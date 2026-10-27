import { isAbsolute, resolve } from "node:path";
import type { ServerOptions } from "./server.js";
import { StartupError } from "./startup-error.js";
import { parseIdentity } from "./identity.js";

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
  return {
    action: "run",
    server: {
      workspace,
      port: parsePort(flags.get("--port") ?? env.A2A_PORT),
      ...(identity === undefined ? {} : { identity }),
    },
  };
}

function parseFlags(args: readonly string[]) {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const flag = token === "-h" ? "--help" : token === "-v" ? "--version" : token;
    if (flag === undefined || flags.has(flag)) throw new StartupError("arguments");
    if (flag === "--help" || flag === "--version") {
      flags.set(flag, "");
      continue;
    }
    if (flag !== "--workspace" && flag !== "--port") throw new StartupError("arguments");
    flags.set(flag, flagValue(flag, args[index + 1]));
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
