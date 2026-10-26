// SDK-only: copy beside an installation of @a2a-js/sdk; no gateway imports.
import assert from "node:assert/strict";
import {
  SendMessageRequest,
  Task,
  TaskArtifactUpdateEvent,
  TaskStatusUpdateEvent,
  TaskState,
} from "@a2a-js/sdk";
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  ServerCallContext,
} from "@a2a-js/sdk/server";

const count = Number(process.argv[2] ?? "1");
assert.ok([0, 1, 2].includes(count), "usage: node repro-sdk-cancellation.mjs [0|1|2]");
const timer = setTimeout(() => {
  console.error("Reproducer did not settle within 5 seconds");
  process.exit(2);
}, 5_000);
const initialSaved = Promise.withResolvers();
const cancelEntered = Promise.withResolvers();
const finish = Promise.withResolvers();
const memory = new InMemoryTaskStore();
const parts = (task) =>
  (task.artifacts ?? [])
    .flatMap((artifact) => artifact.parts)
    .map((part) => (part.content?.$case === "text" ? part.content.value : ""));
const store = {
  load: (...args) => memory.load(...args),
  list: (...args) => memory.list(...args),
  async save(task, context) {
    await memory.save(task, context);
    if (parts(task).join("") === "A") initialSaved.resolve(task.id);
  },
};
let live;
let cancels = 0;
const append = (text, append, lastChunk = false) =>
  live.bus.publish(
    AgentEvent.artifactUpdate(
      TaskArtifactUpdateEvent.fromJSON({
        taskId: live.context.taskId,
        contextId: live.context.contextId,
        artifact: { artifactId: "output", parts: [{ text }] },
        append,
        lastChunk,
      }),
    ),
  );
const executor = {
  async execute(context, bus) {
    live = { context, bus };
    bus.publish(
      AgentEvent.task(
        Task.fromJSON({
          id: context.taskId,
          contextId: context.contextId,
          status: { state: TaskState.TASK_STATE_WORKING },
        }),
      ),
    );
    append("A", false);
    await finish.promise;
  },
  async cancelTask() {
    if (++cancels === count) cancelEntered.resolve();
  },
};
try {
  const context = new ServerCallContext({});
  const handler = new DefaultRequestHandler({ capabilities: { streaming: true } }, store, executor);
  const sending = handler.sendMessage(
    SendMessageRequest.fromJSON({
      message: {
        messageId: "input",
        role: "ROLE_USER",
        parts: [{ text: "test" }],
      },
    }),
    context,
  );
  const id = await initialSaved.promise;
  const cancellations = Array.from({ length: count }, () => handler.cancelTask({ id }, context));
  if (count) await cancelEntered.promise;
  append("B", true);
  append("B", true);
  append("", true, true);
  live.bus.publish(
    AgentEvent.statusUpdate(
      TaskStatusUpdateEvent.fromJSON({
        taskId: id,
        contextId: live.context.contextId,
        status: { state: TaskState.TASK_STATE_CANCELED },
      }),
    ),
  );
  finish.resolve();
  await Promise.all([sending, ...cancellations]);
  const task = await handler.getTask({ id }, context);
  const published = ["A", "B", "B", ""];
  console.log(
    JSON.stringify({
      cancels: count,
      published,
      stored: parts(task),
      state: TaskState[task.status.state],
    }),
  );
  assert.deepEqual(
    parts(task),
    published,
    "each append, including repeated text and empty lastChunk, must persist once",
  );
} finally {
  clearTimeout(timer);
}
