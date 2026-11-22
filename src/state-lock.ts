import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync, constants } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { runtimeInUse } from "./runtime-processes.js";
import { StartupError } from "./startup-error.js";

type Owner = { pid: number; start: string; nonce: string; root?: string; tag?: string };

// Field 22 of /proc/<pid>/stat (process start time) separates a live owner from a recycled pid.
export function processStart(pid: number): string | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
  } catch {
    return undefined;
  }
}

const parse = (text: string): Owner => {
  const value: unknown = JSON.parse(text);
  const owner = value as Partial<Owner> | null;
  if (
    !owner ||
    !Number.isSafeInteger(owner.pid) ||
    typeof owner.start !== "string" ||
    typeof owner.nonce !== "string"
  )
    throw new Error("invalid lock");
  return owner as Owner;
};

// A lock is stale only when its recorded process is demonstrably gone (no signal is ever sent) and
// no process still carries or uses the recorded runtime. Anything unreadable fails closed.
function stale(file: string) {
  try {
    const owner = parse(readFileSync(file, "utf8"));
    if (processStart(owner.pid) === owner.start) return false;
    return !(owner.root && owner.tag && runtimeInUse(owner.root, owner.tag));
  } catch {
    return false;
  }
}

export function acquireLock(directory: string) {
  const file = join(directory, "lock");
  const owner: Owner = {
    pid: process.pid,
    start: processStart(process.pid) ?? "",
    nonce: randomBytes(16).toString("hex"),
  };
  if (!owner.start) throw new StartupError("stateDir");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      closeSync(fd);
      writeFileSync(file, JSON.stringify(owner));
      break;
    } catch (error) {
      const busy = error instanceof Error && "code" in error && error.code === "EEXIST";
      if (!busy || attempt === 1 || !stale(file)) throw new StartupError("stateBusy");
      unlinkSync(file);
    }
  }
  const mine = () => {
    try {
      return parse(readFileSync(file, "utf8")).nonce === owner.nonce;
    } catch {
      return false;
    }
  };
  return {
    record(root: string, tag: string) {
      if (mine()) writeFileSync(file, JSON.stringify({ ...owner, root, tag }));
    },
    release() {
      if (mine()) unlinkSync(file);
    },
  };
}
