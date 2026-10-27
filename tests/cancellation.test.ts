import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createGateway } from "../src/server.js";
import { createAgentExecutor } from "../src/executor.js";

const fixture = fileURLToPath(new URL("./fixtures/acp-peer.ts", import.meta.url));

async function rpc(url: string, method: string, params: object) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "A2A-Version": "1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(5_000),
  });
}

function message(text: string, contextId?: string) {
  return {
    message: { messageId: crypto.randomUUID(), role: "ROLE_USER", parts: [{ text }], contextId },
  };
}

async function stream(url: string, contextId?: string) {
  const ready = Promise.withResolvers<{ id: string; contextId: string }>();
  const response = await rpc(url, "SendStreamingMessage", message("cancel", contextId));
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing SSE reader");
  let wire = "";
  const decoder = new TextDecoder();
  const ended = (async () => {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return wire;
      wire += decoder.decode(chunk.value, { stream: true });
      if (!wire.includes('"text":"ready"')) continue;
      const initial = wire.split("\n").find((line) => line.startsWith("data:"));
      if (!initial) throw new Error("Missing task snapshot");
      ready.resolve(JSON.parse(initial.slice(5)).result.task);
    }
  })();
  void ended.catch((error: unknown) => ready.reject(error));
  return { task: await ready.promise, ended };
}

function run() {
  const stopped = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const calls: string[] = [];
  const gateway = createGateway({
    workspace: process.cwd(),
    port: 0,
    acp: {
      executable: process.execPath,
      args: [fixture, "normal"],
      versionArgs: [fixture, "normal", "--version"],
      env: { PATH: process.env.PATH },
      startupTimeoutMs: 2_000,
      promptTimeoutMs: 2_000,
      cancelTimeoutMs: 150,
      closeTimeoutMs: 600,
    },
    createExecutor(bridge) {
      return createAgentExecutor({
        async newSession() {
          calls.push("session");
          return bridge.newSession();
        },
        prompt(session, text, onText) {
          calls.push(`${session}:${text}`);
          return bridge.prompt(session, text, onText);
        },
        async cancel(session) {
          await bridge.cancel(session);
          stopped.resolve();
          await release.promise;
        },
      });
    },
  });
  return { gateway, calls, stopped: stopped.promise, release: () => release.resolve() };
}

test("C09 HTTP holds admission until late cancellation settles", async () => {
  const probe = run();
  const gateway = probe.gateway;
  try {
    const ready = await gateway.start();
    const first = await stream(ready.url);
    const cancellation = rpc(ready.url, "CancelTask", { id: first.task.id }).then((response) =>
      response.json(),
    );
    await probe.stopped;
    const wire = await first.ended;
    const stored = await (await rpc(ready.url, "GetTask", { id: first.task.id })).json();
    expect(stored.result.status.state).toBe("TASK_STATE_CANCELED");
    expect(stored.result.artifacts[0].parts.map((part: { text: string }) => part.text)).toEqual([
      "ready",
      "late-before-stop",
      "late-cancelled",
      "",
    ]);
    expect(wire).toContain("TASK_STATE_CANCELED");
    expect(wire).not.toContain("private");
    const busy = await (
      await rpc(ready.url, "SendMessage", message("too early", first.task.contextId))
    ).json();
    expect(busy.result.task.status.state).toBe("TASK_STATE_FAILED");
    expect(busy.result.task.status.message.parts[0].text).toContain("busy");
    expect(probe.calls).toEqual(["session", "session-1:cancel"]);
    probe.release();
    expect((await cancellation).result.status.state).toBe("TASK_STATE_CANCELED");
  } finally {
    probe.release();
    await gateway.close();
  }
});

test("C10 HTTP cancellation of a terminal task cannot affect the next active turn", async () => {
  const probe = run();
  const gateway = probe.gateway;
  probe.release();
  try {
    const ready = await gateway.start();
    const first = await stream(ready.url);
    const initial = await (await rpc(ready.url, "CancelTask", { id: first.task.id })).json();
    expect(initial.result.status.state).toBe("TASK_STATE_CANCELED");
    expect(await first.ended).toContain("TASK_STATE_CANCELED");
    const second = await stream(ready.url, first.task.contextId);
    const repeated = await (await rpc(ready.url, "CancelTask", { id: first.task.id })).json();
    expect(repeated.result.status.state).toBe("TASK_STATE_CANCELED");
    const active = await (await rpc(ready.url, "GetTask", { id: second.task.id })).json();
    expect(active.result.status.state).toBe("TASK_STATE_WORKING");
    const canceled = await (await rpc(ready.url, "CancelTask", { id: second.task.id })).json();
    expect(canceled.result.status.state).toBe("TASK_STATE_CANCELED");
    expect(await second.ended).toContain("TASK_STATE_CANCELED");
    expect(probe.calls).toEqual(["session", "session-1:cancel", "session-1:cancel"]);
  } finally {
    probe.release();
    await gateway.close();
  }
});
