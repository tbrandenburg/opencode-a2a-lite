import type * as acp from "@agentclientprotocol/sdk";

export interface ReplayMessage {
  role: "user" | "assistant";
  text: string;
}

export interface Replay {
  messages: ReplayMessage[];
  truncated: boolean;
}

export const REPLAY_MESSAGES = 100;
export const REPLAY_CHARS = 20_000;

// Tool calls, tool output and reasoning that OpenCode also replays are deliberately dropped.
function chunkOf(update: acp.SessionUpdate) {
  if (
    update.sessionUpdate !== "user_message_chunk" &&
    update.sessionUpdate !== "agent_message_chunk"
  )
    return;
  if (update.content.type !== "text") return;
  if (update.content._meta?.["opencode/child-session"] !== undefined) return;
  return {
    role:
      update.sessionUpdate === "user_message_chunk" ? ("user" as const) : ("assistant" as const),
    id: "messageId" in update && typeof update.messageId === "string" ? update.messageId : "",
    text: update.content.text,
  };
}

/** Collects the text messages OpenCode replays on session/load, keeping only the newest bounded set. */
export function createReplayCollector(limit = REPLAY_MESSAGES, maxChars = REPLAY_CHARS) {
  const messages: ReplayMessage[] = [];
  let truncated = false;
  let lastKey = "";

  function collect(update: acp.SessionUpdate) {
    const chunk = chunkOf(update);
    if (!chunk) return;
    const key = `${chunk.role}:${chunk.id}`;
    const last = messages.at(-1);
    if (last && key === lastKey) {
      last.text = clip(last.text + chunk.text);
      return;
    }
    lastKey = key;
    messages.push({ role: chunk.role, text: clip(chunk.text) });
    if (messages.length > limit) {
      messages.shift();
      truncated = true;
    }
  }

  function clip(text: string) {
    if (text.length <= maxChars) return text;
    truncated = true;
    return text.slice(0, maxChars);
  }

  return { collect, result: (): Replay => ({ messages: [...messages], truncated }) };
}
