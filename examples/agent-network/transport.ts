import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { proxyArgs, record, type Profile, type NetworkConnection } from "./profiles.js";
import { interrupted, owned } from "./lifecycle.js";

export async function freePort() {
  const server = createServer();
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
  console.log(JSON.stringify({ freeLoopbackPortChecked: address.port }));
  return address.port;
}

export async function until<T>(
  probe: () => Promise<T | undefined>,
  label: string,
  ms = 30_000,
  interval = 100,
) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await setTimeout(interval);
  }
  throw new Error(`Deadline: ${label}`);
}

export async function stop(child: ChildProcess) {
  if (child.pid === undefined) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise<void>((done) => child.once("exit", () => done()));
  child.kill("SIGTERM");
  // Keep force-kill reaping inside the existing ten-second shutdown budget.
  const timer = AbortSignal.timeout(9_000);
  try {
    await interrupted(ended, timer);
  } catch {
    child.kill("SIGKILL");
    await interrupted(ended, AbortSignal.timeout(1_000));
    throw new Error("Owned child shutdown deadline exceeded");
  }
}

export async function directory(binary: string, profile: Profile, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const port = await freePort();
  signal?.throwIfAborted();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(binary, ["directory", "--addr", `127.0.0.1:${port}`], {
    cwd: profile.cwd,
    env: { PATH: profile.env.PATH, HOME: profile.env.HOME },
    stdio: "ignore",
  });
  let failed = false;
  const failure = new Promise<never>((_done, reject) => {
    child.once("error", () => {
      failed = true;
      reject(new Error("Directory failed to execute"));
    });
  });
  const close = owned(() => stop(child), signal);
  try {
    await interrupted(
      Promise.race([
        failure,
        until(async () => {
          if (failed) throw new Error("Directory failed to execute");
          signal?.throwIfAborted();
          assert(child.exitCode === null && child.signalCode === null, "Directory exited early");
          const response = await fetch(url + "/agents", {
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(1_000)])
              : AbortSignal.timeout(1_000),
          }).catch(() => undefined);
          return response?.ok ? true : undefined;
        }, "directory ready"),
      ]),
      signal,
    );
    signal?.throwIfAborted();
    return { url, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function mcp(profile: Profile, connection: NetworkConnection, signal?: AbortSignal) {
  signal?.throwIfAborted();
  await freePort();
  signal?.throwIfAborted();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: proxyArgs(profile, connection),
    cwd: profile.cwd,
    env: { PATH: profile.env.PATH ?? "", HOME: profile.env.HOME ?? "" },
    stderr: "pipe",
  });
  transport.stderr?.on("data", () => undefined);
  const client = new Client({ name: "opencode-a2a-network-experiment", version: "0.1.1" });
  const close = owned(async () => {
    try {
      await client.close();
    } finally {
      await transport.close();
    }
  }, signal);
  try {
    await interrupted(client.connect(transport, { timeout: 15_000 }), signal);
    signal?.throwIfAborted();
  } catch (error) {
    await close();
    throw error;
  }
  return {
    client,
    close,
    async call(name: string, args: Record<string, unknown>, error = false) {
      signal?.throwIfAborted();
      const result = await interrupted(
        client.callTool({ name, arguments: args }, CallToolResultSchema, {
          timeout: 150_000,
        }),
        signal,
      );
      assert.equal(Boolean(result.isError), error, "Unexpected MCP tool error status");
      assert(Array.isArray(result.content), "Expected MCP content");
      const text = result.content
        .map((part: unknown) => {
          const content = record(part);
          if (content.type !== "text") return "";
          assert.equal(typeof content.text, "string");
          return content.text;
        })
        .join("");
      return error ? text : (JSON.parse(text) as unknown);
    },
  };
}

export function payloadText(value: unknown) {
  const task = record(value);
  const artifacts = task.artifacts ?? [];
  assert(Array.isArray(artifacts), "Expected real task artifacts");
  return artifacts
    .flatMap((artifact: unknown) => {
      const parts = record(artifact).parts;
      assert(Array.isArray(parts));
      return parts.map((part: unknown) => record(part).text ?? "");
    })
    .join("")
    .trim();
}
