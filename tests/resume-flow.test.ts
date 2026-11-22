import { expect, test } from "bun:test";
import { Message, TaskState } from "@a2a-js/sdk";
import {
  DefaultExecutionEventBus,
  RequestContext,
  ServerCallContext,
  type AgentExecutionEvent,
} from "@a2a-js/sdk/server";
import { BridgeError } from "../src/bridge-error.js";
import { createAgentExecutor, type ExecutorBridge, type ExecutorOptions } from "../src/executor.js";

const known = "ses_dfc114de7ffecIV2y1jJ0U0akj";

function rig(options: ExecutorOptions = { resume: true }, withResume = true) {
  const calls: string[] = [];
  const bridge: ExecutorBridge = {
    async newSession() {
      calls.push("new");
      return { sessionId: `ses_created${calls.length}00000` };
    },
    async prompt(session, text, onText) {
      calls.push(`prompt:${session}:${text}`);
      onText(session);
      return { stopReason: "end_turn" };
    },
    async cancel() {},
    ...(withResume
      ? {
          async resumeSession(id: string) {
            calls.push(`resume:${id}`);
            if (id.startsWith("ses_unknown")) throw new BridgeError("ACP session resume rejected");
            return id;
          },
        }
      : {}),
  };
  const executor = createAgentExecutor(bridge, options);
  const bus = new DefaultExecutionEventBus();
  const events: AgentExecutionEvent[] = [];
  bus.on("event", (event) => events.push(event));
  return { calls, executor, bus, events };
}

function context(
  text: string,
  contextId: string,
  metadata?: object,
  explicit = false,
  requestMetadata?: object,
) {
  return new RequestContext(
    {
      message: Message.fromJSON({
        messageId: crypto.randomUUID(),
        role: "ROLE_USER",
        parts: [{ text }],
        ...(explicit ? { contextId } : {}),
        ...(metadata ? { metadata } : {}),
      }),
      tenant: "",
      configuration: undefined,
      metadata: requestMetadata,
    },
    crypto.randomUUID(),
    contextId,
    new ServerCallContext({}),
  );
}

const last = (events: AgentExecutionEvent[]) =>
  events.filter((event) => event.kind === "statusUpdate").at(-1);
const failure = (events: AgentExecutionEvent[]) => {
  const event = last(events);
  const content =
    event?.kind === "statusUpdate" ? event.data.status?.message?.parts[0]?.content : undefined;
  return {
    state: event?.kind === "statusUpdate" ? event.data.status?.state : undefined,
    text: content?.$case === "text" ? content.value : "",
  };
};
const meta = { "opencode.sessionId": known };

test("S1: a first message with a session id resumes it, follows up on it, and marks the task", async () => {
  const run = rig();
  await run.executor.execute(context("hello", "ctx", meta), run.bus);
  expect(run.calls).toEqual([`resume:${known}`, `prompt:${known}:hello`]);
  expect(last(run.events)).toMatchObject({
    data: {
      status: { state: TaskState.TASK_STATE_COMPLETED },
      metadata: { "opencode.sessionId": known, "opencode.resumed": "true" },
    },
  });
  await run.executor.execute(context("again", "ctx", undefined, true), run.bus);
  expect(run.calls.slice(2)).toEqual([`prompt:${known}:again`]);
  expect(JSON.stringify(last(run.events))).not.toContain("resumed");
});

test("S2: without --allow-resume the request fails visibly and nothing is allocated", async () => {
  const run = rig({});
  await run.executor.execute(context("hello", "ctx", meta), run.bus);
  expect(run.calls).toEqual([]);
  expect(failure(run.events)).toEqual({
    state: TaskState.TASK_STATE_FAILED,
    text: expect.stringContaining("--allow-resume"),
  });
});

test("S3: malformed ids, rebinding and shared sessions are refused before any ACP call", async () => {
  const run = rig();
  await run.executor.execute(context("x", "bad", { "opencode.sessionId": "ses_../x" }), run.bus);
  expect(failure(run.events).text).toContain("Invalid opencode.sessionId");
  await run.executor.execute(context("x", "one", meta), run.bus);
  await run.executor.execute(context("x", "two", meta), run.bus);
  expect(failure(run.events).text).toContain("another context");
  await run.executor.execute(
    context("x", "one", { "opencode.sessionId": "ses_otherother1" }, true),
    run.bus,
  );
  expect(failure(run.events).text).toContain("different session");
  expect(run.calls.filter((call) => call.startsWith("resume"))).toEqual([`resume:${known}`]);
});

test("S4: a rejected session fails with its phase, registers no context, and the next request works", async () => {
  const run = rig();
  await run.executor.execute(
    context("x", "ctx", { "opencode.sessionId": "ses_unknown0001" }),
    run.bus,
  );
  expect(failure(run.events)).toEqual({
    state: TaskState.TASK_STATE_FAILED,
    text: "ACP session resume rejected",
  });
  await run.executor.execute(context("x", "ctx", undefined, true), run.bus);
  expect(failure(run.events).text).toContain("Unknown or expired context");
  await run.executor.execute(context("fresh", "other"), run.bus);
  expect(failure(run.events).state).toBe(TaskState.TASK_STATE_COMPLETED);
});

test("S5: after a gateway restart the client can re-bind its old context id to the session", async () => {
  const run = rig();
  await run.executor.execute(context("back", "old-context", meta, true), run.bus);
  expect(run.calls).toEqual([`resume:${known}`, `prompt:${known}:back`]);
  expect(failure(run.events).state).toBe(TaskState.TASK_STATE_COMPLETED);
});

test("S6: a bridge without resume support fails generically", async () => {
  const run = rig({ resume: true }, false);
  await run.executor.execute(context("x", "ctx", meta), run.bus);
  expect(failure(run.events)).toEqual({
    state: TaskState.TASK_STATE_FAILED,
    text: "ACP execution failed",
  });
});

test("S7: the id may also come as request metadata, which is what a2a --metadata sends", async () => {
  const run = rig();
  await run.executor.execute(context("hi", "ctx", undefined, false, meta), run.bus);
  expect(run.calls).toEqual([`resume:${known}`, `prompt:${known}:hi`]);
  const both = rig();
  await both.executor.execute(
    context("hi", "ctx", { "opencode.sessionId": "ses_msgmsgmsg1" }, false, meta),
    both.bus,
  );
  expect(both.calls[0]).toBe("resume:ses_msgmsgmsg1");
});
