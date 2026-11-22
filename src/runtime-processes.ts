import { readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { ProbeCleanupError } from "./runtime-probes.js";
import { pathInside } from "./smoke-processes.js";

type Reader = {
  list: (path: string) => string[];
  read: (path: string) => string;
  link: (path: string) => string;
};

const reader: Reader = {
  list: (path) => readdirSync(path),
  read: (path) => readFileSync(path, "utf8"),
  link: (path) => readlinkSync(path),
};

function invisible(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    ["EACCES", "EPERM", "ENOENT", "ESRCH"].includes(String(error.code))
  );
}

function inspect<T>(operation: () => T): T | undefined {
  try {
    return operation();
  } catch (error) {
    if (invisible(error)) return undefined;
    throw error;
  }
}

function processInUse(root: string, tag: string, base: string, access: Reader) {
  const expected = `A2A_LITE_RUNTIME_ID=${tag}`;
  const environment = inspect(() => access.read(join(base, "environ")));
  if (environment?.split("\0").includes(expected)) return true;
  const cwd = inspect(() => access.link(join(base, "cwd")));
  if (cwd && pathInside(root, cwd)) return true;
  const descriptors = inspect(() => access.list(join(base, "fd"))) ?? [];
  return descriptors.some((descriptor) => {
    const path = inspect(() => access.link(join(base, "fd", descriptor)));
    return Boolean(path && pathInside(root, path));
  });
}

export function runtimeInUse(root: string, tag: string, access: Reader = reader) {
  for (const pid of access.list("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    if (processInUse(root, tag, `/proc/${pid}`, access)) return true;
  }
  return false;
}

export async function awaitRuntimeUnused(root: string, tag: string, timeout = 2_000) {
  if (process.platform !== "linux")
    throw new ProbeCleanupError("Private runtime cleanup unconfirmed");
  const deadline = performance.now() + timeout;
  try {
    const actual = realpathSync(root);
    while (performance.now() < deadline) {
      if (!runtimeInUse(actual, tag)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } catch {
    throw new ProbeCleanupError("Private runtime cleanup unconfirmed");
  }
  throw new ProbeCleanupError("Private runtime cleanup unconfirmed");
}
