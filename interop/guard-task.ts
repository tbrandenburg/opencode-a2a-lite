import { createHash } from "node:crypto";
export const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
export type Audit = Record<string, unknown>;

// Submitted arguments are untrusted; only returned identifiers establish provenance.
export function submittedIdentifiers(args: Audit) {
  return {
    contextPresent: Object.hasOwn(args, "context_id"),
    ...(typeof args.context_id === "string" ? { contextHash: sha256(args.context_id) } : {}),
    taskPresent: Object.hasOwn(args, "task_id"),
    ...(typeof args.task_id === "string" ? { taskHash: sha256(args.task_id) } : {}),
  };
}

export function pairedResult(call: Audit, audit: readonly Audit[]): Audit | undefined {
  if (typeof call.connection !== "string" || typeof call.id !== "string") return undefined;
  const results = audit.filter(
    (entry) =>
      entry.event === "result" &&
      entry.connection === call.connection &&
      entry.id === call.id &&
      entry.tool === call.tool,
  );
  return results.length === 1 ? results[0] : undefined;
}

// Per-connection receipt privacy, never a modification of forwarded MCP results.
export function createResultMetadata() {
  const known = new Set<string>();
  const reflected = new Set<string>();
  const key = (peer: unknown, field: string, digest: string) =>
    JSON.stringify([peer, field, digest]);
  const project = (entry: Audit, peer: unknown): Audit => {
    const output = { ...entry };
    for (const field of ["context", "task"] as const) {
      const value = entry[`${field}Id`];
      if (typeof value !== "string") continue;
      const digest = sha256(value);
      if (!reflected.has(key(peer, field, digest))) continue;
      delete output[`${field}Id`];
      output[`${field}Hash`] = digest;
      output[`${field}Untrusted`] = true;
    }
    return output;
  };
  return {
    capture(entry: Audit, call?: Audit): Audit {
      const peer = call?.peer;
      for (const field of ["context", "task"] as const) {
        const value = entry[`${field}Id`];
        const digest = typeof value === "string" ? sha256(value) : entry[`${field}Hash`];
        if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) continue;
        const identity = key(peer, field, digest);
        const failed = ["TASK_STATE_FAILED", "TASK_STATE_REJECTED"].includes(String(entry.state));
        const echo =
          call &&
          typeof value === "string" &&
          call[`${field}Present`] === true &&
          call[`${field}Hash`] === digest;
        if (
          !known.has(identity) &&
          (entry[`${field}Untrusted`] === true || (echo && (field === "context" || failed)))
        )
          reflected.add(identity);
        if (typeof value === "string" && !reflected.has(identity)) known.add(identity);
      }
      return project(entry, peer);
    },
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Persist transport metadata only, never task text or provider diagnostics.
export function taskMetadata(result: unknown): Record<string, string> {
  if (!isRecord(result) || result.isError === true || !Array.isArray(result.content)) return {};
  try {
    const text = result.content
      .map((part: unknown) =>
        isRecord(part) && part.type === "text" && typeof part.text === "string" ? part.text : "",
      )
      .join("");
    const envelope: unknown = JSON.parse(text);
    if (!isRecord(envelope)) return {};
    const task = isRecord(envelope.task) ? envelope.task : envelope;
    if (typeof task.id !== "string" || typeof task.contextId !== "string" || !isRecord(task.status))
      return {};
    if (![task.id, task.contextId].every((id) => /^[\w-]{1,256}$/.test(id))) return {};
    const state = task.status.state;
    if (
      typeof state !== "string" ||
      !/^TASK_STATE_(SUBMITTED|WORKING|INPUT_REQUIRED|AUTH_REQUIRED|COMPLETED|FAILED|REJECTED|CANCELED)$/.test(
        state,
      )
    )
      return {};
    const artifacts = Array.isArray(task.artifacts) ? task.artifacts : [];
    const output = artifacts
      .flatMap((artifact: unknown) =>
        isRecord(artifact) && Array.isArray(artifact.parts) ? artifact.parts : [],
      )
      .map((part: unknown) => {
        if (!isRecord(part)) return "";
        if (typeof part.text === "string") return part.text;
        return isRecord(part.content) &&
          part.content.$case === "text" &&
          typeof part.content.value === "string"
          ? part.content.value
          : "";
      })
      .join("");
    return {
      taskId: task.id,
      contextId: task.contextId,
      state,
      artifactHash: createHash("sha256").update(output).digest("hex"),
    };
  } catch {
    return {};
  }
}
