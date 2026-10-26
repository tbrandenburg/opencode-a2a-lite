import { randomUUID } from "node:crypto";
import { Role, TaskState, type Part } from "@a2a-js/sdk";
import { TaskNotCancelableError } from "@a2a-js/sdk/errors";
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import type { createAcpBridge } from "./acp-client.js";

export type ExecutorBridge = Pick<
  ReturnType<typeof createAcpBridge>,
  "newSession" | "prompt" | "cancel"
>;

export const EXPLICIT_CONTEXT = "opencode.explicitContext";

export interface ExecutorOptions {
  maxContexts?: number;
}

function textPart(text: string): Part {
  return {
    content: { $case: "text", value: text },
    mediaType: "text/plain",
    filename: "",
    metadata: undefined,
  };
}

export function createAgentExecutor(
  bridge: ExecutorBridge,
  options: ExecutorOptions = {},
): AgentExecutor {
  const maximum = options.maxContexts ?? 100;
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("Invalid context capacity");
  const sessions = new Map<string, string>();
  type Active = {
    taskId: string;
    sessionId?: string;
    terminal: boolean;
    cancellation?: Promise<void>;
  };
  let active: Active | undefined;

  async function execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
    const taskId = ctx.taskId;
    const contextId = ctx.contextId;
    const artifactId = randomUUID();
    let emitted = false;
    let terminal = false;

    function status(state: TaskState, text?: string) {
      bus.publish(
        AgentEvent.statusUpdate({
          taskId,
          contextId,
          status: {
            state,
            timestamp: new Date().toISOString(),
            message: text
              ? {
                  messageId: randomUUID(),
                  taskId,
                  contextId,
                  role: Role.ROLE_AGENT,
                  parts: [textPart(text)],
                  metadata: undefined,
                  extensions: [],
                  referenceTaskIds: [],
                }
              : undefined,
          },
          metadata: undefined,
        }),
      );
    }

    function chunk(text: string, lastChunk = false) {
      bus.publish(
        AgentEvent.artifactUpdate({
          taskId,
          contextId,
          artifact: {
            artifactId,
            name: "response",
            description: "Assistant text",
            parts: [textPart(text)],
            metadata: undefined,
            extensions: [],
          },
          append: emitted,
          lastChunk,
          metadata: undefined,
        }),
      );
      emitted = true;
    }

    function finish(state: TaskState, text?: string) {
      terminal = true;
      if (emitted) chunk("", true);
      status(state, text);
    }

    bus.publish(
      AgentEvent.task(
        ctx.task ?? {
          id: taskId,
          contextId,
          status: {
            state: TaskState.TASK_STATE_SUBMITTED,
            timestamp: new Date().toISOString(),
            message: undefined,
          },
          history: [ctx.userMessage],
          artifacts: [],
          metadata: undefined,
        },
      ),
    );

    const message = ctx.userMessage;
    if (ctx.task || message.referenceTaskIds.length) {
      finish(
        TaskState.TASK_STATE_FAILED,
        "Use contextId without taskId or task references for follow-up turns",
      );
      return;
    }
    const parts = message.parts;
    if (
      message.role !== Role.ROLE_USER ||
      !parts.length ||
      parts.some(
        (part) =>
          part.content?.$case !== "text" ||
          (part.mediaType !== "" && part.mediaType !== "text/plain"),
      )
    ) {
      finish(TaskState.TASK_STATE_FAILED, "Only non-empty plain text input is supported");
      return;
    }
    const text = parts
      .map((part) => (part.content?.$case === "text" ? part.content.value : ""))
      .join("\n");
    if (!text.trim()) {
      finish(TaskState.TASK_STATE_FAILED, "Only non-empty plain text input is supported");
      return;
    }

    const existing = sessions.get(contextId);
    const explicit = ctx.context.state.get(EXPLICIT_CONTEXT) ?? Boolean(message.contextId);
    if (active) {
      finish(TaskState.TASK_STATE_FAILED, "Gateway busy; retry after the active turn finishes");
      return;
    }
    if (explicit && !existing) {
      finish(
        TaskState.TASK_STATE_FAILED,
        "Unknown or expired context; omit contextId to start a new conversation",
      );
      return;
    }
    if (!existing && sessions.size >= maximum) {
      finish(
        TaskState.TASK_STATE_FAILED,
        "Context capacity reached; restart the gateway to clear contexts",
      );
      return;
    }

    // Reserve synchronously before session allocation: there is no queue.
    const record: Active = { taskId, terminal: false };
    active = record;
    status(TaskState.TASK_STATE_WORKING);
    try {
      const sessionId = existing ?? (await bridge.newSession()).sessionId;
      record.sessionId = sessionId;
      sessions.set(contextId, sessionId);
      const response = await bridge.prompt(sessionId, text, (value) => {
        if (!terminal && value) chunk(value);
      });
      if (response.stopReason === "end_turn") {
        finish(TaskState.TASK_STATE_COMPLETED);
        return;
      }
      if (response.stopReason === "cancelled") {
        finish(TaskState.TASK_STATE_CANCELED);
        return;
      }
      sessions.delete(contextId);
      finish(TaskState.TASK_STATE_FAILED, "ACP did not complete the turn");
    } catch {
      sessions.delete(contextId);
      if (!terminal) finish(TaskState.TASK_STATE_FAILED, "ACP execution failed");
    } finally {
      record.terminal = true;
      await record.cancellation?.catch(() => undefined);
      if (active === record) active = undefined;
    }
  }

  async function cancelTask(taskId: string): Promise<void> {
    const record = active;
    if (!record || record.taskId !== taskId || record.terminal)
      throw new TaskNotCancelableError("Task has no active ACP prompt");
    if (!record.sessionId)
      throw new TaskNotCancelableError(
        "ACP session allocation is not cancelable; retry after allocation finishes",
      );
    try {
      // execute() publishes the terminal state only after ACP confirms its stop reason.
      record.cancellation ??= bridge.cancel(record.sessionId);
      await record.cancellation;
    } catch {
      throw new TaskNotCancelableError("ACP cancellation failed");
    }
  }

  return { execute, cancelTask };
}
