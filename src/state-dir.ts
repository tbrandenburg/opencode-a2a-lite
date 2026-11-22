import { Database } from "bun:sqlite";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { acquireLock } from "./state-lock.js";
import { StartupError } from "./startup-error.js";
import { contains, requireOwnedPrivate, requireTrustedPath } from "./trusted-path.js";

// Tables of OpenCode's database that carry authority rather than conversation: saved "always"
// approvals, provider/account credentials and scheduled automations. They are emptied at every
// launch and shutdown so persistent state can never lift the launch policy or store credentials.
const AUTHORITY = [
  "permission",
  "credential",
  "account",
  "account_state",
  "control_account",
  "automation",
  "job",
];
const CREDENTIAL_FILES = ["auth.json", "mcp-auth.json"];

const fail = () => new StartupError("stateDir");
const entries = (path: string) => readdirSync(path).filter((name) => name !== "lock");

function privateDirectory(path: string) {
  const info = lstatSync(path);
  if (!info.isDirectory()) throw fail();
  requireOwnedPrivate(info, 0o700, "stateDir");
}

// Binding marker: one state directory serves exactly one workspace realpath.
function bind(path: string, workspace: string) {
  const marker = join(path, "binding.json");
  const wanted = JSON.stringify({ version: 1, workspace });
  if (!existsSync(marker)) {
    if (entries(path).length) throw fail();
    writeFileSync(marker, wanted, { mode: 0o600, flag: "wx" });
  } else if (readFileSync(marker, "utf8") !== wanted) throw fail();
  const info = lstatSync(marker);
  if (!info.isFile()) throw fail();
  requireOwnedPrivate(info, 0o600, "stateDir");
}

export function clearAuthority(data: string) {
  const dir = join(data, "opencode");
  if (!existsSync(dir)) return;
  for (const name of CREDENTIAL_FILES) if (existsSync(join(dir, name))) throw fail();
  const file = join(dir, "opencode.db");
  if (!existsSync(file)) return;
  if (!lstatSync(file).isFile()) throw fail();
  const db = new Database(file, { readwrite: true, create: false });
  try {
    const tables = new Set(
      db
        .query<{ name: string }, []>("select name from sqlite_master where type = 'table'")
        .all()
        .map((row) => row.name),
    );
    for (const table of AUTHORITY) if (tables.has(table)) db.run(`delete from \`${table}\``);
  } catch {
    throw fail();
  } finally {
    db.close();
  }
}

// Validates (creating only a missing leaf), binds, locks and sanitizes the persistent state.
// Nothing pre-existing is ever deleted except the authority rows above.
export function acquireState(path: string, workspace: string) {
  if (contains(realpathSync(workspace), path)) throw fail();
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  requireTrustedPath(path, workspace, "stateDir");
  privateDirectory(path);
  const lock = acquireLock(path);
  const data = join(path, "data");
  try {
    bind(path, realpathSync(workspace));
    if (!existsSync(data)) mkdirSync(data, { mode: 0o700 });
    privateDirectory(data);
    clearAuthority(data);
  } catch (error) {
    lock.release();
    throw error instanceof StartupError ? error : fail();
  }
  return {
    data,
    record: lock.record,
    release() {
      try {
        clearAuthority(data);
      } finally {
        lock.release();
      }
    },
  };
}
