import { Database } from "bun:sqlite";
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { StartupError } from "./startup-error.js";

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
const SENSITIVE = /permission|credential|approval|account|token|grant|auth/i;
// Usage counters (`tokens_input` ...) are not credentials.
const COUNTER = /^tokens_[a-z_]+$/;
// Per-session permission rulesets are set to NULL; history stays.
const RULESET = "permission";

const fail = () => new StartupError("stateDir");
const quote = (name: string) => `\`${name.replaceAll("`", "``")}\``;

// Fails closed on authority-looking tables or columns this version does not know, so a schema
// change in OpenCode cannot silently persist grants.
function sanitize(db: Database) {
  const tables = db
    .query<{ name: string }, []>("select name from sqlite_master where type = 'table'")
    .all()
    .map((row) => row.name);
  for (const table of tables) {
    if (AUTHORITY.includes(table)) {
      db.run(`delete from ${quote(table)}`);
      continue;
    }
    if (SENSITIVE.test(table)) throw fail();
    const columns = db
      .query<{ name: string; notnull: number }, []>(`pragma table_info(${quote(table)})`)
      .all();
    for (const column of columns.filter((item) => SENSITIVE.test(item.name))) {
      if (COUNTER.test(column.name)) continue;
      if (column.name !== RULESET || column.notnull) throw fail();
      db.run(`update ${quote(table)} set ${quote(RULESET)} = null`);
    }
  }
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
    db.transaction(() => sanitize(db))();
  } catch {
    throw fail();
  } finally {
    db.close();
  }
}
