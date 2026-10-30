import { expect, test } from "bun:test";
import { Readable } from "node:stream";
import { filterCatalog, loopback, readPackets, toolDecision } from "../../interop/bridge-proxy.js";
import {
  createResultMetadata,
  pairedResult,
  sha256,
  submittedIdentifiers,
  taskMetadata,
} from "../../interop/guard-task.js";

const peers = ["http://127.0.0.1:4123/", "http://[::1]:4124/"];

test("N19 receipt provenance hashes unknown reflected identifiers without changing returned tasks", () => {
  const metadata = createResultMetadata();
  const sentinel = "PRIVATE-UNKNOWN-IDENTIFIER";
  const call = {
    event: "call",
    connection: "one",
    id: "1",
    tool: "a2a_send_message",
    peer: peers[0],
    ...submittedIdentifiers({ context_id: sentinel, task_id: sentinel }),
  };
  const task = {
    id: sentinel,
    contextId: sentinel,
    status: { state: "TASK_STATE_FAILED" },
    artifacts: [{ parts: [{ text: "PRIVATE-OUTPUT" }] }],
  };
  const result = taskMetadata({ content: [{ type: "text", text: JSON.stringify(task) }] });
  const sanitized = metadata.capture(result, call);
  expect(sanitized).toEqual({
    contextHash: sha256(sentinel),
    taskHash: sha256(sentinel),
    contextUntrusted: true,
    taskUntrusted: true,
    state: "TASK_STATE_FAILED",
    artifactHash: sha256("PRIVATE-OUTPUT"),
  });
  expect(JSON.stringify({ call, sanitized })).not.toContain(sentinel);
  expect(task.contextId).toBe(sentinel);
  expect(metadata.capture(result, { peer: peers[0] })).toEqual(sanitized);
  const fresh = {
    taskId: "returned-task",
    contextId: "returned-context",
    state: "TASK_STATE_COMPLETED",
  };
  expect(metadata.capture(fresh, { peer: peers[0], ...submittedIdentifiers({}) })).toEqual(fresh);
  expect(
    metadata.capture(fresh, {
      peer: peers[0],
      ...submittedIdentifiers({ context_id: fresh.contextId }),
    }),
  ).toEqual(fresh);
  const audit = [{ ...sanitized, event: "result", connection: "one", id: "1", tool: call.tool }];
  expect(pairedResult(call, audit)).toBe(audit[0]);
  expect(pairedResult(call, [...audit, ...audit])).toBeUndefined();
  expect(pairedResult({ ...call, connection: "other" }, audit)).toBeUndefined();
});

test("N01 guard requires exact loopback roots, approved tools and a forty-call ceiling", () => {
  expect(toolDecision("a2a_get_task", { peer_url: peers[1] }, peers, 40)).toBeUndefined();
  expect(toolDecision("a2a_list_agents", {}, peers, 1)).toBeUndefined();
  expect(
    toolDecision("a2a_send_message", { peer_url: peers[0], blocking: false }, peers, 1),
  ).toBeUndefined();
  expect(toolDecision("a2a_send_message", { peer_url: peers[0], blocking: false }, peers, 41)).toBe(
    "budget",
  );
  expect(
    toolDecision("a2a_send_message", { peer_url: peers[0], blocking: false }, peers, 40),
  ).toBeUndefined();
  for (const args of [{ peer_url: peers[0] }, { peer_url: peers[0], blocking: true }])
    expect(toolDecision("a2a_send_message", args, peers, 41)).toBe("budget");
  expect(toolDecision("a2a_inbox", { peer_url: peers[0] }, peers, 1)).toBe("tool");
  expect(toolDecision("unknown", {}, peers, 1)).toBe("tool");
  expect(toolDecision("a2a_send_message", { peer_url: peers[0]!.slice(0, -1) }, peers, 1)).toBe(
    "peer",
  );
  expect(toolDecision("a2a_send_message", { peer_url: "http://127.0.0.1:9999/" }, peers, 1)).toBe(
    "peer",
  );
  const external = "http://example.com/";
  expect(
    toolDecision("a2a_send_message", { peer_url: external, blocking: false }, [external], 1),
  ).toBe("peer");
  expect(toolDecision("a2a_send_message", { peer_url: external, blocking: false }, peers, 1)).toBe(
    "peer",
  );
  expect(toolDecision("a2a_send_message", { peer_url: external, blocking: true }, peers, 1)).toBe(
    "peer",
  );
  expect(toolDecision("unsupported", { blocking: true }, peers, 41)).toBe("tool");
  expect(toolDecision("a2a_send_message", { peer_url: peers[0] }, peers, 1)).toBe("mode");
  expect(toolDecision("a2a_send_message", { peer_url: peers[0], blocking: true }, peers, 1)).toBe(
    "mode",
  );
  expect(
    toolDecision("a2a_send_message", { peer_url: peers[0], blocking: "false" }, peers, 1),
  ).toBe("mode");
  expect(toolDecision("a2a_send_message", { peer_url: peers[0], blocking: null }, peers, 1)).toBe(
    "mode",
  );
  expect(toolDecision("a2a_send_message", null, peers, 1)).toBe("mode");
  expect(toolDecision("a2a_send_message", [], peers, 1)).toBe("mode");
  expect(toolDecision("a2a_send_streaming", { peer_url: peers[0] }, peers, 1)).toBeUndefined();
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
