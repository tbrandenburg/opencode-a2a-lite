import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { StartupError } from "./startup-error.js";

export class RuntimeSourceError extends StartupError {
  constructor(category: string, path: unknown, root: string) {
    super("runtime");
    const safe =
      typeof path === "string" &&
      isAbsolute(path) &&
      !inside(root, path) &&
      !/[?@#\x00-\x1f\x7f]/.test(path);
    this.message = `Private runtime preflight failed: rejected ${category} configuration source${safe ? ` (${path})` : ""}; review trusted workspace and OpenCode configuration.`;
  }
}

function inside(root: string, candidate: string) {
  const tail = relative(root, candidate);
  return tail === "" || (!tail.startsWith("..") && !isAbsolute(tail));
}

function physicalPath(value: string) {
  if (!isAbsolute(value) || resolve(value) !== value) throw new Error("Invalid runtime path");
  let current = value;
  for (;;) {
    try {
      lstatSync(current);
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
        throw new Error("Cannot inspect runtime path");
      const parent = dirname(current);
      if (parent === current) throw new Error("Invalid runtime path");
      current = parent;
    }
  }
  const actual = (() => {
    try {
      return realpathSync(current);
    } catch {
      throw new Error("Cannot resolve runtime path");
    }
  })();
  return resolve(actual, relative(current, value));
}

export function validateRuntimeSources(output: string, root: string, workspace: string) {
  const privateRoot = realpathSync(root);
  const trusted = realpathSync(workspace);
  const entries: unknown = (() => {
    try {
      return JSON.parse(output);
    } catch {
      throw new Error("Invalid configuration sources");
    }
  })();
  if (!Array.isArray(entries)) throw new Error("Invalid configuration sources");
  let privateDirectory = false;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") throw new Error("Invalid configuration source");
    const source = entry as Record<string, unknown>;
    if (source.type !== "document" && source.type !== "directory") {
      const category = source.type === "remote" ? "remote" : "virtual";
      throw new RuntimeSourceError(category, source.path, privateRoot);
    }
    if (typeof source.path !== "string")
      throw new RuntimeSourceError("virtual", undefined, privateRoot);
    const reported = source.path;
    const target = physicalPath(reported);
    if (!inside(privateRoot, target) && !inside(trusted, target)) {
      const managed = ["/etc/opencode", "/private/etc/opencode"].some(
        (path) => inside(path, reported) || inside(path, target),
      );
      const category = managed ? "managed" : inside(trusted, reported) ? "symlink" : "external";
      throw new RuntimeSourceError(category, target, privateRoot);
    }
    if (source.type === "directory" && inside(privateRoot, target)) privateDirectory = true;
  }
  if (!privateDirectory) throw new Error("Missing private configuration source");
}

// With persistent state only the data directory and database may live outside the private root.
export function validateRuntimePaths(output: string, root: string, data?: string) {
  const privateRoot = realpathSync(root);
  const required = new Set(["home", "data", "cache", "config", "state", "tmp", "db"]);
  const seen = new Set<string>();
  for (const line of output.trim().split("\n")) {
    const match = /^([a-z]+)\s+(.+)$/.exec(line);
    if (!match?.[1] || !match[2] || seen.has(match[1])) throw new Error("Invalid runtime paths");
    seen.add(match[1]);
    const target = physicalPath(match[2]);
    const persistent = data !== undefined && ["data", "db", "log", "repos"].includes(match[1]);
    if (!inside(privateRoot, target) && !(persistent && inside(realpathSync(data), target)))
      throw new Error("External runtime path");
  }
  if ([...required].some((name) => !seen.has(name))) throw new Error("Incomplete runtime paths");
}
