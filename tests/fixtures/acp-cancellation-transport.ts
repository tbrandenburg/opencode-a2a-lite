import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

if (process.argv[3] === "--version") {
  console.log("opencode v2.0.28");
  process.exit(0);
}
const mode = process.argv[2];
const agent = acp.agent({ name: "cancellation-transport-peer" });
const canceled = Promise.withResolvers<void>();
agent.onRequest(acp.methods.agent.initialize, async () => ({
  protocolVersion: 1,
  agentCapabilities: {},
}));
agent.onRequest(acp.methods.agent.session.new, async () => ({ sessionId: "transport-session" }));
agent.onNotification(acp.methods.agent.session.cancel, async () => canceled.resolve());
agent.onRequest(acp.methods.agent.session.prompt, async (request) => {
  const chunk = (text: string) =>
    request.client.notify(acp.methods.client.session.update, {
      sessionId: request.params.sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    });
  await chunk("A");
  await canceled.promise;
  // A 4 MiB burst exercises paused HTTP reads beyond small buffered responses.
  for (let index = 0; index < 64; index++) await chunk("B".repeat(65_536));
  return { stopReason: mode === "completed" ? "end_turn" : "cancelled" };
});
const connection = agent.connect(
  acp.ndJsonStream(
    Writable.toWeb(process.stdout),
    Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
  ),
);
process.stdin.on("end", () => process.exit(0));
await connection.closed;
