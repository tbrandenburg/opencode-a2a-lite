import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { candidateEnvironment, deniedToolEvidence, exec } from "./e2e-support.js";

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
      expect(realpathSync(join(env.PATH.split(":")[0]!, "opencode"))).toBe(
        realpathSync(executable),
      );
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

function stored(
  seed: (db: Database) => void,
  operation: (db: Database, workspace: { root: string }) => void,
) {
  const root = mkdtempSync(join(tmpdir(), "issue-61-evidence-"));
  mkdirSync(join(root, "gateway-state/data/opencode"), { recursive: true });
  const db = new Database(join(root, "gateway-state/data/opencode/opencode.db"));
  try {
    db.transaction(() => {
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
      seed(db);
    })();
    operation(db, { root });
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

test("denial fixture commits batched setup before opening the evidence reader", () => {
  stored(
    (db) => {
      expect(db.inTransaction).toBe(true);
      message(db, "latest", "denied", 1);
      part(db, "latest", "denied", 0, "text");
    },
    (db, workspace) => {
      expect(db.inTransaction).toBe(false);
      expect(deniedToolEvidence(workspace)).toEqual({
        recordedToolCalls: 0,
        assistantContentTypes: ["text"],
      });
    },
  );
});

test("denial evidence reads split parts across the latest session, not empty envelopes or old tools", () => {
  stored(
    (db) => {
      message(db, "old", "old", 1);
      part(db, "old", "old", 0, "tool");
      message(db, "first", "denied", 2);
      part(db, "first", "denied", 0, "reasoning");
      message(db, "latest", "denied", 3);
      part(db, "latest", "denied", 0, "text");
    },
    (db, workspace) => {
      const result = deniedToolEvidence(workspace);
      expect(result).toEqual({
        recordedToolCalls: 0,
        assistantContentTypes: ["reasoning", "text"],
      });
      expect(JSON.stringify(result)).not.toContain(secret);
      expect(db.query("SELECT count(*) AS count FROM session_part").get()).toEqual({ count: 3 });
    },
  );
});

test("denial evidence rejects split tools from an earlier step in the same denied session", () => {
  stored(
    (db) => {
      message(db, "tool-step", "denied", 1);
      part(db, "tool-step", "denied", 0, "tool");
      message(db, "latest", "denied", 2);
      part(db, "latest", "denied", 0, "text");
    },
    (db, workspace) => {
      expect(() => deniedToolEvidence(workspace)).toThrow("Unexpected tool/nontext content");
      expect(
        db.query("SELECT count(*) AS count FROM session_part WHERE type = 'tool'").get(),
      ).toEqual({ count: 1 });
    },
  );
});

test("denial evidence rejects mixed legacy tools and unknown parts instead of overlooking them", () => {
  stored(
    (db) => {
      message(db, "latest", "denied", 1, [{ type: "tool", input: secret }]);
      part(db, "latest", "denied", 0, "text");
    },
    (db, workspace) => {
      expect(() => deniedToolEvidence(workspace)).toThrow("Unexpected tool/nontext content");
      db.query("UPDATE session_message SET data = ?").run('{"content":[]}');
      part(db, "latest", "denied", 1, "unexpected");
      expect(() => deniedToolEvidence(workspace)).toThrow("Unexpected tool/nontext content");
    },
  );
});

test("denial evidence fails closed on empty, reasoning-only and missing part storage", () => {
  stored(
    () => {},
    (db, workspace) => {
      expect(() => deniedToolEvidence(workspace)).toThrow();
      message(db, "latest", "denied", 1);
      part(db, "latest", "denied", 0, "reasoning");
      expect(() => deniedToolEvidence(workspace)).toThrow();
      db.exec("DROP TABLE session_part");
      expect(() => deniedToolEvidence(workspace)).toThrow();
    },
  );
});
