import { afterEach, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createGateway } from "../src/server.js";
import { createAgentExecutor } from "../src/executor.js";

const gateways: ReturnType<typeof createGateway>[] = [];
const fixture = fileURLToPath(new URL("./fixtures/acp-peer.ts", import.meta.url));

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
});

function gateway(allocation?: Promise<void>) {
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
      return createAgentExecutor({
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
      });
    },
  });
  gateways.push(instance);
  return { instance, calls, started: started.promise };
}

type WireTask = {
  id: string;
  contextId: string;
  status: { state: string; message?: { parts: { text: string }[] } };
  artifacts?: { artifactId: string; parts: { text: string }[] }[];
};
type WireEvent = {
  task?: WireTask;
  artifactUpdate?: {
    artifact: NonNullable<WireTask["artifacts"]>[number];
    append?: boolean;
    lastChunk?: boolean;
  };
  statusUpdate?: { status: WireTask["status"] };
};

async function rpc(url: string, method: string, params: object) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "A2A-Version": "1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(5_000),
  });
}

async function stored(url: string, id: string): Promise<WireTask> {
  const response = await rpc(url, "GetTask", { id });
  return ((await response.json()) as { result: WireTask }).result;
}

async function send(url: string, method: string, text: string, contextId?: string) {
  const response = await rpc(url, method, {
    message: { messageId: crypto.randomUUID(), role: "ROLE_USER", parts: [{ text }], contextId },
  });
  expect(response.status).toBe(200);
  if (method === "SendMessage") {
    const task = ((await response.json()) as { result: { task: WireTask } }).result.task;
    expect(await stored(url, task.id)).toEqual(task);
    return task;
  }
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const wire = await response.text();
  const events = wire
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => (JSON.parse(line.slice(5)) as { result: WireEvent }).result);
  const task = events[0]?.task;
  if (!task) throw new Error("Missing initial SSE task");
  expect(task.status.state).toBe("TASK_STATE_SUBMITTED");
  const snapshot = await stored(url, task.id);
  expect(events.at(-1)?.statusUpdate?.status).toEqual(snapshot.status);
  if (snapshot.status.state === "TASK_STATE_COMPLETED") {
    expect(events[1]?.statusUpdate?.status.state).toBe("TASK_STATE_WORKING");
    const chunks = events.flatMap((event) => (event.artifactUpdate ? [event.artifactUpdate] : []));
    expect(chunks.map((chunk) => [chunk.append ?? false, chunk.lastChunk ?? false])).toEqual([
      [false, false],
      [true, false],
      [true, true],
    ]);
    expect(new Set(chunks.map((chunk) => chunk.artifact.artifactId)).size).toBe(1);
    expect(chunks.flatMap((chunk) => chunk.artifact.parts)).toEqual(
      snapshot.artifacts?.[0]?.parts ?? [],
    );
    expect(
      events.filter((event) => event.statusUpdate?.status.state === "TASK_STATE_COMPLETED"),
    ).toHaveLength(1);
  }
  expect(wire).not.toMatch(/wrong-session|child|private|late-idle/);
  return snapshot;
}

test.each([
  { id: "H08", method: "SendMessage" },
  { id: "H09", method: "SendStreamingMessage" },
])(
  "$id $method context lifecycle preserves continuation/isolation and rejects unknown/stale IDs",
  async ({ method }) => {
    const run = gateway();
    const ready = await run.instance.start();
    const unknown = await send(ready.url, method, "hello", "unknown");
    expect(unknown.status.state).toBe("TASK_STATE_FAILED");
    expect(unknown.status.message?.parts[0]?.text).toContain("Unknown or expired");
    expect(run.calls).toEqual([]);
    const alpha = await send(ready.url, method, "alpha");
    const beta = await send(ready.url, method, "beta");
    const again = await send(ready.url, method, "alpha again", alpha.contextId);
    const other = await send(ready.url, method, "beta again", beta.contextId);
    expect(alpha.contextId).not.toBe(beta.contextId);
    expect(again.id).not.toBe(alpha.id);
    expect(again.contextId).toBe(alpha.contextId);
    expect(other.contextId).toBe(beta.contextId);
    expect([alpha, beta, again, other].map((task) => task.status.state)).toEqual(
      Array(4).fill("TASK_STATE_COMPLETED"),
    );
    expect(
      [alpha, beta, again, other].map((task) =>
        task.artifacts?.[0]?.parts.map((part) => part.text),
      ),
    ).toEqual([
      ["turn-1:", "alpha", ""],
      ["turn-2:", "beta", ""],
      ["turn-3:", "alpha again", ""],
      ["turn-4:", "beta again", ""],
    ]);
    expect(run.calls).toEqual([
      "session",
      "session-1:alpha",
      "session",
      "session-2:beta",
      "session-1:alpha again",
      "session-2:beta again",
    ]);
    await run.instance.close();
    const restarted = gateway();
    const fresh = await restarted.instance.start();
    const stale = await send(fresh.url, method, "follow up", alpha.contextId);
    expect(stale.status.state).toBe("TASK_STATE_FAILED");
    expect(stale.status.message?.parts[0]?.text).toContain("Unknown or expired");
    expect(restarted.calls).toEqual([]);
    const accepted = await send(fresh.url, method, "new conversation");
    expect(accepted.status.state).toBe("TASK_STATE_COMPLETED");
    expect(restarted.calls).toEqual(["session", "session-1:new conversation"]);
  },
);

test("H10 HTTP busy during allocation rejects without session creation or submission", async () => {
  const release = Promise.withResolvers<void>();
  const run = gateway(release.promise);
  const ready = await run.instance.start();
  const pending = send(ready.url, "SendMessage", "first");
  try {
    await run.started;
    const rejected = await send(ready.url, "SendMessage", "second");
    expect(rejected.status.state).toBe("TASK_STATE_FAILED");
    expect(rejected.status.message?.parts[0]?.text).toContain("busy");
    expect(run.calls).toEqual(["session"]);
  } finally {
    release.resolve();
  }
  expect((await pending).status.state).toBe("TASK_STATE_COMPLETED");
  expect(run.calls).toEqual(["session", "session-1:first"]);
});
