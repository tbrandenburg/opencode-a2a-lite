import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { Task, TaskState } from "@a2a-js/sdk";
import { record } from "./profiles.js";
import type { CallOptions, mcp } from "./transport.js";

export type Handle = Readonly<{ peerUrl: string; contextId: string; taskId: string }>;
type Terminal = "completed" | "failed" | "canceled";
export type Observation = {
  outcome: Terminal | "pending";
  handle: Handle;
  task: Task;
};
export type Pending = Observation & {
  reason?: "deadline" | "aborted" | "poll-limit" | "budget";
};
export type Submission = Observation | { outcome: "uncertain"; cause: unknown };
export type WaitOptions = CallOptions & {
  maxPolls?: number;
  intervalMs?: number;
  stopWhen?: (observation: Observation) => boolean;
};
type Connection = Pick<Awaited<ReturnType<typeof mcp>>, "call" | "remainingCalls">;

function observe(peerUrl: string, value: unknown, previous?: Handle): Observation {
  const envelope = record(value);
  const raw = record(envelope.task ?? envelope);
  assert(typeof raw.id === "string" && raw.id, "Missing actual task ID");
  assert(typeof raw.contextId === "string" && raw.contextId, "Missing actual context ID");
  assert(
    Object.values(TaskState).includes(record(raw.status).state as TaskState),
    "Unknown task state",
  );
  const task = Task.fromJSON(raw);
  assert(
    task.status &&
      task.status.state !== TaskState.UNRECOGNIZED &&
      task.status.state !== TaskState.TASK_STATE_UNSPECIFIED,
    "Unknown task state",
  );
  if (previous) {
    assert.equal(task.id, previous.taskId, "Task ID changed during observation");
    assert.equal(task.contextId, previous.contextId, "Context ID changed during observation");
  }
  const outcome =
    task.status?.state === TaskState.TASK_STATE_COMPLETED
      ? "completed"
      : task.status?.state === TaskState.TASK_STATE_FAILED ||
          task.status?.state === TaskState.TASK_STATE_REJECTED
        ? "failed"
        : task.status?.state === TaskState.TASK_STATE_CANCELED
          ? "canceled"
          : "pending";
  return {
    outcome,
    handle: Object.freeze({ peerUrl, taskId: task.id, contextId: task.contextId }),
    task,
  };
}

// Eight calls remain available for intervention/final verification, including direct calls.
const reserve = 8;
export function createTaskClient(connection: Connection, peerUrl: string) {
  const peer = (handle: Handle) =>
    assert.equal(handle.peerUrl, peerUrl, "Cross-peer handle misuse");
  const inspect = async (tool: string, handle: Handle, options: CallOptions) => {
    peer(handle);
    return observe(
      peerUrl,
      await connection.call(
        tool,
        {
          peer_url: peerUrl,
          task_id: handle.taskId,
        },
        false,
        options,
      ),
      handle,
    );
  };
  return {
    async submit(text: string, options: CallOptions, continuation?: Handle): Promise<Submission> {
      if (continuation) peer(continuation);
      options.signal?.throwIfAborted();
      assert(options.deadline > performance.now(), "Submission deadline expired before dispatch");
      assert(connection.remainingCalls > reserve, "Submission would consume intervention reserve");
      let value: unknown;
      try {
        value = await connection.call(
          "a2a_send_message",
          {
            peer_url: peerUrl,
            text,
            blocking: false,
            ...(continuation ? { context_id: continuation.contextId } : {}),
          },
          false,
          options,
        );
      } catch (cause) {
        // Even a bridge tool error may follow remote acceptance (for example its unary timeout).
        return { outcome: "uncertain", cause };
      }
      const result = observe(peerUrl, value);
      if (continuation)
        assert.equal(
          result.handle.contextId,
          continuation.contextId,
          "Continuation changed context",
        );
      return result;
    },
    get: (handle: Handle, options: CallOptions) => inspect("a2a_get_task", handle, options),
    // A racing completion is returned as completed, not relabeled canceled. Errors propagate.
    cancel: (handle: Handle, options: CallOptions) => inspect("a2a_cancel_task", handle, options),
    async wait(initial: Observation, options: WaitOptions): Promise<Pending> {
      peer(initial.handle);
      const maximum = options.maxPolls ?? 8;
      const interval =
        options.intervalMs ?? Math.max(100, (options.deadline - performance.now()) / maximum);
      assert(Number.isInteger(maximum) && maximum > 0 && maximum <= 24, "Invalid poll count");
      assert(Number.isFinite(interval) && interval >= 0, "Invalid polling interval");
      let last = initial;
      for (let count = 0; count < maximum; count++) {
        if (last.outcome !== "pending" || options.stopWhen?.(last)) return last;
        if (options.signal?.aborted) return { ...last, reason: "aborted" };
        const remaining = options.deadline - performance.now();
        if (remaining <= 0) return { ...last, reason: "deadline" };
        if (connection.remainingCalls <= reserve) return { ...last, reason: "budget" };
        const timeout = AbortSignal.timeout(Math.ceil(remaining));
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        try {
          last = await inspect("a2a_get_task", last.handle, { deadline: options.deadline, signal });
          if (last.outcome !== "pending" || options.stopWhen?.(last)) return last;
          if (count + 1 === maximum) return { ...last, reason: "poll-limit" };
          const wake = Math.min(options.deadline, performance.now() + interval);
          // Timer delivery can precede a fractional target; it is not permission to poll.
          while (true) {
            const delay = wake - performance.now();
            if (delay <= 0) break;
            await setTimeout(Math.ceil(delay), undefined, { signal });
          }
        } catch (error) {
          if (options.signal?.aborted) return { ...last, reason: "aborted" };
          if (timeout.aborted || performance.now() >= options.deadline)
            return { ...last, reason: "deadline" };
          throw error;
        }
      }
      return { ...last, reason: "poll-limit" };
    },
  };
}
