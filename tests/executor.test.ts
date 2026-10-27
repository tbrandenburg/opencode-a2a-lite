import { expect, test } from "bun:test";
import { Message, TaskState } from "@a2a-js/sdk";
import {
  DefaultExecutionEventBus,
  RequestContext,
  ServerCallContext,
  type AgentExecutionEvent,
} from "@a2a-js/sdk/server";
import type { PromptResponse } from "@agentclientprotocol/sdk";
import { createAgentExecutor, type ExecutorBridge } from "../src/executor.js";

function context(
  parts: unknown[] = [{ text: "hello" }],
  fields: object = {},
  ids = { task: "task", context: "context" },
) {
  return new RequestContext(
    {
      message: Message.fromJSON({ messageId: "input", role: "ROLE_USER", parts, ...fields }),
      tenant: "",
      configuration: undefined,
      metadata: undefined,
    },
    ids.task,
    ids.context,
    new ServerCallContext({}),
  );
}

function setup(stopReason = "end_turn", failure?: "prompt") {
  const calls: string[] = [];
  const bridge: ExecutorBridge = {
    async newSession() {
      calls.push("session");
      return { sessionId: "session" };
    },
    async prompt(session, text, onText) {
      calls.push(`${session}:${text}`);
      onText("first");
      onText("");
      onText(" second");
      if (failure === "prompt") throw new Error("sensitive provider diagnostics");
      // Exercise unknown runtime stop reasons as well as the SDK's known values.
      return { stopReason } as PromptResponse;
    },
    async cancel(session) {
      calls.push(`cancel:${session}`);
    },
  };
  const executor = createAgentExecutor(bridge);
  const bus = new DefaultExecutionEventBus();
  const events: AgentExecutionEvent[] = [];
  bus.on("event", (event) => events.push(event));
  return { bridge, calls, executor, bus, events };
}

function statuses(events: AgentExecutionEvent[]) {
  return events.flatMap((event) =>
    event.kind === "statusUpdate" ? [event.data.status?.state] : [],
  );
}

test("E1: publishes snapshot, working, ordered stable chunks, empty final append, completed", async () => {
  const run = setup();
  await run.executor.execute(context([{ text: "hello" }, { text: "world" }]), run.bus);
  expect(run.calls).toEqual(["session", "session:hello\nworld"]);
  expect(run.events.map((event) => event.kind)).toEqual([
    "task",
    "statusUpdate",
    "artifactUpdate",
    "artifactUpdate",
    "artifactUpdate",
    "statusUpdate",
  ]);
  expect(run.events[0]).toMatchObject({
    data: { id: "task", contextId: "context", status: { state: TaskState.TASK_STATE_SUBMITTED } },
  });
  expect(statuses(run.events)).toEqual([
    TaskState.TASK_STATE_WORKING,
    TaskState.TASK_STATE_COMPLETED,
  ]);
  const chunks = run.events.flatMap((event) =>
    event.kind === "artifactUpdate" ? [event.data] : [],
  );
  expect(new Set(chunks.map((chunk) => chunk.artifact?.artifactId)).size).toBe(1);
  expect(chunks.map((chunk) => [chunk.append, chunk.lastChunk])).toEqual([
    [false, false],
    [true, false],
    [true, true],
  ]);
  expect(chunks.map((chunk) => chunk.artifact?.parts[0]?.content)).toEqual([
    { $case: "text", value: "first" },
    { $case: "text", value: " second" },
    { $case: "text", value: "" },
  ]);
});

test("E2: an unknown stop reason flushes before failure and invalidates continuation", async () => {
  const run = setup("unknown");
  await run.executor.execute(context(), run.bus);
  expect(statuses(run.events)).toEqual([TaskState.TASK_STATE_WORKING, TaskState.TASK_STATE_FAILED]);
  expect(run.events.at(-2)).toMatchObject({
    kind: "artifactUpdate",
    data: { append: true, lastChunk: true },
  });
  expect(run.events.at(-1)).toMatchObject({
    kind: "statusUpdate",
    data: { status: { state: TaskState.TASK_STATE_FAILED } },
  });
  await run.executor.execute(context(undefined, { contextId: "context" }), run.bus);
  expect(run.calls).toEqual(["session", "session:hello"]);
  expect(statuses(run.events)).toEqual([
    TaskState.TASK_STATE_WORKING,
    TaskState.TASK_STATE_FAILED,
    TaskState.TASK_STATE_FAILED,
  ]);
});

test("E3: mixed unsupported parts fail without starting ACP", async () => {
  const run = setup();
  await run.executor.execute(
    context([{ text: "hello" }, { raw: "aGVsbG8=", mediaType: "image/png" }]),
    run.bus,
  );
  expect(run.calls).toEqual([]);
  expect(run.events.map((event) => event.kind)).toEqual(["task", "statusUpdate"]);
  expect(statuses(run.events)).toEqual([TaskState.TASK_STATE_FAILED]);
});

test("E4: cancellation uses only the active binding and waits for the canceled result", async () => {
  const run = setup();
  let release: ((response: PromptResponse) => void) | undefined;
  let started: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  run.bridge.prompt = async (_session, _text, onText) => {
    onText("partial");
    started?.();
    return new Promise<PromptResponse>((resolve) => {
      release = resolve;
    });
  };
  const pending = run.executor.execute(context(), run.bus);
  await ready;
  await expect(run.executor.cancelTask("wrong-task", run.bus)).rejects.toThrow("active ACP");
  expect(run.calls).toEqual(["session"]);
  await run.executor.cancelTask("task", run.bus);
  expect(run.calls).toEqual(["session", "cancel:session"]);
  expect(statuses(run.events)).toEqual([TaskState.TASK_STATE_WORKING]);
  release?.({ stopReason: "cancelled" });
  await pending;
  expect(statuses(run.events)).toEqual([
    TaskState.TASK_STATE_WORKING,
    TaskState.TASK_STATE_CANCELED,
  ]);
  expect(run.events.at(-2)).toMatchObject({
    kind: "artifactUpdate",
    data: { append: true, lastChunk: true },
  });
  await expect(run.executor.cancelTask("task", run.bus)).rejects.toThrow("active ACP");
  expect(run.calls).toEqual(["session", "cancel:session"]);
});

test("E5: admission stays held until losing cancellation settles; terminal tasks cannot cancel next turn", async () => {
  const run = setup();
  const response = Promise.withResolvers<PromptResponse>();
  const cancellation = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  run.bridge.prompt = async (_session, _text, onText) => {
    onText("start");
    ready.resolve();
    return response.promise;
  };
  run.bridge.cancel = () => {
    run.calls.push("cancel");
    return cancellation.promise;
  };
  const pending = run.executor.execute(context(), run.bus);
  await ready.promise;
  const cancel = run.executor.cancelTask("task", run.bus);
  response.resolve({ stopReason: "end_turn" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(statuses(run.events).at(-1)).toBe(TaskState.TASK_STATE_COMPLETED);
  await run.executor.execute(context(undefined, {}, { task: "other", context: "other" }), run.bus);
  expect(run.calls).toEqual(["session", "cancel"]);
  expect(statuses(run.events).at(-1)).toBe(TaskState.TASK_STATE_FAILED);
  await expect(run.executor.cancelTask("task", run.bus)).rejects.toThrow("active ACP");
  cancellation.resolve();
  await Promise.all([cancel, pending]);
  run.bridge.prompt = async () => ({ stopReason: "end_turn" });
  await run.executor.execute(context(undefined, {}, { task: "other", context: "other" }), run.bus);
  expect(statuses(run.events).at(-1)).toBe(TaskState.TASK_STATE_COMPLETED);
  expect(run.calls).toEqual(["session", "cancel", "session"]);
});

test("E6: reuses each context's session without mixing sequential conversations", async () => {
  const run = setup();
  let count = 0;
  run.bridge.newSession = async () => ({ sessionId: `session-${++count}` });
  for (const name of ["alpha", "beta", "alpha", "beta"]) {
    await run.executor.execute(
      context([{ text: name }], {}, { task: name, context: name }),
      run.bus,
    );
  }
  expect(count).toBe(2);
  expect(run.calls).toEqual([
    "session-1:alpha",
    "session-2:beta",
    "session-1:alpha",
    "session-2:beta",
  ]);
});

test("E7: explicit unknown and failed contexts never submit; provider failures stay sanitized", async () => {
  const run = setup("end_turn", "prompt");
  await run.executor.execute(context([{ text: "hello" }], { contextId: "context" }), run.bus);
  expect(run.calls).toEqual([]);
  expect(statuses(run.events)).toEqual([TaskState.TASK_STATE_FAILED]);
  await run.executor.execute(context(), run.bus);
  expect(run.calls).toEqual(["session", "session:hello"]);
  expect(statuses(run.events)).toEqual([
    TaskState.TASK_STATE_FAILED,
    TaskState.TASK_STATE_WORKING,
    TaskState.TASK_STATE_FAILED,
  ]);
  expect(run.events.filter((event) => event.kind === "artifactUpdate")).toHaveLength(3);
  expect(JSON.stringify(run.events)).not.toContain("sensitive provider diagnostics");
  expect(run.events.at(-2)).toMatchObject({
    kind: "artifactUpdate",
    data: { append: true, lastChunk: true },
  });
  await run.executor.execute(context([{ text: "again" }], { contextId: "context" }), run.bus);
  expect(run.calls).toEqual(["session", "session:hello"]);
  expect(run.events.at(-1)).toMatchObject({
    data: {
      status: {
        state: TaskState.TASK_STATE_FAILED,
        message: { parts: [{ content: { value: expect.stringContaining("expired") } }] },
      },
    },
  });
});

test("E8: reserves the global slot synchronously before allocation; allocation is not cancelable", async () => {
  const run = setup();
  const allocation = Promise.withResolvers<{ sessionId: string }>();
  run.bridge.newSession = () => {
    run.calls.push("session");
    return allocation.promise;
  };
  const pending = run.executor.execute(context(), run.bus);
  await run.executor.execute(context(undefined, {}, { task: "other", context: "other" }), run.bus);
  expect(run.calls).toEqual(["session"]);
  expect(run.events.at(-1)).toMatchObject({
    data: { status: { state: TaskState.TASK_STATE_FAILED } },
  });
  await expect(run.executor.cancelTask("task", run.bus)).rejects.toThrow(
    "allocation is not cancelable",
  );
  await expect(run.executor.cancelTask("other", run.bus)).rejects.toThrow("active ACP");
  allocation.resolve({ sessionId: "session" });
  await pending;
  expect(run.calls).toEqual(["session", "session:hello"]);
  expect(run.events.at(-1)).toMatchObject({
    data: { status: { state: TaskState.TASK_STATE_COMPLETED } },
  });
});
