import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

if (process.argv[3] === "--version") {
  console.log("opencode v2.0.28");
  process.exit(0);
}
const marker = process.argv[2];
if (!marker) throw new Error("Missing initialization marker");
const agent = acp.agent({ name: "http-startup-peer" });
agent.onRequest(acp.methods.agent.initialize, async () => {
  await Bun.write(marker, "initializing");
  return new Promise<never>(() => undefined);
});
const connection = agent.connect(
  acp.ndJsonStream(
    Writable.toWeb(process.stdout),
    Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
  ),
);
process.stdin.on("end", () => process.exit(0));
await connection.closed;
