import { realpathSync } from "node:fs";
import { join } from "node:path";
import { policyConfig, requiredAgentEffects, type PolicyProfile } from "./runtime-policy.js";
import { StartupError } from "./startup-error.js";

const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function parse(output: string): unknown[] {
  const value: unknown = JSON.parse(output);
  if (!Array.isArray(value)) throw new Error("Invalid OpenCode output");
  return value;
}

function matches(pattern: string, value: string) {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${source}$`, "s").test(value);
}

// Last matching rule wins; OpenCode asks when nothing matches.
function effect(rules: readonly unknown[], action: string, resource: string) {
  const hit = rules
    .filter(
      (item) =>
        record(item) &&
        typeof item.action === "string" &&
        typeof item.resource === "string" &&
        matches(item.action, action) &&
        matches(item.resource, resource),
    )
    .at(-1);
  return record(hit) ? hit.effect : "ask";
}

// OpenCode silently drops invalid statements, so the private document it reports must equal
// what was written; any difference fails closed.
export function validatePolicyDocument(output: string, root: string, profile: PolicyProfile) {
  const path = join(realpathSync(root), "home", ".config", "opencode", "opencode.json");
  const entry = parse(output).find((item) => record(item) && item.path === path);
  if (!record(entry) || !record(entry.info)) throw new StartupError("policy");
  const actual = entry.info;
  const picked = {
    policies: actual.policies,
    permissions: actual.permissions,
    agents: actual.agents,
  };
  if (JSON.stringify(picked) !== JSON.stringify(policyConfig(profile)))
    throw new StartupError("policy");
}

export function validateAgentPermissions(output: string, profile: PolicyProfile) {
  const agents = parse(output);
  if (!agents.length) throw new StartupError("policy");
  for (const agent of agents) {
    if (!record(agent) || !Array.isArray(agent.permissions)) throw new StartupError("policy");
    for (const required of requiredAgentEffects(profile))
      if (effect(agent.permissions, required.action, required.resource) !== required.effect)
        throw new StartupError("policy");
  }
}
