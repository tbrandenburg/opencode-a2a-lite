import { afterEach, expect, test as bunTest } from "bun:test";
import { fileURLToPath } from "node:url";
import { createGateway } from "../src/server.js";
import { fixtureStartupMs, fixtureTestMs } from "./fixtures/acp-test-timeouts.js";

const gateways: ReturnType<typeof createGateway>[] = [];
const fixture = fileURLToPath(new URL("./fixtures/acp-peer.ts", import.meta.url));
const test = (name: string, run: () => Promise<void>) => bunTest(name, run, fixtureTestMs);
afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
});

function gateway(resume: boolean) {
  const instance = createGateway({
    workspace: process.cwd(),
    port: 0,
    ...(resume ? { executor: { resume: true } } : {}),
    acp: {
      executable: process.execPath,
      args: [fixture, "normal"],
      versionArgs: [fixture, "normal", "--version"],
      env: { PATH: process.env.PATH },
      startupTimeoutMs: fixtureStartupMs,
      promptTimeoutMs: 5_000,
      closeTimeoutMs: 600,
    },
  });
  gateways.push(instance);
  return instance;
}

interface TaskJson {
  contextId: string;
  status: { state: string; message?: { parts: { text?: string }[] } };
  metadata: Record<string, string>;
  artifacts?: { name: string; parts: { text?: string; data?: unknown }[] }[];
}
async function send(url: string, text: string, extra: object = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "A2A-Version": "1.0" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "SendMessage",
      params: {
        message: { messageId: crypto.randomUUID(), role: "ROLE_USER", parts: [{ text }], ...extra },
      },
    }),
  });
  return ((await response.json()) as { result: { task: TaskJson } }).result.task;
}
const answer = (task: TaskJson) =>
  (task.artifacts ?? [])
    .flatMap((artifact) => artifact.parts.map((part) => part.text ?? ""))
    .join("");
const failed = (task: TaskJson) => task.status.message?.parts[0]?.text;
const session = "ses_dfc114de7ffecIV2y1jJ0U0akj";

test("T1: a client continues an existing OpenCode session through A2A and keeps following up", async () => {
  const ready = await gateway(true).start();
  const card = await (await fetch(new URL(".well-known/agent-card.json", ready.url))).json();
  expect(card.capabilities.extensions.map((entry: { uri: string }) => entry.uri)).toEqual([
    "urn:opencode-a2a-lite:resume:v1",
  ]);
  const first = await send(ready.url, "whoami", { metadata: { "opencode.sessionId": session } });
  expect(first.status.state).toBe("TASK_STATE_COMPLETED");
  expect(answer(first)).toBe(session);
  expect(first.metadata["opencode.sessionId"]).toBe(session);
  expect(first.metadata["opencode.resumed"]).toBe("true");
  const next = await send(ready.url, "whoami", { contextId: first.contextId });
  expect(answer(next)).toBe(session);
  expect(next.metadata["opencode.resumed"]).toBeUndefined();
  const other = await send(ready.url, "hello", { metadata: { "opencode.sessionId": session } });
  expect(other.status.state).toBe("TASK_STATE_FAILED");
  expect(failed(other)).toContain("another context");
});

test("T2: a rejected or malformed id fails that task only; the gateway keeps serving", async () => {
  const ready = await gateway(true).start();
  const unknown = await send(ready.url, "hi", {
    metadata: { "opencode.sessionId": "ses_unknown0001" },
  });
  expect(failed(unknown)).toBe("ACP session resume rejected");
  const malformed = await send(ready.url, "hi", { metadata: { "opencode.sessionId": "../../x" } });
  expect(failed(malformed)).toContain("Invalid opencode.sessionId");
  const fresh = await send(ready.url, "hello");
  expect(fresh.status.state).toBe("TASK_STATE_COMPLETED");
  expect(fresh.metadata["opencode.resumed"]).toBeUndefined();
});

test("T3: without --enable resume the metadata is refused, never silently ignored", async () => {
  const ready = await gateway(false).start();
  const card = await (await fetch(new URL(".well-known/agent-card.json", ready.url))).json();
  expect(card.capabilities.extensions ?? []).toEqual([]);
  const refused = await send(ready.url, "whoami", { metadata: { "opencode.sessionId": session } });
  expect(refused.status.state).toBe("TASK_STATE_FAILED");
  expect(failed(refused)).toContain("--enable resume");
  expect(answer(refused)).toBe("");
});

test("T4: replay delivers the earlier conversation as an artifact, then the new answer", async () => {
  const ready = await gateway(true).start();
  const sent = await send(ready.url, "whoami", {
    metadata: { "opencode.sessionId": "ses_replayed0001", "opencode.replay": true },
  });
  expect(sent.status.state).toBe("TASK_STATE_COMPLETED");
  expect(sent.metadata["opencode.replayed"]).toBe("4");
  const byName = (name: string) =>
    (sent.artifacts ?? []).find((artifact) => artifact.name === name);
  const conversation = byName("conversation")?.parts.map((part) => part.data);
  expect(conversation).toEqual([
    { role: "user", text: "remember KUMQUAT" },
    { role: "assistant", text: "noted" },
    { role: "user", text: "what was it?" },
    { role: "assistant", text: "KUMQUAT" },
  ]);
  expect(JSON.stringify(sent)).not.toMatch(/tool-input|tool-output|replayed-thought|child-reply/);
  expect(answer(sent)).toBe("ses_replayed0001");
  const next = await send(ready.url, "whoami", { contextId: sent.contextId });
  expect((next.artifacts ?? []).map((artifact) => artifact.name)).toEqual(["response"]);
  expect(next.metadata["opencode.replayed"]).toBeUndefined();
  const rejected = await send(ready.url, "x", {
    metadata: { "opencode.sessionId": "ses_unknown0003", "opencode.replay": true },
  });
  expect(failed(rejected)).toBe("ACP session load rejected");
  expect((await send(ready.url, "hello")).status.state).toBe("TASK_STATE_COMPLETED");
});
