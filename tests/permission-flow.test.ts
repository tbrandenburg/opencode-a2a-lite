import { expect, test } from "bun:test";
import { Message, TaskState, type Task } from "@a2a-js/sdk";
import {
  DefaultExecutionEventBus,
  RequestContext,
  ServerCallContext,
  type AgentExecutionEvent,
} from "@a2a-js/sdk/server";
import { createAgentExecutor, type ExecutorBridge, type ExecutorOptions } from "../src/executor.js";
import { decide, offeredOptions } from "../src/permission.js";

const request = {
  title: "echo hi",
  kind: "execute",
  options: [
    { optionId: "allow", kind: "allow_once" },
    { optionId: "always", kind: "allow_always" },
    { optionId: "deny", kind: "reject_once" },
  ],
};

function rig(options: ExecutorOptions = { permissions: "ask" }) {
  const seen: unknown[] = [];
  const cancelled = Promise.withResolvers<"cancelled">();
  const bridge: ExecutorBridge = {
    async newSession() {
      return { sessionId: "session" };
    },
    async prompt(_session, text, onText, _onActivity, onPermission) {
      seen.push(onPermission);
      onText("before");
      for (let index = 0; index < Number(text.replace("ask:", "")); index += 1) {
        const chosen = await Promise.race([
          cancelled.promise,
          onPermission?.({ ...request, options: offeredOptions(request.options) }),
        ]);
        if (chosen === "cancelled") return { stopReason: "cancelled" };
        const decision = decide(request.options, chosen);
        if (decision.denied) return { stopReason: "cancelled", permissionDenied: true };
      }
      onText("after");
      return { stopReason: "end_turn" };
    },
    async cancel() {
      cancelled.resolve("cancelled");
    },
  };
  const executor = createAgentExecutor(bridge, options);
  const bus = new DefaultExecutionEventBus();
  const events: AgentExecutionEvent[] = [];
  bus.on("event", (event) => events.push(event));
  return { executor, bus, events, seen };
}

function context(parts: unknown[], task?: Task) {
  return new RequestContext(
    {
      message: Message.fromJSON({ messageId: crypto.randomUUID(), role: "ROLE_USER", parts }),
      tenant: "",
      configuration: undefined,
      metadata: undefined,
    },
    "task",
    "context",
    new ServerCallContext({}),
    task,
  );
}

const snapshot = (state: TaskState): Task => ({
  id: "task",
  contextId: "context",
  status: { state, timestamp: new Date().toISOString(), message: undefined },
  history: [],
  artifacts: [],
  metadata: undefined,
});

const statuses = (events: AgentExecutionEvent[]) =>
  events.flatMap((event) => (event.kind === "statusUpdate" ? [event.data.status] : []));
const states = (events: AgentExecutionEvent[]) => statuses(events).map((status) => status?.state);
const last = (events: AgentExecutionEvent[]) =>
  events.filter((event) => event.kind === "statusUpdate").at(-1);

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200 && !check(); attempt += 1) await Bun.sleep(5);
  expect(check()).toBe(true);
}

function asked(events: AgentExecutionEvent[], nth = 1) {
  const waiting = events.filter(
    (event) =>
      event.kind === "statusUpdate" &&
      event.data.status?.state === TaskState.TASK_STATE_INPUT_REQUIRED,
  );
  const message = waiting[nth - 1]?.kind === "statusUpdate" ? waiting[nth - 1] : undefined;
  const parts = message?.kind === "statusUpdate" ? message.data.status?.message?.parts : undefined;
  const content = parts?.[1]?.content;
  return content?.$case === "data"
    ? (content.value as { permission: { requestId: string; options: { optionId: string }[] } })
        .permission
    : undefined;
}

const answer = (id: string, optionId: string) => [
  { data: { permissionResponse: { requestId: id, optionId } } },
];

test("K1: a permission request pauses the task and an allow answer resumes it to completion", async () => {
  const run = rig();
  const first = run.executor.execute(context([{ text: "ask:1" }]), run.bus);
  await until(() => asked(run.events) !== undefined);
  const permission = asked(run.events);
  expect(permission?.options.map((option) => option.optionId)).toEqual(["allow", "deny"]);
  const waiting = last(run.events);
  const message = waiting?.kind === "statusUpdate" ? waiting.data.status?.message : undefined;
  expect(message?.parts[0]?.content).toEqual({
    $case: "text",
    value: 'Allow "echo hi (execute)"? Reply allow or reject.',
  });
  expect(waiting).toMatchObject({
    data: {
      metadata: {
        "opencode.permissionPending": "true",
        "opencode.permissionRequestId": permission?.requestId,
      },
    },
  });
  await run.executor.execute(
    context([{ text: " Allow " }], snapshot(TaskState.TASK_STATE_INPUT_REQUIRED)),
    run.bus,
  );
  await first;
  expect(states(run.events)).toEqual([
    TaskState.TASK_STATE_WORKING,
    TaskState.TASK_STATE_INPUT_REQUIRED,
    TaskState.TASK_STATE_WORKING,
    TaskState.TASK_STATE_COMPLETED,
  ]);
  expect(last(run.events)).toMatchObject({
    data: {
      metadata: {
        "opencode.permissionPending": "false",
        "opencode.permissionRequestId": "",
        "opencode.stopReason": "end_turn",
      },
    },
  });
  expect(JSON.stringify(run.events)).not.toContain("permissionDenied");
});

test("K2: a reject answer ends the task canceled with the denial marked", async () => {
  const run = rig();
  const first = run.executor.execute(context([{ text: "ask:1" }]), run.bus);
  await until(() => asked(run.events) !== undefined);
  const id = asked(run.events)?.requestId ?? "";
  await run.executor.execute(
    context(answer(id, "deny"), snapshot(TaskState.TASK_STATE_INPUT_REQUIRED)),
    run.bus,
  );
  await first;
  expect(last(run.events)).toMatchObject({
    data: {
      status: {
        state: TaskState.TASK_STATE_CANCELED,
        message: {
          parts: [{ content: { value: expect.stringContaining("Permission request rejected") } }],
        },
      },
      metadata: { "opencode.permissionDenied": "true", "opencode.permissionPending": "false" },
    },
  });
});

test("K3: wrong ids, unoffered options and allow_always keep the request open", async () => {
  const run = rig();
  const first = run.executor.execute(context([{ text: "ask:1" }]), run.bus);
  await until(() => asked(run.events) !== undefined);
  const id = asked(run.events)?.requestId ?? "";
  const waiting = snapshot(TaskState.TASK_STATE_INPUT_REQUIRED);
  for (const [parts, message] of [
    [answer("stale", "allow"), "does not match"],
    [answer(id, "always"), "not offered"],
    [[{ text: "maybe" }], "Unrecognized answer"],
  ] as const) {
    await run.executor.execute(context([...parts], waiting), run.bus);
    expect(last(run.events)).toMatchObject({
      data: {
        status: {
          state: TaskState.TASK_STATE_INPUT_REQUIRED,
          message: { parts: [{ content: { value: expect.stringContaining(message) } }] },
        },
      },
    });
  }
  expect(states(run.events)).not.toContain(TaskState.TASK_STATE_COMPLETED);
  await run.executor.execute(context(answer(id, "allow"), waiting), run.bus);
  await first;
  expect(last(run.events)).toMatchObject({
    data: { status: { state: TaskState.TASK_STATE_COMPLETED } },
  });
});

test("K4: a second answer never fails or changes the live task", async () => {
  const run = rig();
  const first = run.executor.execute(context([{ text: "ask:1" }]), run.bus);
  await until(() => asked(run.events) !== undefined);
  const id = asked(run.events)?.requestId ?? "";
  const resumed = run.executor.execute(
    context(answer(id, "allow"), snapshot(TaskState.TASK_STATE_INPUT_REQUIRED)),
    run.bus,
  );
  await run.executor.execute(
    context(answer(id, "allow"), snapshot(TaskState.TASK_STATE_WORKING)),
    run.bus,
  );
  await Promise.all([first, resumed]);
  expect(states(run.events)).not.toContain(TaskState.TASK_STATE_FAILED);
  expect(
    states(run.events).filter((state) => state === TaskState.TASK_STATE_COMPLETED),
  ).toHaveLength(1);
});

test("K5: no answer before the deadline rejects once", async () => {
  const run = rig({ permissions: "ask", permissionTimeoutMs: 40 });
  await run.executor.execute(context([{ text: "ask:1" }]), run.bus);
  expect(last(run.events)).toMatchObject({
    data: {
      status: { state: TaskState.TASK_STATE_CANCELED },
      metadata: { "opencode.permissionDenied": "true" },
    },
  });
});

test("K6: cancelling a waiting task cancels it without marking a denial", async () => {
  const run = rig();
  const first = run.executor.execute(context([{ text: "ask:1" }]), run.bus);
  await until(() => asked(run.events) !== undefined);
  await run.executor.cancelTask("task", run.bus);
  await first;
  const final = last(run.events);
  expect(final).toMatchObject({ data: { status: { state: TaskState.TASK_STATE_CANCELED } } });
  expect(JSON.stringify(final)).not.toContain("permissionDenied");
  expect(states(run.events)).not.toContain(TaskState.TASK_STATE_COMPLETED);
});

test("K7: consecutive requests each get their own id and answer", async () => {
  const run = rig();
  const first = run.executor.execute(context([{ text: "ask:2" }]), run.bus);
  await until(() => asked(run.events, 1) !== undefined);
  const one = asked(run.events, 1)?.requestId ?? "";
  const resumed = run.executor.execute(
    context(answer(one, "allow"), snapshot(TaskState.TASK_STATE_INPUT_REQUIRED)),
    run.bus,
  );
  await until(() => asked(run.events, 2) !== undefined);
  const two = asked(run.events, 2)?.requestId ?? "";
  expect(two).not.toBe(one);
  await run.executor.execute(
    context(answer(one, "allow"), snapshot(TaskState.TASK_STATE_INPUT_REQUIRED)),
    run.bus,
  );
  expect(states(run.events)).not.toContain(TaskState.TASK_STATE_COMPLETED);
  await run.executor.execute(
    context(answer(two, "allow"), snapshot(TaskState.TASK_STATE_INPUT_REQUIRED)),
    run.bus,
  );
  await Promise.all([first, resumed]);
  expect(last(run.events)).toMatchObject({
    data: { status: { state: TaskState.TASK_STATE_COMPLETED } },
  });
});

test("K8: without the ask option no permission callback is offered", async () => {
  const run = rig({});
  await run.executor.execute(context([{ text: "ask:1" }]), run.bus);
  expect(run.seen).toEqual([undefined]);
  expect(JSON.stringify(run.events)).not.toContain("permissionPending");
});
