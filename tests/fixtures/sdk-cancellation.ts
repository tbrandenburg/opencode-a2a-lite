import {
  AgentCard,
  SendMessageRequest,
  TaskArtifactUpdateEvent,
  TaskStatusUpdateEvent,
  Task,
  TaskState,
  type StreamResponse,
} from "@a2a-js/sdk";
import { TaskNotFoundError } from "@a2a-js/sdk/errors";
import {
  AgentEvent,
  DefaultRequestHandler,
  InMemoryTaskStore,
  ServerCallContext,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import { createRequestHandler } from "../../src/request-handler.js";

const card = AgentCard.fromJSON({ capabilities: { streaming: true } });
export const params = (returnImmediately = false) =>
  SendMessageRequest.fromJSON({
    message: { messageId: crypto.randomUUID(), role: "ROLE_USER", parts: [{ text: "test" }] },
    configuration: { returnImmediately },
  });
export const parts = (task: Task) =>
  (task.artifacts ?? [])
    .flatMap((artifact) => artifact.parts)
    .map((part) => (part.content?.$case === "text" ? part.content.value : ""));

export async function until(check: () => boolean | Promise<boolean>, timeout = 1_000) {
  const deadline = performance.now() + timeout;
  while (!(await check())) {
    if (performance.now() >= deadline) throw new Error("SDK cancellation probe timed out");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

export function cancellationProbe(stock = false, failure?: "hang") {
  const started = Promise.withResolvers<RequestContext>();
  const finish = Promise.withResolvers<void>();
  const events: StreamResponse[] = [];
  let live: { context: RequestContext; bus: ExecutionEventBus } | undefined;
  let cancels = 0;
  const append = (text: string, append: boolean, lastChunk = false) => {
    if (!live) throw new Error("Executor not started");
    live.bus.publish(
      AgentEvent.artifactUpdate(
        TaskArtifactUpdateEvent.fromJSON({
          taskId: live.context.taskId,
          contextId: live.context.contextId,
          artifact: { artifactId: "output", parts: [{ text, mediaType: "text/plain" }] },
          append,
          lastChunk,
        }),
      ),
    );
  };
  const executor: AgentExecutor = {
    async execute(context, bus) {
      live = { context, bus };
      bus.publish(
        AgentEvent.task(
          Task.fromJSON({
            id: context.taskId,
            contextId: context.contextId,
            status: { state: TaskState.TASK_STATE_WORKING },
            artifacts: [],
            history: [],
          }),
        ),
      );
      append("A", false);
      started.resolve(context);
      await finish.promise;
    },
    async cancelTask() {
      cancels++;
      if (failure === "hang") await new Promise<never>(() => undefined);
    },
  };
  const handler = stock
    ? new DefaultRequestHandler(card, new InMemoryTaskStore(), executor)
    : createRequestHandler(card, executor, 100);
  const context = new ServerCallContext({});
  const snapshot = async () =>
    handler.getTask({ id: (await started.promise).taskId, tenant: "" }, context);
  const ready = async () =>
    until(async () => {
      try {
        return parts(await snapshot()).join("") === "A";
      } catch (error) {
        if (error instanceof TaskNotFoundError) return false;
        throw error;
      }
    });
  const settle = (state = TaskState.TASK_STATE_CANCELED) => {
    if (!live) throw new Error("Executor not started");
    append("B", true);
    append("B", true);
    append("", true, true);
    live.bus.publish(
      AgentEvent.statusUpdate(
        TaskStatusUpdateEvent.fromJSON({
          taskId: live.context.taskId,
          contextId: live.context.contextId,
          status: { state },
        }),
      ),
    );
    finish.resolve();
  };
  const cancel = async () =>
    handler.cancelTask(
      { id: (await started.promise).taskId, tenant: "", metadata: undefined },
      context,
    );
  const consume = async (stream: AsyncGenerator<StreamResponse>) => {
    for await (const event of stream) events.push(event);
  };
  return {
    handler,
    context,
    started: started.promise,
    ready,
    snapshot,
    settle,
    cancel,
    consume,
    events,
    waitCancels: (count: number) => until(() => cancels === count),
  };
}
