import { spawn } from "node:child_process";
import { accessSync, constants, lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { supportedOpenCode } from "./opencode-version.js";
import { StartupError } from "./startup-error.js";
import { validateAgentPermissions, validatePolicyDocument } from "./runtime-policy-check.js";
import type { Exception } from "./policy-file.js";
import type { PolicyProfile } from "./runtime-policy.js";
import {
  RuntimeSourceError,
  validateRuntimePaths,
  validateRuntimeSources,
} from "./runtime-preflight.js";

export class ProbeCleanupError extends Error {}

function rejectIfPresent(path: string, category: string, root: string) {
  try {
    lstatSync(path);
    throw new RuntimeSourceError(category, path, root);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

function rejectAncestorConfiguration(workspace: string, root: string) {
  let current = dirname(realpathSync(workspace));
  for (;;) {
    for (const name of ["opencode.json", "opencode.jsonc", ".opencode", ".agents", ".claude"])
      rejectIfPresent(join(current, name), "external", root);
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export function resolveOpenCode(path: string, executable = "opencode", cwd = process.cwd()) {
  const candidates = executable.includes("/")
    ? [resolve(cwd, executable)]
    : path.split(":").map((directory) => join(directory, executable));
  for (const file of candidates) {
    try {
      const candidate = realpathSync(file);
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
  onSpawn?: () => void,
) {
  if (abort.aborted) throw new StartupError("runtime");
  const child = spawn(executable, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.pid) onSpawn?.();
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

const AGENT_ATTEMPTS = 3;
const POLICY_MESSAGE = new StartupError("policy").message;

// OpenCode 2.3.2 intermittently reports `debug agents` without the private global config for one
// process. Only this probe is retried, each time in a fresh process; a deterministic weakening
// fails every attempt and keeps the sanitized policy error.
async function verifyAgents(
  run: (args: string[]) => Promise<string>,
  policy: PolicyProfile,
  exceptions: readonly Exception[] | undefined,
) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      validateAgentPermissions(await run(["--standalone", "debug", "agents"]), policy, exceptions);
      if (attempt > 1)
        console.error(
          `Private runtime preflight: agent check passed on attempt ${attempt} of ${AGENT_ATTEMPTS}`,
        );
      return;
    } catch (error) {
      const weakened = error instanceof StartupError && error.message === POLICY_MESSAGE;
      if (!weakened || attempt === AGENT_ATTEMPTS) throw error;
      console.error(
        `Private runtime preflight: agent check attempt ${attempt} of ${AGENT_ATTEMPTS} did not report the private policy; retrying`,
      );
      await new Promise((done) => setTimeout(done, 100 * attempt));
    }
  }
}

export async function verifyRuntime(options: {
  executable: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  root: string;
  policy?: PolicyProfile;
  exceptions?: readonly Exception[];
  data?: string;
  signal: AbortSignal;
  onSpawn?: () => void;
}) {
  if (process.platform !== "linux") throw new StartupError("runtimePlatform");
  rejectIfPresent("/etc/opencode", "managed", options.root);
  rejectAncestorConfiguration(options.cwd, options.root);
  const run = (args: string[]) =>
    probe(options.executable, args, options.cwd, options.env, options.signal, options.onSpawn);
  const version = await run(["--version"]);
  if (!supportedOpenCode(version.trim())) throw new StartupError("version");
  try {
    validateRuntimePaths(await run(["debug", "paths"]), options.root, options.data);
    const sources = await run(["--standalone", "debug", "config"]);
    validateRuntimeSources(sources, options.root, options.cwd);
    if (options.policy) {
      validatePolicyDocument(sources, options.root, options.policy, options.exceptions);
      await verifyAgents(run, options.policy, options.exceptions);
    }
  } catch (error) {
    if (
      error instanceof ProbeCleanupError ||
      error instanceof RuntimeSourceError ||
      error instanceof StartupError
    )
      throw error;
    throw new StartupError("runtime");
  }
}
