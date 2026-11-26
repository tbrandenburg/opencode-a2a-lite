import { afterAll, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireLaunchLock, launchLockPath } from "../src/launch-lock.js";

const base = realpathSync(mkdtempSync(join(tmpdir(), "launch-lock-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const quiet = { pollMs: 5, log: () => undefined };
const fresh = () => join(base, `lock-${Math.random().toString(36).slice(2)}`);

test("the lock file is per user and lives in the given directory", () => {
  expect(launchLockPath(base)).toBe(join(base, `opencode-a2a-launch-${process.getuid?.()}.lock`));
});

test("two concurrent preflights run one at a time", async () => {
  const file = fresh();
  const events: string[] = [];
  const job = async (name: string) => {
    const release = await acquireLaunchLock({ file, ...quiet });
    events.push(`${name}:start`);
    await Bun.sleep(60);
    events.push(`${name}:end`);
    release();
  };
  await Promise.all([job("a"), job("b")]);
  expect(events).toHaveLength(4);
  expect(events[0]!.split(":")[0]).toBe(events[1]!.split(":")[0]);
  expect(events[2]!.split(":")[0]).toBe(events[3]!.split(":")[0]);
  expect(existsSync(file)).toBe(false);
});

test("a waiter logs once and gives up after the bounded wait without removing the holder", async () => {
  const file = fresh();
  const lines: string[] = [];
  const release = await acquireLaunchLock({ file, ...quiet });
  const waited = await acquireLaunchLock({
    file,
    pollMs: 5,
    waitMs: 60,
    log: (l) => lines.push(l),
  });
  expect(lines.some((l) => /Waiting for another gateway launch/.test(l))).toBe(true);
  expect(lines.some((l) => /still held after \d+ms; continuing without it/.test(l))).toBe(true);
  waited();
  expect(existsSync(file)).toBe(true);
  release();
  expect(existsSync(file)).toBe(false);
});

test("release is idempotent and never removes another owner's lock", async () => {
  const file = fresh();
  const release = await acquireLaunchLock({ file, ...quiet });
  release();
  const other = await acquireLaunchLock({ file, ...quiet });
  release();
  expect(existsSync(file)).toBe(true);
  other();
  expect(existsSync(file)).toBe(false);
});

test("a lock left by a dead process does not block", async () => {
  const file = fresh();
  writeFileSync(file, JSON.stringify({ pid: 2_147_483_000, start: "1", nonce: "x" }));
  const release = await acquireLaunchLock({ file, waitMs: 2_000, ...quiet });
  expect(JSON.parse(readFileSync(file, "utf8")).pid).toBe(process.pid);
  release();
});

test("a lock whose recorded start time differs (recycled pid) does not block", async () => {
  const file = fresh();
  writeFileSync(file, JSON.stringify({ pid: process.pid, start: "0", nonce: "x" }));
  const release = await acquireLaunchLock({ file, waitMs: 2_000, ...quiet });
  release();
  expect(existsSync(file)).toBe(false);
});

test("a crashed holder releases the lock for the next launch and is never signalled by us", async () => {
  const file = fresh();
  const holder = Bun.spawn(
    ["bun", join(import.meta.dir, "fixtures", "launch-lock-holder.ts"), file],
    {
      stdout: "pipe",
      stderr: "ignore",
    },
  );
  try {
    const reader = holder.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("held");
    const lines: string[] = [];
    const blocked = await acquireLaunchLock({
      file,
      pollMs: 5,
      waitMs: 50,
      log: (l) => lines.push(l),
    });
    expect(lines.some((l) => /continuing without it/.test(l))).toBe(true);
    blocked();
    holder.kill("SIGKILL");
    await holder.exited;
    const release = await acquireLaunchLock({ file, waitMs: 5_000, ...quiet });
    expect(JSON.parse(readFileSync(file, "utf8")).pid).toBe(process.pid);
    release();
  } finally {
    holder.kill("SIGKILL");
  }
});

test("an unreadable or foreign lock file is skipped with a log, not waited on", async () => {
  const file = fresh();
  const target = join(base, "target");
  writeFileSync(target, "");
  await Bun.write(file, "");
  rmSync(file);
  Bun.spawnSync(["ln", "-s", target, file]);
  const lines: string[] = [];
  const release = await acquireLaunchLock({
    file,
    pollMs: 5,
    waitMs: 60_000,
    log: (l) => lines.push(l),
  });
  expect(lines.some((l) => /unavailable/.test(l))).toBe(true);
  release();
});
