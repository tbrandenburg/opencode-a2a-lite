import { isAbsolute, resolve } from "node:path";
import type { ServerOptions } from "./server.js";
import { StartupError } from "./startup-error.js";
import { parseIdentity } from "./identity.js";
import { validatePassEnv } from "./runtime-environment.js";
import { parsePolicy, validatePolicyFlags } from "./runtime-policy.js";

type Options =
  | { action: "help" }
  | { action: "version" }
  | { action: "run"; server: ServerOptions };

export function parseOptions(args: readonly string[], env: NodeJS.ProcessEnv): Options {
  const flags = parseFlags(args);
  if (flags.has("--help")) return { action: "help" };
  if (flags.has("--version")) return { action: "version" };
  const explicit = flags.get("--workspace");
  const workspace = explicit === undefined ? env.A2A_WORKSPACE : resolve(explicit);
  if (!workspace || !isAbsolute(workspace)) throw new StartupError("workspace");
  const identity = parseIdentity(env);
  const names = flags.get("--pass-env")?.split(",") ?? [];
  try {
    validatePassEnv(names, env);
  } catch {
    throw new StartupError("passEnv");
  }
  return {
    action: "run",
    server: {
      workspace,
      port: parsePort(flags.get("--port") ?? env.A2A_PORT),
      ...(names.length ? { passEnv: names } : {}),
      ...executorOptions(flags),
      ...policyOptions(flags),
      ...privateOptions(flags),
      ...(identity === undefined ? {} : { identity }),
    },
  };
}

function executorOptions(flags: Map<string, string>): Pick<ServerOptions, "executor"> {
  const permissions = flags.get("--permissions");
  if (permissions !== undefined && permissions !== "reject" && permissions !== "ask")
    throw new StartupError("arguments");
  const executor = {
    ...(flags.has("--publish-activity") ? { activity: true } : {}),
    ...(permissions === "ask" ? { permissions: "ask" as const } : {}),
    ...(flags.has("--allow-resume") ? { resume: true } : {}),
  };
  return Object.keys(executor).length ? { executor } : {};
}

function policyOptions(
  flags: Map<string, string>,
): Pick<ServerOptions, "policy" | "dangerouslySkipPermissions"> {
  const acknowledged = flags.has("--dangerously-skip-permissions");
  const policy = parsePolicy(flags.get("--policy"));
  validatePolicyFlags(
    policy,
    acknowledged,
    flags.get("--permissions") === "ask" ? "ask" : "reject",
  );
  return {
    ...(flags.has("--policy") ? { policy } : {}),
    ...(acknowledged ? { dangerouslySkipPermissions: true } : {}),
  };
}

function privateOptions(
  flags: Map<string, string>,
): Pick<ServerOptions, "policyFile" | "stateDir"> {
  const policyFile = flags.get("--policy-file");
  const stateDir = flags.get("--state-dir");
  for (const [value, code] of [
    [policyFile, "policyFile"],
    [stateDir, "stateDir"],
  ] as const)
    if (value !== undefined && (!isAbsolute(value) || resolve(value) !== value))
      throw new StartupError(code);
  return {
    ...(policyFile === undefined ? {} : { policyFile }),
    ...(stateDir === undefined ? {} : { stateDir }),
  };
}

const VALUELESS = new Set([
  "--help",
  "--version",
  "--publish-activity",
  "--allow-resume",
  "--dangerously-skip-permissions",
]);

function parseFlags(args: readonly string[]) {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const flag = token === "-h" ? "--help" : token === "-v" ? "--version" : token;
    if (flag === undefined || (flag !== "--pass-env" && flags.has(flag)))
      throw new StartupError("arguments");
    if (VALUELESS.has(flag)) {
      flags.set(flag, "");
      continue;
    }
    if (
      flag !== "--workspace" &&
      flag !== "--port" &&
      flag !== "--permissions" &&
      flag !== "--policy" &&
      flag !== "--policy-file" &&
      flag !== "--state-dir" &&
      flag !== "--pass-env"
    )
      throw new StartupError("arguments");
    const value = flagValue(flag, args[index + 1]);
    if (flag === "--pass-env" && value.includes(",")) throw new StartupError("arguments");
    flags.set(
      flag,
      flag === "--pass-env" && flags.has(flag) ? `${flags.get(flag)},${value}` : value,
    );
    index += 1;
  }
  return flags;
}

function flagValue(flag: string, value: string | undefined) {
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
