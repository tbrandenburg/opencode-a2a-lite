import { randomUUID } from "node:crypto";
import { AgentEvent } from "@a2a-js/sdk/server";
import type { Replay } from "./replay.js";

/** One artifact holding the replayed earlier messages of a resumed session, oldest first. */
export function conversationEvent(taskId: string, contextId: string, replay: Replay) {
  return AgentEvent.artifactUpdate({
    taskId,
    contextId,
    artifact: {
      artifactId: randomUUID(),
      name: "conversation",
      description: "Earlier messages of the resumed session",
      parts: replay.messages.map((message) => ({
        content: { $case: "data" as const, value: { ...message } },
        mediaType: "application/json",
        filename: "",
        metadata: undefined,
      })),
      metadata: undefined,
      extensions: [],
    },
    append: false,
    lastChunk: true,
    metadata: undefined,
  });
}
