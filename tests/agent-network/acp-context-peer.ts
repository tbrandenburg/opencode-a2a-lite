import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

if (process.argv.includes("--version")) {
  console.log("opencode v2.0.28");
  process.exit(0);
}
const receipt = process.argv[2]!;
const agent = acp.agent({ name: "controlled-context-peer" });
const sessions = new Map<string, number>();
let release: (() => void) | undefined;
const audit = (entry: object) =>
  appendFileSync(receipt, JSON.stringify(entry) + "\n", { mode: 0o600 });
agent.onRequest(acp.methods.agent.initialize, async () => ({
  protocolVersion: 1,
  agentCapabilities: {},
}));
agent.onRequest(acp.methods.agent.session.new, async () => {
  const sessionId = randomUUID();
  sessions.set(sessionId, 0);
  audit({ event: "session", sessionId });
  return { sessionId };
});
agent.onRequest(acp.methods.agent.session.prompt, async (request) => {
  const sessionId = request.params.sessionId;
  const previous = sessions.get(sessionId);
  if (previous === undefined) throw new Error("Unknown fixture session");
  const turn = previous + 1;
  sessions.set(sessionId, turn);
  const part = request.params.prompt[0];
  if (part?.type !== "text") throw new Error("Expected text");
  audit({ event: "prompt", sessionId, turn, command: part.text });
  if (part.text === "fail") throw acp.RequestError.authRequired();
  const output = `${sessionId}:${turn}:${part.text}`;
  await request.client.notify(acp.methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: output },
    },
  });
  if (part.text.startsWith("hold")) {
    await new Promise<void>((done) => {
      release = done;
    });
    release = undefined;
    return { stopReason: part.text === "hold-lose" ? "end_turn" : "cancelled" };
  }
  return { stopReason: "end_turn" };
});
agent.onNotification(acp.methods.agent.session.cancel, async (notification) => {
  audit({ event: "cancel", sessionId: notification.params.sessionId });
  release?.();
});
const connection = agent.connect(
  acp.ndJsonStream(
    Writable.toWeb(process.stdout),
    Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
  ),
);
process.stdin.on("end", () => process.exit(0));
await connection.closed;
