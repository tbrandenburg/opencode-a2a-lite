import { afterEach, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createGateway } from "../src/server.js";
import { createAgentExecutor } from "../src/executor.js";

const gateways: ReturnType<typeof createGateway>[] = [];
const fixture = fileURLToPath(new URL("./fixtures/acp-peer.ts", import.meta.url));

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
});

function gateway(maxContexts = 100, allocation?: Promise<void>) {
  const calls: string[] = [];
  const started = Promise.withResolvers<void>();
  const instance = createGateway({
    workspace: process.cwd(),
    port: 0,
    acp: {
      executable: process.execPath,
      args: [fixture, "normal"],
      versionArgs: [fixture, "normal", "--version"],
      env: { PATH: process.env.PATH },
      closeTimeoutMs: 600,
    },
    createExecutor(bridge) {
      return createAgentExecutor(
        {
          async newSession() {
            calls.push("session");
            started.resolve();
            await allocation;
            return bridge.newSession();
          },
          prompt(session, text, onText) {
            calls.push(`${session}:${text}`);
            return bridge.prompt(session, text, onText);
          },
          cancel: (session) => bridge.cancel(session),
        },
        { maxContexts },
      );
    },
  });
  gateways.push(instance);
  return { instance, calls, started: started.promise };
}

async function rpc(url: string, method: string, params: object) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "A2A-Version": "1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(5_000),
  });
  return response.json();
}

function message(text: string, contextId?: string) {
  return {
    message: { messageId: crypto.randomUUID(), role: "ROLE_USER", parts: [{ text }], contextId },
  };
}

test("HTTP same-context follow-ups reuse sessions; separate contexts remain isolated", async () => {
  const run = gateway();
  const ready = await run.instance.start();
  const alpha = await rpc(ready.url, "SendMessage", message("alpha"));
  const beta = await rpc(ready.url, "SendMessage", message("beta"));
  const again = await rpc(
    ready.url,
    "SendMessage",
    message("alpha again", alpha.result.task.contextId),
  );
  const other = await rpc(
    ready.url,
    "SendMessage",
    message("beta again", beta.result.task.contextId),
  );
  expect(alpha.result.task.contextId).not.toBe(beta.result.task.contextId);
  expect(again.result.task.id).not.toBe(alpha.result.task.id);
  expect(again.result.task.contextId).toBe(alpha.result.task.contextId);
  expect(other.result.task.contextId).toBe(beta.result.task.contextId);
  expect([alpha, beta, again, other].map((body) => body.result.task.status.state)).toEqual(
    Array(4).fill("TASK_STATE_COMPLETED"),
  );
  expect(run.calls).toEqual([
    "session",
    "session-1:alpha",
    "session",
    "session-2:beta",
    "session-1:alpha again",
    "session-2:beta again",
  ]);
});

test("HTTP explicit unknown and post-restart stale contexts fail without ACP submission", async () => {
  const first = gateway();
  const ready = await first.instance.start();
  const unknown = await rpc(ready.url, "SendMessage", message("hello", "unknown"));
  expect(unknown.result.task.status.state).toBe("TASK_STATE_FAILED");
  expect(unknown.result.task.status.message.parts[0].text).toContain("Unknown or expired");
  expect(first.calls).toEqual([]);
  const accepted = await rpc(ready.url, "SendMessage", message("remember"));
  await first.instance.close();
  const second = gateway();
  const restarted = await second.instance.start();
  const stale = await rpc(
    restarted.url,
    "SendMessage",
    message("follow up", accepted.result.task.contextId),
  );
  expect(stale.result.task.status.state).toBe("TASK_STATE_FAILED");
  expect(second.calls).toEqual([]);
  const fresh = await rpc(restarted.url, "SendMessage", message("new conversation"));
  expect(fresh.result.task.status.state).toBe("TASK_STATE_COMPLETED");
  expect(second.calls).toEqual(["session", "session-1:new conversation"]);
});

test("HTTP finite context capacity rejects new contexts but preserves retained follow-ups", async () => {
  const run = gateway(1);
  const ready = await run.instance.start();
  const accepted = await rpc(ready.url, "SendMessage", message("first"));
  const rejected = await rpc(ready.url, "SendMessage", message("new"));
  expect(rejected.result.task.status.state).toBe("TASK_STATE_FAILED");
  expect(rejected.result.task.status.message.parts[0].text).toContain("capacity");
  expect(run.calls).toEqual(["session", "session-1:first"]);
  const followup = await rpc(
    ready.url,
    "SendMessage",
    message("again", accepted.result.task.contextId),
  );
  expect(followup.result.task.status.state).toBe("TASK_STATE_COMPLETED");
  expect(run.calls).toEqual(["session", "session-1:first", "session-1:again"]);
});

test("HTTP busy during allocation rejects immediately without session creation or submission", async () => {
  const release = Promise.withResolvers<void>();
  const run = gateway(100, release.promise);
  const ready = await run.instance.start();
  const pending = rpc(ready.url, "SendMessage", message("first"));
  try {
    await run.started;
    const rejected = await rpc(ready.url, "SendMessage", message("second"));
    expect(rejected.result.task.status.state).toBe("TASK_STATE_FAILED");
    expect(rejected.result.task.status.message.parts[0].text).toContain("busy");
    expect(run.calls).toEqual(["session"]);
  } finally {
    release.resolve();
  }
  const completed = await pending;
  expect(completed.result.task.status.state).toBe("TASK_STATE_COMPLETED");
  expect(run.calls).toEqual(["session", "session-1:first"]);
});

test("HTTP streaming preserves explicit context checks and reuses a retained context", async () => {
  const run = gateway();
  const ready = await run.instance.start();
  const accepted = await rpc(ready.url, "SendMessage", message("first"));
  for (const contextId of ["unknown", accepted.result.task.contextId]) {
    const response = await fetch(ready.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "A2A-Version": "1.0" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "SendStreamingMessage",
        params: message("again", contextId),
      }),
      signal: AbortSignal.timeout(5_000),
    });
    const text = await response.text();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain(contextId === "unknown" ? "TASK_STATE_FAILED" : "TASK_STATE_COMPLETED");
    expect(text).not.toContain(
      contextId === "unknown" ? "TASK_STATE_WORKING" : "TASK_STATE_FAILED",
    );
  }
  expect(run.calls).toEqual(["session", "session-1:first", "session-1:again"]);
});

test("HTTP active prompt rejects same-context and new-context work without ACP submission", async () => {
  const run = gateway();
  const ready = await run.instance.start();
  const response = await fetch(ready.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "A2A-Version": "1.0" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "SendStreamingMessage",
      params: message("cancel"),
    }),
    signal: AbortSignal.timeout(5_000),
  });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing SSE body");
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes('"ready"')) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error("Prompt ended before ready");
    text += decoder.decode(chunk.value, { stream: true });
  }
  const snapshot = text.split("\n").find((line) => line.startsWith("data:"));
  if (!snapshot) throw new Error("Missing task snapshot");
  const task = JSON.parse(snapshot.slice(5)).result.task;
  const same = await rpc(ready.url, "SendMessage", message("same", task.contextId));
  const other = await rpc(ready.url, "SendMessage", message("other"));
  expect([same, other].map((body) => body.result.task.status.state)).toEqual([
    "TASK_STATE_FAILED",
    "TASK_STATE_FAILED",
  ]);
  expect([same, other].map((body) => body.result.task.status.message.parts[0].text)).toEqual([
    expect.stringContaining("busy"),
    expect.stringContaining("busy"),
  ]);
  expect(run.calls).toEqual(["session", "session-1:cancel"]);
  await rpc(ready.url, "CancelTask", { id: task.id });
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  expect(text).toContain("TASK_STATE_CANCELED");
  const followup = await rpc(ready.url, "SendMessage", message("after", task.contextId));
  expect(followup.result.task.status.state).toBe("TASK_STATE_COMPLETED");
  expect(run.calls).toEqual(["session", "session-1:cancel", "session-1:after"]);
});
