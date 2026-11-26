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

const REPLAY_KEY = "opencode.replay";
export type WantedReplay = boolean | "invalid";

/** Reads whether the client wants the earlier conversation replayed; absent means not asked. */
export function wantedReplay(metadata: unknown): WantedReplay | undefined {
  if (typeof metadata !== "object" || metadata === null || !(REPLAY_KEY in metadata)) return;
  const value = (metadata as Record<string, unknown>)[REPLAY_KEY];
  return typeof value === "boolean" ? value : "invalid";
}

export interface ResumeAsk {
  wanted: Wanted | undefined;
  replay: WantedReplay | undefined;
}

function replayRefusal(
  replay: WantedReplay | undefined,
  wanted: Wanted | undefined,
  existing: string | undefined,
): string | undefined {
  if (replay === "invalid") return `${REPLAY_KEY} must be true or false`;
  if (replay === true && (!wanted || existing !== undefined))
    return `${REPLAY_KEY} only applies to the first message that resumes a session`;
  return undefined;
}

/** Returns why a resume request must not proceed, or undefined when it may. */
export function resumeRefusal(
  ask: ResumeAsk,
  enabled: boolean,
  existing: string | undefined,
  bound: Iterable<string>,
): string | undefined {
  const { wanted, replay } = ask;
  if (!enabled) return "Session resume is not enabled; start the gateway with --enable resume";
  const misuse = replayRefusal(replay, wanted, existing);
  if (misuse || !wanted) return misuse;
  if ("error" in wanted) return wanted.error;
  if (existing !== undefined && existing !== wanted.id)
    return "This context is already bound to a different session";
  if (existing === undefined && new Set(bound).has(wanted.id))
    return "That session is already in use by another context";
  return undefined;
}
