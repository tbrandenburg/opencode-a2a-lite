import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

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
    if (
      (source.type !== "document" && source.type !== "directory") ||
      typeof source.path !== "string"
    )
      throw new Error("Unexpected configuration source");
    const target = physicalPath(source.path);
    if (!inside(privateRoot, target) && !inside(trusted, target))
      throw new Error("External configuration source requires review");
    if (source.type === "directory" && inside(privateRoot, target)) privateDirectory = true;
  }
  if (!privateDirectory) throw new Error("Missing private configuration source");
}

export function validateRuntimePaths(output: string, root: string) {
  const privateRoot = realpathSync(root);
  const required = new Set(["home", "data", "cache", "config", "state", "tmp", "db"]);
  const seen = new Set<string>();
  for (const line of output.trim().split("\n")) {
    const match = /^([a-z]+)\s+(.+)$/.exec(line);
    if (!match?.[1] || !match[2] || seen.has(match[1])) throw new Error("Invalid runtime paths");
    seen.add(match[1]);
    if (!inside(privateRoot, physicalPath(match[2]))) throw new Error("External runtime path");
  }
  if ([...required].some((name) => !seen.has(name))) throw new Error("Incomplete runtime paths");
}
