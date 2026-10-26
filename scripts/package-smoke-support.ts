import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";

export function run(command: string[], cwd: string, env: NodeJS.ProcessEnv, timeout = 30_000) {
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd,
    env,
    encoding: "utf8",
    timeout,
    maxBuffer: 1_048_576,
  });
  assert.ifError(result.error);
  return result;
}

export async function until<T>(read: () => T | undefined, label: string): Promise<T> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await Bun.sleep(25);
  }
  throw new Error(`Timed out: ${label}`);
}

export function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    throw error;
  }
}

export function peerRecord(path: string): { pid: number; parent: number; cwd: string } | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

export function launch(command: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const child = spawn(command[0]!, command.slice(1), {
    cwd,
    env,
    detached: true,
    timeout: 45_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const output = { stdout: "", stderr: "" };
  child.stdout.on("data", (chunk: Buffer) => (output.stdout += chunk.toString()));
  child.stderr.on("data", (chunk: Buffer) => (output.stderr += chunk.toString()));
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  return { child, output, exited };
}

export function signal(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
    throw error;
  }
}
