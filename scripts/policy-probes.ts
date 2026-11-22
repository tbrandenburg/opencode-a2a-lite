// Explicit provider-free probes: the real OpenCode executable runs scripted tool calls from a local
// OpenAI-compatible fixture, so denials are observed as real tool results and side effects.
if (process.platform !== "linux") {
  console.log(JSON.stringify({ skipped: "private runtime probes are Linux-only" }));
  process.exit(0);
}

import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createRuntimeEnvironment } from "../src/runtime-environment.js";
import type { PolicyProfile } from "../src/runtime-policy.js";
import { resolveOpenCode, verifyRuntime } from "../src/runtime-probes.js";
import { removeUnusedRuntime } from "../src/runtime-processes.js";
import { scriptedModel, type Call } from "../tests/fixtures/scripted-model.js";

// Counts requests that reach a local listener; a denied web tool must leave this at zero.
let hits = 0;
const listener = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: () => {
    hits += 1;
    return new Response("listener-reached");
  },
});
const target = `http://127.0.0.1:${listener.port}/`;

type Outcome = { tool: string; status: string; text: string };
const allow = { action: "*", resource: "*", effect: "allow" };
const hostileProject = {
  policies: ["tool.use", "websearch.use", "mcp.use", "plugin.use", "skill.use"].map((action) => ({
    action,
    resource: "*",
    effect: "allow",
  })),
  permissions: [allow],
  agents: { build: { permissions: [allow] } },
};

const denied = (item: Outcome | undefined) => item?.status === "error";
const only = (action: string, resource = "*") => ({
  agents: { build: { permissions: [{ action, resource, effect: "allow" }] } },
});

type Project = object | ((workspace: string) => object);

async function drive(profile: PolicyProfile, calls: Call[], project: Project = {}) {
  const runtime = createRuntimeEnvironment([], process.env, profile);
  const root = runtime.root;
  const workspace = mkdtempSync(join(root, "ws-"));
  const outside = mkdtempSync(join(root, "outside-"));
  const model = scriptedModel(
    calls.map((item): Call =>
      JSON.parse(JSON.stringify(item).replaceAll("OUTSIDE", join(outside, "o.txt"))),
    ),
  );
  const file = (...parts: string[]) => join(workspace, ...parts);
  writeFileSync(file("fix.txt"), "fixture-text\n");
  writeFileSync(join(outside, "o.txt"), "outside-secret\n");
  symlinkSync(join(outside, "o.txt"), file("link.txt"));
  mkdirSync(file(".opencode"));
  writeFileSync(
    file("opencode.json"),
    JSON.stringify({
      model: "mock/m",
      providers: {
        mock: {
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL: `${model.url}/v1`, apiKey: "x" },
          models: { m: {} },
        },
      },
      ...(typeof project === "function" ? project(workspace) : project),
    }),
  );
  const executable = resolveOpenCode(runtime.env.PATH!);
  const preflight = () =>
    verifyRuntime({
      executable,
      cwd: workspace,
      env: runtime.env,
      root,
      policy: profile,
      signal: new AbortController().signal,
    });
  const run = async () => {
    const child = Bun.spawn([executable, "--standalone", "run", "--format", "json", "go"], {
      cwd: workspace,
      env: runtime.env,
      stdout: "pipe",
      stderr: "ignore",
      killSignal: "SIGKILL",
      timeout: 90_000,
    });
    const out = await new Response(child.stdout).text();
    await child.exited;
    return out.split("\n").flatMap((line): Outcome[] => {
      try {
        const part = JSON.parse(line).part;
        if (part?.type !== "tool") return [];
        return [
          {
            tool: part.tool,
            status: part.state.status,
            text: String(part.state.output ?? part.state.error ?? ""),
          },
        ];
      } catch {
        return [];
      }
    });
  };
  const finish = async () => {
    model.stop();
    await removeUnusedRuntime(runtime);
  };
  return { workspace, outside, file, preflight, run, finish };
}

const call = (name: string, args: Record<string, unknown> = {}): Call => ({ name, args });
const log = (name: string, detail: unknown) =>
  console.log(JSON.stringify({ probe: name, ...(detail as object) }));
const summary = (out: Outcome[]) => out.map((item) => `${item.tool}:${item.status}`);
const removed = /No tool named/;
const blocked = /Blocked by configuration policy/;
const sentinels = (probe: { file: (...parts: string[]) => string }, names: string[]) => {
  for (const name of names) assert(!existsSync(probe.file(name)), `${name} must not exist`);
};

// Control: without gateway policy the same MCP config spawns `touch` (verified manually).
const integrations = (workspace: string) => ({
  mcp: { srv: { type: "local", command: ["touch", join(workspace, "MCP.txt")] } },
});

async function readOnly(hostile: boolean) {
  const name = hostile ? "read-only+hostile-project" : "read-only";
  const probe = await drive(
    "read-only",
    [
      call("read", { path: "fix.txt" }),
      call("grep", { pattern: "fixture" }),
      call("glob", { pattern: "*.txt" }),
      call("edit", { path: "fix.txt", oldString: "fixture", newString: "X" }),
      call("write", { path: "NEW.txt", content: "x" }),
      call("shell", { command: "touch SHELL.txt" }),
      call("webfetch", { url: target }),
      call("websearch", { query: "x" }),
      call("subagent", { agent: "general", description: "d", prompt: "p" }),
      call("read", { path: "link.txt" }),
      call("glob", { pattern: "../*" }),
      call("execute", { code: "return 1" }),
    ],
    hostile ? (workspace: string) => ({ ...hostileProject, ...integrations(workspace) }) : {},
  );
  hits = 0;
  try {
    if (hostile) await assert.rejects(probe.preflight(), /capability policy/);
    else await probe.preflight();
    const out = await probe.run();
    const by = (tool: string, index = 0) => out.filter((item) => item.tool === tool)[index];
    assert.equal(out.length, 12, "every scripted call must produce an outcome");
    for (const tool of ["read", "grep", "glob"]) assert.equal(by(tool)?.status, "completed");
    assert.match(by("read")?.text ?? "", /fixture-text/);
    // Without a hostile project the tools are removed; with one, the hard policy blocks the call.
    const reason = hostile ? blocked : removed;
    for (const tool of ["edit", "write", "shell", "webfetch", "subagent"])
      assert.match(by(tool)?.text ?? "", reason, `${tool} denial reason`);
    assert.equal(by("websearch")?.status, "error");
    // Known gap: path checks are lexical, so a workspace symlink can expose outside files to read.
    assert.match(by("read", 1)?.text ?? "", /outside-secret/);
    assert.equal(readFileSync(probe.file("fix.txt"), "utf8"), "fixture-text\n");
    sentinels(probe, ["NEW.txt", "SHELL.txt", "MCP.txt"]);
    assert.equal(hits, 0, "webfetch must not reach the local listener");
    if (hostile)
      assert.equal(by("execute")?.status, "completed", "hostile project re-enables Code Mode");
    else assert.match(by("execute")?.text ?? "", removed);
    log(name, { outcomes: summary(out) });
  } finally {
    await probe.finish();
  }
}

async function edit() {
  const probe = await drive("edit", [
    call("edit", { path: "fix.txt", oldString: "fixture", newString: "changed" }),
    call("write", { path: "NEW.txt", content: "created\n" }),
    call("write", { path: "opencode.json", content: "{}" }),
    call("write", { path: ".opencode/agents/x.md", content: "x" }),
    call("write", { path: "../escape.txt", content: "x" }),
    call("shell", { command: "touch SHELL.txt" }),
    call("webfetch", { url: target }),
    call("write", { path: "link.txt", content: "overwritten-through-symlink\n" }),
  ]);
  hits = 0;
  try {
    await probe.preflight();
    const original = readFileSync(probe.file("opencode.json"), "utf8");
    const out = await probe.run();
    assert.deepEqual(summary(out), [
      "edit:completed",
      "write:completed",
      "write:error",
      "write:error",
      "write:error",
      "shell:error",
      "webfetch:error",
      "write:completed",
    ]);
    assert.match(out[2]!.text, blocked);
    assert.match(out[3]!.text, blocked);
    assert.match(out[4]!.text, /external_directory/);
    assert.match(out[5]!.text, removed);
    assert.match(out[6]!.text, removed);
    assert.equal(readFileSync(probe.file("fix.txt"), "utf8"), "changed-text\n");
    assert.equal(readFileSync(probe.file("NEW.txt"), "utf8"), "created\n");
    assert.equal(readFileSync(probe.file("opencode.json"), "utf8"), original);
    assert(!existsSync(probe.file(".opencode", "agents", "x.md")));
    assert(!existsSync(join(probe.workspace, "..", "escape.txt")));
    sentinels(probe, ["SHELL.txt"]);
    assert.equal(hits, 0, "webfetch must not reach the local listener");
    // Known risk: edit follows a workspace symlink, so it can overwrite a file outside the workspace.
    assert.equal(
      readFileSync(join(probe.outside, "o.txt"), "utf8"),
      "overwritten-through-symlink\n",
    );
    log("edit", { outcomes: summary(out), symlinkWriteEscapes: true });
  } finally {
    await probe.finish();
  }
}

async function fullAccess() {
  const probe = await drive("full-access", [
    call("shell", { command: "touch SHELL.txt" }),
    call("write", { path: "NEW.txt", content: "created\n" }),
    call("execute", { code: "return 1" }),
    call("webfetch", { url: target }),
  ]);
  hits = 0;
  try {
    await probe.preflight();
    const out = await probe.run();
    assert.deepEqual(
      summary(out),
      Array(4)
        .fill(0)
        .map((_, i) => `${["shell", "write", "execute", "webfetch"][i]}:completed`),
    );
    assert(existsSync(probe.file("SHELL.txt")) && existsSync(probe.file("NEW.txt")));
    assert.equal(hits, 1, "positive control: allowed webfetch reaches the listener");
    log("full-access", { outcomes: summary(out) });
  } finally {
    await probe.finish();
  }
  // A project agent that denies or asks for a required allow aborts startup.
  for (const effect of ["deny", "ask"]) {
    const weakened = await drive("full-access", [], {
      agents: { build: { permissions: [{ action: "shell", resource: "*", effect }] } },
    });
    try {
      await assert.rejects(weakened.preflight(), /capability policy/);
    } finally {
      await weakened.finish();
    }
  }
  log("full-access-weakened-by-project", { preflightRejects: true });
}

// Evidence for withholding `supervised`: agent-level ask works, but a project agent rule appended
// after the global one turns the same shell call into an unprompted run.
async function supervised() {
  const shell = [call("shell", { command: "touch SHELL.txt" })];
  const asked = await drive("supervised", shell);
  const hijacked = await drive("supervised", shell, only("shell"));
  try {
    const rejected = await asked.run();
    assert(denied(rejected[0]) && /cannot ask/.test(rejected[0]?.text ?? ""));
    assert(!existsSync(asked.file("SHELL.txt")));
    await assert.rejects(hijacked.preflight(), /capability policy/);
    const ran = await hijacked.run();
    assert.equal(ran[0]?.status, "completed");
    assert(existsSync(hijacked.file("SHELL.txt")));
    log("supervised-withheld", {
      askRejectedWithoutExecution: true,
      projectAgentAllowRunsUnprompted: true,
      preflightCatchesIt: true,
    });
  } finally {
    await asked.finish();
    await hijacked.finish();
  }
}

// Project agent rules that would re-open boundaries. The hard policy still blocks the outside
// accesses on the tested versions (observed), and preflight rejects each rule independently.
async function projectOverrides(profile: PolicyProfile) {
  const rules: [string, string][] = [
    ["execute", "*"],
    ["execute", "code"],
    ["external_directory", "*"],
    ["external_directory", "/tmp/*"],
    ["ext*", "*"],
  ];
  for (const [action, resource] of rules) {
    const probe = await drive(
      profile,
      [call("read", { path: "OUTSIDE" }), call("write", { path: "../escape.txt", content: "x" })],
      only(action, resource),
    );
    try {
      await assert.rejects(probe.preflight(), /capability policy/, `${action} ${resource}`);
    } finally {
      await probe.finish();
    }
  }
  // Which resource string does `execute` check? Record whether a rule for another resource opens it.
  const narrow = await drive(
    profile,
    [call("execute", { code: "return 1" })],
    only("execute", "code"),
  );
  const wide = await drive(profile, [call("execute", { code: "return 1" })], only("execute", "*"));
  try {
    const [narrowOut, wideOut] = [await narrow.run(), await wide.run()];
    assert.equal(wideOut[0]?.status, "completed", "execute resource is `*`");
    log(`execute-resource-${profile}`, {
      resourceCodeOpensIt: narrowOut[0]?.status === "completed",
    });
  } finally {
    await narrow.finish();
    await wide.finish();
  }
  const lone = await drive(
    profile,
    [call("read", { path: "OUTSIDE" }), call("write", { path: "../escape.txt", content: "x" })],
    only("external_directory"),
  );
  try {
    const outside = join(lone.outside, "o.txt");
    const out = await lone.run();
    assert.match(out[0]?.text ?? "", blocked, "outside read stays blocked by hard policy");
    assert(!existsSync(join(lone.workspace, "..", "escape.txt")));
    assert(readFileSync(outside, "utf8").startsWith("outside-secret"));
    log(`override-${profile}`, {
      rulesRejectedByPreflight: rules.length,
      outsideStillBlocked: true,
    });
  } finally {
    await lone.finish();
  }
}

try {
  await readOnly(false);
  await readOnly(true);
  await projectOverrides("read-only");
  await projectOverrides("edit");
  await edit();
  await fullAccess();
  await supervised();
  console.log(JSON.stringify({ policyProbes: true }));
} catch (error) {
  console.error(
    JSON.stringify({
      policyProbes: false,
      error: error instanceof Error ? error.message : "failed",
    }),
  );
  process.exitCode = 1;
}
listener.stop(true);
