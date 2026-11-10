import { mkdtempSync, mkdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import {
  candidateEnvironment,
  deniedToolEvidence,
  exec,
  runtimeCatalogReady,
} from "./e2e-support.js";

const secret = "PRIVATE-content-not-for-evidence";

test("production PATH executes the exact candidate instead of a different inherited opencode", async () => {
  const root = mkdtempSync(join(tmpdir(), "issue-61-candidate-"));
  try {
    const baseline = join(root, "baseline");
    const selected = join(root, "selected");
    mkdirSync(baseline);
    mkdirSync(selected);
    writeFileSync(join(baseline, "opencode"), '#!/bin/sh\nprintf "baseline:%s" "$1"\n', {
      mode: 0o700,
    });
    for (const filename of ["opencode", "alternate-candidate"]) {
      const executable = join(selected, filename);
      writeFileSync(executable, '#!/bin/sh\nprintf "candidate:%s" "$1"\n', { mode: 0o700 });
      const workspace = { root, cwd: root, executable, env: { PATH: baseline } };
      const env = candidateEnvironment(workspace);
      const result = await exec("opencode", ["acp"], { cwd: root, env, timeout: 2_000 });
      expect(result.stdout).toBe("candidate:acp");
      expect(readlinkSync(join(env.PATH.split(":")[0]!, "opencode"))).toBe(executable);
      expect(workspace.env.PATH).toBe(baseline);
    }
    expect((await exec("opencode", ["acp"], { env: { PATH: baseline } })).stdout).toBe(
      "baseline:acp",
    );
    expect(() =>
      candidateEnvironment({
        root,
        cwd: root,
        executable: "/missing/candidate",
        env: { PATH: baseline },
      }),
    ).toThrow("no longer executable");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function stored(operation: (db: Database, workspace: { env: NodeJS.ProcessEnv }) => void) {
  const root = mkdtempSync(join(tmpdir(), "issue-61-evidence-"));
  mkdirSync(join(root, "opencode"));
  const db = new Database(join(root, "opencode/opencode.db"));
  try {
    // Relevant DDL copied from the provider-free v2.2.7 executable's sqlite_master.
    db.exec(`
      CREATE TABLE session_v2 (id text PRIMARY KEY);
      CREATE TABLE session_message (
        id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL,
        time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL,
        FOREIGN KEY (session_id) REFERENCES session_v2(id) ON DELETE CASCADE
      );
      CREATE TABLE session_part (
        message_id text NOT NULL, session_id text NOT NULL, ordinal integer NOT NULL,
        type text NOT NULL, call_id text, time_created integer NOT NULL,
        time_updated integer NOT NULL, data text NOT NULL, PRIMARY KEY (message_id, ordinal),
        FOREIGN KEY (message_id) REFERENCES session_message(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES session_v2(id) ON DELETE CASCADE
      );
      INSERT INTO session_v2 VALUES ('old'), ('denied');
    `);
    operation(db, { env: { XDG_DATA_HOME: root } });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function message(db: Database, id: string, session: string, time: number, content: unknown[] = []) {
  db.query("INSERT INTO session_message VALUES (?, ?, 'assistant', ?, ?, ?, ?)").run(
    id,
    session,
    time,
    time,
    time,
    JSON.stringify({ content }),
  );
}

function part(db: Database, id: string, session: string, ordinal: number, type: string) {
  db.query("INSERT INTO session_part VALUES (?, ?, ?, ?, NULL, 1, 1, ?)").run(
    id,
    session,
    ordinal,
    type,
    JSON.stringify({ type, text: secret }),
  );
}

test("denial evidence reads split parts across the latest session, not empty envelopes or old tools", () => {
  stored((db, workspace) => {
    message(db, "old", "old", 1);
    part(db, "old", "old", 0, "tool");
    message(db, "first", "denied", 2);
    part(db, "first", "denied", 0, "reasoning");
    message(db, "latest", "denied", 3);
    part(db, "latest", "denied", 0, "text");
    const result = deniedToolEvidence(workspace);
    expect(result).toEqual({ recordedToolCalls: 0, assistantContentTypes: ["reasoning", "text"] });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(db.query("SELECT count(*) AS count FROM session_part").get()).toEqual({ count: 3 });
  });
});

test("denial evidence rejects split tools from an earlier step in the same denied session", () => {
  stored((db, workspace) => {
    message(db, "tool-step", "denied", 1);
    part(db, "tool-step", "denied", 0, "tool");
    message(db, "latest", "denied", 2);
    part(db, "latest", "denied", 0, "text");
    expect(() => deniedToolEvidence(workspace)).toThrow("Unexpected tool/nontext content");
    expect(
      db.query("SELECT count(*) AS count FROM session_part WHERE type = 'tool'").get(),
    ).toEqual({
      count: 1,
    });
  });
});

test("denial evidence rejects mixed legacy tools and unknown parts instead of overlooking them", () => {
  stored((db, workspace) => {
    message(db, "latest", "denied", 1, [{ type: "tool", input: secret }]);
    part(db, "latest", "denied", 0, "text");
    expect(() => deniedToolEvidence(workspace)).toThrow("Unexpected tool/nontext content");
    db.query("UPDATE session_message SET data = ?").run('{"content":[]}');
    part(db, "latest", "denied", 1, "unexpected");
    expect(() => deniedToolEvidence(workspace)).toThrow("Unexpected tool/nontext content");
  });
});

test("denial evidence fails closed on empty, reasoning-only and missing part storage", () => {
  stored((db, workspace) => {
    expect(() => deniedToolEvidence(workspace)).toThrow();
    message(db, "latest", "denied", 1);
    part(db, "latest", "denied", 0, "reasoning");
    expect(() => deniedToolEvidence(workspace)).toThrow();
    db.exec("DROP TABLE session_part");
    expect(() => deniedToolEvidence(workspace)).toThrow();
  });
});

function runtime() {
  const deny = { action: "*", resource: "*", effect: "deny" };
  const workspace = {
    root: "/tmp/private-runtime",
    cwd: "/tmp/private-runtime/workspace",
    config: {
      model: { providerID: "openai", model: "gpt-6-luna" },
      default_agent: "smoke",
      permissions: [deny],
      agents: {
        smoke: { mode: "primary", description: "probe", system: "probe", permissions: [deny] },
      },
      plugins: [],
      skills: [],
      instructions: [],
      snapshots: false,
      warming: false,
    },
  };
  const list = <T>(data: T[]) => ({ location: { directory: workspace.cwd }, data });
  const values = {
    config: [
      { type: "document", path: join(workspace.cwd, "opencode.json"), info: workspace.config },
    ],
    plugins: list(
      ["opencode.config.agent", "opencode.config.provider", "opencode.config.mcp"].map((id) => ({
        id,
        source: { type: "builtin" },
        state: { status: "active" },
      })),
    ),
    agents: list([{ id: "smoke", mode: "primary", system: "probe", permissions: [deny] }]),
    model: {
      location: { directory: workspace.cwd },
      data: { providerID: "openai", id: "gpt-6-luna" },
    },
    mcp: list<unknown>([]),
  };
  return { workspace, values };
}

test("runtime readiness waits for cold catalogs and wrong agent/model, not config alone", () => {
  const { workspace, values } = runtime();
  expect(runtimeCatalogReady(workspace, values)).toBe(true);
  expect(
    runtimeCatalogReady(workspace, { ...values, plugins: { ...values.plugins, data: [] } }),
  ).toBe(false);
  values.plugins.data[0]!.state.status = "pending";
  expect(runtimeCatalogReady(workspace, values)).toBe(false);
  values.plugins.data[0]!.state.status = "active";
  values.plugins.data[0]!.id = "unrelated-builtin";
  expect(runtimeCatalogReady(workspace, values)).toBe(false);
  values.plugins.data[0]!.id = "opencode.config.agent";
  values.agents.data[0]!.id = "build";
  expect(runtimeCatalogReady(workspace, values)).toBe(false);
  values.agents.data[0]!.id = "smoke";
  values.model.data.id = "wrong-model";
  expect(runtimeCatalogReady(workspace, values)).toBe(false);
});

test("runtime readiness rejects permission overrides and nonbuiltin plugins without raw details", () => {
  const { workspace, values } = runtime();
  values.agents.data[0]!.permissions.push({ action: "shell", resource: "*", effect: "allow" });
  expect(() => runtimeCatalogReady(workspace, values)).toThrow("does not deny tool access");
  values.agents.data[0]!.permissions.pop();
  values.plugins.data[0]!.source.type = secret;
  expect(() => runtimeCatalogReady(workspace, values)).toThrow("Unexpected runtime plugin source");
});

test("runtime readiness rejects missing denial, agent-model overrides and changed effective config", () => {
  const { workspace, values } = runtime();
  expect(() =>
    runtimeCatalogReady(workspace, {
      ...values,
      agents: { ...values.agents, data: [{ ...values.agents.data[0], permissions: [] }] },
    }),
  ).toThrow("does not deny tool access");
  expect(() =>
    runtimeCatalogReady(workspace, {
      ...values,
      agents: {
        ...values.agents,
        data: [{ ...values.agents.data[0], model: { providerID: "openai", id: "wrong-model" } }],
      },
    }),
  ).toThrow("Unexpected runtime agent model override");
  expect(() =>
    runtimeCatalogReady(workspace, {
      ...values,
      config: values.config.map((entry) => ({
        ...entry,
        info: { ...entry.info, permissions: [] },
      })),
    }),
  ).toThrow("Runtime configuration changed the restrictions");
});

test("runtime readiness rejects external config, MCP and wrong catalog locations", () => {
  const { workspace, values } = runtime();
  expect(() =>
    runtimeCatalogReady(workspace, { ...values, config: [{ path: "/outside/config" }] }),
  ).toThrow("configuration source");
  values.mcp.data.push({ name: secret });
  expect(() => runtimeCatalogReady(workspace, values)).toThrow("Unexpected runtime MCP");
  values.mcp.data.pop();
  values.model.location.directory = "/wrong/workspace";
  expect(() => runtimeCatalogReady(workspace, values)).toThrow("Wrong runtime model location");
});
