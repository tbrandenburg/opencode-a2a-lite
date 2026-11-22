import type { Part } from "@a2a-js/sdk";

export interface PermissionOption {
  optionId: string;
  kind: string;
}

export interface PermissionRequest {
  title: string;
  kind?: string;
  options: PermissionOption[];
}

export type PermissionDecision =
  | { outcome: "selected"; optionId: string; denied: boolean }
  | { outcome: "cancelled"; denied: boolean };

const OFFERED = new Set(["allow_once", "reject_once", "reject_always"]);
const ALLOW = new Set(["allow", "approve", "yes"]);
const REJECT = new Set(["reject", "deny", "no"]);

// allow_always would change OpenCode's permission rules for later sessions, so it is never offered.
export function offeredOptions(options: readonly PermissionOption[]): PermissionOption[] {
  return options.filter((option) => OFFERED.has(option.kind));
}

export function decide(
  options: readonly PermissionOption[],
  chosen: string | undefined,
): PermissionDecision {
  const offered = offeredOptions(options);
  const pick = offered.find((option) => option.optionId === chosen);
  if (pick?.kind === "allow_once")
    return { outcome: "selected", optionId: pick.optionId, denied: false };
  const reject = pick ?? offered.find((option) => option.kind.startsWith("reject"));
  return reject
    ? { outcome: "selected", optionId: reject.optionId, denied: true }
    : { outcome: "cancelled", denied: true };
}

function dataAnswer(value: unknown): { requestId?: string; optionId?: string } | undefined {
  if (typeof value !== "object" || value === null || !("permissionResponse" in value)) return;
  const answer = value.permissionResponse;
  if (typeof answer !== "object" || answer === null) return;
  const { requestId, optionId } = answer as Record<string, unknown>;
  return {
    ...(typeof requestId === "string" ? { requestId } : {}),
    ...(typeof optionId === "string" ? { optionId } : {}),
  };
}

export function parseAnswer(
  parts: readonly Part[],
  requestId: string,
  options: readonly PermissionOption[],
): { optionId: string } | { error: string } {
  const offered = offeredOptions(options);
  const data = parts.flatMap((part) =>
    part.content?.$case === "data" ? [dataAnswer(part.content.value)] : [],
  )[0];
  if (data) {
    if (data.requestId !== requestId) return { error: "The permission request id does not match" };
    const pick = offered.find((option) => option.optionId === data.optionId);
    return pick ? { optionId: pick.optionId } : { error: "The option is not offered" };
  }
  const text = parts
    .map((part) => (part.content?.$case === "text" ? part.content.value : ""))
    .join(" ")
    .trim()
    .toLowerCase();
  const wanted = ALLOW.has(text) ? "allow_once" : REJECT.has(text) ? "reject" : undefined;
  const pick = offered.find((option) => option.kind.startsWith(wanted ?? "\0"));
  return pick ? { optionId: pick.optionId } : { error: "Unrecognized answer" };
}

interface Asker {
  onPermission: ((request: PermissionRequest) => Promise<string | undefined>) | undefined;
  hold: { count: number; rearm?: () => void };
  released: { promise: Promise<undefined> };
}

// Asks the operator while holding the prompt deadline; cancellation or a failing callback means no answer.
export async function askOperator(
  turn: Asker,
  params: {
    toolCall: { title?: string | null; kind?: string | null };
    options: readonly PermissionOption[];
  },
): Promise<string | undefined> {
  if (!turn.onPermission) return;
  turn.hold.count += 1;
  try {
    return await Promise.race([
      turn.released.promise,
      turn.onPermission({
        title: params.toolCall.title ?? "tool",
        ...(params.toolCall.kind ? { kind: params.toolCall.kind } : {}),
        options: offeredOptions(params.options),
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    turn.hold.count -= 1;
    if (!turn.hold.count) turn.hold.rearm?.();
  }
}
