import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { cleanup } from "../scripts/acp-smoke-config.js";
import { parseDarwinCwds, workspaceInUse } from "../scripts/smoke-processes.js";

test("macOS cwd records reject missing, malformed, or inaccessible process information", () => {
  expect(parseDarwinCwds("p1\0\nfcwd\0n/private/one\0\np2\0\nfcwd\0n/private/two\0\n")).toEqual([
    "/private/one",
    "/private/two",
  ]);
  expect(() => parseDarwinCwds("")).toThrow();
  expect(() => parseDarwinCwds("p1\0\nfcwd\0\np2\0\nfcwd\0n/private/two\0\n")).toThrow();
  expect(() => parseDarwinCwds("p1\0\nfcwd\0npermission denied\0\n")).toThrow();
  expect(() => parseDarwinCwds("pbad\0\nfcwd\0n/private/one\0\n")).toThrow();
});

test("workspace inspection tracks owned cwd and does not confuse sibling prefixes", async () => {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), "smoke-process-test-"));
  const root = join(parent, "workspace");
  const sibling = join(parent, "workspace-other");
  mkdirSync(root);
  mkdirSync(sibling);
  const child = spawn(
    process.execPath,
    ["-e", 'console.log("ready"); setInterval(() => {}, 1000)'],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const exited = once(child, "exit");
  try {
    await once(child.stdout, "data");
    expect(workspaceInUse(root)).toBe(true);
    expect(workspaceInUse(sibling)).toBe(false);
    await expect(cleanup(root, 100)).rejects.toThrow("processes did not stop");
    expect(existsSync(root)).toBe(true);
    child.kill("SIGTERM");
    await exited;
    expect(workspaceInUse(root)).toBe(false);
    await cleanup(root);
    expect(existsSync(root)).toBe(false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
    if (existsSync(root) && !workspaceInUse(root)) rmSync(root, { recursive: true });
    if (!existsSync(root)) rmSync(parent, { recursive: true });
  }
}, 30_000);
