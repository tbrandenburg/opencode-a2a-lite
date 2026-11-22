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
  artifacts?: { parts: { text?: string }[] }[];
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

test("T3: without --allow-resume the metadata is refused, never silently ignored", async () => {
  const ready = await gateway(false).start();
  const card = await (await fetch(new URL(".well-known/agent-card.json", ready.url))).json();
  expect(card.capabilities.extensions ?? []).toEqual([]);
  const refused = await send(ready.url, "whoami", { metadata: { "opencode.sessionId": session } });
  expect(refused.status.state).toBe("TASK_STATE_FAILED");
  expect(failed(refused)).toContain("--allow-resume");
  expect(answer(refused)).toBe("");
});
