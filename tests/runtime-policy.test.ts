import { expect, test } from "bun:test";
import { statSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseOptions } from "../src/cli-options.js";
import { createRuntimeEnvironment } from "../src/runtime-environment.js";
import {
  POLICY_PROFILES,
  parsePolicy,
  policyConfig,
  policySummary,
  type PolicyProfile,
} from "../src/runtime-policy.js";
import { validateAgentPermissions, validatePolicyDocument } from "../src/runtime-policy-check.js";
import { launchGateway } from "../src/server.js";
import { StartupError } from "../src/startup-error.js";

const env = { A2A_WORKSPACE: "/trusted" };
const parse = (...args: string[]) => parseOptions(args, env);
const message = (...args: string[]) => {
  try {
    parse(...args);
  } catch (error) {
    return error instanceof StartupError ? error.message : "other";
  }
  return "accepted";
};
const rejects = (args: string[], text: RegExp) => expect(message(...args)).toMatch(text);

test("CLI: default and explicit profiles, valueless acknowledgement", () => {
  expect(parse()).toEqual({ action: "run", server: { workspace: "/trusted", port: 41241 } });
  expect(parse("--policy", "read-only")).toMatchObject({ server: { policy: "read-only" } });
  expect(parse("--policy", "edit", "--permissions", "ask")).toMatchObject({
    server: { policy: "edit", executor: { permissions: "ask" } },
  });
  expect(parse("--policy", "full-access", "--dangerously-skip-permissions")).toMatchObject({
    server: { policy: "full-access", dangerouslySkipPermissions: true },
  });
  expect(
    parse("--dangerously-skip-permissions", "--policy", "full-access", "--permissions", "reject"),
  ).toMatchObject({ server: { policy: "full-access" } });
});

test("CLI: contradictory, unknown, duplicate and malformed combinations are rejected", () => {
  rejects(["--policy", "full-access"], /requires --dangerously-skip-permissions/);
  rejects(["--dangerously-skip-permissions"], /only with --policy full-access/);
  rejects(["--policy", "edit", "--dangerously-skip-permissions"], /only with --policy full-access/);
  rejects(["--policy", "read-only", "--dangerously-skip-permissions"], /only with/);
  rejects(
    ["--policy", "full-access", "--dangerously-skip-permissions", "--permissions", "ask"],
    /cannot combine/,
  );
  rejects(["--policy", "supervised", "--permissions", "ask"], /not available/);
  rejects(["--policy", "supervised"], /not available/);
  for (const bad of [
    ["--policy"],
    ["--policy", "yolo"],
    ["--policy", "unsafe"],
    ["--policy", "Edit"],
    ["--policy", "workspace-write"],
    ["--policy", "edit", "--policy", "edit"],
    ["--dangerously-skip-permissions", "true"],
    ["--dangerously-skip-permissions=true"],
    ["--policy=full-access", "--dangerously-skip-permissions"],
    ["--policy", "full-access", "--dangerously-skip-permissions", "--dangerously-skip-permissions"],
  ])
    rejects(bad, /Invalid arguments|requires|only with/);
});

test("CLI: --help and --version stay side-effect free even with policy flags", () => {
  expect(parse("--help", "--policy", "full-access")).toEqual({ action: "help" });
  expect(parse("--version")).toEqual({ action: "version" });
});

test("policy statements: ordered deny-then-allow, nothing broader than the profile", () => {
  const tool = (profile: PolicyProfile) =>
    policyConfig(profile)
      .policies.filter((item) => item.action === "tool.use" && item.effect === "allow")
      .map((item) => item.resource);
  expect(tool("read-only")).toEqual(["read:*", "glob:*", "grep:*"]);
  expect(tool("edit")).toEqual(["read:*", "glob:*", "grep:*", "edit:*"]);
  expect(policyConfig("read-only").policies.slice(0, 2)).toEqual([
    { action: "tool.use", resource: "*", effect: "deny" },
    { action: "websearch.use", resource: "*", effect: "deny" },
  ]);
  for (const profile of POLICY_PROFILES) {
    const policies = policyConfig(profile).policies;
    for (const action of ["mcp.use", "plugin.use", "skill.use"])
      expect(policies).toContainEqual({ action, resource: "*", effect: "deny" });
    expect(policyConfig(profile).agents.build.permissions).toEqual(
      policyConfig(profile).permissions,
    );
  }
  expect(tool("full-access")).toEqual(["*"]);
  expect(policyConfig("full-access").permissions).toEqual([
    { action: "*", resource: "*", effect: "allow" },
  ]);
  expect(policyConfig("supervised").permissions.at(-1)).toEqual({
    action: "shell",
    resource: "*",
    effect: "ask",
  });
  expect(JSON.stringify(policyConfig("read-only"))).not.toContain("shell");
  expect(
    policyConfig("edit").policies.some((item) => item.resource === "edit:*opencode.json"),
  ).toBe(true);
});

test("startup summary names policy, approvals, shell, blocked classes and no isolation", () => {
  expect(policySummary("read-only", "reject").join("\n")).toMatch(
    /read-only[\s\S]*approvals: reject[\s\S]*shell: denied[\s\S]*MCP, plugins, skills[\s\S]*OS isolation: none/,
  );
  expect(policySummary("full-access", "reject").join("\n")).toMatch(
    /shell: auto-approved with host-user/,
  );
  expect(policySummary("edit", "ask").join("\n")).toMatch(/any client of this port may approve/);
  expect(parsePolicy(undefined)).toBe("read-only");
});

test("private runtime writes the policy as an owner-only global config; none without a policy", () => {
  const runtime = createRuntimeEnvironment([], { PATH: "/usr/bin" }, "edit");
  try {
    const file = join(runtime.env.XDG_CONFIG_HOME!, "opencode", "opencode.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(runtime.env.XDG_CONFIG_HOME!, "opencode")).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(
      JSON.parse(JSON.stringify(policyConfig("edit"))),
    );
  } finally {
    runtime.remove();
  }
  const plain = createRuntimeEnvironment([], { PATH: "/usr/bin" });
  try {
    expect(() => statSync(join(plain.env.XDG_CONFIG_HOME!, "opencode"))).toThrow();
  } finally {
    rmSync(plain.root, { recursive: true });
  }
});

test("preflight: dropped, altered or missing policy statements fail closed", () => {
  const runtime = createRuntimeEnvironment([], { PATH: "/usr/bin" }, "read-only");
  try {
    const path = join(runtime.root, "home", ".config", "opencode", "opencode.json");
    const listing = (info: unknown) => JSON.stringify([{ type: "document", path, info }]);
    const config = policyConfig("read-only");
    expect(() => validatePolicyDocument(listing(config), runtime.root, "read-only")).not.toThrow();
    const dropped = { ...config, policies: config.policies.slice(1) };
    for (const info of [
      dropped,
      { ...config, permissions: [] },
      { ...config, agents: {} },
      {},
      null,
    ])
      expect(() => validatePolicyDocument(listing(info), runtime.root, "read-only")).toThrow(
        /capability policy/,
      );
    expect(() => validatePolicyDocument(listing(config), runtime.root, "edit")).toThrow(
      /capability policy/,
    );
    expect(() => validatePolicyDocument("[]", runtime.root, "read-only")).toThrow(
      /capability policy/,
    );
  } finally {
    runtime.remove();
  }
});

test("preflight: effective agent rules must deny Code Mode; last matching rule wins", () => {
  const agents = (...rules: [string, string, string][]) =>
    JSON.stringify([
      {
        id: "build",
        permissions: rules.map(([action, resource, effect]) => ({ action, resource, effect })),
      },
    ]);
  const base: [string, string, string] = ["*", "*", "allow"];
  expect(() =>
    validateAgentPermissions(agents(base, ["execute", "*", "deny"]), "read-only"),
  ).not.toThrow();
  expect(() => validateAgentPermissions(agents(base, ["*", "*", "deny"]), "edit")).not.toThrow();
  for (const bad of [
    agents(base),
    agents(["execute", "*", "deny"], ["*", "*", "allow"]),
    agents(["execute", "*", "deny"], ["exec*", "*", "ask"]),
    agents(),
    "[]",
    JSON.stringify([{ id: "x" }]),
  ])
    expect(() => validateAgentPermissions(bad, "read-only")).toThrow(/capability policy/);
  expect(() => validateAgentPermissions(agents(base), "full-access")).not.toThrow();
  expect(() =>
    validateAgentPermissions(agents(["*", "*", "deny"], ["shell", "*", "allow"]), "supervised"),
  ).toThrow(/capability policy/);
});

test("launchGateway rejects contradictory policy options before any runtime exists", async () => {
  const workspace = "/tmp";
  await expect(launchGateway({ workspace, policy: "full-access" })).rejects.toThrow(
    /requires --dangerously/,
  );
  await expect(launchGateway({ workspace, dangerouslySkipPermissions: true })).rejects.toThrow(
    /only with/,
  );
  await expect(
    launchGateway({
      workspace,
      policy: "full-access",
      dangerouslySkipPermissions: true,
      executor: { permissions: "ask" },
    }),
  ).rejects.toThrow(/cannot combine/);
  await expect(launchGateway({ workspace, policy: "edit", acp: { env: {} } })).rejects.toThrow(
    /cannot combine/,
  );
});
