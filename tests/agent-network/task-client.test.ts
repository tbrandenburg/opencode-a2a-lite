import { afterEach, expect, test } from "bun:test";
import { setTimeout } from "node:timers/promises";
import { TaskState } from "@a2a-js/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolRequestSchema, ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { callTool, LocalDeadlineError } from "../../interop/transport.js";
import { createTaskClient, type Observation } from "../../interop/task-client.js";

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
      return { content: [{ type: "text", text: JSON.stringify(await handler(call)) }] };
    } catch (error) {
      if (error instanceof McpError) throw error;
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

test("N04 continuation uses actual peer/context and a new task; unknown tasks fail visibly", async () => {
  const f = await fixture((request) => {
    if (request.name === "a2a_get_task") throw new Error("unknown task");
    if (request.args.text === "stale") throw new Error("unknown context");
    return raw(
      "COMPLETED",
      `task-${f.calls.length}`,
      String(request.args.context_id ?? `context-${f.calls.length}`),
    );
  });
  const first = received(await f.peer.submit("one", options()));
  const followup = received(await f.peer.submit("again", options(), first.handle));
  expect(first.handle.contextId).toBe("context-1");
  expect(followup.handle.contextId).toBe(first.handle.contextId);
  expect(followup.handle.taskId).not.toBe(first.handle.taskId);
  expect(followup.outcome).toBe("completed");
  expect(f.calls[1]!.args).toEqual({
    peer_url: first.handle.peerUrl,
    text: "again",
    blocking: false,
    context_id: "context-1",
  });
  const other = createTaskClient(f.connection, "http://127.0.0.1:1002/");
  await expect(other.submit("wrong", options(), first.handle)).rejects.toThrow("Cross-peer");
  await expect(f.peer.get(first.handle, options())).rejects.toThrow("unknown task");
  const stale = await f.peer.submit("stale", options(), first.handle);
  expect(stale.outcome).toBe("uncertain");
  if (stale.outcome !== "uncertain") throw new Error("Expected explicit submission uncertainty");
  expect(String(stale.cause)).toContain("unknown context");
  expect("handle" in stale).toBe(false);
  expect(f.calls).toHaveLength(4);
});

test("N05 deadline and local abort preserve the observed task without remote cancellation", async () => {
  const f = await fixture(async (request) => {
    if (request.name === "a2a_send_message") return raw();
    await setTimeout(10_000, undefined, { signal: request.signal });
    return raw();
  });
  const initial = received(await f.peer.submit("held", options()));
  const started = performance.now();
  const deadline = await f.peer.wait(initial, options(70));
  expect(performance.now() - started).toBeLessThan(600);
  expect(deadline.reason).toBe("deadline");
  expect(deadline.handle).toEqual(initial.handle);
  expect(deadline.task).toEqual(initial.task);
  expect(deadline.outcome).toBe("pending");
  const controller = new AbortController();
  const waiting = f.peer.wait(deadline, { ...options(), signal: controller.signal });
  await setTimeout(20);
  controller.abort();
  const aborted = await waiting;
  expect(aborted.reason).toBe("aborted");
  expect(aborted.handle).toEqual(initial.handle);
  expect(aborted.outcome).toBe("pending");
  await setTimeout(20);
  expect(f.calls.map((call) => call.name)).toEqual([
    "a2a_send_message",
    "a2a_get_task",
    "a2a_get_task",
  ]);
  expect(f.calls[1]!.signal.aborted).toBe(true);
  expect(f.calls[2]!.signal.aborted).toBe(true);
});

test("an in-flight SDK call aborts using the actual cancellation signal", async () => {
  const entered = Promise.withResolvers<void>();
  const canceled = Promise.withResolvers<void>();
  const f = await fixture(async (request) => {
    if (request.name === "a2a_send_message") return raw();
    request.signal.addEventListener("abort", () => canceled.resolve(), { once: true });
    entered.resolve();
    await setTimeout(10_000, undefined, { signal: request.signal });
    return raw();
  });
  const initial = received(await f.peer.submit("held", options()));
  const controller = new AbortController();
  const waiting = f.peer.wait(initial, { ...options(), signal: controller.signal });
  await entered.promise;
  controller.abort();
  const result = await waiting;
  await canceled.promise;
  expect(result.reason).toBe("aborted");
  expect(result.task).toBe(initial.task);
  expect(result.handle).toEqual(initial.handle);
  expect(f.calls.map((call) => call.name)).toEqual(["a2a_send_message", "a2a_get_task"]);
  expect(f.calls[1]!.signal.aborted).toBe(true);
});

test("a transport error with the abort sentinel as its cause propagates", async () => {
  const f = await fixture(() => raw());
  const initial = received(await f.peer.submit("held", options()));
  const controller = new AbortController();
  let failure: Error | undefined;
  let calls = 0;
  const peer = createTaskClient(
    {
      get remainingCalls() {
        return f.connection.remainingCalls - calls;
      },
      async call(name, args, _error, limits) {
        calls++;
        expect(name).toBe("a2a_get_task");
        expect(args).toEqual({ peer_url: initial.handle.peerUrl, task_id: initial.handle.taskId });
        if (!limits?.signal) throw new Error("Missing observation signal");
        controller.abort();
        expect(limits.signal.aborted).toBe(true);
        failure = new Error("actual transport failure", { cause: limits.signal.reason });
        throw failure;
      },
    },
    initial.handle.peerUrl,
  );
  const waiting = peer.wait(initial, { ...options(), signal: controller.signal });
  expect(failure).toBeInstanceOf(Error);
  await expect(waiting).rejects.toBe(failure);
  expect(calls).toBe(1);
  expect(f.connection.remainingCalls).toBe(39);
});

test("caller abort during polling sleep preserves the latest task", async () => {
  const f = await fixture(() => raw());
  const initial = received(await f.peer.submit("held", options()));
  const controller = new AbortController();
  const seen: Observation[] = [];
  const result = await f.peer.wait(initial, {
    ...options(),
    signal: controller.signal,
    intervalMs: 1_000,
    stopWhen: (observation) => {
      seen.push(observation);
      if (seen.length === 2) queueMicrotask(() => controller.abort());
      return false;
    },
  });
  expect(result.reason).toBe("aborted");
  expect(result.task).toBe(seen[1]!.task);
  expect(result.handle).toEqual(initial.handle);
  expect(f.calls.map((call) => call.name)).toEqual(["a2a_send_message", "a2a_get_task"]);
});

test("deadline during polling sleep preserves the latest task", async () => {
  const f = await fixture(() => raw());
  const initial = received(await f.peer.submit("held", options()));
  const seen: Observation[] = [];
  const result = await f.peer.wait(initial, {
    ...options(150),
    intervalMs: 1_000,
    stopWhen: (observation) => {
      seen.push(observation);
      return false;
    },
  });
  expect(result.reason).toBe("deadline");
  expect(result.task).toBe(seen[1]!.task);
  expect(result.handle).toEqual(initial.handle);
  expect(f.calls.map((call) => call.name)).toEqual(["a2a_send_message", "a2a_get_task"]);
});

test("a pre-aborted caller takes precedence over an expired deadline", async () => {
  const f = await fixture(() => raw());
  const initial = received(await f.peer.submit("held", options()));
  const controller = new AbortController();
  controller.abort();
  const result = await f.peer.wait(initial, {
    deadline: performance.now() - 1,
    signal: controller.signal,
  });
  expect(result.reason).toBe("aborted");
  expect(result.task).toBe(initial.task);
  expect(result.handle).toEqual(initial.handle);
  expect(f.calls.map((call) => call.name)).toEqual(["a2a_send_message"]);
});

test("an earlier transport deadline remains distinguishable from the observation timer", async () => {
  const f = await fixture(async (request) => {
    if (request.name === "a2a_send_message") return raw();
    await setTimeout(10_000, undefined, { signal: request.signal });
    return raw();
  });
  const initial = received(await f.peer.submit("held", options()));
  const peer = createTaskClient(
    {
      get remainingCalls() {
        return f.connection.remainingCalls;
      },
      call: (name, args, error, limits) => {
        if (!limits) throw new Error("Missing call deadline");
        return f.connection.call(name, args, error, { ...limits, deadline: limits.deadline - 100 });
      },
    },
    initial.handle.peerUrl,
  );
  const result = await peer.wait(initial, options(200));
  expect(result.reason).toBe("deadline");
  expect(result.task).toEqual(initial.task);
  expect(result.handle).toEqual(initial.handle);
  expect(f.calls.map((call) => call.name)).toEqual(["a2a_send_message", "a2a_get_task"]);
});

test("a later stalled poll retains the latest actual task", async () => {
  let polls = 0;
  const f = await fixture(async (request) => {
    if (request.name === "a2a_send_message") return raw();
    if (++polls === 1) return raw("INPUT_REQUIRED");
    await setTimeout(10_000, undefined, { signal: request.signal });
    return raw();
  });
  const initial = received(await f.peer.submit("held", options()));
  const seen: Observation[] = [];
  const result = await f.peer.wait(initial, {
    ...options(150),
    intervalMs: 1,
    stopWhen: (observation) => {
      seen.push(observation);
      return false;
    },
  });
  expect(result.reason).toBe("deadline");
  expect(result.task).toBe(seen[1]!.task);
  expect(result.task.status?.state).toBe(TaskState.TASK_STATE_INPUT_REQUIRED);
  expect(result.handle).toEqual(initial.handle);
  expect(f.calls.map((call) => call.name)).toEqual([
    "a2a_send_message",
    "a2a_get_task",
    "a2a_get_task",
  ]);
  expect(f.connection.remainingCalls).toBe(37);
});

test("a tool error is not converted to a deadline when the event loop was delayed", async () => {
  let deadline = 0;
  const f = await fixture((request) => {
    if (request.name === "a2a_send_message") return raw();
    Atomics.wait(
      new Int32Array(new SharedArrayBuffer(4)),
      0,
      0,
      Math.max(0, deadline + 5 - performance.now()),
    );
    throw new Error("actual tool failure");
  });
  const initial = received(await f.peer.submit("held", options()));
  deadline = performance.now() + 30;
  await expect(f.peer.wait(initial, { deadline })).rejects.toThrow("actual tool failure");
  expect(f.calls.map((call) => call.name)).toEqual(["a2a_send_message", "a2a_get_task"]);
});

test("a remote MCP timeout error is not treated as a local deadline", async () => {
  const f = await fixture((request) => {
    if (request.name === "a2a_send_message") return raw();
    throw new McpError(ErrorCode.RequestTimeout, "remote timeout");
  });
  const initial = received(await f.peer.submit("held", options()));
  await expect(f.peer.wait(initial, options())).rejects.toThrow("remote timeout");
  expect(f.calls.map((call) => call.name)).toEqual(["a2a_send_message", "a2a_get_task"]);
});

test("a stopWhen deadline error after a successful poll propagates", async () => {
  const f = await fixture(() => raw());
  const initial = received(await f.peer.submit("held", options()));
  const deadline = performance.now() + 2_000;
  const failure = new LocalDeadlineError();
  const seen: Observation[] = [];
  await expect(
    f.peer.wait(initial, {
      deadline,
      stopWhen: (observation) => {
        seen.push(observation);
        if (seen.length === 1) return false;
        expect(performance.now()).toBeLessThan(deadline);
        throw failure;
      },
    }),
  ).rejects.toBe(failure);
  expect(seen).toHaveLength(2);
  expect(seen[0]).toBe(initial);
  expect(seen[1]).not.toBe(initial);
  expect(seen[1]!.handle).toEqual(initial.handle);
  expect(f.calls.map((call) => call.name)).toEqual(["a2a_send_message", "a2a_get_task"]);
  expect(f.calls[1]!.args).toEqual({
    peer_url: initial.handle.peerUrl,
    task_id: initial.handle.taskId,
  });
  expect(f.connection.remainingCalls).toBe(38);
});

test("N06 timed-out submission has no fabricated handle or automatic resend", async () => {
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

test("N07 fractional polls respect wake targets and preserve the shared eight-call reserve", async () => {
  const polls: number[] = [];
  const f = await fixture((request) => {
    if (request.name === "a2a_get_task") polls.push(performance.now());
    return raw();
  });
  const initial = received(await f.peer.submit("held", options()));
  const intervalMs = 2.9;
  const result = await f.peer.wait(initial, { ...options(), intervalMs, maxPolls: 24 });
  expect(result.reason).toBe("poll-limit");
  expect(f.calls).toHaveLength(25);
  expect(polls).toHaveLength(24);
  expect(
    Math.min(...polls.slice(1).map((time, index) => time - polls[index]!)),
  ).toBeGreaterThanOrEqual(intervalMs);
  // Another caller spends seven real calls on the same connection.
  for (let count = 0; count < 7; count++) await f.connection.call("a2a_get_task", {});
  expect((await f.peer.wait(result, options())).reason).toBe("budget");
  expect(f.calls).toHaveLength(32);
  expect(f.connection.remainingCalls).toBe(8);
  expect(result.handle).toEqual(initial.handle);
});
