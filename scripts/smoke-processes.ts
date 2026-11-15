import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";

export function parseDarwinCwds(output: string): string[] {
  const cwds: string[] = [];
  let processSeen = false;
  let cwdSeen = false;
  for (const raw of output.split("\0")) {
    const field = raw.replace(/^\n+/, "");
    if (field.startsWith("p")) {
      assert(!processSeen || cwdSeen, "Unable to inspect a process working directory");
      assert(/^p\d+$/.test(field), "Invalid process record");
      processSeen = true;
      cwdSeen = false;
    } else if (field.startsWith("n")) {
      assert(processSeen && !cwdSeen, "Invalid working directory record");
      const cwd = field.slice(1);
      assert(path.isAbsolute(cwd), "Unable to inspect a process working directory");
      cwds.push(cwd);
      cwdSeen = true;
    }
  }
  assert(processSeen && cwdSeen, "Incomplete working directory inspection");
  return cwds;
}

export function workspaceInUse(root: string): boolean {
  const actualRoot = realpathSync(root);
  const inside = (cwd: string) => cwd === actualRoot || cwd.startsWith(actualRoot + path.sep);
  if (process.platform === "darwin") {
    assert(typeof process.getuid === "function", "Cannot identify process owner");
    const result = spawnSync(
      "/usr/sbin/lsof",
      ["-nP", "-a", "-u", String(process.getuid()), "-d", "cwd", "-F0pn"],
      { encoding: "utf8", timeout: 10_000, maxBuffer: 16 * 1024 * 1024 },
    );
    assert(!result.error && result.status === 0, "Working directory inspection failed");
    assert(!result.stderr, "Working directory inspection incomplete");
    return parseDarwinCwds(result.stdout).some(inside);
  }
  return readdirSync("/proc").some((pid) => {
    if (!/^\d+$/.test(pid)) return false;
    try {
      return inside(readlinkSync(`/proc/${pid}/cwd`));
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["ENOENT", "EACCES", "ESRCH"].includes(String(error.code))
      )
        return false;
      throw error;
    }
  });
}
