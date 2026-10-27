import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

if (process.argv[3] === "--version") {
  console.log("opencode v2.0.28");
  process.exit(0);
}
const marker = process.argv[2];
if (!marker) throw new Error("Missing initialization marker");
// Keep startup-failure fixtures independent of SDK loading overhead.
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  try {
    const request: unknown = JSON.parse(line);
    if (
      !request ||
      typeof request !== "object" ||
      !("jsonrpc" in request) ||
      request.jsonrpc !== "2.0" ||
      !("method" in request) ||
      request.method !== "initialize" ||
      !("id" in request) ||
      (typeof request.id !== "number" && typeof request.id !== "string")
    )
      throw new Error("Invalid initialization request");
    if (marker === "--protocol-2") {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { protocolVersion: 2, agentCapabilities: {} },
        }) + "\n",
      );
      return;
    }
    writeFileSync(marker, "initializing");
  } catch {
    throw new Error("Invalid initialization request");
  }
});
input.on("close", () => process.exit(0));
