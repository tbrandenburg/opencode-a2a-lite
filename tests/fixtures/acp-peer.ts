import { Readable, Writable } from "node:stream";
import { spawn } from "node:child_process";
import * as acp from "@agentclientprotocol/sdk";

const mode = process.argv[2];
if (process.argv[3] === "--version") {
  console.log(mode === "executable-version" ? "opencode v2.0.29" : "opencode v2.0.28");
  process.exit(0);
}
const descendant =
  mode === "descendant"
    ? spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })
    : undefined;
const agent = acp.agent({ name: "test-peer" });
let initialized = 0;
let sessions = 0;
let turns = 0;
let release: (() => void) | undefined;
let current: acp.AgentContext | undefined;
let activeSession = "";
const forever = () => new Promise<never>(() => undefined);

agent.onRequest(acp.methods.agent.initialize, async (request) => {
  initialized++;
  if (mode === "startup-exit") process.exit(12);
  if (request.params.protocolVersion !== 1 || initialized !== 1) throw new Error("bad initialize");
  return { protocolVersion: 1, agentCapabilities: {} };
});
agent.onRequest(acp.methods.agent.session.new, async (request) => {
  if (request.params.cwd !== process.cwd() || request.params.mcpServers.length)
    throw new Error("bad workspace");
  if (current) await chunk(current, activeSession, "late-idle");
  return { sessionId: `session-${++sessions}` };
});

async function chunk(
  ctx: acp.AgentContext,
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
  if (text?.type !== "text") throw new Error("bad prompt");
  if (text.text === "exit") process.exit(13);
  if (text.text === "hang") return forever();
  if (text.text === "cancel") {
    await chunk(ctx, activeSession, "ready");
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await chunk(ctx, activeSession, "late-cancelled");
    return { stopReason: "cancelled" };
  }
  if (text.text.startsWith("permission")) {
    const options: acp.PermissionOption[] = [
      { kind: "allow_once", optionId: "allow", name: "Allow" },
    ];
    if (text.text === "permission-reject")
      options.push({ kind: "reject_once", optionId: "deny", name: "Deny" });
    const response = await ctx.request(acp.methods.client.session.requestPermission, {
      sessionId: activeSession,
      toolCall: { toolCallId: "tool", title: "Untrusted tool" },
      options,
    });
    await chunk(ctx, activeSession, JSON.stringify(response.outcome));
    return { stopReason: "refusal" };
  }
  await chunk(ctx, "unrelated", "wrong-session");
  await chunk(ctx, activeSession, "child", { "opencode/child-session": false });
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
  if (mode === "cancel-hang") return;
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
