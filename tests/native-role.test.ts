import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadNativeRole,
  MAX_SYSTEM_PROMPT_BYTES,
  rejectRoleCollision,
  STANDALONE_AGENT,
  validateNativeRole,
} from "../src/native-role.js";
import { parseOptions } from "../src/cli-options.js";
import { policyConfig } from "../src/runtime-policy.js";
import { validateAgentPermissions } from "../src/runtime-policy-check.js";
import { verifyMode } from "../src/acp-role.js";
import { launchGateway } from "../src/server.js";

const roots: string[] = [];
const directory = () => {
  const root = mkdtempSync(join(tmpdir(), "native-role-test-"));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("CLI role flags are startup-only, mutually exclusive and incompatible with resume", () => {
  for (const args of [
    ["--agent", "a", "--system-prompt-file", "p"],
    ["--agent", "a", "--enable", "resume"],
    ["--system-prompt-file", "p", "--enable", "resume"],
    ["--agent", " "],
    ["--agent", "bad\nname"],
    ["--agent", "a", "--agent", "b"],
  ])
    expect(() => parseOptions(args, {}, "/workspace")).toThrow();
  expect(parseOptions(["--agent", "team/architect"], {}, "/workspace")).toEqual({
    action: "run",
    server: { workspace: "/workspace", port: 41241, agent: "team/architect" },
  });
  expect(parseOptions(["--system-prompt-file", "p.md"], {}, "/workspace")).toEqual({
    action: "run",
    server: { workspace: "/workspace", port: 41241, systemPromptFile: "/workspace/p.md" },
  });
  expect(loadNativeRole()).toBeUndefined();
});

test("prompt files are bounded, strict UTF-8 regular files and errors never contain their text/path", () => {
  const root = directory();
  const file = join(root, "private-prompt");
  for (const content of [
    "",
    " \n\t",
    "\0secret",
    Buffer.from([0xc3, 0x28]),
    "x".repeat(MAX_SYSTEM_PROMPT_BYTES + 1),
  ]) {
    writeFileSync(file, content);
    expect(() => loadNativeRole(undefined, file)).toThrow("UTF-8");
    try {
      loadNativeRole(undefined, file);
    } catch (error) {
      expect(String(error)).not.toContain(file);
      expect(String(error)).not.toContain("secret");
    }
  }
  expect(() => loadNativeRole(undefined, root)).toThrow("regular file");
  expect(() => loadNativeRole(undefined, join(root, "missing"))).toThrow("readable");
  writeFileSync(file, "x".repeat(MAX_SYSTEM_PROMPT_BYTES));
  expect(loadNativeRole(undefined, file)?.system?.length).toBe(MAX_SYSTEM_PROMPT_BYTES);
  writeFileSync(file, "  Role α\n");
  expect(loadNativeRole(undefined, file)).toEqual({ id: STANDALONE_AGENT, system: "  Role α\n" });
  chmodSync(file, 0);
  if (process.getuid?.() !== 0) expect(() => loadNativeRole(undefined, file)).toThrow("readable");
  chmodSync(file, 0o600);
});

test("effective role rejects hidden, missing, subagent and prompt overrides", () => {
  const role = { id: "architect", system: "private role" };
  const agent = { id: role.id, mode: "primary", hidden: false, system: role.system };
  expect(() => validateNativeRole(JSON.stringify([agent]), role)).not.toThrow();
  for (const agents of [
    [],
    [{ ...agent, hidden: true }],
    [{ ...agent, mode: "subagent" }],
    [{ ...agent, mode: ["primary"] }],
    [{ ...agent, system: "override" }],
  ])
    expect(() => validateNativeRole(JSON.stringify(agents), role)).toThrow("Native role");
  expect(() => validateNativeRole(JSON.stringify([{ ...agent, mode: "all" }]), role)).not.toThrow();
});

test("standalone role document and markdown collisions reject even an identical prompt", () => {
  const root = directory();
  const role = { id: STANDALONE_AGENT, system: "private role" };
  const source = {
    type: "document",
    path: "/workspace/opencode.json",
    info: { agents: { [role.id]: { system: role.system } } },
  };
  expect(() => rejectRoleCollision(JSON.stringify([source]), role, "/private/config")).toThrow(
    "Native role",
  );
  expect(() => rejectRoleCollision(JSON.stringify([source]), role, source.path)).not.toThrow();
  mkdirSync(join(root, "agents"));
  writeFileSync(join(root, "agents", `${role.id}.md`), role.system);
  expect(() =>
    rejectRoleCollision(
      JSON.stringify([{ type: "directory", path: root }]),
      role,
      "/private/config",
    ),
  ).toThrow("Native role");
});

test("standalone role inherits policy, and project role permissions cannot reopen protected boundaries", () => {
  const config = policyConfig("read-only", [], { id: STANDALONE_AGENT, system: "private" });
  expect(config.agents[STANDALONE_AGENT]?.permissions).toEqual([
    { action: "*", resource: "*", effect: "deny" },
    { action: "read", resource: "*", effect: "allow" },
    { action: "glob", resource: "*", effect: "allow" },
    { action: "grep", resource: "*", effect: "allow" },
    { action: "read", resource: "*.env", effect: "ask" },
    { action: "read", resource: "*.env.*", effect: "ask" },
    { action: "read", resource: "*.env.example", effect: "allow" },
  ]);
  const agent = {
    id: STANDALONE_AGENT,
    mode: "primary",
    hidden: false,
    permissions: config.permissions,
  };
  expect(() => validateAgentPermissions(JSON.stringify([agent]), "read-only")).not.toThrow();
  for (const action of ["execute", "external_directory"])
    expect(() =>
      validateAgentPermissions(
        JSON.stringify([
          {
            ...agent,
            permissions: [...config.permissions, { action, resource: "*", effect: "allow" }],
          },
        ]),
        "read-only",
      ),
    ).toThrow("capability policy");
});

test("ACP selector rejects missing catalog, missing choice and mismatched current selection", () => {
  const mode = {
    id: "mode",
    name: "Mode",
    type: "select" as const,
    currentValue: "build",
    options: [{ value: "architect", name: "Architect" }],
  };
  expect(() => verifyMode([mode], "architect")).not.toThrow();
  expect(() => verifyMode([mode], "architect", true)).toThrow("Native role");
  expect(() => verifyMode(undefined, "architect")).toThrow("Native role");
  expect(() => verifyMode([mode], "missing")).toThrow("Native role");
  expect(() => verifyMode([mode, mode], "architect")).toThrow("Native role");
});

test("library launch refuses role/environment ambiguity before touching runtime state", async () => {
  await expect(
    launchGateway({ workspace: "/missing", agent: "a", acp: { env: {} } }),
  ).rejects.toThrow("private runtime");
  await expect(
    launchGateway({
      workspace: "/missing",
      systemPromptFile: "/missing",
      executor: { resume: true },
    }),
  ).rejects.toThrow("resume");
});
