import type { Exception } from "./policy-file.js";
import { StartupError } from "./startup-error.js";
import type { NativeRole } from "./native-role.js";

export const POLICY_PROFILES = ["read-only", "edit", "supervised", "full-access"] as const;
export type PolicyProfile = (typeof POLICY_PROFILES)[number];
export const DEFAULT_POLICY: PolicyProfile = "read-only";
// `supervised` is internal only: no CLI value selects it until every shell call needs a fresh approval.

type Effect = "allow" | "deny" | "ask";
export type Statement = { action: string; resource: string; effect: Effect };
const rule = (action: string, resource: string, effect: Effect): Statement => ({
  action,
  resource,
  effect,
});
const tools = (...names: string[]) => names.map((name) => rule("tool.use", `${name}:*`, "allow"));

const READ = ["read", "glob", "grep"];
const ENV_READS = [
  rule("read", "*.env", "ask"),
  rule("read", "*.env.*", "ask"),
  rule("read", "*.env.example", "allow"),
];
const BLOCKED = ["mcp.use", "plugin.use", "skill.use"].map((action) => rule(action, "*", "deny"));

// Best-effort: keep an edit-capable profile from rewriting the configuration that selects agents.
const PROTECTED = [
  "*opencode.json",
  "*opencode.jsonc",
  ...[".opencode", ".agents", ".claude"].flatMap((name) => [`${name}/*`, `*/${name}/*`]),
].map((path) => rule("tool.use", `edit:${path}`, "deny"));

const permitted = (...names: string[]) => [
  rule("*", "*", "deny"),
  ...names.map((name) => rule(name, "*", "allow")),
  ...ENV_READS,
];

// Hard policy denials are the boundary; agent permissions are defence in depth. Later statements win.
function definition(profile: PolicyProfile) {
  const denied = [rule("tool.use", "*", "deny"), rule("websearch.use", "*", "deny"), ...BLOCKED];
  if (profile === "read-only")
    return { policies: [...denied, ...tools(...READ)], permissions: permitted(...READ) };
  if (profile === "edit")
    return {
      policies: [...denied, ...tools(...READ, "edit"), ...PROTECTED],
      permissions: permitted(...READ, "edit"),
    };
  if (profile === "supervised")
    return {
      policies: [...denied, ...tools(...READ, "edit", "shell"), ...PROTECTED],
      permissions: [...permitted(...READ, "edit"), rule("shell", "*", "ask")],
    };
  return {
    policies: [...BLOCKED, rule("tool.use", "*", "allow"), rule("websearch.use", "*", "allow")],
    permissions: [rule("*", "*", "allow")],
  };
}

// Operator exceptions are exact allows appended after the base. A policy allow only lifts a denial,
// so each one also needs the tool.use allow and agent permission that make the capability usable
// (observed on OpenCode 2.3.2): MCP tool `<server>_<tool>`, skill `<id>`. Plugins only load.
export function exceptionStatements(exceptions: readonly Exception[]) {
  const policies: Statement[] = [];
  const permissions: Statement[] = [];
  for (const item of exceptions) {
    const name = item.resource.replace(/:\*$/, "");
    policies.push(rule(item.action, item.resource, "allow"));
    if (item.action === "tool.use") permissions.push(rule(name, "*", "allow"));
    if (item.action === "skill.use") {
      policies.push(rule("tool.use", `skill:${name}`, "allow"));
      permissions.push(rule("skill", name, "allow"));
    }
  }
  return { policies, permissions };
}

export function policyConfig(
  profile: PolicyProfile,
  exceptions: readonly Exception[] = [],
  role?: NativeRole,
) {
  const policy = definition(profile);
  const extra = exceptionStatements(exceptions);
  const permissions = [...policy.permissions, ...extra.permissions];
  const agents: { build: { permissions: Statement[] } } & Record<
    string,
    { permissions: Statement[]; mode?: "primary"; hidden?: boolean; system?: string }
  > = {
    build: { permissions },
    ...(role?.system === undefined
      ? {}
      : {
          [role.id]: { mode: "primary" as const, hidden: false, system: role.system, permissions },
        }),
  };
  return {
    policies: [...policy.policies, ...extra.policies],
    permissions,
    agents,
  };
}

export function validatePolicyFlags(
  profile: PolicyProfile,
  acknowledged: boolean,
  permissions: "reject" | "ask",
) {
  if (acknowledged !== (profile === "full-access")) throw new StartupError("policyAcknowledgement");
  if (profile === "full-access" && permissions === "ask") throw new StartupError("policyConflict");
}

export function policySummary(profile: PolicyProfile, permissions: "reject" | "ask") {
  const shell = {
    "read-only": "denied",
    edit: "denied",
    supervised: "fresh approval per command",
    "full-access": "auto-approved with host-user authority",
  }[profile];
  return [
    `profile: ${profile} · ${
      {
        "read-only": "read/search only",
        edit: "read/search and edit",
        supervised: "read/search and edit",
        "full-access": "read, edit, shell and web",
      }[profile]
    }`,
    `ACP approvals: ${permissions === "ask" ? "ask (any client of this port may approve)" : "reject"}`,
    `shell: ${shell}`,
    profile === "full-access"
      ? "web tools and subagents: allowed · MCP, plugins and skills: blocked"
      : "web tools, MCP, plugins, skills and subagents: blocked",
    "OS isolation: none",
  ];
}

export const FULL_ACCESS_WARNING =
  "full-access | auto-approved commands | no OS isolation | any local A2A client may execute host-user commands";

// Effective agent effects that hard policies cannot enforce on their own. Code Mode `execute`
// exposes OpenCode utilities (worktrees, session moves) without a policy-checked permission, and
// `external_directory` is an agent-level boundary the project could re-open. Every agent must deny
// them; `supervised` additionally needs `shell: ask`. `full-access` must keep its allows on every
// visible primary agent.
export type AgentRequirement = { action: string; effect: Effect };

export function requiredAgentEffects(profile: PolicyProfile): readonly AgentRequirement[] {
  if (profile === "full-access") return [];
  return [
    { action: "execute", effect: "deny" },
    { action: "external_directory", effect: "deny" },
    ...(profile === "supervised" ? [{ action: "shell", effect: "ask" as const }] : []),
  ];
}

export const FULL_ACCESS_ALLOWED = [
  "read",
  "glob",
  "grep",
  "edit",
  "shell",
  "webfetch",
  "websearch",
  "subagent",
  "execute",
  "external_directory",
];
