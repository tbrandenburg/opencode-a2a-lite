import { expect, test } from "bun:test";
import { Message, Task, TaskState } from "@a2a-js/sdk";
import {
  DefaultExecutionEventBus,
  RequestContext,
  ServerCallContext,
  type AgentExecutionEvent,
} from "@a2a-js/sdk/server";
import type { PromptResponse } from "@agentclientprotocol/sdk";
import { createAgentExecutor, type ExecutorBridge, type ExecutorOptions } from "../src/executor.js";

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

function setup(stopReason = "end_turn", failure?: "session" | "prompt", options?: ExecutorOptions) {
  const calls: string[] = [];
  const bridge: ExecutorBridge = {
    async newSession() {
      calls.push("session");
      if (failure === "session") throw new Error("sensitive provider diagnostics");
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
  const executor = createAgentExecutor(bridge, options);
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

test("publishes snapshot, working, ordered stable artifact chunks, empty final append, completed", async () => {
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

test.each([
  ["cancelled", TaskState.TASK_STATE_CANCELED],
  ["refusal", TaskState.TASK_STATE_FAILED],
  ["max_tokens", TaskState.TASK_STATE_FAILED],
  ["max_turn_requests", TaskState.TASK_STATE_FAILED],
  ["unknown", TaskState.TASK_STATE_FAILED],
])("%s flushes chunks before exactly one terminal state", async (reason, state) => {
  const run = setup(reason);
  await run.executor.execute(context(), run.bus);
  expect(statuses(run.events)).toEqual([TaskState.TASK_STATE_WORKING, state]);
  expect(run.events.at(-2)).toMatchObject({
    kind: "artifactUpdate",
    data: { append: true, lastChunk: true },
  });
  expect(run.events.at(-1)).toMatchObject({ kind: "statusUpdate", data: { status: { state } } });
});

test.each(["session", "prompt"] as const)(
  "%s failure is sanitized and terminal",
  async (failure) => {
    const run = setup("end_turn", failure);
    await run.executor.execute(context(), run.bus);
    expect(statuses(run.events)).toEqual([
      TaskState.TASK_STATE_WORKING,
      TaskState.TASK_STATE_FAILED,
    ]);
    expect(JSON.stringify(run.events)).not.toContain("sensitive provider diagnostics");
    expect(run.events.filter((event) => event.kind === "artifactUpdate").length).toBe(
      failure === "prompt" ? 3 : 0,
    );
  },
);

test.each(
  [
    [],
    [{ text: "" }],
    [{ text: " \n" }],
    [{ data: { value: 1 } }],
    [{ text: "hello" }, { raw: "aGVsbG8=", mediaType: "image/png" }],
    [{ text: "hello", mediaType: "text/html" }],
    [{ url: "https://example.invalid/file" }],
  ].map((parts) => ({ parts })),
)("rejects empty, mixed and unsupported parts without starting ACP: %j", async ({ parts }) => {
  const run = setup();
  await run.executor.execute(context(parts), run.bus);
  expect(run.calls).toEqual([]);
  expect(run.events.map((event) => event.kind)).toEqual(["task", "statusUpdate"]);
  expect(statuses(run.events)).toEqual([TaskState.TASK_STATE_FAILED]);
});

test("no-text response has no invented artifact; late callbacks cannot follow the terminal state", async () => {
  const run = setup();
  let late: ((text: string) => void) | undefined;
  run.bridge.prompt = async (_session, _text, onText) => {
    late = onText;
    return { stopReason: "end_turn" };
  };
  await run.executor.execute(context(), run.bus);
  late?.("late");
  expect(run.events.map((event) => event.kind)).toEqual(["task", "statusUpdate", "statusUpdate"]);
  expect(statuses(run.events)).toEqual([
    TaskState.TASK_STATE_WORKING,
    TaskState.TASK_STATE_COMPLETED,
  ]);
});

test.each([{ referenceTaskIds: ["previous"] }, { role: "ROLE_AGENT" }])(
  "rejects follow-up context or non-user role: %j",
  async (fields) => {
    const run = setup();
    await run.executor.execute(context([{ text: "hello" }], fields), run.bus);
    expect(run.calls).toEqual([]);
    expect(statuses(run.events)).toEqual([TaskState.TASK_STATE_FAILED]);
  },
);

test("cancel uses only the active binding and never publishes an unconfirmed canceled state", async () => {
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
  await expect(run.executor.cancelTask("task", run.bus)).rejects.toThrow("active ACP");
  expect(run.calls).toEqual(["session", "cancel:session"]);
});

test("holds admission until a losing cancellation settles; terminal tasks cannot cancel next turn", async () => {
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

test.each(["refusal", "max_tokens", "unknown"])(
  "%s invalidates continuation context",
  async (reason) => {
    const run = setup(reason);
    await run.executor.execute(context(), run.bus);
    await run.executor.execute(context(undefined, { contextId: "context" }), run.bus);
    expect(run.calls).toEqual(["session", "session:hello"]);
    expect(statuses(run.events)).toEqual([
      TaskState.TASK_STATE_WORKING,
      TaskState.TASK_STATE_FAILED,
      TaskState.TASK_STATE_FAILED,
    ]);
  },
);

test("rejects an existing task before creating a session", async () => {
  const run = setup();
  const fresh = context();
  const followup = new RequestContext(
    fresh.request,
    fresh.taskId,
    fresh.contextId,
    fresh.context,
    Task.fromJSON({ id: "task", contextId: "context", status: { state: "TASK_STATE_WORKING" } }),
  );
  await run.executor.execute(followup, run.bus);
  expect(run.calls).toEqual([]);
  expect(statuses(run.events)).toEqual([TaskState.TASK_STATE_FAILED]);
});

test("reuses each context's session without mixing sequential conversations", async () => {
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

test("explicit unknown and expired contexts never create or submit ACP sessions", async () => {
  const run = setup("end_turn", "prompt");
  await run.executor.execute(context([{ text: "hello" }], { contextId: "context" }), run.bus);
  expect(run.calls).toEqual([]);
  expect(statuses(run.events)).toEqual([TaskState.TASK_STATE_FAILED]);
  await run.executor.execute(context(), run.bus);
  expect(run.calls).toEqual(["session", "session:hello"]);
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

test("finite capacity rejects new contexts but allows existing follow-ups", async () => {
  const run = setup("end_turn", undefined, { maxContexts: 1 });
  await run.executor.execute(context(), run.bus);
  await run.executor.execute(context(undefined, {}, { task: "other", context: "other" }), run.bus);
  expect(run.calls).toEqual(["session", "session:hello"]);
  expect(run.events.at(-1)).toMatchObject({
    data: { status: { state: TaskState.TASK_STATE_FAILED } },
  });
  await run.executor.execute(context([{ text: "again" }], { contextId: "context" }), run.bus);
  expect(run.calls).toEqual(["session", "session:hello", "session:again"]);
  expect(run.events.at(-1)).toMatchObject({
    data: { status: { state: TaskState.TASK_STATE_COMPLETED } },
  });
});

test.each([0, -1, 1.5, Infinity, NaN])(
  "rejects invalid finite context capacity %s",
  (maxContexts) => {
    const run = setup();
    expect(() => createAgentExecutor(run.bridge, { maxContexts })).toThrow("capacity");
    expect(run.calls).toEqual([]);
  },
);

test("reserves the global slot before session allocation; allocation cancellation is explicit", async () => {
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

test("busy same-context and different-context turns do not submit; the slot is released", async () => {
  const run = setup();
  await run.executor.execute(context(), run.bus);
  const response = Promise.withResolvers<PromptResponse>();
  const prompt = run.bridge.prompt;
  run.bridge.prompt = () => response.promise;
  const pending = run.executor.execute(context(), run.bus);
  await run.executor.execute(context(), run.bus);
  await run.executor.execute(context(undefined, {}, { task: "other", context: "other" }), run.bus);
  expect(run.calls).toEqual(["session", "session:hello"]);
  expect(statuses(run.events).slice(-2)).toEqual([
    TaskState.TASK_STATE_FAILED,
    TaskState.TASK_STATE_FAILED,
  ]);
  response.resolve({ stopReason: "end_turn" });
  await pending;
  run.bridge.prompt = prompt;
  await run.executor.execute(context(), run.bus);
  expect(run.calls).toEqual(["session", "session:hello", "session:hello"]);
  expect(run.events.at(-1)).toMatchObject({
    data: { status: { state: TaskState.TASK_STATE_COMPLETED } },
  });
});

test("default capacity retains exactly 100 contexts and refuses the 101st without submission", async () => {
  const run = setup();
  for (let index = 0; index < 101; index++) {
    await run.executor.execute(
      context(undefined, {}, { task: `task-${index}`, context: `context-${index}` }),
      run.bus,
    );
  }
  expect(run.calls.filter((call) => call === "session").length).toBe(100);
  expect(run.calls.filter((call) => call === "session:hello").length).toBe(100);
  expect(
    statuses(run.events).filter((state) => state === TaskState.TASK_STATE_COMPLETED).length,
  ).toBe(100);
  expect(run.events.at(-1)).toMatchObject({
    data: { status: { state: TaskState.TASK_STATE_FAILED } },
  });
});

test("allocation failure releases the global slot and does not consume capacity", async () => {
  const run = setup("end_turn", undefined, { maxContexts: 1 });
  const allocate = run.bridge.newSession;
  run.bridge.newSession = async () => {
    throw new Error("allocation failed");
  };
  await run.executor.execute(context(), run.bus);
  expect(statuses(run.events)).toEqual([TaskState.TASK_STATE_WORKING, TaskState.TASK_STATE_FAILED]);
  expect(run.calls).toEqual([]);
  run.bridge.newSession = allocate;
  await run.executor.execute(context(undefined, {}, { task: "other", context: "other" }), run.bus);
  expect(run.calls).toEqual(["session", "session:hello"]);
  expect(run.events.at(-1)).toMatchObject({
    data: { status: { state: TaskState.TASK_STATE_COMPLETED } },
  });
});
