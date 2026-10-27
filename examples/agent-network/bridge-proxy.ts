import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { constants as os } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { taskMetadata } from "./guard-task.js";
import { envelopeMetadata } from "./topology-envelope.js";

const digest = "bdfa1f6894f5547dfef539140139e162402ca6ab33bb7602d9335d125d414db2";
export const tools = [
  "a2a_whoami",
  "a2a_list_agents",
  "a2a_send_message",
  "a2a_send_streaming",
  "a2a_get_task",
  "a2a_cancel_task",
];
const limit = 4 * 1024 * 1024;
const denied = {
  isError: true,
  content: [{ type: "text", text: "Bridge request denied by endpoint guard." }],
};
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function loopback(value: unknown, root = false): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (!root || url.pathname === "/")
    );
  } catch {
    return false;
  }
}

export function toolDecision(
  tool: unknown,
  args: unknown,
  peers: readonly string[],
  count: number,
): "tool" | "peer" | "budget" | undefined {
  if (typeof tool !== "string" || !tools.includes(tool)) return "tool";
  const invalidPeer = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(invalidPeer);
    return (
      record(value) &&
      Object.entries(value).some(([key, item]) =>
        key === "peer_url"
          ? typeof item !== "string" || !loopback(item, true) || !peers.includes(item)
          : invalidPeer(item),
      )
    );
  };
  if (invalidPeer(args)) return "peer";
  if (count > 40) return "budget";
  return undefined;
}

export function inputHash(args: unknown): string {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : record(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  return hash(
    record(args) && typeof args.text === "string"
      ? args.text
      : JSON.stringify(canonical(args ?? {})),
  );
}

export function filterCatalog(result: Record<string, unknown>): string[] {
  if (!Array.isArray(result.tools)) throw new Error("transport");
  result.tools = result.tools.filter(
    (tool: unknown) => record(tool) && typeof tool.name === "string" && tools.includes(tool.name),
  );
  return (result.tools as Record<string, unknown>[]).map((tool) => String(tool.name));
}

export async function readPackets(
  stream: Readable,
  receive: (packet: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  stream.setEncoding("utf8");
  let pending = "";
  const parse = async (line: string) => {
    if (Buffer.byteLength(line) > limit) throw new Error("transport");
    const packet: unknown = JSON.parse(line);
    if (!record(packet) || packet.jsonrpc !== "2.0") throw new Error("transport");
    await receive(packet);
  };
  for await (const chunk of stream) {
    if (typeof chunk !== "string") throw new Error("transport");
    pending += chunk;
    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      await parse(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
    if (Buffer.byteLength(pending) > limit) throw new Error("transport");
  }
  if (pending) await parse(pending);
}

const send = (stream: Writable, packet: Record<string, unknown>) =>
  new Promise<void>((resolve, reject) => {
    stream.write(`${JSON.stringify(packet)}\n`, (error) => (error ? reject(error) : resolve()));
  });

async function main(): Promise<void> {
  const [binary, directory, receipt, encoded] = process.argv.slice(2);
  if (!binary || !isAbsolute(binary) || !loopback(directory) || !receipt || !encoded)
    throw new Error("configuration");
  const peers: unknown = JSON.parse(encoded);
  if (!Array.isArray(peers) || !peers.every((peer: unknown) => loopback(peer, true)))
    throw new Error("configuration");
  if (hash(fs.readFileSync(binary)) !== digest) throw new Error("binary");
  process.umask(0o077);
  const state = join(dirname(receipt), "bridge-state");
  const home = join(dirname(receipt), "bridge-home");
  [state, home].forEach((path) => {
    fs.mkdirSync(path, { recursive: true, mode: 0o700 });
    fs.chmodSync(path, 0o700);
  });
  const env = { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: home };
  const version = spawnSync(binary, ["--version"], {
    env,
    encoding: "utf8",
    timeout: 3000,
    killSignal: "SIGKILL",
    maxBuffer: 4096,
  });
  if (version.error || version.status !== 0 || !/\b4\.0\.2\b/.test(version.stdout))
    throw new Error("binary");
  const fd = fs.openSync(
    receipt,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW,
    0o600,
  );
  fs.fchmodSync(fd, 0o600);
  const connection = randomUUID();
  const audit = (entry: Record<string, unknown>) => {
    fs.writeSync(fd, `${JSON.stringify({ connection, ...entry })}\n`);
  };
  const child = spawn(
    binary,
    ["bridge", "--directory", directory, "--state-dir", state, "--name", "coordinator"],
    { env, stdio: ["pipe", "pipe", "pipe"] },
  );
  child.stderr.resume();
  const requests = new Map<string, { method: unknown; tool: string }>();
  let count = 0;
  let failed = false;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let force: ReturnType<typeof setTimeout> | undefined;
  const shutdown = (signal?: NodeJS.Signals) => {
    if (closed) return;
    if (signal) child.kill(signal);
    if (timer) return;
    child.stdin.end();
    timer = setTimeout(
      () => {
        child.kill("SIGTERM");
        force = setTimeout(() => {
          child.kill("SIGKILL");
          child.stdout.destroy();
          child.stderr.destroy();
        }, 500);
      },
      signal ? 0 : 2000,
    );
  };
  const fail = () => {
    if (failed) return;
    failed = true;
    process.exitCode = 1;
    process.stderr.write("Bridge proxy transport failure.\n");
    shutdown("SIGTERM");
  };
  child.on("error", fail);
  child.stdin.on("error", fail);
  process.stdout.on("error", fail);
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
  const handlers = signals.map((signal) => {
    const handler = () => shutdown(signal);
    process.on(signal, handler);
    return handler;
  });
  const completion = new Promise<void>((resolve) =>
    child.once("close", (code, signal) => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(force);
      process.stdin.destroy();
      signals.forEach((name, index) => {
        const handler = handlers[index];
        if (handler) process.off(name, handler);
      });
      process.exitCode = failed ? 1 : (code ?? (signal ? 128 + (os.signals[signal] ?? 0) : 1));
      resolve();
    }),
  );
  const input = readPackets(process.stdin, async (packet) => {
    if (closed) return;
    const id =
      typeof packet.id === "string" || typeof packet.id === "number"
        ? String(packet.id)
        : undefined;
    const params = record(packet.params) ? packet.params : {};
    const tool =
      typeof params.name === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(params.name)
        ? params.name
        : "unknown";
    if (packet.method === "tools/call") {
      count += 1;
      const reason = toolDecision(params.name, params.arguments, peers, count);
      if (reason) {
        audit({ event: "rejected", tool, reason });
        if (id !== undefined)
          await send(process.stdout, { jsonrpc: "2.0", id: packet.id, result: denied });
        return;
      }
      if (id === undefined) throw new Error("transport");
      const args = record(params.arguments) ? params.arguments : {};
      audit({
        event: "call",
        id,
        tool,
        ...(typeof args.peer_url === "string" ? { peer: args.peer_url } : {}),
        ...(typeof args.context_id === "string" ? { context: args.context_id } : {}),
        ...(typeof args.task_id === "string" ? { task: args.task_id } : {}),
        inputHash: inputHash(args),
        ...(tool === "a2a_send_message" && typeof args.text === "string"
          ? { inputEnvelope: envelopeMetadata(args.text) }
          : {}),
        taskIdOmitted: !Object.hasOwn(args, "task_id"),
        ...(typeof args.blocking === "boolean" ? { blocking: args.blocking } : {}),
        at: new Date().toISOString(),
      });
    }
    if (id !== undefined && typeof packet.method === "string")
      requests.set(id, { method: packet.method, tool });
    await send(child.stdin, packet);
  }).then(
    () => shutdown(),
    () => {
      if (!closed) fail();
    },
  );
  const output = readPackets(child.stdout, async (packet) => {
    const id =
      typeof packet.id === "string" || typeof packet.id === "number"
        ? String(packet.id)
        : undefined;
    const request = id !== undefined && packet.method === undefined ? requests.get(id) : undefined;
    if (request?.method === "tools/list" && !packet.error) {
      if (!record(packet.result)) throw new Error("transport");
      audit({ event: "catalog", tools: filterCatalog(packet.result) });
    }
    if (request?.method === "tools/call")
      audit({
        event: "result",
        id,
        tool: request.tool,
        ok: !packet.error && record(packet.result) && packet.result.isError !== true,
        ...(!packet.error ? taskMetadata(packet.result) : {}),
        at: new Date().toISOString(),
      });
    if (request && id !== undefined) requests.delete(id);
    await send(process.stdout, packet);
  }).then(() => shutdown(), fail);
  await completion;
  await Promise.all([input, output]);
  fs.closeSync(fd);
}

if (import.meta.main)
  void main().catch(() => {
    process.stderr.write("Bridge proxy configuration failure.\n");
    process.exitCode = 1;
  });
