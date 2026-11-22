import { afterEach, expect, test as bunTest } from "bun:test";
import { fileURLToPath } from "node:url";
import { createAgentExecutor } from "../src/executor.js";
import { createGateway } from "../src/server.js";
import { fixtureStartupMs, fixtureTestMs } from "./fixtures/acp-test-timeouts.js";

const gateways: ReturnType<typeof createGateway>[] = [];
const fixture = fileURLToPath(new URL("./fixtures/acp-peer.ts", import.meta.url));
const test = (name: string, run: () => Promise<void>) => bunTest(name, run, fixtureTestMs);
afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
});

function gateway(wrap = false) {
  const instance = createGateway({
    workspace: process.cwd(),
    port: 0,
    executor: { permissions: "ask", permissionTimeoutMs: 20_000 },
    acp: {
      executable: process.execPath,
      args: [fixture, "normal"],
      versionArgs: [fixture, "normal", "--version"],
      env: { PATH: process.env.PATH },
      startupTimeoutMs: fixtureStartupMs,
      promptTimeoutMs: 5_000,
      closeTimeoutMs: 600,
    },
    ...(wrap
      ? {
          createExecutor: (bridge) =>
            createAgentExecutor(
              {
                newSession: () => bridge.newSession(),
                prompt: (session, text, onText, onActivity, onPermission) => {
                  onText("before");
                  return bridge.prompt(session, text, onText, onActivity, onPermission);
                },
                cancel: (session) => bridge.cancel(session),
              },
              { permissions: "ask", permissionTimeoutMs: 20_000 },
            ),
        }
      : {}),
  });
  gateways.push(instance);
  return instance;
}

interface PartJson {
  text?: string;
  data: { permission: { requestId: string; options: { optionId: string }[] } };
}
interface TaskJson {
  id: string;
  contextId: string;
  status: { state: string; message: { parts: PartJson[] } };
  metadata: Record<string, string>;
  artifacts?: { parts: PartJson[] }[];
}
interface EventJson {
  task?: TaskJson;
  statusUpdate?: { status: TaskJson["status"] };
  artifactUpdate?: { artifact: { name: string } };
}

const permissionOf = (task: Pick<TaskJson, "status">) => {
  const permission = task.status.message.parts[1]?.data.permission;
  if (!permission) throw new Error("No permission request in the task status");
  return permission;
};
const headers = { "Content-Type": "application/json", "A2A-Version": "1.0" };
async function rpc(url: string, method: string, params: object) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await response.json()) as { result: TaskJson & { task: TaskJson }; error?: unknown };
}
const message = (id: string, parts: object[], extra: object = {}) => ({
  message: { messageId: id, role: "ROLE_USER", parts, ...extra },
});
const texts = (task: TaskJson) =>
  (task.artifacts ?? []).flatMap((artifact) => artifact.parts.map((part) => part.text ?? ""));

async function ask(url: string, prompt = "permission-reject") {
  const sent = await rpc(url, "SendMessage", message("first", [{ text: prompt }]));
  return sent.result.task;
}

test("Q1: a permission request pauses the HTTP task and a text answer resumes it", async () => {
  const instance = gateway();
  const ready = await instance.start();
  const card = await (await fetch(new URL(".well-known/agent-card.json", ready.url))).json();
  expect(card.capabilities.extensions.map((entry: { uri: string }) => entry.uri)).toEqual([
    "urn:opencode-a2a-lite:permissions:v1",
  ]);
  const paused = await ask(ready.url);
  expect(paused.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
  const permission = permissionOf(paused);
  expect(permission.options.map((option: { optionId: string }) => option.optionId)).toEqual([
    "allow",
    "deny",
  ]);
  expect(paused.metadata["opencode.permissionRequestId"]).toBe(permission.requestId);
  const stored = (await rpc(ready.url, "GetTask", { id: paused.id })).result;
  expect(stored.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
  const resumed = (
    await rpc(
      ready.url,
      "SendMessage",
      message("answer", [{ text: "allow" }], { taskId: paused.id, contextId: paused.contextId }),
    )
  ).result.task;
  expect(texts(resumed).join("")).toContain('"optionId":"allow"');
  expect(resumed.metadata["opencode.permissionPending"]).toBe("false");
  expect(resumed.metadata["opencode.permissionDenied"]).toBeUndefined();
  expect(
    (await rpc(ready.url, "GetTask", { id: paused.id })).result.metadata[
      "opencode.permissionPending"
    ],
  ).toBe("false");
});

test("Q2: streaming pauses at input-required and the resume stream finishes the task", async () => {
  const ready = await gateway().start();
  const stream = async (params: object) => {
    const response = await fetch(ready.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "SendStreamingMessage", params }),
    });
    return (await response.text())
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => JSON.parse(line.slice(5)).result);
  };
  const label = (event: EventJson) =>
    event.task?.status?.state ??
    event.statusUpdate?.status?.state ??
    event.artifactUpdate?.artifact?.name;
  const first = await stream(message("s1", [{ text: "permission-reject" }]));
  expect(first.map(label)).toEqual([
    "TASK_STATE_SUBMITTED",
    "TASK_STATE_WORKING",
    "TASK_STATE_INPUT_REQUIRED",
  ]);
  const id = first[0].task.id;
  const waiting = first.at(-1)?.statusUpdate;
  if (!waiting) throw new Error("Stream did not end with a status update");
  const permission = permissionOf(waiting);
  const second = await stream(
    message(
      "s2",
      [{ data: { permissionResponse: { requestId: permission.requestId, optionId: "deny" } } }],
      {
        taskId: id,
        contextId: first[0].task.contextId,
      },
    ),
  );
  expect(second.map(label)[0]).toBe("TASK_STATE_INPUT_REQUIRED");
  expect(second.map(label)).toContain("TASK_STATE_WORKING");
  expect(second.at(-1).statusUpdate.status.state).toMatch(/FAILED|CANCELED/);
  const done = (await rpc(ready.url, "GetTask", { id })).result;
  expect(texts(done).join("")).toContain('"optionId":"deny"');
  expect(done.metadata["opencode.permissionDenied"]).toBe("true");
});

test("Q3: a bad answer keeps the task waiting, a second task is busy, and a stale id is refused", async () => {
  const ready = await gateway().start();
  const paused = await ask(ready.url);
  const permission = permissionOf(paused);
  const answer = (id: string, parts: object[]) =>
    rpc(
      ready.url,
      "SendMessage",
      message(id, parts, { taskId: paused.id, contextId: paused.contextId }),
    );
  const bad = (
    await answer("bad", [
      { data: { permissionResponse: { requestId: "stale", optionId: "allow" } } },
    ])
  ).result.task;
  expect(bad.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
  expect(bad.status.message.parts[0]?.text).toContain("does not match");
  const busy = (await rpc(ready.url, "SendMessage", message("busy", [{ text: "hello" }]))).result
    .task;
  expect(busy.status.state).toBe("TASK_STATE_FAILED");
  expect(busy.status.message.parts[0]?.text).toContain("busy");
  const good = (
    await answer("good", [
      { data: { permissionResponse: { requestId: permission.requestId, optionId: "allow" } } },
    ])
  ).result.task;
  expect(texts(good).join("")).toContain('"optionId":"allow"');
  const again = await answer("again", [{ text: "allow" }]);
  expect(again.result).toBeUndefined();
  expect(again.error).toBeDefined();
});

test("Q4: cancelling a waiting task persists canceled once, without duplicate artifact chunks", async () => {
  const ready = await gateway(true).start();
  const paused = await ask(ready.url, "permission-wait");
  expect(paused.status.state).toBe("TASK_STATE_INPUT_REQUIRED");
  const canceled = await rpc(ready.url, "CancelTask", { id: paused.id });
  expect(canceled.error).toBeUndefined();
  expect(canceled.result.status.state).toBe("TASK_STATE_CANCELED");
  const stored = (await rpc(ready.url, "GetTask", { id: paused.id })).result;
  expect(stored.status.state).toBe("TASK_STATE_CANCELED");
  expect(stored.metadata["opencode.permissionDenied"]).toBeUndefined();
  expect(stored.metadata["opencode.permissionPending"]).toBe("false");
  const parts = texts(stored);
  expect(parts.filter((part: string) => part === "before")).toHaveLength(1);
  expect(parts.filter((part: string) => part === "")).toHaveLength(1);
  const late = await rpc(
    ready.url,
    "SendMessage",
    message("late", [{ text: "allow" }], { taskId: paused.id, contextId: paused.contextId }),
  );
  expect(late.result?.task?.status?.state ?? "error").not.toBe("TASK_STATE_COMPLETED");
  const next = (await rpc(ready.url, "SendMessage", message("next", [{ text: "hello" }]))).result
    .task;
  expect(next.status.state).toBe("TASK_STATE_COMPLETED");
});
