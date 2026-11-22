import { StartupError } from "./startup-error.js";

export const POLICY_PROFILES = ["read-only", "edit", "supervised", "full-access"] as const;
export type PolicyProfile = (typeof POLICY_PROFILES)[number];
export const DEFAULT_POLICY: PolicyProfile = "read-only";
// `supervised` stays unreleased until every shell call is proven to need a fresh approval.
export const SUPERVISED_AVAILABLE = false;

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

export function policyConfig(profile: PolicyProfile) {
  const policy = definition(profile);
  return {
    policies: policy.policies,
    permissions: policy.permissions,
    agents: { build: { permissions: policy.permissions } },
  };
}

export function parsePolicy(value: string | undefined): PolicyProfile {
  if (value === undefined) return DEFAULT_POLICY;
  const profile = POLICY_PROFILES.find((name) => name === value);
  if (!profile) throw new StartupError("arguments");
  if (profile === "supervised" && !SUPERVISED_AVAILABLE) throw new StartupError("supervised");
  return profile;
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
    `profile: ${profile} · ${profile === "read-only" ? "read/search only" : "read/search and edit"}`,
    `ACP approvals: ${permissions === "ask" ? "ask (any client of this port may approve)" : "reject"}`,
    `shell: ${shell}`,
    profile === "full-access"
      ? "web tools: allowed · MCP, plugins and skills: blocked"
      : "web tools, MCP, plugins, skills and subagents: blocked",
    "OS isolation: none",
  ];
}

export const FULL_ACCESS_WARNING =
  "full-access | auto-approved commands | no OS isolation | any local A2A client may execute host-user commands";

// Effective agent effects that hard policies cannot enforce: Code Mode exposes OpenCode utilities
// (worktrees, session moves) without a policy-checked permission, so it must stay denied.
export function requiredAgentEffects(profile: PolicyProfile): readonly Statement[] {
  if (profile === "full-access") return [];
  return [
    rule("execute", "*", "deny"),
    ...(profile === "supervised" ? [rule("shell", "*", "ask")] : []),
  ];
}
