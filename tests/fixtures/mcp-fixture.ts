import { writeFileSync } from "node:fs";
// Harmless stdio MCP fixture: tools `ping` and `other` only record that they were called.
const sentinel = process.argv[2]!;
const send = (o: object) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...o }) + "\n");
let buf = "";
process.stdin.on("data", (d) => {
  buf += d;
  for (;;) {
    const i = buf.indexOf("\n");
    if (i < 0) return;
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const m = JSON.parse(line);
    if (m.id === undefined) continue;
    if (m.method === "initialize")
      send({
        id: m.id,
        result: {
          protocolVersion: m.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "fx", version: "1" },
        },
      });
    else if (m.method === "tools/list")
      send({
        id: m.id,
        result: {
          tools: [
            { name: "ping", description: "ping", inputSchema: { type: "object", properties: {} } },
            {
              name: "other",
              description: "other",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      });
    else if (m.method === "tools/call") {
      writeFileSync(sentinel + "." + m.params.name, "called");
      send({ id: m.id, result: { content: [{ type: "text", text: "pong" }] } });
    } else send({ id: m.id, error: { code: -32601, message: "x" } });
  }
});
