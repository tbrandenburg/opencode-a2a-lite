const KEY = "opencode.sessionId";
const SESSION = /^ses_[A-Za-z0-9]{8,64}$/;

export type Wanted = { id: string } | { error: string };

/** Reads the OpenCode session a client wants to continue from message metadata. */
export function wantedSession(metadata: unknown): Wanted | undefined {
  if (typeof metadata !== "object" || metadata === null || !(KEY in metadata)) return;
  const value = (metadata as Record<string, unknown>)[KEY];
  return typeof value === "string" && SESSION.test(value)
    ? { id: value }
    : { error: `Invalid ${KEY}; expected an OpenCode session id like ses_…` };
}

/** Returns why a resume request must not proceed, or undefined when it may. */
export function resumeRefusal(
  wanted: Wanted,
  enabled: boolean,
  existing: string | undefined,
  bound: Iterable<string>,
): string | undefined {
  if (!enabled) return "Session resume is not enabled; start the gateway with --allow-resume";
  if ("error" in wanted) return wanted.error;
  if (existing !== undefined && existing !== wanted.id)
    return "This context is already bound to a different session";
  if (existing === undefined && new Set(bound).has(wanted.id))
    return "That session is already in use by another context";
  return undefined;
}
