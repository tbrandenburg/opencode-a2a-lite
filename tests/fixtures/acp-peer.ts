import { Readable, Writable } from "node:stream";
import { spawn } from "node:child_process";
import type { AgentContext, PermissionOption } from "@agentclientprotocol/sdk";
import { slowInitializationMs } from "./acp-test-timeouts.js";

const mode = process.argv[2];
if (process.argv[3] === "--version") {
  const version =
    mode === "executable-version"
      ? "2.2.6"
      : mode === "version-old"
        ? "2.0.28"
        : mode === "version-floor"
          ? "2.1.3"
          : mode === "version-newer"
            ? "2.3.0"
            : mode === "version-prerelease"
              ? "2.3.0-beta.1"
              : "2.2.7";
  console.log(`opencode v${version}`);
  process.exit(0);
}
const acp = await import("@agentclientprotocol/sdk");
const descendant =
  mode === "descendant"
    ? spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
    : undefined;
const agent = acp.agent({ name: "test-peer" });
let initialized = 0;
let sessions = 0;
let turns = 0;
let release: (() => void) | undefined;
let current: AgentContext | undefined;
let activeSession = "";
const selectedRoles = new Set<string>();
const roleOptions = (
  selected = false,
): import("@agentclientprotocol/sdk").SessionConfigOption[] => [
  {
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue: selected ? "architect" : "build",
    options: [
      { value: "build", name: "Build" },
      { value: "architect", name: "Architect" },
    ],
  },
];
const forever = () => new Promise<never>(() => undefined);

agent.onRequest(acp.methods.agent.initialize, async (request) => {
  initialized++;
  if (mode === "startup-exit") process.exit(12);
  if (request.params.protocolVersion !== 1 || initialized !== 1) throw new Error("bad initialize");
  if (mode === "cancel-hang-slow-start" || mode === "slow-start")
    await Bun.sleep(slowInitializationMs);
  return { protocolVersion: 1, agentCapabilities: {} };
});
agent.onRequest(acp.methods.agent.session.new, async (request) => {
  if (request.params.cwd !== process.cwd() || request.params.mcpServers.length)
    throw new Error("bad workspace");
  if (mode === "session-unavailable") throw new Error("secret provider diagnostics");
  // Session creation must not be counted against the completed startup phase.
  if (mode === "cancel-hang-slow-start") await Bun.sleep(4_000);
  if (current) await chunk(current, activeSession, "late-idle");
  return {
    sessionId: `session-${++sessions}`,
    ...(mode?.startsWith("role-") ? { configOptions: roleOptions() } : {}),
  };
});
agent.onRequest(acp.methods.agent.session.setConfigOption, async (request) => {
  if (mode === "role-error") throw new Error("secret role prompt");
  if (mode === "role-new-session-failure" && sessions > 1) return { configOptions: roleOptions() };
  if (request.params.configId !== "mode" || request.params.value !== "architect")
    throw new Error("bad selection");
  if (mode !== "role-fallback") selectedRoles.add(request.params.sessionId);
  return { configOptions: roleOptions(mode !== "role-fallback") };
});

agent.onRequest(acp.methods.agent.session.resume, async (request) => {
  // Like OpenCode: unknown ids and foreign workspaces are invalid params, not fatal errors.
  if (request.params.cwd !== process.cwd() || request.params.sessionId.startsWith("ses_unknown"))
    throw acp.RequestError.invalidParams({ sessionId: request.params.sessionId });
  if (mode === "resume-internal-error") throw new Error("secret provider diagnostics");
  return {};
});

agent.onRequest(acp.methods.agent.session.load, async (request) => {
  if (request.params.cwd !== process.cwd() || request.params.sessionId.startsWith("ses_unknown"))
    throw acp.RequestError.invalidParams({ sessionId: request.params.sessionId });
  const ctx = request.client;
  const id = request.params.sessionId;
  const send = (update: Record<string, unknown>) =>
    ctx.notify(acp.methods.client.session.update, { sessionId: id, update: update as never });
  const text = (kind: string, messageId: string, value: string, meta?: object) =>
    send({
      sessionUpdate: kind,
      messageId,
      content: { type: "text", text: value, ...(meta ? { _meta: meta } : {}) },
    });
  if (id.startsWith("ses_longhistory")) {
    for (let index = 0; index < 105; index += 1)
      await text("user_message_chunk", `m${index}`, `q${index}`);
    await text("agent_message_chunk", "big", "x".repeat(25_000));
    return {};
  }
  await send({
    sessionUpdate: "user_message_chunk",
    messageId: "image",
    content: { type: "image", data: "", mimeType: "image/png" },
  });
  await text("user_message_chunk", "m1", "remember KUMQUAT");
  await send({
    sessionUpdate: "tool_call",
    toolCallId: "t1",
    title: "read",
    rawInput: { secret: "tool-input" },
  });
  await send({
    sessionUpdate: "tool_call_update",
    toolCallId: "t1",
    status: "completed",
    content: [{ type: "content", content: { type: "text", text: "tool-output" } }],
  });
  await send({
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: "replayed-thought" },
  });
  await text("agent_message_chunk", "m2", "no", undefined);
  await text("agent_message_chunk", "m2", "ted");
  await text("agent_message_chunk", "child", "child-reply", { "opencode/child-session": true });
  await text("user_message_chunk", "m3", "what was it?");
  await text("agent_message_chunk", "m4", "KUMQUAT");
  return {};
});

async function chunk(
  ctx: AgentContext,
  sessionId: string,
  text: string,
  meta?: Record<string, unknown>,
) {
  await ctx.notify(acp.methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
      ...(meta ? { _meta: meta } : {}),
    },
  });
}

agent.onRequest(acp.methods.agent.session.prompt, async (request) => {
  const ctx = request.client;
  current = ctx;
  activeSession = request.params.sessionId;
  const text = request.params.prompt[0];
  if (mode?.startsWith("role-") && !selectedRoles.has(activeSession))
    throw new Error("unselected prompt must never be sent");
  if (mode === "role-ok") {
    await ctx.notify(acp.methods.client.session.update, {
      sessionId: activeSession,
      _meta: { "opencode/child-session": true },
      update: { sessionUpdate: "config_option_update", configOptions: roleOptions() },
    });
    await ctx.notify(acp.methods.client.session.update, {
      sessionId: activeSession,
      update: {
        sessionUpdate: "config_option_update",
        configOptions: roleOptions(),
        _meta: { "opencode/child-session": { id: "ses_child" } },
      },
    });
  }
  if (mode === "role-drift") {
    await ctx.notify(acp.methods.client.session.update, {
      sessionId: activeSession,
      update: { sessionUpdate: "config_option_update", configOptions: roleOptions() },
    });
    return forever();
  }
  if (text?.type !== "text") throw new Error("bad prompt");
  if (text.text === "exit") process.exit(13);
  if (text.text === "slow-prompt") await Bun.sleep(2_300);
  if (text.text === "whoami") {
    await chunk(ctx, activeSession, activeSession);
    return { stopReason: "end_turn" };
  }
  if (text.text === "hang") {
    await chunk(ctx, activeSession, "ready");
    return forever();
  }
  if (text.text === "cancel") {
    await chunk(ctx, activeSession, "ready");
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await chunk(ctx, activeSession, "late-cancelled");
    return { stopReason: "cancelled" };
  }
  if (text.text.startsWith("permission")) {
    const options: PermissionOption[] = [
      { kind: "allow_once", optionId: "allow", name: "Allow" },
      { kind: "allow_always", optionId: "always", name: "Always" },
    ];
    if (text.text === "permission-reject" || text.text === "permission-wait")
      options.push({ kind: "reject_once", optionId: "deny", name: "Deny" });
    const response = await ctx.request(acp.methods.client.session.requestPermission, {
      sessionId: activeSession,
      toolCall: { toolCallId: "tool", title: "Untrusted tool" },
      options,
    });
    await chunk(ctx, activeSession, JSON.stringify(response.outcome));
    // Like OpenCode, a cancelled permission ends the turn as cancelled.
    if (text.text === "permission-wait" && response.outcome.outcome === "cancelled")
      return { stopReason: "cancelled" };
    return { stopReason: "refusal" };
  }
  await chunk(ctx, "unrelated", "wrong-session");
  await chunk(ctx, activeSession, "child", { "opencode/child-session": false });
  await chunk(ctx, activeSession, "child-object", {
    "opencode/child-session": { id: "ses_child", parentID: activeSession, depth: 1 },
  });
  await ctx.notify(acp.methods.client.session.update, {
    sessionId: activeSession,
    _meta: { "opencode/child-session": true },
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "child-envelope" },
    },
  });
  await ctx.notify(acp.methods.client.session.update, {
    sessionId: activeSession,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "child-content", _meta: { "opencode/child-session": true } },
    },
  });
  await ctx.notify(acp.methods.client.session.update, {
    sessionId: activeSession,
    update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "private" } },
  });
  await ctx.notify(acp.methods.client.session.update, {
    sessionId: activeSession,
    update: {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text: "child-thought", _meta: { "opencode/child-session": true } },
    },
  });
  await ctx.notify(acp.methods.client.session.update, {
    sessionId: activeSession,
    update: { sessionUpdate: "tool_call", toolCallId: "private-tool", title: "private tool" },
  });
  await ctx.notify(acp.methods.client.session.update, {
    sessionId: activeSession,
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "private-tool",
      status: "completed",
      content: [{ type: "content", content: { type: "text", text: "secret-tool-output" } }],
      rawOutput: "secret-tool-output",
    },
  });
  await ctx.notify(acp.methods.client.session.update, {
    sessionId: activeSession,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "image", data: "", mimeType: "image/png" },
    },
  });
  await chunk(ctx, activeSession, `turn-${++turns}:`);
  await chunk(ctx, activeSession, text.text);
  return {
    stopReason: text.text === "limit" ? "max_tokens" : "end_turn",
    _meta: { initialized, pid: process.pid, ...(descendant ? { descendant: descendant.pid } : {}) },
  };
});

agent.onNotification(acp.methods.agent.session.cancel, async (notification) => {
  const ctx = notification.client;
  if (mode === "cancel-hang" || mode === "cancel-hang-slow-start") {
    await chunk(ctx, notification.params.sessionId, "cancel-received");
    return;
  }
  if (mode === "cancel-no-receipt") return;
  await chunk(ctx, notification.params.sessionId, "late-before-stop");
  release?.();
});
const connection = agent.connect(
  acp.ndJsonStream(
    Writable.toWeb(process.stdout),
    Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
  ),
);
if (descendant) process.on("SIGTERM", () => undefined);
process.stdin.on("end", () => {
  if (!descendant) process.exit(0);
});
if (descendant) setInterval(() => undefined, 1_000);
await connection.closed;
