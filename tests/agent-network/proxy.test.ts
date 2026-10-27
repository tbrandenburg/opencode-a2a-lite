import { expect, test } from "bun:test";
import { Readable } from "node:stream";
import {
  filterCatalog,
  loopback,
  readPackets,
  toolDecision,
} from "../../examples/agent-network/bridge-proxy.js";

const peers = ["http://127.0.0.1:4123/", "http://[::1]:4124/"];

test("N01 guard requires exact loopback roots, approved tools and a forty-call ceiling", () => {
  expect(toolDecision("a2a_get_task", { peer_url: peers[1] }, peers, 40)).toBeUndefined();
  expect(toolDecision("a2a_list_agents", {}, peers, 1)).toBeUndefined();
  expect(toolDecision("a2a_send_message", { peer_url: peers[0] }, peers, 41)).toBe("budget");
  expect(toolDecision("a2a_inbox", { peer_url: peers[0] }, peers, 1)).toBe("tool");
  expect(toolDecision("unknown", {}, peers, 1)).toBe("tool");
  expect(toolDecision("a2a_send_message", { peer_url: peers[0]!.slice(0, -1) }, peers, 1)).toBe(
    "peer",
  );
  expect(toolDecision("a2a_send_message", { peer_url: "http://127.0.0.1:9999/" }, peers, 1)).toBe(
    "peer",
  );
  const external = "http://example.com/";
  expect(toolDecision("a2a_send_message", { peer_url: external }, [external], 1)).toBe("peer");
  expect(loopback("http://localhost:9000/path", true)).toBe(false);
  expect(loopback("http://user:password@localhost/", true)).toBe(false);
  expect(loopback("http://localhost/?secret=x", true)).toBe(false);
});

test("N02 catalog preserves real schemas without inventing absent permitted tools", () => {
  const schema = { name: "a2a_whoami", inputSchema: { type: "object" }, description: "real" };
  const result = { tools: [schema, { name: "a2a_inbox" }, null], nextCursor: "cursor" };
  expect(filterCatalog(result)).toEqual(["a2a_whoami"]);
  expect(result.tools).toEqual([schema]);
  expect(result.tools[0]).toBe(schema);
  expect(result.nextCursor).toBe("cursor");
  expect(() => filterCatalog({ tools: "invalid" })).toThrow();
});

test("N03 fragmented JSONL delivers complete packets and rejects malformed transport", async () => {
  const received: Record<string, unknown>[] = [];
  const collect = async (packet: Record<string, unknown>) => {
    received.push(packet);
  };
  await readPackets(
    Readable.from([
      '{"jsonrpc":"2.0","method":"notifications/',
      'initialized"}\n{"jsonrpc":"2.0","id":2,"method":"sampling/createMessage","params":{"messages":[]}}',
    ]),
    collect,
  );
  expect(received).toEqual([
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "sampling/createMessage", params: { messages: [] } },
  ]);
  await expect(readPackets(Readable.from(["[]\n"]), collect)).rejects.toThrow();
  await expect(
    readPackets(Readable.from(["x".repeat(4 * 1024 * 1024 + 1)]), collect),
  ).rejects.toThrow();
  expect(received).toHaveLength(2);
});
