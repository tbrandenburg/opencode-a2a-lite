import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireState } from "../src/state-dir.js";
import { processStart } from "../src/state-lock.js";
import { StartupError } from "../src/startup-error.js";

const base = realpathSync(mkdtempSync(join(tmpdir(), "state-dir-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));
const workspace = join(base, "ws");
const other = join(base, "other");
mkdirSync(workspace);
mkdirSync(other);
let counter = 0;
const fresh = () => join(base, `state-${counter++}`);
const message = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof StartupError ? error.message : "other";
  }
  return "accepted";
};

function seed(data: string) {
  mkdirSync(join(data, "opencode"), { recursive: true });
  const db = new Database(join(data, "opencode", "opencode.db"));
  db.run("create table permission (id text, action text)");
  db.run("create table credential (id text, value text)");
  db.run("create table automation (id text)");
  db.run("create table session_v2 (id text)");
  db.run("insert into permission values ('p', 'shell')");
  db.run("insert into credential values ('c', 'secret')");
  db.run("insert into automation values ('a')");
  db.run("insert into session_v2 values ('ses_keep')");
  db.close();
}
const count = (data: string, table: string) => {
  const db = new Database(join(data, "opencode", "opencode.db"));
  const row = db.query<{ n: number }, []>(`select count(*) n from ${table}`).get();
  db.close();
  return row?.n;
};

test("creates a 0700 owned directory bound to the workspace; release keeps data", () => {
  const path = fresh();
  const state = acquireState(path, workspace);
  expect(statSync(path).mode & 0o777).toBe(0o700);
  expect(statSync(state.data).mode & 0o777).toBe(0o700);
  expect(JSON.parse(readFileSync(join(path, "binding.json"), "utf8"))).toEqual({
    version: 1,
    workspace,
  });
  expect(existsSync(join(path, "lock"))).toBe(true);
  writeFileSync(join(state.data, "kept"), "x");
  state.release();
  expect(existsSync(join(path, "lock"))).toBe(false);
  expect(readFileSync(join(state.data, "kept"), "utf8")).toBe("x");
  acquireState(path, workspace).release();
});

test("rejects reuse by another workspace without changing the state", () => {
  const path = fresh();
  acquireState(path, workspace).release();
  const before = readFileSync(join(path, "binding.json"), "utf8");
  expect(message(() => acquireState(path, other))).toMatch(/--state-dir rejected/);
  expect(readFileSync(join(path, "binding.json"), "utf8")).toBe(before);
  expect(existsSync(join(path, "lock"))).toBe(false);
});

test.each([
  ["inside the workspace", () => join(workspace, "state")],
  ["containing the workspace", () => base],
  [
    "a symlink",
    () => {
      const real = fresh();
      mkdirSync(real, { mode: 0o700 });
      const link = fresh();
      symlinkSync(real, link);
      return link;
    },
  ],
  [
    "group-writable",
    () => {
      const path = fresh();
      mkdirSync(path);
      chmodSync(path, 0o770);
      return path;
    },
  ],
  [
    "a world-readable directory",
    () => {
      const path = fresh();
      mkdirSync(path);
      chmodSync(path, 0o755);
      return path;
    },
  ],
  [
    "a non-empty unbound directory",
    () => {
      const path = fresh();
      mkdirSync(path, { mode: 0o700 });
      writeFileSync(join(path, "operator-file"), "x");
      return path;
    },
  ],
  [
    "under a symlinked parent",
    () => {
      const real = fresh();
      mkdirSync(real, { mode: 0o700 });
      const link = fresh();
      symlinkSync(real, link);
      return join(link, "state");
    },
  ],
])("rejects %s and never deletes pre-existing content", (_name, make) => {
  const path = make();
  expect(message(() => acquireState(path, workspace))).toMatch(/--state-dir/);
  expect(existsSync(join(path, "lock"))).toBe(false);
  if (path.endsWith("state-" + (counter - 1)) && existsSync(join(path, "operator-file")))
    expect(readFileSync(join(path, "operator-file"), "utf8")).toBe("x");
});

test("a second owner is refused while the first is alive; live locks are never taken over", () => {
  const path = fresh();
  const first = acquireState(path, workspace);
  expect(message(() => acquireState(path, workspace))).toMatch(/in use/);
  first.release();
  acquireState(path, workspace).release();
});

test("stale lock: dead pid or recycled start time is recovered; garbage fails closed", () => {
  const path = fresh();
  acquireState(path, workspace).release();
  const lock = join(path, "lock");
  const mine = processStart(process.pid)!;
  writeFileSync(lock, JSON.stringify({ pid: process.pid, start: mine, nonce: "n" }), {
    mode: 0o600,
  });
  expect(message(() => acquireState(path, workspace))).toMatch(/in use/);
  writeFileSync(lock, JSON.stringify({ pid: process.pid, start: "1", nonce: "n" }));
  acquireState(path, workspace).release();
  writeFileSync(lock, JSON.stringify({ pid: 2 ** 22 + 7, start: "1", nonce: "n" }));
  acquireState(path, workspace).release();
  writeFileSync(lock, "not json");
  expect(message(() => acquireState(path, workspace))).toMatch(/in use/);
  expect(readFileSync(lock, "utf8")).toBe("not json");
});

test("authority tables are emptied each launch; sessions survive", () => {
  const path = fresh();
  const state = acquireState(path, workspace);
  seed(state.data);
  state.release();
  expect(count(state.data, "permission")).toBe(0);
  expect(count(state.data, "credential")).toBe(0);
  expect(count(state.data, "automation")).toBe(0);
  expect(count(state.data, "session_v2")).toBe(1);
  const again = acquireState(path, workspace);
  expect(count(again.data, "session_v2")).toBe(1);
  again.release();
});

test("saved approvals present before launch are cleared; credential files fail closed", () => {
  const path = fresh();
  const first = acquireState(path, workspace);
  seed(first.data);
  first.release();
  const db = new Database(join(first.data, "opencode", "opencode.db"));
  db.run("insert into permission values ('p2', 'shell')");
  db.close();
  const second = acquireState(path, workspace);
  expect(count(second.data, "permission")).toBe(0);
  second.release();
  writeFileSync(join(first.data, "opencode", "auth.json"), "{}");
  expect(message(() => acquireState(path, workspace))).toMatch(/--state-dir rejected/);
  expect(existsSync(join(first.data, "opencode", "auth.json"))).toBe(true);
  expect(existsSync(join(path, "lock"))).toBe(false);
});
