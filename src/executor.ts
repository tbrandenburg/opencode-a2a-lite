import { randomUUID } from "node:crypto";
import { Role, TaskState, type Part } from "@a2a-js/sdk";
import { TaskNotCancelableError } from "@a2a-js/sdk/errors";
import {
  AgentEvent,
  type AgentExecutor,
  type ExecutionEventBus,
  type RequestContext,
} from "@a2a-js/sdk/server";
import type { Activity } from "./activity.js";
import type { createAcpBridge } from "./acp-client.js";
import { BridgeError } from "./bridge-error.js";
import { createPermissionDesk } from "./permission-desk.js";
import { parseAnswer, type PermissionRequest } from "./permission.js";
import { conversationEvent } from "./conversation.js";
import { resumeRefusal, wantedReplay, wantedSession } from "./resume.js";

export type ExecutorBridge = Pick<
  ReturnType<typeof createAcpBridge>,
  "newSession" | "prompt" | "cancel"
> &
  Partial<Pick<ReturnType<typeof createAcpBridge>, "resumeSession" | "loadSession">>;

export const EXPLICIT_CONTEXT = "opencode.explicitContext";

export interface ExecutorOptions {
  maxContexts?: number;
  activity?: boolean;
  permissions?: "ask";
  permissionTimeoutMs?: number;
  resume?: boolean;
}

export const ACTIVITY_EXTENSION = "urn:opencode-a2a-lite:activity:v1";
export const PERMISSIONS_EXTENSION = "urn:opencode-a2a-lite:permissions:v1";
export const RESUME_EXTENSION = "urn:opencode-a2a-lite:resume:v1";

function permissionPart(requestId: string, request: PermissionRequest): Part {
  return {
    content: { $case: "data", value: { permission: { requestId, ...request } } },
    mediaType: "application/json",
    filename: "",
    metadata: undefined,
  };
}

function dataPart(value: Activity): Part {
  return {
    content: { $case: "data", value },
    mediaType: "application/json",
    filename: "",
    metadata: undefined,
  };
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
  const desk = createPermissionDesk(options.permissionTimeoutMs ?? 120_000);
  type Active = {
    taskId: string;
    sessionId?: string;
    terminal: boolean;
    cancellation?: Promise<void>;
  };
  let active: Active | undefined;

  // Handles a message that answers a pending permission request; true when it was consumed.
  async function resume(
    ctx: RequestContext,
    status: (state: TaskState, text?: string, extra?: Part[]) => void,
  ): Promise<boolean> {
    const state = ctx.task?.status?.state;
    const entry = desk.pending(ctx.taskId);
    if (!entry) {
      // A live task must not be failed by a stray follow-up; the snapshot is the whole reply.
      return (
        state === TaskState.TASK_STATE_WORKING || state === TaskState.TASK_STATE_INPUT_REQUIRED
      );
    }
    const answer = parseAnswer(ctx.userMessage.parts, entry.requestId, entry.options);
    if ("error" in answer) {
      status(TaskState.TASK_STATE_INPUT_REQUIRED, `${answer.error}. Reply allow or reject.`);
      return true;
    }
    entry.settle(answer.optionId);
    await entry.finished;
    return true;
  }

  async function execute(ctx: RequestContext, bus: ExecutionEventBus): Promise<void> {
    const taskId = ctx.taskId;
    const contextId = ctx.contextId;
    const artifactId = randomUUID();
    const activityId = randomUUID();
    const meta: Record<string, string> = {};
    let emitted = false;
    let activityEmitted = false;
    let terminal = false;
    const finished = Promise.withResolvers<void>();

    function status(state: TaskState, text?: string, extra: Part[] = []) {
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
                  parts: [textPart(text), ...extra],
                  metadata: undefined,
                  extensions: [],
                  referenceTaskIds: [],
                }
              : undefined,
          },
          metadata: Object.keys(meta).length ? { ...meta } : undefined,
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

    function activity(entry?: Activity) {
      const lastChunk = entry === undefined;
      bus.publish(
        AgentEvent.artifactUpdate({
          taskId,
          contextId,
          artifact: {
            artifactId: activityId,
            name: "activity",
            description: "Tool call summaries and reasoning text",
            parts: [entry ? dataPart(entry) : textPart("")],
            metadata: undefined,
            extensions: [ACTIVITY_EXTENSION],
          },
          append: activityEmitted,
          lastChunk,
          metadata: undefined,
        }),
      );
      activityEmitted = true;
    }

    async function attachSession(id: string, replay: boolean): Promise<string> {
      if (!replay) {
        if (!bridge.resumeSession) throw new Error("Session resume unavailable");
        return bridge.resumeSession(id);
      }
      if (!bridge.loadSession) throw new Error("Session replay unavailable");
      const earlier = await bridge.loadSession(id);
      meta["opencode.replayed"] = String(earlier.messages.length);
      if (earlier.truncated) meta["opencode.replayTruncated"] = "true";
      if (earlier.messages.length) bus.publish(conversationEvent(taskId, contextId, earlier));
      return id;
    }

    function clearPending() {
      if (meta["opencode.permissionPending"] !== "true") return;
      meta["opencode.permissionPending"] = "false";
      meta["opencode.permissionRequestId"] = "";
    }

    function finish(state: TaskState, text?: string) {
      terminal = true;
      clearPending();
      if (emitted) chunk("", true);
      if (activityEmitted) activity();
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

    if (options.permissions === "ask" && ctx.task && (await resume(ctx, status))) return;

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
    const ask = {
      wanted: wantedSession(message.metadata) ?? wantedSession(ctx.request.metadata),
      replay: wantedReplay(message.metadata) ?? wantedReplay(ctx.request.metadata),
    };
    const wanted = ask.wanted;
    const refusal =
      (wanted || ask.replay !== undefined) &&
      resumeRefusal(ask, options.resume === true, existing, sessions.values());
    if (refusal) {
      finish(TaskState.TASK_STATE_FAILED, refusal);
      return;
    }
    if (explicit && !existing && !wanted) {
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
      const resuming = wanted && "id" in wanted && !existing ? wanted.id : undefined;
      const sessionId =
        existing ??
        (resuming
          ? await attachSession(resuming, ask.replay === true)
          : (await bridge.newSession()).sessionId);
      if (resuming) meta["opencode.resumed"] = "true";
      record.sessionId = sessionId;
      meta["opencode.sessionId"] = sessionId;
      sessions.set(contextId, sessionId);
      const response = await bridge.prompt(
        sessionId,
        text,
        (value) => {
          if (!terminal && value) chunk(value);
        },
        options.activity
          ? (entry) => {
              if (!terminal) activity(entry);
            }
          : undefined,
        options.permissions === "ask"
          ? async (request) => {
              const entry = desk.open(taskId, request.options, finished.promise);
              meta["opencode.permissionPending"] = "true";
              meta["opencode.permissionRequestId"] = entry.requestId;
              const label = request.kind ? `${request.title} (${request.kind})` : request.title;
              status(
                TaskState.TASK_STATE_INPUT_REQUIRED,
                `Allow "${label}"? Reply allow or reject.`,
                [permissionPart(entry.requestId, request)],
              );
              const answer = await entry.answer;
              clearPending();
              if (!terminal && !record.cancellation) status(TaskState.TASK_STATE_WORKING);
              return answer;
            }
          : undefined,
      );
      meta["opencode.stopReason"] = response.stopReason;
      if (response.permissionDenied) meta["opencode.permissionDenied"] = "true";
      if (response.stopReason === "end_turn") {
        finish(TaskState.TASK_STATE_COMPLETED);
        return;
      }
      if (response.stopReason === "cancelled") {
        finish(
          TaskState.TASK_STATE_CANCELED,
          response.permissionDenied && !record.cancellation
            ? "Permission request rejected; the tool run was not approved"
            : undefined,
        );
        return;
      }
      sessions.delete(contextId);
      finish(TaskState.TASK_STATE_FAILED, "ACP did not complete the turn");
    } catch (error) {
      sessions.delete(contextId);
      // Only gateway-authored phase messages are published; peer diagnostics never are.
      if (!terminal)
        finish(
          TaskState.TASK_STATE_FAILED,
          error instanceof BridgeError ? error.message : "ACP execution failed",
        );
    } finally {
      desk.release(taskId);
      finished.resolve();
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
