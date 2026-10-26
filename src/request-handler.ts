import { TaskState, type AgentCard, type Task } from "@a2a-js/sdk";
import { TaskNotCancelableError } from "@a2a-js/sdk/errors";
import {
  DefaultExecutionEventBusManager,
  DefaultRequestHandler,
  InMemoryTaskStore,
  type AgentExecutor,
  type TaskStore,
} from "@a2a-js/sdk/server";

export function createRequestHandler(card: AgentCard, executor: AgentExecutor, timeout: number) {
  const memory = new InMemoryTaskStore();
  const buses = new DefaultExecutionEventBusManager();
  const listeners = new Map<string, Set<() => void>>();
  const terminal = (task: Task) =>
    task.status &&
    ![TaskState.TASK_STATE_SUBMITTED, TaskState.TASK_STATE_WORKING].includes(task.status.state);
  const store: TaskStore = {
    load: (id, context) => memory.load(id, context),
    list: (params, context) => memory.list(params, context),
    async save(task, context) {
      await memory.save(task, context);
      if (terminal(task)) listeners.get(task.id)?.forEach((notify) => notify());
    },
  };
  const handler = new DefaultRequestHandler(card, store, executor, buses);
  // SDK 1.3's CancelTask creates a second ResultManager on the live bus, so
  // cancellation-time artifact appends are persisted twice. Keep one consumer;
  // await that consumer's terminal save through the public TaskStore interface.
  handler.cancelTask = async (params, context) => {
    const task = await handler.getTask(params, context);
    if (task.status?.state === TaskState.TASK_STATE_CANCELED) return task;
    const bus = buses.getByTaskId(params.id, context);
    if (terminal(task) || !bus) throw new TaskNotCancelableError("Task has no active ACP prompt");
    const pending = Promise.withResolvers<void>();
    const callbacks = listeners.get(params.id) ?? new Set<() => void>();
    const notify = () => pending.resolve();
    callbacks.add(notify);
    listeners.set(params.id, callbacks);
    const timer = setTimeout(
      () => pending.reject(new TaskNotCancelableError("Cancellation did not settle")),
      timeout,
    );
    try {
      // Recheck after subscribing in case the original event consumer won the race.
      const current = await handler.getTask(params, context);
      if (terminal(current)) notify();
      await Promise.all([executor.cancelTask(params.id, bus), pending.promise]);
      const result = await handler.getTask(params, context);
      if (result.status?.state !== TaskState.TASK_STATE_CANCELED)
        throw new TaskNotCancelableError("ACP did not cancel the task");
      return result;
    } finally {
      clearTimeout(timer);
      callbacks.delete(notify);
      if (!callbacks.size) listeners.delete(params.id);
    }
  };
  return handler;
}
