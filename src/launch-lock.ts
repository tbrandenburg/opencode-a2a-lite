import {
  closeSync,
  constants,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { processStart } from "./state-lock.js";

type Owner = { pid: number; start: string; nonce: string };

export const LAUNCH_WAIT_MS = 300_000;
const POLL_MS = 200;
const REPORT_MS = 10_000;

const uid = () => process.getuid?.() ?? -1;

export const launchLockPath = (directory = realpathSync("/tmp")) =>
  join(directory, `opencode-a2a-launch-${uid()}.lock`);

function readOwner(file: string): Owner | undefined {
  try {
    const owner = JSON.parse(readFileSync(file, "utf8")) as Partial<Owner> | null;
    if (!owner || !Number.isSafeInteger(owner.pid)) return undefined;
    if (typeof owner.start !== "string" || typeof owner.nonce !== "string") return undefined;
    return owner as Owner;
  } catch {
    return undefined;
  }
}

// Stale only when the recorded process is demonstrably gone; no signal is ever sent to any pid.
const dead = (owner: Owner) => processStart(owner.pid) !== owner.start;

// A file that never received its owner record (crash between create and write) is abandoned.
function abandoned(file: string) {
  try {
    return Date.now() - lstatSync(file).mtimeMs > 5_000;
  } catch {
    return false;
  }
}

function create(file: string, owner: Owner) {
  try {
    const fd = openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    closeSync(fd);
    writeFileSync(file, JSON.stringify(owner));
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
    throw error;
  }
}

// Removes a lock or guard whose owner is dead, re-reading right before the unlink. The remaining
// race can at worst let two preflights overlap, which is the behavior without any lock.
function reap(file: string) {
  const owner = readOwner(file);
  if (!owner ? !abandoned(file) : !dead(owner)) return false;
  if (readOwner(file)?.nonce !== owner?.nonce) return false;
  try {
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

function usable(file: string) {
  try {
    const info = lstatSync(file);
    return info.isFile() && info.uid === uid();
  } catch {
    return true;
  }
}

function attempt(file: string, owner: Owner) {
  if (create(file, owner)) return true;
  if (!usable(file)) return undefined;
  const guard = `${file}.reap`;
  if (!create(guard, owner)) {
    reap(guard);
    return false;
  }
  try {
    return reap(file) && create(file, owner);
  } finally {
    if (readOwner(guard)?.nonce === owner.nonce) unlinkSync(guard);
  }
}

// Serializes launches of the same user so only one gateway runs OpenCode probes and startup at a
// time. Waiting is bounded: after the limit the launch proceeds unlocked and says so, because a
// missing lock only costs reliability, never safety. Release is idempotent.
export async function acquireLaunchLock(
  options: {
    file?: string;
    waitMs?: number;
    pollMs?: number;
    signal?: AbortSignal;
    log?: (line: string) => void;
  } = {},
) {
  const file = options.file ?? launchLockPath();
  const log = options.log ?? ((line: string) => console.error(line));
  const owner: Owner = {
    pid: process.pid,
    start: processStart(process.pid) ?? "",
    nonce: randomBytes(16).toString("hex"),
  };
  const nothing = () => undefined;
  if (!owner.start) return nothing;
  const started = performance.now();
  let reported = 0;
  for (;;) {
    const got = attempt(file, owner);
    if (got === undefined) {
      log("Launch lock unavailable (foreign or unreadable file); continuing without it");
      return nothing;
    }
    if (got) break;
    const waited = performance.now() - started;
    if (options.signal?.aborted) return nothing;
    if (waited >= (options.waitMs ?? LAUNCH_WAIT_MS)) {
      log(`Launch lock still held after ${Math.round(waited)}ms; continuing without it`);
      return nothing;
    }
    if (waited >= reported) {
      log("Waiting for another gateway launch on this host to finish its startup checks");
      reported = waited + REPORT_MS;
    }
    await new Promise((done) => setTimeout(done, options.pollMs ?? POLL_MS));
  }
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    if (readOwner(file)?.nonce !== owner.nonce) return;
    try {
      unlinkSync(file);
    } catch (error) {
      log(`Launch lock release failed: ${error instanceof Error ? error.message : "unknown"}`);
    }
  };
}
