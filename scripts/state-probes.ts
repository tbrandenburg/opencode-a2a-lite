// Real-OpenCode probes (scripted local model, no provider) for operator exceptions and persistent
// state: named MCP/skill exceptions work and stay narrow, and state created under full-access
// cannot lift a later read-only launch.
if (process.platform !== "linux") {
  console.log(JSON.stringify({ skipped: "private runtime probes are Linux-only" }));
  process.exit(0);
}

import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parsePolicyFile, type Exception } from "../src/policy-file.js";
import { createRuntimeEnvironment } from "../src/runtime-environment.js";
import type { PolicyProfile } from "../src/runtime-policy.js";
import { resolveOpenCode, verifyRuntime } from "../src/runtime-probes.js";
import { removeUnusedRuntime } from "../src/runtime-processes.js";
import { acquireState } from "../src/state-dir.js";
import { scriptedModel, type Call } from "../tests/fixtures/scripted-model.js";

type Outcome = { tool: string; status: string; text: string };
const call = (name: string, args: Record<string, unknown> = {}): Call => ({ name, args });
const log = (name: string, detail: object) =>
  console.log(JSON.stringify({ probe: name, ...detail }));
const scratch = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "state-probes-")));
const workspace = join(scratch, "ws");
mkdirSync(join(workspace, ".opencode", "skills", "demo"), { recursive: true });
writeFileSync(
  join(workspace, ".opencode", "skills", "demo", "SKILL.md"),
  "---\nname: demo\ndescription: demo skill\n---\nbody-of-skill\n",
);
const mcp = (name: string) => ({
  type: "local",
  command: [
    process.execPath,
    join(import.meta.dir, "../tests/fixtures/mcp-fixture.ts"),
    join(workspace, name),
  ],
});

async function launch(
  profile: PolicyProfile,
  calls: Call[],
  options: {
    exceptions?: readonly Exception[];
    state?: string;
    project?: object;
    session?: string;
  } = {},
) {
  const state = options.state ? acquireState(options.state, workspace) : undefined;
  const runtime = createRuntimeEnvironment([], process.env, profile, {
    ...(options.exceptions ? { exceptions: options.exceptions } : {}),
    ...(state ? { data: state.data } : {}),
  });
  const model = scriptedModel(calls);
  writeFileSync(
    join(workspace, "opencode.json"),
    JSON.stringify({
      model: "mock/m",
      providers: {
        mock: {
          package: "@opencode/ai/providers/openai-compatible",
          settings: { baseURL: `${model.url}/v1`, apiKey: "x" },
          models: { m: {} },
        },
      },
      mcp: { fx: mcp("FX"), rogue: mcp("ROGUE") },
      ...options.project,
    }),
  );
  const executable = resolveOpenCode(runtime.env.PATH!);
  const preflight = () =>
    verifyRuntime({
      executable,
      cwd: workspace,
      env: runtime.env,
      root: runtime.root,
      policy: profile,
      ...(options.exceptions ? { exceptions: options.exceptions } : {}),
      ...(state ? { data: state.data } : {}),
      signal: new AbortController().signal,
    });
  const run = async () => {
    const args = [
      "--standalone",
      "run",
      "--format",
      "json",
      ...(options.session ? ["--session", options.session] : []),
      "go",
    ];
    const child = Bun.spawn([executable, ...args], {
      cwd: workspace,
      env: runtime.env,
      stdout: "pipe",
      stderr: "ignore",
      killSignal: "SIGKILL",
      timeout: 90_000,
    });
    const out = await new Response(child.stdout).text();
    await child.exited;
    const lines = out.split("\n").flatMap((line): Record<string, unknown>[] => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
    const outcomes = lines.flatMap((line): Outcome[] => {
      const part = line.part as
        | {
            type?: string;
            tool: string;
            state: { status: string; output?: unknown; error?: unknown };
          }
        | undefined;
      return part?.type === "tool"
        ? [
            {
              tool: part.tool,
              status: part.state.status,
              text: String(part.state.output ?? part.state.error ?? ""),
            },
          ]
        : [];
    });
    return { outcomes, session: String(lines.find((line) => line.sessionID)?.sessionID ?? "") };
  };
  const finish = async () => {
    model.stop();
    await removeUnusedRuntime(runtime);
    state?.release();
  };
  return { preflight, run, finish };
}

const exceptions = parsePolicyFile(
  JSON.stringify({
    version: 1,
    base: "read-only",
    policies: [
      { action: "mcp.use", resource: "fx", effect: "allow" },
      { action: "tool.use", resource: "fx_ping:*", effect: "allow" },
      { action: "skill.use", resource: "demo", effect: "allow" },
    ],
  }),
  workspace,
).exceptions;
const status = (items: Outcome[]) => items.map((item) => `${item.tool}:${item.status}`);

async function named() {
  const script = [
    call("fx_ping"),
    call("fx_other"),
    call("rogue_ping"),
    call("skill", { id: "demo" }),
    call("shell", { command: "touch SHELL.txt" }),
  ];
  const without = await launch("read-only", script);
  const allowed = await launch("read-only", script, { exceptions });
  try {
    const before = (await without.run()).outcomes;
    assert(
      before.every((item) => item.status === "error") && !existsSync(join(workspace, "FX.ping")),
    );
    await allowed.preflight();
    const after = (await allowed.run()).outcomes;
    assert.deepEqual(status(after), [
      "fx_ping:completed",
      "fx_other:error",
      "rogue_ping:error",
      "skill:completed",
      "shell:error",
    ]);
    assert(existsSync(join(workspace, "FX.ping")), "named MCP tool ran");
    assert(!existsSync(join(workspace, "FX.other")) && !existsSync(join(workspace, "ROGUE.ping")));
    assert(!existsSync(join(workspace, "SHELL.txt")));
    log("named-exceptions", { withoutFile: status(before), withFile: status(after) });
  } finally {
    await without.finish();
    await allowed.finish();
  }
  // A project agent deny after the exception wins and preflight refuses to start.
  const denied = await launch("read-only", [call("fx_ping")], {
    exceptions,
    project: {
      agents: { build: { permissions: [{ action: "fx_ping", resource: "*", effect: "deny" }] } },
    },
  });
  try {
    await assert.rejects(denied.preflight(), /capability policy/);
    rmSync(join(workspace, "FX.ping"));
    const out = (await denied.run()).outcomes;
    assert.equal(out[0]?.status, "error");
    assert(!existsSync(join(workspace, "FX.ping")));
    log("agent-deny-wins", { preflightRejects: true, toolRan: false });
  } finally {
    await denied.finish();
  }
}

// Old behaviour: `external_directory:*` composed from an MCP server `external` lifted the hard
// outside-workspace denial. The parser now rejects it; the raw statements prove why.
async function collision() {
  const outside = join(scratch, "outside.txt");
  writeFileSync(outside, "outside-secret\n");
  const raw: Exception[] = [
    { action: "mcp.use", resource: "external" },
    { action: "tool.use", resource: "external_directory:*" },
  ];
  const read = [call("read", { path: outside })];
  const plain = await launch("read-only", read);
  const lifted = await launch("read-only", read, { exceptions: raw });
  try {
    const before = (await plain.run()).outcomes;
    assert.equal(before[0]?.status, "error", "outside read is denied without the exception");
    await assert.rejects(lifted.preflight(), /capability policy/);
    const after = (await lifted.run()).outcomes;
    assert.equal(after[0]?.status, "completed", "raw exception lifts the outside-read denial");
    assert.match(after[0]?.text ?? "", /outside-secret/);
    const file = JSON.stringify({
      version: 1,
      base: "read-only",
      policies: [
        { action: "mcp.use", resource: "external", effect: "allow" },
        { action: "tool.use", resource: "external_directory:*", effect: "allow" },
      ],
    });
    assert.throws(() => parsePolicyFile(file, workspace), /--policy-file/);
    log("builtin-name-collision", {
      rawLiftsDenial: true,
      preflightRejectsRaw: true,
      parserRejects: true,
    });
  } finally {
    await plain.finish();
    await lifted.finish();
  }
}

async function downgrade() {
  const state = join(scratch, "state");
  const full = await launch(
    "full-access",
    [
      call("shell", { command: "touch FULL-SHELL.txt" }),
      call("write", { path: "FULL-EDIT.txt", content: "x" }),
    ],
    { state },
  );
  let session = "";
  try {
    await full.preflight();
    const result = await full.run();
    assert.deepEqual(status(result.outcomes), ["shell:completed", "write:completed"]);
    assert(
      existsSync(join(workspace, "FULL-SHELL.txt")) && existsSync(join(workspace, "FULL-EDIT.txt")),
    );
    session = result.session;
  } finally {
    await full.finish();
  }
  // Simulate a saved "always" approval and a scheduled automation left in the persistent database.
  const db = new Database(join(state, "data", "opencode", "opencode.db"));
  const project = db.query<{ id: string }, []>("select id from project limit 1").get();
  db.run(
    "insert into permission (id, project_id, action, resource, time_created, time_updated) values ('p', ?, 'shell', '*', 0, 0)",
    [project!.id],
  );
  db.run("update session_v2 set permission = ?", [
    JSON.stringify([{ action: "*", resource: "*", effect: "allow" }]),
  ]);
  db.close();
  rmSync(join(workspace, "FULL-SHELL.txt"));
  rmSync(join(workspace, "FULL-EDIT.txt"));
  const attempts = [
    call("shell", { command: "touch RO-SHELL.txt" }),
    call("write", { path: "RO-EDIT.txt", content: "x" }),
  ];
  const outcomes: Outcome[][] = [];
  for (const options of [{ state }, { state, session }]) {
    const pad = options.session ? [call("noop"), call("noop")] : [];
    const probe = await launch("read-only", [...pad, ...attempts], options);
    try {
      await probe.preflight();
      outcomes.push((await probe.run()).outcomes);
    } finally {
      await probe.finish();
    }
  }
  try {
    for (const out of outcomes)
      assert(
        out.length >= 2 && out.slice(-2).every((item) => item.status === "error"),
        "denied after downgrade",
      );
    for (const name of ["RO-SHELL.txt", "RO-EDIT.txt", "FULL-SHELL.txt", "FULL-EDIT.txt"])
      assert(!existsSync(join(workspace, name)), `${name} must not exist`);
    const check = new Database(join(state, "data", "opencode", "opencode.db"), { readonly: true });
    assert.equal(check.query<{ n: number }, []>("select count(*) n from permission").get()?.n, 0);
    assert(
      check.query("select id from session_v2 where id = ?").get(session),
      "session history kept",
    );
    assert.equal(
      check
        .query<{ n: number }, []>("select count(*) n from session_v2 where permission is not null")
        .get()?.n,
      0,
      "session permission rulesets cleared",
    );
    check.close();
    log("downgrade-full-access-to-read-only", {
      shellDenied: true,
      editDenied: true,
      savedApprovalCleared: true,
      sessionKept: true,
    });
  } finally {
    rmSync(state, { recursive: true, force: true });
  }
}

try {
  await named();
  await collision();
  await downgrade();
  console.log(JSON.stringify({ stateProbes: true }));
} catch (error) {
  console.error(
    JSON.stringify({
      stateProbes: false,
      error: error instanceof Error ? error.message : "failed",
    }),
  );
  process.exitCode = 1;
}
rmSync(scratch, { recursive: true, force: true });
