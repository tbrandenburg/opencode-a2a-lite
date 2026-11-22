import { afterAll, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOptions } from "../src/cli-options.js";
import { loadPolicyFile, parsePolicyFile } from "../src/policy-file.js";
import { policyConfig } from "../src/runtime-policy.js";
import { validateAgentPermissions } from "../src/runtime-policy-check.js";
import { StartupError } from "../src/startup-error.js";

const base = realpathSync(mkdtempSync(join(tmpdir(), "policy-file-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const workspace = join(base, "ws");
const admin = join(base, "admin");
mkdirSync(workspace);
mkdirSync(admin, { mode: 0o700 });

const doc = (policies: unknown[], extra: object = {}) =>
  JSON.stringify({ version: 1, base: "read-only", policies, ...extra });
const allow = (action: string, resource: string) => ({
  action,
  resource,
  effect: "allow" as const,
});
const write = (name: string, text: string, mode = 0o600) => {
  const file = join(admin, name);
  writeFileSync(file, text, { mode });
  chmodSync(file, mode);
  return file;
};
const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof StartupError ? error.message.slice(0, 40) : "other";
  }
  return "accepted";
};

test("schema: exact reviewed allows load in deterministic order", () => {
  const file = parsePolicyFile(
    doc([
      allow("skill.use", "repo-audit"),
      allow("tool.use", "docs_search:*"),
      allow("mcp.use", "docs"),
      allow("plugin.use", "opencode-acme-cli"),
    ]),
    workspace,
  );
  expect(file.exceptions.map((item) => item.action)).toEqual([
    "mcp.use",
    "tool.use",
    "skill.use",
    "plugin.use",
  ]);
});

test.each([
  ["unknown top-level field", doc([], { extra: 1 })],
  ["wrong version", JSON.stringify({ version: 2, base: "read-only", policies: [] })],
  ["supervised base", doc([], { base: "supervised" })],
  ["unknown base", doc([], { base: "yolo" })],
  ["not JSON", "{"],
  ["array root", "[]"],
  ["deny effect", doc([{ action: "mcp.use", resource: "a", effect: "deny" }])],
  ["unknown field", doc([{ ...allow("mcp.use", "a"), note: "x" }])],
  ["unknown action", doc([allow("provider.use", "openai")])],
  ["websearch", doc([allow("websearch.use", "exa")])],
  ["wildcard mcp", doc([allow("mcp.use", "*")])],
  ["pattern mcp", doc([allow("mcp.use", "doc*")])],
  ["question mark", doc([allow("skill.use", "a?")])],
  ["env substitution", doc([allow("mcp.use", "${HOME}")])],
  ["url plugin", doc([allow("plugin.use", "https://example.test/p.js")])],
  ["credential-like text", doc([allow("mcp.use", "key=sk-123")])],
  ["shell tool", doc([allow("tool.use", "shell:*")])],
  ["shell command", doc([allow("tool.use", "shell:git status *")])],
  ["edit tool", doc([allow("tool.use", "edit:*")])],
  ["global tool wildcard", doc([allow("tool.use", "*")])],
  ["tool without server", doc([allow("tool.use", "docs_search:*")])],
  ["reserved server", doc([allow("mcp.use", "shell")])],
  [
    "external_directory collision",
    doc([allow("mcp.use", "external"), allow("tool.use", "external_directory:*")]),
  ],
  ["apply_patch collision", doc([allow("mcp.use", "apply"), allow("tool.use", "apply_patch:*")])],
  ["todo_write collision", doc([allow("mcp.use", "todo"), allow("tool.use", "todo_write:*")])],
  ["relative plugin path", doc([allow("plugin.use", "./p.js")])],
  ["plugin path traversal", doc([allow("plugin.use", "/opt/../etc/p.js")])],
  ["plugin inside workspace", doc([allow("plugin.use", join(workspace, "p.js"))])],
  ["duplicate", doc([allow("mcp.use", "a"), allow("mcp.use", "a")])],
  ["too many", doc(Array.from({ length: 33 }, (_, i) => allow("mcp.use", `s${i}`)))],
])("schema rejects %s", (_name, text) => {
  expect(code(() => parsePolicyFile(text, workspace))).toMatch(/--policy-file reject/);
});

test("trust: accepts a private file and rejects unsafe placements", () => {
  const good = write("good.json", doc([allow("mcp.use", "docs")]));
  expect(loadPolicyFile(good, workspace, "read-only").exceptions).toHaveLength(1);
  expect(code(() => loadPolicyFile(good, workspace, "edit"))).toMatch(/base must equal/);
  expect(code(() => loadPolicyFile("rel.json", workspace, "read-only"))).toMatch(/reject/);
  expect(code(() => loadPolicyFile(join(admin, "missing.json"), workspace, "read-only"))).toMatch(
    /reject/,
  );
  const link = join(admin, "link.json");
  symlinkSync(good, link);
  expect(code(() => loadPolicyFile(link, workspace, "read-only"))).toMatch(/reject/);
  for (const mode of [0o620, 0o602, 0o666])
    expect(
      code(() => loadPolicyFile(write("w.json", doc([]), mode), workspace, "read-only")),
    ).toMatch(/reject/);
  const inside = join(workspace, "p.json");
  writeFileSync(inside, doc([]), { mode: 0o600 });
  expect(code(() => loadPolicyFile(inside, workspace, "read-only"))).toMatch(/reject/);
  const shared = join(base, "shared");
  mkdirSync(shared, { mode: 0o777 });
  chmodSync(shared, 0o777);
  writeFileSync(join(shared, "p.json"), doc([]), { mode: 0o600 });
  expect(code(() => loadPolicyFile(join(shared, "p.json"), workspace, "read-only"))).toMatch(
    /reject/,
  );
  const real = join(base, "real");
  mkdirSync(real, { mode: 0o700 });
  writeFileSync(join(real, "p.json"), doc([]), { mode: 0o600 });
  symlinkSync(real, join(base, "viadir"));
  expect(
    code(() => loadPolicyFile(join(base, "viadir", "p.json"), workspace, "read-only")),
  ).toMatch(/reject/);
});

test("CLI: file flag needs an absolute path; a full-access base never upgrades the profile", () => {
  const env = { A2A_WORKSPACE: "/trusted" };
  expect(parseOptions(["--policy-file", "/etc/x.json"], env)).toMatchObject({
    server: { policyFile: "/etc/x.json" },
  });
  for (const value of ["x.json", "/a/../b.json"])
    expect(code(() => parseOptions(["--policy-file", value], env))).toMatch(/reject/);
  expect(() => parseOptions(["--policy-file"], env)).toThrow();
  expect(() => parseOptions(["--policy-file", "/a", "--policy-file", "/b"], env)).toThrow();
  const full = write("full.json", doc([], { base: "full-access" }));
  expect(code(() => loadPolicyFile(full, workspace, "read-only"))).toMatch(/base must equal/);
});

test("generated config: exceptions follow the base; tool and skill add their usable pair", () => {
  const exceptions = parsePolicyFile(
    doc([
      allow("mcp.use", "docs"),
      allow("tool.use", "docs_search:*"),
      allow("skill.use", "audit"),
    ]),
    workspace,
  ).exceptions;
  const plain = policyConfig("read-only");
  const config = policyConfig("read-only", exceptions);
  expect(config.policies.slice(0, plain.policies.length)).toEqual(plain.policies);
  expect(config.policies.slice(plain.policies.length)).toEqual([
    allow("mcp.use", "docs"),
    allow("tool.use", "docs_search:*"),
    allow("skill.use", "audit"),
    allow("tool.use", "skill:audit"),
  ]);
  expect(config.agents.build.permissions.slice(-2)).toEqual([
    allow("docs_search", "*"),
    allow("skill", "audit"),
  ]);
  expect(JSON.stringify(policyConfig("read-only", []))).toBe(JSON.stringify(plain));
});

test("preflight: an agent-level deny after an exception fails closed", () => {
  const exceptions = parsePolicyFile(
    doc([allow("mcp.use", "docs"), allow("tool.use", "docs_search:*")]),
    workspace,
  ).exceptions;
  const rules = (...tail: object[]) => [
    ...policyConfig("read-only", exceptions).permissions,
    { action: "execute", resource: "*", effect: "deny" },
    { action: "external_directory", resource: "*", effect: "deny" },
    ...tail,
  ];
  const agents = (list: object[]) => JSON.stringify([{ name: "build", permissions: list }]);
  expect(() => validateAgentPermissions(agents(rules()), "read-only", exceptions)).not.toThrow();
  const denied = { action: "docs_search", resource: "*", effect: "deny" };
  expect(() => validateAgentPermissions(agents(rules(denied)), "read-only", exceptions)).toThrow();
  const missing = policyConfig("read-only").permissions;
  expect(() => validateAgentPermissions(agents([...missing]), "read-only", exceptions)).toThrow();
});

test("plugin path through a symlink into the workspace is rejected", () => {
  const target = join(workspace, "plugin.js");
  writeFileSync(target, "x");
  const link = join(admin, "plugin-link.js");
  symlinkSync(target, link);
  expect(code(() => parsePolicyFile(doc([allow("plugin.use", link)]), workspace))).toMatch(
    /--policy-file reject/,
  );
});

test("a non-colliding composed tool name is still accepted", () => {
  expect(
    parsePolicyFile(
      doc([allow("mcp.use", "external"), allow("tool.use", "external_search:*")]),
      workspace,
    ).exceptions,
  ).toHaveLength(2);
});
