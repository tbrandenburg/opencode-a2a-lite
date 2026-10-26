import { afterEach, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createGateway } from "../src/server.js";

const gateways: ReturnType<typeof createGateway>[] = [];
const fixture = fileURLToPath(new URL("./fixtures/acp-peer.ts", import.meta.url));
afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
});

async function rpc(url: string, method: string, params: object) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "A2A-Version": "1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

test.each(["normal", "cancel-loses", "cancel-hang", "shutdown"])(
  "HTTP %s cancellation stores the actual terminal state and text",
  async (mode) => {
    const settled = Promise.withResolvers<string>();
    const gateway = createGateway({
      workspace: process.cwd(),
      port: 0,
      acp: {
        executable: process.execPath,
        args: [fixture, mode],
        versionArgs: [fixture, mode, "--version"],
        env: { PATH: process.env.PATH },
        startupTimeoutMs: 2_000,
        promptTimeoutMs: 2_000,
        cancelTimeoutMs: 150,
        closeTimeoutMs: 600,
      },
    });
    gateways.push(gateway);
    const ready = await gateway.start();
    const response = await rpc(ready.url, "SendStreamingMessage", {
      message: { messageId: "cancel-input", role: "ROLE_USER", parts: [{ text: "cancel" }] },
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let stream = "";
    let taskId = "";
    const consume = (async () => {
      while (true) {
        const part = await reader.read();
        if (part.done) return;
        stream += decoder.decode(part.value, { stream: true });
        const events = stream.split("\n").filter((line) => line.startsWith("data:"));
        const task = events.map((line) => JSON.parse(line.slice(5)).result?.task).find(Boolean);
        if (task) taskId = task.id;
        if (taskId && stream.includes('"text":"ready"')) settled.resolve(taskId);
      }
    })();
    await settled.promise;
    const wrong = await (await rpc(ready.url, "CancelTask", { id: "wrong-task" })).json();
    expect(wrong.error).toBeDefined();
    expect(stream).not.toContain("late-before-stop");
    if (mode === "shutdown") {
      await gateway.close();
      await consume;
      expect(stream).toContain("TASK_STATE_CANCELED");
      expect(stream).toContain("late-cancelled");
      const stopped = await fetch(ready.url).catch(() => undefined);
      expect(stopped === undefined || stopped.status === 503).toBe(true);
      return;
    }
    const cancellations = await Promise.all(
      Array.from({ length: mode === "normal" ? 2 : 1 }, async () =>
        (await rpc(ready.url, "CancelTask", { id: taskId })).json(),
      ),
    );
    const canceled = cancellations[0];
    await consume;
    const stored = await (await rpc(ready.url, "GetTask", { id: taskId })).json();
    const state =
      mode === "normal"
        ? "TASK_STATE_CANCELED"
        : mode === "cancel-loses"
          ? "TASK_STATE_COMPLETED"
          : "TASK_STATE_FAILED";
    expect(stored.result.status.state).toBe(state);
    expect(stream).toContain(state);
    if (mode === "normal") {
      expect(canceled.result.status.state).toBe(state);
      expect(cancellations[1].result.status.state).toBe(state);
      const repeated = await (await rpc(ready.url, "CancelTask", { id: taskId })).json();
      expect(repeated.result.status.state).toBe(state);
    } else {
      expect(canceled.error).toBeDefined();
    }
    const text = stored.result.artifacts[0].parts
      .map((part: { text?: string }) => part.text ?? "")
      .join("");
    expect(text).toBe(mode === "cancel-hang" ? "ready" : "readylate-before-stoplate-cancelled");
    expect(stream).not.toContain("private");
  },
);
