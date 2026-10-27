import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "../package.json" with { type: "json" };
import { createGateway, type ServerOptions } from "../src/server.js";
import { until } from "./fixtures/sdk-cancellation.js";

const gateways: ReturnType<typeof createGateway>[] = [];
const fixture = fileURLToPath(new URL("./fixtures/acp-peer.ts", import.meta.url));
function gateway(mode = "normal", overrides: Partial<ServerOptions> = {}) {
  const instance = createGateway({
    workspace: process.cwd(),
    port: 0,
    ...overrides,
    acp: {
      executable: process.execPath,
      args: [fixture, mode],
      versionArgs: [fixture, mode, "--version"],
      env: { PATH: process.env.PATH },
      startupTimeoutMs: mode === "normal" ? 3_000 : 800,
      promptTimeoutMs: 2_000,
      closeTimeoutMs: 600,
      ...overrides.acp,
    },
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

test("H01 discovery snapshots configured identity after ACP initializes; closes terminally", async () => {
  let initialized = false;
  const tags = [" planning ", "text", "planning", "review"];
  const identity = { name: " planner ", description: " Plans work ", tags };
  const instance = gateway("normal", {
    identity,
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
  identity.name = "changed-before-start";
  tags.push("changed-before-start");
  const [ready, again] = await Promise.all([instance.start(), instance.start()]);
  expect(again.url).toBe(ready.url);
  expect(initialized).toBe(true);
  const response = await fetch(new URL(".well-known/agent-card.json", ready.url));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    name: "planner",
    description: "Plans work",
    version: manifest.version,
    supportedInterfaces: [{ url: ready.url, protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
    capabilities: { streaming: true, pushNotifications: false, extendedAgentCard: false },
    skills: [
      {
        id: "text-prompt",
        tags: ["text", "planning", "review"],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
      },
    ],
  });
  await instance.close();
  await instance.close();
  await expect(fetch(ready.url)).rejects.toThrow();
  await expect(instance.start()).rejects.toThrow("closed");
});

async function rpc(url: string, method: string, params: object) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "A2A-Version": "1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method, params }),
  });
  return response.json();
}

test("H02 HTTP rejects mixed text/data input and persists truthful failure", async () => {
  const ready = await gateway().start();
  const body = await rpc(ready.url, "SendMessage", {
    message: {
      messageId: "failure",
      role: "ROLE_USER",
      parts: [{ text: "hello" }, { data: { value: 1 } }],
    },
  });
  expect(body.result.task.status.state).toBe("TASK_STATE_FAILED");
  expect(body.result.task.status.message.parts[0].text).toContain("plain text");
  const stored = await rpc(ready.url, "GetTask", { id: body.result.task.id });
  expect(stored.result.status.state).toBe("TASK_STATE_FAILED");
  expect(JSON.stringify(body)).not.toMatch(/wrong-session|child|private/);
});

test("H03 ACP startup timeout never opens HTTP or advertises early readiness", async () => {
  const port = await freePort();
  const directory = await mkdtemp(join(tmpdir(), "a2a-http-startup-"));
  const marker = join(directory, "initializing");
  const peer = fileURLToPath(new URL("./fixtures/acp-http-startup.ts", import.meta.url));
  const instance = gateway("startup-hang", {
    port,
    acp: { args: [peer, marker], versionArgs: [peer, marker, "--version"] },
  });
  try {
    const pending = instance.start().catch((error: unknown) => error);
    await until(() => Bun.file(marker).exists());
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    expect(await pending).toBeInstanceOf(Error);
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    await expect(instance.start()).rejects.toThrow("closed");
  } finally {
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("H12 incompatible ACP protocol rejects startup without HTTP discovery and retires terminally", async () => {
  const port = await freePort();
  const instance = gateway("protocol-version", { port });
  await expect(instance.start()).rejects.toThrow("ACP startup failed");
  await expect(fetch(`http://127.0.0.1:${port}/.well-known/agent-card.json`)).rejects.toThrow();
  await expect(instance.start()).rejects.toThrow("closed");
});

test("H04 close during initialization prevents late readiness and closes owned ACP", async () => {
  const port = await freePort();
  const directory = await mkdtemp(join(tmpdir(), "a2a-http-close-startup-"));
  const marker = join(directory, "initializing");
  const peer = fileURLToPath(new URL("./fixtures/acp-http-startup.ts", import.meta.url));
  const instance = gateway("startup-hang", {
    port,
    acp: { args: [peer, marker], versionArgs: [peer, marker, "--version"] },
  });
  try {
    const pending = instance.start().catch((error: unknown) => error);
    await until(() => Bun.file(marker).exists());
    await instance.close();
    expect(await pending).toBeInstanceOf(Error);
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  } finally {
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("H11 direct gateway options enforce the trusted workspace and loopback boundary", async () => {
  expect(() => createGateway({ workspace: "relative" })).toThrow("absolute");
  expect(() => createGateway({ workspace: process.cwd(), host: "0.0.0.0" })).toThrow("loopback");
  expect(() => createGateway({ workspace: process.cwd(), port: -1 })).toThrow("port");
  const missing = gateway("normal", { workspace: "/nonexistent/a2a-workspace-test" });
  await expect(missing.start()).rejects.toThrow("existing directory");
  await expect(missing.start()).rejects.toThrow("closed");
});

test("H05 listener conflict fails closed without stopping the existing listener", async () => {
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

test("H06 shutdown bounds a client that leaves its HTTP request incomplete", async () => {
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

test("H07 Bun shutdown rejects work with 503 throughout the HTTP drain before closing its listener", async () => {
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
