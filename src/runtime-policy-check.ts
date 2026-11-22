import { realpathSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  FULL_ACCESS_ALLOWED,
  policyConfig,
  requiredAgentEffects,
  type PolicyProfile,
} from "./runtime-policy.js";
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

// A blanket rule for the action must end with the required effect, and no later rule that matches
// the action by exact name or wildcard (for any resource) may differ; otherwise a narrower project
// rule could re-open it. OpenCode asks when nothing matches.
function holds(rules: readonly unknown[], action: string, wanted: string) {
  const matching = rules.flatMap((item, index) =>
    record(item) &&
    typeof item.action === "string" &&
    typeof item.resource === "string" &&
    matches(item.action, action)
      ? [{ index, resource: item.resource, effect: item.effect }]
      : [],
  );
  const blanket = matching.filter((item) => item.resource === "*" && item.effect === wanted).at(-1);
  return (
    Boolean(blanket) &&
    matching.every((item) => item.index < blanket!.index || item.effect === wanted)
  );
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
  const expected: unknown = JSON.parse(JSON.stringify(policyConfig(profile)));
  if (!isDeepStrictEqual(picked, expected)) throw new StartupError("policy");
}

export function validateAgentPermissions(output: string, profile: PolicyProfile) {
  const agents = parse(output);
  if (!agents.length) throw new StartupError("policy");
  for (const agent of agents) {
    if (!record(agent) || !Array.isArray(agent.permissions)) throw new StartupError("policy");
    const rules: readonly unknown[] = agent.permissions;
    for (const required of requiredAgentEffects(profile))
      if (!holds(rules, required.action, required.effect)) throw new StartupError("policy");
    const primary = agent.hidden !== true && agent.mode !== "subagent";
    if (profile === "full-access" && primary)
      for (const action of FULL_ACCESS_ALLOWED)
        if (!holds(rules, action, "allow")) throw new StartupError("policy");
  }
}
