import { afterEach, expect, test } from "bun:test";
import { setTimeout } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { callTool, ToolError } from "../../examples/agent-network/transport.js";
import { createTaskClient, type Observation } from "../../examples/agent-network/task-client.js";

const releases: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(releases.splice(0).map((close) => close()));
});
const options = (ms = 2_000) => ({ deadline: performance.now() + ms });
const raw = (state = "WORKING", id = "actual-task", contextId = "actual-context") => ({
  id,
  contextId,
  status: { state: `TASK_STATE_${state}` },
});
type Request = { name: string; args: Record<string, unknown>; signal: AbortSignal };
async function fixture(handler: (request: Request) => Promise<unknown> | unknown) {
  const server = new Server(
    { name: "controlled-tool-peer", version: "1" },
    { capabilities: { tools: {} } },
  );
  const client = new Client({ name: "deadline-test", version: "1" });
  const [local, remote] = InMemoryTransport.createLinkedPair();
  const calls: Request[] = [];
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const call = {
      name: request.params.name,
      args: request.params.arguments ?? {},
      signal: extra.signal,
    };
    calls.push(call);
    try {
      const value = await handler(call);
      return { content: [{ type: "text", text: JSON.stringify(value) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text", text: String(error) }] };
    }
  });
  await server.connect(remote);
  await client.connect(local);
  releases.push(async () => {
    await client.close();
    await server.close();
  });
  let attempts = 0;
  const connection = {
    get remainingCalls() {
      return 40 - attempts;
    },
    async call(name: string, args: Record<string, unknown>, error = false, limits = options()) {
      attempts++;
      return callTool(client, name, args, error, limits);
    },
  };
  return { calls, connection, peer: createTaskClient(connection, "http://127.0.0.1:1001/") };
}
function received(
  value: Awaited<ReturnType<ReturnType<typeof createTaskClient>["submit"]>>,
): Observation {
  if (value.outcome === "uncertain") throw new Error("Unexpected uncertainty");
  return value;
}

test("actual handles isolate two conversations and two peers; continuation omits task_id", async () => {
  const f = await fixture((request) =>
    raw(
      "COMPLETED",
      `task-${f.calls.length}`,
      String(request.args.context_id ?? `context-${f.calls.length}`),
    ),
  );
  const other = createTaskClient(f.connection, "http://127.0.0.1:1002/");
  const first = received(await f.peer.submit("one", options()));
  const second = received(await other.submit("two", options()));
  const followup = received(await f.peer.submit("again", options(), first.handle));
  expect(first.handle.contextId).toBe("context-1");
  expect(second.handle).toEqual({
    peerUrl: "http://127.0.0.1:1002/",
    contextId: "context-2",
    taskId: "task-2",
  });
  expect(followup.handle.contextId).toBe(first.handle.contextId);
  expect(followup.handle.taskId).not.toBe(first.handle.taskId);
  expect(f.calls[2]!.args).toEqual({
    peer_url: first.handle.peerUrl,
    text: "again",
    blocking: false,
    context_id: "context-1",
  });
  await expect(other.submit("wrong", options(), first.handle)).rejects.toThrow("Cross-peer");
  await expect(other.get(first.handle, options())).rejects.toThrow("Cross-peer");
  await expect(other.cancel(first.handle, options())).rejects.toThrow("Cross-peer");
  expect(f.calls).toHaveLength(3);
});

test.each([
  ["COMPLETED", "completed"],
  ["FAILED", "failed"],
  ["CANCELED", "canceled"],
  ["WORKING", "pending"],
] as const)("successful MCP %s is classified %s", async (state, outcome) => {
  const f = await fixture(() => raw(state));
  const result = received(await f.peer.submit("start", options()));
  expect(result.outcome).toBe(outcome);
  expect(result.handle.taskId).toBe("actual-task");
});

test("hung in-flight get obeys absolute deadline and sends MCP abort without remote cancel", async () => {
  const f = await fixture(async (request) => {
    if (request.name === "a2a_send_message") return raw();
    await setTimeout(10_000, undefined, { signal: request.signal });
    return raw();
  });
  const initial = received(await f.peer.submit("held", options()));
  const started = performance.now();
  const result = await f.peer.wait(initial, options(70));
  expect(performance.now() - started).toBeLessThan(600);
  expect(result.reason).toBe("deadline");
  expect(result.handle).toEqual(initial.handle);
  expect(result.outcome).toBe("pending");
  await setTimeout(20);
  expect(f.calls.map((call) => call.name)).toEqual(["a2a_send_message", "a2a_get_task"]);
  expect(f.calls[1]!.signal.aborted).toBe(true);
});

test("sleep cannot extend deadline or start another poll", async () => {
  const f = await fixture(() => raw());
  const initial = received(await f.peer.submit("held", options()));
  const started = performance.now();
  const result = await f.peer.wait(initial, { ...options(70), intervalMs: 10_000 });
  expect(result.reason).toBe("deadline");
  expect(performance.now() - started).toBeLessThan(600);
  await setTimeout(30);
  expect(f.calls).toHaveLength(2);
  expect(result.task.id).toBe(initial.task.id);
});

test("abort stops wait during sleep, preserves state and permits explicit cancel later", async () => {
  const f = await fixture((request) =>
    raw(request.name === "a2a_cancel_task" ? "CANCELED" : "WORKING"),
  );
  const initial = received(await f.peer.submit("held", options()));
  const controller = new AbortController();
  const waiting = f.peer.wait(initial, {
    ...options(),
    signal: controller.signal,
    intervalMs: 10_000,
  });
  await setTimeout(30);
  controller.abort();
  const result = await waiting;
  expect(result.reason).toBe("aborted");
  expect(result.outcome).toBe("pending");
  expect(f.calls).toHaveLength(2);
  expect((await f.peer.cancel(result.handle, options())).outcome).toBe("canceled");
  expect(f.calls[2]!.name).toBe("a2a_cancel_task");
});

test("poll bound and shared intervention reserve include other callers", async () => {
  const f = await fixture(() => raw());
  const initial = received(await f.peer.submit("held", options()));
  expect((await f.peer.wait(initial, { ...options(), maxPolls: 2, intervalMs: 0 })).reason).toBe(
    "poll-limit",
  );
  expect(f.calls).toHaveLength(3);
  for (let count = 0; count < 29; count++) await f.connection.call("a2a_get_task", {});
  expect((await f.peer.wait(initial, options())).reason).toBe("budget");
  expect(f.calls).toHaveLength(32);
  expect(f.connection.remainingCalls).toBe(8);
});

test("submission timeout has no fabricated handle and never resends", async () => {
  const f = await fixture(async (request) => {
    await setTimeout(10_000, undefined, { signal: request.signal });
    return raw();
  });
  const result = await f.peer.submit("may have been accepted", options(60));
  expect(result.outcome).toBe("uncertain");
  expect("handle" in result).toBe(false);
  await setTimeout(30);
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]!.signal.aborted).toBe(true);
});

test("bridge unary timeout tool error without a handle remains submission uncertainty", async () => {
  const f = await fixture(() => {
    throw new Error("context deadline exceeded");
  });
  const result = await f.peer.submit("may have been accepted", options());
  expect(result.outcome).toBe("uncertain");
  if (result.outcome !== "uncertain") throw new Error("Expected uncertainty");
  expect(result.cause).toBeInstanceOf(ToolError);
  expect("handle" in result).toBe(false);
  expect(f.calls).toHaveLength(1);
});

test("in-flight abort preserves observed task and submission abort remains uncertain", async () => {
  const f = await fixture(async (request) => {
    if (f.calls.length === 1) return raw();
    await setTimeout(10_000, undefined, { signal: request.signal });
    return raw();
  });
  const initial = received(await f.peer.submit("held", options()));
  const controller = new AbortController();
  const waiting = f.peer.wait(initial, { ...options(), signal: controller.signal });
  await setTimeout(20);
  controller.abort();
  const result = await waiting;
  expect(result.reason).toBe("aborted");
  expect(result.handle).toEqual(initial.handle);
  const submitting = new AbortController();
  const submission = f.peer.submit("unknown", { ...options(), signal: submitting.signal });
  await setTimeout(20);
  submitting.abort();
  expect((await submission).outcome).toBe("uncertain");
  await setTimeout(20);
  expect(f.calls).toHaveLength(3);
  expect(f.calls[1]!.signal.aborted).toBe(true);
  expect(f.calls[2]!.signal.aborted).toBe(true);
});

test("malformed IDs, unknown state and changed observation IDs fail visibly", async () => {
  const malformed = await fixture(() => ({ status: { state: "TASK_STATE_COMPLETED" } }));
  await expect(malformed.peer.submit("no IDs", options())).rejects.toThrow("actual task ID");
  expect(malformed.calls).toHaveLength(1);
  const unknown = await fixture(() => raw("UNSPECIFIED"));
  await expect(unknown.peer.submit("unknown state", options())).rejects.toThrow(
    "Unknown task state",
  );
  expect(unknown.calls).toHaveLength(1);
  const changed = await fixture(() =>
    raw("WORKING", changed.calls.length === 1 ? "actual-task" : "wrong-task"),
  );
  const initial = received(await changed.peer.submit("start", options()));
  await expect(changed.peer.wait(initial, options())).rejects.toThrow("Task ID changed");
  expect(changed.calls).toHaveLength(2);
});

test("expired/preaborted work and streaming continuation fail before dispatch", async () => {
  const f = await fixture(() => raw());
  const first = received(await f.peer.submit("first", options()));
  const controller = new AbortController();
  controller.abort();
  await expect(f.peer.submit("no", { ...options(), signal: controller.signal })).rejects.toThrow();
  await expect(f.peer.submit("no", options(-1))).rejects.toThrow("deadline");
  await expect(f.peer.submit("no", options(), first.handle, "streaming")).rejects.toThrow("4.0.2");
  expect((await f.peer.wait(first, { ...options(), signal: controller.signal })).reason).toBe(
    "aborted",
  );
  expect((await f.peer.wait(first, options(-1))).reason).toBe("deadline");
  expect(f.calls).toHaveLength(1);
});

test("stale context, unknown tasks and cancel errors propagate; losing cancel race stays completed", async () => {
  const f = await fixture((request) => {
    if (request.args.context_id)
      return raw("FAILED", "new-failed-task", String(request.args.context_id));
    if (request.name === "a2a_get_task") throw new Error("unknown task");
    if (request.name === "a2a_cancel_task" && f.calls.length === 4) return raw("COMPLETED");
    if (request.name === "a2a_cancel_task") throw new Error("not cancelable");
    return raw();
  });
  const first = received(await f.peer.submit("start", options()));
  const stale = received(await f.peer.submit("stale", options(), first.handle));
  expect(stale.outcome).toBe("failed");
  expect(stale.handle.taskId).toBe("new-failed-task");
  await expect(f.peer.get(first.handle, options())).rejects.toThrow("unknown task");
  expect((await f.peer.cancel(first.handle, options())).outcome).toBe("completed");
  await expect(f.peer.cancel(first.handle, options())).rejects.toBeInstanceOf(ToolError);
  expect(f.calls).toHaveLength(5);
});
