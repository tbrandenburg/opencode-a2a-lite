import { isAbsolute, resolve } from "node:path";
import { readTrustedFile, contains } from "./trusted-path.js";
import { POLICY_PROFILES, type PolicyProfile } from "./runtime-policy.js";
import { StartupError } from "./startup-error.js";
import { realpathSync } from "node:fs";

// Reviewed exception actions. Each is an exact allow that lifts one built-in denial; see
// docs/architecture.md for the extra statements each one needs to become effective.
export type Exception = {
  action: "mcp.use" | "skill.use" | "plugin.use" | "tool.use";
  resource: string;
};
export type PolicyFile = { base: PolicyProfile; exceptions: readonly Exception[] };

const MAX_BYTES = 64 * 1024;
const MAX_ENTRIES = 32;
const SERVER = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const SKILL = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}(?::[A-Za-z0-9][A-Za-z0-9_.-]{0,63})*$/;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]{0,63}\/)?[a-z0-9][a-z0-9._-]{0,63}$/;
const FILE = /^\/[A-Za-z0-9_.@/-]{1,512}$/;
const TOOL = /^([A-Za-z0-9][A-Za-z0-9-]{0,63})_([A-Za-z0-9_-]{1,64}):\*$/;
// Built-in tool/permission names stay governed by the profile, so shell and edit cannot be lifted.
const RESERVED = new Set(
  "read glob grep edit write shell bash webfetch websearch subagent task execute skill external_directory".split(
    " ",
  ),
);

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const invalid = () => new StartupError("policyFile");

function exceptionOf(entry: unknown, workspace: string): Exception {
  if (!record(entry) || Object.keys(entry).sort().join() !== "action,effect,resource")
    throw invalid();
  const { action, resource, effect } = entry;
  if (effect !== "allow" || typeof resource !== "string") throw invalid();
  const ok =
    (action === "mcp.use" && SERVER.test(resource) && !RESERVED.has(resource)) ||
    (action === "skill.use" && SKILL.test(resource)) ||
    (action === "tool.use" && TOOL.test(resource)) ||
    (action === "plugin.use" &&
      (PACKAGE.test(resource) ||
        (FILE.test(resource) &&
          !resource.split("/").includes("..") &&
          !contains(realpathSync(workspace), resource))));
  if (!ok) throw invalid();
  return { action: action as Exception["action"], resource };
}

export function parsePolicyFile(text: string, workspace: string): PolicyFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw invalid();
  }
  if (!record(value) || Object.keys(value).sort().join() !== "base,policies,version")
    throw invalid();
  const base = POLICY_PROFILES.find((name) => name === value.base);
  if (value.version !== 1 || !base || base === "supervised") throw invalid();
  const list = value.policies;
  if (!Array.isArray(list) || list.length > MAX_ENTRIES) throw invalid();
  const found = list.map((entry) => exceptionOf(entry, workspace));
  const keys = found.map((item) => `${item.action}\0${item.resource}`);
  if (new Set(keys).size !== keys.length) throw invalid();
  const servers = new Set(found.filter((i) => i.action === "mcp.use").map((i) => i.resource));
  // A tool exception must belong to an MCP server the same file allows.
  for (const item of found.filter((i) => i.action === "tool.use"))
    if (!servers.has(TOOL.exec(item.resource)![1]!)) throw invalid();
  const order = ["mcp.use", "tool.use", "skill.use", "plugin.use"];
  const exceptions = found.sort(
    (a, b) =>
      order.indexOf(a.action) - order.indexOf(b.action) || a.resource.localeCompare(b.resource),
  );
  return { base, exceptions };
}

export function loadPolicyFile(path: string, workspace: string, profile: PolicyProfile) {
  if (!isAbsolute(path) || resolve(path) !== path) throw invalid();
  const file = parsePolicyFile(readTrustedFile(path, workspace, MAX_BYTES), workspace);
  if (file.base !== profile) throw new StartupError("policyFileBase");
  return file;
}

export const exceptionNames = (items: readonly Exception[]) =>
  items.map((item) => `${item.action}:${item.resource.replace(/:\*$/, "")}`);
