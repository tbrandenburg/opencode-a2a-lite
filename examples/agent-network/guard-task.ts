import { createHash } from "node:crypto";
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
