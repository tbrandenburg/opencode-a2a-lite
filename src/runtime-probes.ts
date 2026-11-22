import { spawn } from "node:child_process";
import { accessSync, constants, lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { supportedOpenCode } from "./opencode-version.js";
import { StartupError } from "./startup-error.js";
import { validateRuntimePaths, validateRuntimeSources } from "./runtime-preflight.js";

export class ProbeCleanupError extends Error {}

function rejectIfPresent(path: string) {
  try {
    lstatSync(path);
    throw new StartupError("runtime");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

function rejectAncestorConfiguration(workspace: string) {
  let current = dirname(realpathSync(workspace));
  for (;;) {
    for (const name of ["opencode.json", "opencode.jsonc", ".opencode", ".agents", ".claude"])
      rejectIfPresent(join(current, name));
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export function resolveOpenCode(path: string) {
  for (const directory of path.split(":")) {
    try {
      const candidate = realpathSync(join(directory, "opencode"));
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      continue;
    }
  }
  throw new StartupError("executable");
}

function signal(pid: number, value: NodeJS.Signals | 0) {
  try {
    process.kill(-pid, value);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
    if (value === 0 && error instanceof Error && "code" in error && error.code === "EPERM")
      return true;
    throw new ProbeCleanupError("Private runtime process cleanup failed");
  }
}

async function drain(pid: number) {
  for (const value of [0, "SIGTERM", "SIGKILL"] as const) {
    if (value !== 0 && signal(pid, 0)) signal(pid, value);
    const deadline = Date.now() + 2_000;
    while (signal(pid, 0) && Date.now() < deadline)
      await new Promise((done) => setTimeout(done, 20));
    if (!signal(pid, 0)) return;
  }
  throw new ProbeCleanupError("Private runtime process cleanup unconfirmed");
}

async function probe(
  executable: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  abort: AbortSignal,
) {
  if (abort.aborted) throw new StartupError("runtime");
  const child = spawn(executable, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.resume();
  let output = "";
  let invalid = false;
  let interrupted = false;
  let cleanupError: unknown;
  const finished = Promise.withResolvers<number | null>();
  const interrupt = () => {
    interrupted = true;
    try {
      if (child.pid) signal(child.pid, "SIGKILL");
    } catch (error) {
      cleanupError = error;
    }
    finished.resolve(null);
  };
  child.stdout.on("data", (chunk: Buffer) => {
    if (output.length + chunk.length > 2 * 1024 * 1024) {
      invalid = true;
      interrupt();
      return;
    }
    output += chunk.toString();
  });
  child.once("error", () => finished.resolve(null));
  child.once("close", (status) => finished.resolve(status));
  abort.addEventListener("abort", interrupt, { once: true });
  const timer = setTimeout(interrupt, 45_000);
  try {
    const status = await finished.promise;
    if (cleanupError) throw cleanupError;
    if (child.pid) await drain(child.pid);
    if (status !== 0 || invalid || interrupted || abort.aborted) throw new StartupError("runtime");
    return output;
  } finally {
    clearTimeout(timer);
    abort.removeEventListener("abort", interrupt);
  }
}

export async function verifyRuntime(options: {
  executable: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  root: string;
  signal: AbortSignal;
}) {
  if (process.platform !== "linux") throw new StartupError("runtime");
  rejectIfPresent("/etc/opencode");
  rejectAncestorConfiguration(options.cwd);
  const run = (args: string[]) =>
    probe(options.executable, args, options.cwd, options.env, options.signal);
  const version = await run(["--version"]);
  if (!supportedOpenCode(version.trim())) throw new StartupError("version");
  try {
    validateRuntimePaths(await run(["debug", "paths"]), options.root);
    validateRuntimeSources(
      await run(["--standalone", "debug", "config"]),
      options.root,
      options.cwd,
    );
  } catch (error) {
    if (error instanceof ProbeCleanupError) throw error;
    throw new StartupError("runtime");
  }
}
