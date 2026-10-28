import { afterEach, expect, test } from "bun:test";
import { setTimeout } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { callTool } from "../../interop/transport.js";
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
  await expect(f.peer.submit("wrong", options(), first.handle, "streaming")).rejects.toThrow(
    "4.0.2",
  );
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
