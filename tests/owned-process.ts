import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";

export function spawnOwnedProcess(
  executable: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
  grace = { eof: 10_000, term: 1_000, kill: 1_000 },
) {
  assert.equal(process.platform, "linux", "Owned acceptance processes require Linux");
  const child = spawn(executable, args, {
    ...options,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  // Observe spawn failure immediately, even if initialization never finishes.
  const exited = new Promise<number | null>((resolve) => {
    child.once("error", () => resolve(null));
    child.once("exit", resolve);
  });
  function signal(value: NodeJS.Signals | 0) {
    if (!child.pid) return false;
    try {
      process.kill(-child.pid, value);
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
      throw new Error("Owned acceptance process group cleanup failed");
    }
  }
  async function stopped(ms: number) {
    const deadline = performance.now() + ms;
    while (signal(0)) {
      if (performance.now() >= deadline) return false;
      await setTimeout(10);
    }
    return true;
  }
  let closing: Promise<{ code: number | null; forced: boolean }> | undefined;
  function close() {
    closing ??= (async () => {
      // EOF releases the private server lease before any forced group shutdown.
      child.stdin.end();
      const forced = !(await stopped(grace.eof));
      if (forced) {
        signal("SIGTERM");
        if (!(await stopped(grace.term))) {
          signal("SIGKILL");
          assert(await stopped(grace.kill), "Owned acceptance process group did not stop");
        }
      }
      return { code: await exited, forced };
    })();
    return closing;
  }
  return { child, close };
}
