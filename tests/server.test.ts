import { afterEach, expect, test } from "bun:test";
import { connect, createServer } from "node:net";
import { fileURLToPath } from "node:url";
import manifest from "../package.json" with { type: "json" };
import { createGateway, type ServerOptions } from "../src/server.js";

const gateways: ReturnType<typeof createGateway>[] = [];
const fixture = fileURLToPath(new URL("./fixtures/acp-peer.ts", import.meta.url));
function gateway(mode = "normal", overrides: Partial<ServerOptions> = {}) {
  const instance = createGateway({
    workspace: process.cwd(),
    port: 0,
    acp: {
      executable: process.execPath,
      args: [fixture, mode],
      versionArgs: [fixture, mode, "--version"],
      env: { PATH: process.env.PATH },
      startupTimeoutMs: mode === "normal" ? 3_000 : 800,
      promptTimeoutMs: 2_000,
      closeTimeoutMs: 600,
    },
    ...overrides,
  });
  gateways.push(instance);
  return instance;
}
afterEach(async () => {
  await Promise.all(gateways.splice(0).map((instance) => instance.close()));
});

async function freePort() {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  await new Promise<void>((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

test("serves an official v1 card only after ACP initializes; closes terminally", async () => {
  let initialized = false;
  const instance = gateway("normal", {
    createExecutor(bridge) {
      initialized = true;
      return {
        async execute() {
          await bridge.newSession();
          throw new Error("Not implemented");
        },
        async cancelTask() {
          throw new Error("Not implemented");
        },
      };
    },
  });
  const [ready, again] = await Promise.all([instance.start(), instance.start()]);
  expect(again.url).toBe(ready.url);
  expect(initialized).toBe(true);
  const response = await fetch(new URL(".well-known/agent-card.json", ready.url));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    name: "OpenCode A2A Lite",
    version: manifest.version,
    supportedInterfaces: [{ url: ready.url, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    capabilities: { streaming: true, pushNotifications: false, extendedAgentCard: false },
    skills: [{ id: "text-prompt", inputModes: ["text/plain"], outputModes: ["text/plain"] }],
  });
  await instance.close();
  await instance.close();
  await expect(fetch(ready.url)).rejects.toThrow();
  await expect(instance.start()).rejects.toThrow("closed");
});

test("default executor returns assistant text and persists its completed task", async () => {
  const ready = await gateway().start();
  const response = await fetch(ready.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "A2A-Version": "1.0" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "SendMessage",
      params: {
        message: { messageId: "input", role: "ROLE_USER", parts: [{ text: "hello" }] },
      },
    }),
  });
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body).toMatchObject({
    result: {
      task: {
        status: { state: "TASK_STATE_COMPLETED" },
        artifacts: [{ parts: [{ text: "turn-1:" }, { text: "hello" }, { text: "" }] }],
      },
    },
  });
  const stored = await rpc(ready.url, "GetTask", { id: body.result.task.id });
  expect(stored.result).toMatchObject({
    id: body.result.task.id,
    status: { state: "TASK_STATE_COMPLETED" },
    artifacts: [
      {
        artifactId: body.result.task.artifacts[0].artifactId,
        parts: [{ text: "turn-1:" }, { text: "hello" }, { text: "" }],
      },
    ],
  });
});

async function rpc(url: string, method: string, params: object) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "A2A-Version": "1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }),
  });
  return response.json();
}

test("HTTP SSE streams filtered ACP text in order and stores it without duplication", async () => {
  const ready = await gateway().start();
  const response = await fetch(ready.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "A2A-Version": "1.0" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "SendStreamingMessage",
      params: {
        message: { messageId: "stream", role: "ROLE_USER", parts: [{ text: "hello" }] },
      },
    }),
  });
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const text = await response.text();
  const events = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5)).result);
  expect(events[0].task.status.state).toBe("TASK_STATE_SUBMITTED");
  expect(events[1].statusUpdate.status.state).toBe("TASK_STATE_WORKING");
  const chunks = events
    .filter((event) => event.artifactUpdate)
    .map((event) => event.artifactUpdate);
  expect(chunks.map((chunk) => chunk.artifact.parts[0].text ?? "")).toEqual([
    "turn-1:",
    "hello",
    "",
  ]);
  expect(chunks.map((chunk) => [chunk.append ?? false, chunk.lastChunk ?? false])).toEqual([
    [false, false],
    [true, false],
    [true, true],
  ]);
  expect(new Set(chunks.map((chunk) => chunk.artifact.artifactId)).size).toBe(1);
  expect(events.at(-1).statusUpdate.status.state).toBe("TASK_STATE_COMPLETED");
  expect(
    events.filter((event) => event.statusUpdate?.status.state === "TASK_STATE_COMPLETED").length,
  ).toBe(1);
  const stored = await rpc(ready.url, "GetTask", { id: events[0].task.id });
  expect(stored.result.artifacts[0].parts).toEqual([
    { text: "turn-1:", mediaType: "text/plain" },
    { text: "hello", mediaType: "text/plain" },
    { text: "", mediaType: "text/plain" },
  ]);
  expect(text).not.toMatch(/wrong-session|child|private|late-idle/);
});

test.each([
  { parts: [], phrase: "plain text" },
  { parts: [{ text: "hello" }, { data: { value: 1 } }], phrase: "plain text" },
  { parts: [{ text: "limit" }], phrase: "did not complete" },
  { parts: [{ text: "exit" }], phrase: "execution failed" },
  { parts: [{ text: "auth" }], phrase: "execution failed" },
  { parts: [{ text: "transport" }], phrase: "execution failed" },
])(
  "HTTP rejects invalid input and ACP failures without false success: %j",
  async ({ parts, phrase }) => {
    const ready = await gateway().start();
    const body = await rpc(ready.url, "SendMessage", {
      message: { messageId: "failure", role: "ROLE_USER", parts },
    });
    expect(body.result.task.status.state).toBe("TASK_STATE_FAILED");
    expect(body.result.task.status.message.parts[0].text).toContain(phrase);
    const stored = await rpc(ready.url, "GetTask", { id: body.result.task.id });
    expect(stored.result.status.state).toBe("TASK_STATE_FAILED");
    expect(JSON.stringify(body)).not.toMatch(/wrong-session|child|private/);
  },
);

test.each(["version", "executable-version", "startup-exit", "startup-hang"])(
  "%s never opens HTTP",
  async (mode) => {
    const port = await freePort();
    const instance = gateway(mode, { port });
    const pending = instance.start().catch((error: unknown) => error);
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    expect(await pending).toBeInstanceOf(Error);
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    await expect(instance.start()).rejects.toThrow("closed");
  },
);

test("validates trusted workspace and listener options before startup", async () => {
  expect(() => createGateway({ workspace: "relative" })).toThrow("absolute");
  expect(() => createGateway({ workspace: process.cwd(), host: "0.0.0.0" })).toThrow("loopback");
  expect(() => createGateway({ workspace: process.cwd(), port: -1 })).toThrow("port");
  const missing = gateway("normal", { workspace: "/nonexistent/a2a-workspace-test" });
  await expect(missing.start()).rejects.toThrow("existing directory");
  await expect(missing.start()).rejects.toThrow("closed");
});

test("close during initialization prevents late readiness and closes owned ACP", async () => {
  const port = await freePort();
  const instance = gateway("startup-hang", { port });
  const pending = instance.start().catch((error: unknown) => error);
  await new Promise((resolve) => setTimeout(resolve, 50));
  await instance.close();
  expect(await pending).toBeInstanceOf(Error);
  await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
});

test("listener conflict fails closed without stopping the existing listener", async () => {
  const existing = createServer();
  await new Promise<void>((resolve) => existing.listen(0, "127.0.0.1", resolve));
  const address = existing.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  try {
    const instance = gateway("normal", { port: address.port });
    await expect(instance.start()).rejects.toBeInstanceOf(Error);
    expect(existing.listening).toBe(true);
    await expect(instance.start()).rejects.toThrow("closed");
  } finally {
    await new Promise<void>((resolve, reject) =>
      existing.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("shutdown bounds a client that leaves its HTTP request incomplete", async () => {
  const instance = gateway();
  const ready = await instance.start();
  const client = connect(Number(new URL(ready.url).port), "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    client.once("connect", resolve);
    client.once("error", reject);
  });
  client.write("GET / HTTP/1.1\r\nHost: localhost\r\n");
  const disconnected = new Promise<void>((resolve, reject) => {
    client.once("close", () => resolve());
    client.once("error", reject);
  });
  try {
    const started = performance.now();
    await instance.close();
    await disconnected;
    expect(performance.now() - started).toBeLessThan(2_500);
    expect(client.destroyed).toBe(true);
    await expect(fetch(ready.url)).rejects.toThrow();
  } finally {
    client.destroy();
  }
});

test("Bun shutdown rejects work with 503 throughout the HTTP drain before closing its listener", async () => {
  let executions = 0;
  const instance = gateway("normal", {
    createExecutor() {
      return {
        async execute() {
          executions++;
          throw new Error("Shutdown admitted work");
        },
        async cancelTask() {
          throw new Error("Unexpected cancellation");
        },
      };
    },
  });
  const ready = await instance.start();
  const started = performance.now();
  const closing = instance.close();
  expect(instance.close()).toBe(closing);
  const response = await fetch(ready.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "A2A-Version": "1.0" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "SendMessage",
      params: {
        message: { messageId: "drain", role: "ROLE_USER", parts: [{ text: "hello" }] },
      },
    }),
  });
  expect(response.status).toBe(503);
  expect(await response.text()).toBe("");
  expect(executions).toBe(0);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const card = await fetch(new URL(".well-known/agent-card.json", ready.url));
  expect(card.status).toBe(503);
  expect(await card.text()).toBe("");
  await closing;
  expect(performance.now() - started).toBeGreaterThanOrEqual(1_000);
  expect(executions).toBe(0);
  await expect(fetch(ready.url)).rejects.toThrow();
});
