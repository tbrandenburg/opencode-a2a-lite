import { isAbsolute, relative, resolve } from "node:path";
import type { ServerOptions } from "./server.js";
import { StartupError } from "./startup-error.js";
import { parseIdentity } from "./identity.js";
import { validatePassEnv } from "./runtime-environment.js";
import { validateRoleOptions } from "./native-role.js";

type Options =
  | { action: "help" }
  | { action: "version" }
  | { action: "run"; server: ServerOptions };

export const PROVIDER_ENV = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
] as const;

const ACCESS = { read: "read-only", edit: "edit", "danger-full-access": "full-access" } as const;
const EXTRAS = ["activity", "approve", "resume"] as const;

const REPLACED: Record<string, string> = {
  "--policy": "--policy was replaced by --access (read|edit|danger-full-access)",
  "--dangerously-skip-permissions":
    "--dangerously-skip-permissions was removed; --access danger-full-access is the acknowledgement",
  "--permissions": "--permissions was replaced by --enable approve",
  "--publish-activity": "--publish-activity was replaced by --enable activity",
  "--allow-resume": "--allow-resume was replaced by --enable resume",
};

export function parseOptions(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string = process.cwd(),
): Options {
  const flags = parseFlags(args);
  if (flags.has("--help")) return { action: "help" };
  if (flags.has("--version")) return { action: "version" };
  const explicit = flags.get("--workspace")?.[0];
  const workspace =
    explicit !== undefined
      ? resolve(cwd, explicit)
      : env.A2A_WORKSPACE !== undefined
        ? env.A2A_WORKSPACE
        : cwd;
  if (!workspace || !isAbsolute(workspace)) throw new StartupError("workspace");
  const identity = parseIdentity({
    ...env,
    A2A_NAME: flags.get("--name")?.[0] ?? env.A2A_NAME,
    A2A_DESCRIPTION: flags.get("--description")?.[0] ?? env.A2A_DESCRIPTION,
  });
  const access = parseAccess(flags.get("--access")?.[0]);
  const extras = parseEnable(flags.get("--enable") ?? []);
  const agent = flags.get("--agent")?.[0];
  const promptFile = flags.get("--system-prompt-file")?.[0];
  validateRoleOptions(agent, promptFile, extras.includes("resume"));
  if (access === "danger-full-access" && extras.includes("approve"))
    throw new StartupError("accessConflict");
  const names = credentialNames(flags, access, env);
  try {
    validatePassEnv(names, env);
  } catch {
    throw new StartupError("passEnv");
  }
  return {
    action: "run",
    server: {
      workspace,
      ...(agent === undefined ? {} : { agent }),
      ...(promptFile === undefined ? {} : { systemPromptFile: resolve(cwd, promptFile) }),
      port: parsePort(flags.get("--port")?.[0] ?? env.A2A_PORT),
      ...(names.length ? { passEnv: names } : {}),
      ...promptOptions(flags),
      ...executorOptions(extras),
      ...(flags.has("--access")
        ? {
            policy: ACCESS[access],
            ...(access === "danger-full-access" ? { dangerouslySkipPermissions: true } : {}),
          }
        : {}),
      ...privateOptions(flags, cwd),
      ...(identity === undefined ? {} : { identity }),
    },
  };
}

function parseAccess(value: string | undefined) {
  if (value === undefined) return "read";
  if (value === "read" || value === "edit" || value === "danger-full-access") return value;
  throw new StartupError("access");
}

function parseEnable(values: readonly string[]) {
  const extras = values.map((value) => {
    const extra = EXTRAS.find((name) => name === value);
    if (!extra) throw new StartupError("enable");
    return extra;
  });
  if (new Set(extras).size !== extras.length) throw new StartupError("enable");
  return extras;
}

// Explicit names always count; the provider allowlist adds only names that are set, and never
// under danger-full-access. `--no-env` or `--pass-env ""` drops the allowlist, not explicit names.
function credentialNames(flags: Map<string, string[]>, access: string, env: NodeJS.ProcessEnv) {
  const given = flags.get("--pass-env") ?? [];
  const explicit = given.filter((name) => name !== "");
  const automatic =
    access === "danger-full-access" || flags.has("--no-env") || given.includes("")
      ? []
      : PROVIDER_ENV.filter((name) => env[name] && !explicit.includes(name));
  return [...explicit, ...automatic];
}

function promptOptions(flags: Map<string, string[]>): Pick<ServerOptions, "acp"> {
  const value = flags.get("--prompt-timeout")?.[0];
  if (value === undefined) return {};
  if (value === "unlimited") return { acp: { promptTimeoutMs: null } };
  const match = /^(\d+)(ms|s|m|h)$/.exec(value);
  if (!match || match[0] !== value) throw new StartupError("promptTimeout");
  const unit = match[2];
  const multiplier = unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : unit === "s" ? 1_000 : 1;
  const ms = Number(match[1]) * multiplier;
  if (!Number.isSafeInteger(ms) || ms < 30 || ms > 2_147_483_647)
    throw new StartupError("promptTimeout");
  return { acp: { promptTimeoutMs: ms } };
}

function executorOptions(extras: readonly string[]): Pick<ServerOptions, "executor"> {
  const executor = {
    ...(extras.includes("activity") ? { activity: true } : {}),
    ...(extras.includes("approve") ? { permissions: "ask" as const } : {}),
    ...(extras.includes("resume") ? { resume: true } : {}),
  };
  return Object.keys(executor).length ? { executor } : {};
}

function privateOptions(
  flags: Map<string, string[]>,
  cwd: string,
): Pick<ServerOptions, "policyFile" | "stateDir"> {
  const input = flags.get("--policy-file")?.[0];
  const policyFile = input === undefined ? undefined : resolve(cwd, input);
  // Never normalize away components that the trusted-file checks must inspect.
  if (
    input !== undefined &&
    (input.split("/").includes("..") ||
      (isAbsolute(input)
        ? policyFile !== input
        : relative(cwd, policyFile!) !== input.replace(/^\.\//, "")))
  )
    throw new StartupError("policyFile");
  const stateDir = flags.get("--state-dir")?.[0];
  if (stateDir !== undefined && (!isAbsolute(stateDir) || resolve(stateDir) !== stateDir))
    throw new StartupError("stateDir");
  return {
    ...(policyFile === undefined ? {} : { policyFile }),
    ...(stateDir === undefined ? {} : { stateDir }),
  };
}

const VALUELESS = new Set(["--help", "--version", "--no-env"]);
const REPEATABLE = new Set(["--pass-env", "--enable"]);
const VALUED = new Set([
  "--name",
  "--description",
  "--agent",
  "--system-prompt-file",
  "--workspace",
  "--port",
  "--access",
  "--prompt-timeout",
  "--policy-file",
  "--state-dir",
  ...REPEATABLE,
]);

function parseFlags(args: readonly string[]) {
  const flags = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const flag = token === "-h" ? "--help" : token === "-v" ? "--version" : token;
    if (flag !== undefined && REPLACED[flag]) throw new StartupError("replaced", REPLACED[flag]);
    if (flag === undefined || (flags.has(flag) && !REPEATABLE.has(flag)))
      throw new StartupError("arguments");
    if (VALUELESS.has(flag)) {
      flags.set(flag, []);
      continue;
    }
    if (!VALUED.has(flag)) throw new StartupError("arguments");
    const value = flagValue(flag, args[index + 1]);
    if (REPEATABLE.has(flag) && value.includes(",")) throw new StartupError("arguments");
    flags.set(flag, [...(flags.get(flag) ?? []), value]);
    index += 1;
  }
  return flags;
}

function flagValue(flag: string, value: string | undefined) {
  if (flag === "--pass-env" && value === "") return value;
  if (
    !value ||
    (value.startsWith("-") && flag === "--workspace") ||
    value.startsWith("--") ||
    ["-h", "-v"].includes(value)
  )
    throw new StartupError("arguments");
  return value;
}

function parsePort(value: string | undefined) {
  const port = value === undefined ? 41241 : Number(value);
  if (
    value !== undefined &&
    (!value || /[^0-9]/.test(value) || !Number.isSafeInteger(port) || port > 65535)
  )
    throw new StartupError("port");
  return port;
}
