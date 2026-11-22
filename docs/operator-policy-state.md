# Operator policy file and persistent state (issue #89)

Both options are opt-in, CLI private-runtime only, read once at startup, and never change the
launch policy from a prompt, A2A metadata or the workspace. Neither is an OS sandbox.

## `--policy-file ABSOLUTE_PATH`

```json
{
  "version": 1,
  "base": "read-only",
  "policies": [
    { "action": "mcp.use", "resource": "docs", "effect": "allow" },
    { "action": "tool.use", "resource": "docs_search:*", "effect": "allow" },
    { "action": "skill.use", "resource": "repo-audit", "effect": "allow" }
  ]
}
```

- `base` must equal `--policy` (`read-only`, `edit`, `full-access`). A file never selects or
  upgrades a profile; `full-access` still needs both CLI flags, so a full-access file without them
  fails before readiness. `supervised` is not shipped and is rejected.
- Only `effect: "allow"` and exact resources. Unknown fields, duplicates, more than 32 entries,
  `*`/`?`, `$`, URLs, relative or `..` paths, environment substitution and anything outside the
  character classes below are rejected:
  `mcp.use` server name (`[A-Za-z0-9-]`, not a built-in tool name); `skill.use` skill id;
  `plugin.use` unversioned package name or an absolute file path outside the workspace (literal and realpath comparison);
  `tool.use` only `<server>_<tool>:*` of an MCP server the same file allows, and the composed
  name `<server>_<tool>` must not equal a built-in tool or permission name (`read glob grep edit
  write shell bash webfetch websearch subagent task execute skill question external_directory
  apply_patch todo_write ...`; the tool names OpenCode 2.3.2 sends to the model plus known
  permission names). Without this, `mcp.use external` + `tool.use external_directory:*` lifted the
  outside-workspace denial (reproduced in `make policy-smoke`). Built-in tools
  (`shell`, `edit`, `webfetch` ...) cannot be lifted, so **shell exceptions are rejected** for every
  base: use `full-access` deliberately instead.
- Trust checks (one file descriptor, `O_NOFOLLOW`, `fstat`): absolute canonical path equal to its
  realpath (no symlink in any component), regular file with one link, owned by the invoking user,
  no group/world write, 64 KiB limit, every ancestor a real directory owned by root or you with no
  group/world write (sticky shared directories such as `/tmp` allowed), and outside the workspace. Bind mounts are not detectable by realpath; do not place the file or state
  directory on a mount that exposes workspace content.
- Generated order: base statements first, then exceptions sorted by action and resource. Observed
  on OpenCode 2.3.2, a policy `allow` only lifts a denial; usability needs more, which the gateway
  adds and verifies:

| Exception          | Statements generated and required effective                                                   |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `mcp.use` `S`      | policy allow only (the server may start)                                                      |
| `tool.use` `S_t:*` | policy allow + agent permission allow `S_t` (each alone: tool unavailable or "Blocked")       |
| `skill.use` `K`    | policy allow + `tool.use` `skill:K` allow + agent permission allow `skill` `K`                |
| `plugin.use` `P`   | policy allow only; the plugin loads and runs as the host user (not probed with a real plugin) |

- Preflight: the real `debug config` must equal the generated document (dropped statements fail
  closed) and every primary agent must end with an effective `allow` for each required permission.
  A project agent `deny` placed later wins at runtime and fails preflight.
- MCP/plugin code is not sandboxed; allowlisting names does not restrict what it does.
- The startup summary lists capability names only.

## `--state-dir ABSOLUTE_PATH`

Layout (all mode 0700 directories, 0600 files, owned by the invoking user):

```text
<state-dir>/binding.json   {"version":1,"workspace":"<workspace realpath>"}
<state-dir>/lock           pid, process start time, nonce, runtime root and tag of the owner
<state-dir>/data/opencode/ OpenCode data dir (XDG_DATA_HOME=<state-dir>/data): opencode.db, log/, repos/, shell/
```

HOME, config, cache, state, service and tmp stay per-launch inside the private runtime root and are
removed on shutdown; the generated private config is rewritten every launch. `opencode debug paths`
confirms that only `data`, `db`, `log` and `repos` move; preflight rejects any other path outside
the runtime root.

- Rejected before any child starts: relative path, symlink components, inside or containing the
  workspace, wrong owner, mode other than 0700, shared-writable ancestors, a non-empty directory
  with no binding marker, or a marker for another workspace.
- Lock: `O_EXCL` file; stale takeover is serialized by an `O_EXCL` `lock.takeover` guard (the winner
  renames the stale lock aside, then creates the new one; every loser fails closed and a guard left by a
  crash must be removed by hand after checking no gateway runs). A held lock is refused. It is taken over only when its recorded pid is
  absent or has another start time **and** no process still carries the recorded runtime tag or
  uses its root. Unreadable locks fail closed. No signal is ever sent.
- Shutdown removes the runtime root and the lock and keeps `data/`. A failed startup keeps
  pre-existing content (a new empty state directory keeps its marker).
- **Authority is not persisted.** The database holds saved "always" approvals (`permission`),
  credentials and accounts (`credential`, `account`, `account_state`, `control_account`) and
  scheduled `automation`/`job` rows, plus per-session permission rulesets (`session_v2.permission`,
  set to NULL; a seeded allow ruleset did not make a read-only shell run on 2.3.2, but is cleared anyway).
  Startup fails closed on any other table or column whose name matches
  `permission|credential|approval|account|token|grant|auth` (usage counters `tokens_*` excepted), so
  an OpenCode schema change cannot silently persist grants (verified against the 2.3.2 schema only).
  These are emptied at every launch and at shutdown; the
  `auth.json`/`mcp-auth.json` files fail startup if present. Provider keys therefore only come from
  `--pass-env`. Session history (`session_*`, messages) is kept.
- `--allow-resume` is still required to load a stored session; persistence alone restores nothing
  and does not restore A2A tasks or contexts.
- Downgrade: state created under `full-access` and relaunched as `read-only` is enforced by the new
  launch's private config, with approvals cleared (`make policy-smoke` proves shell and edit are
  denied, with side-effect checks, in a fresh and a resumed session).

## Sensitivity and deletion

`data/` contains conversation content, tool output and file excerpts, and may contain secrets the
model saw. Keep it private and do not publish it. To delete: stop the gateway (lock file gone), then
remove the whole state directory yourself (`rm -r <state-dir>`); the gateway never deletes operator
state. If a crash left a lock whose process is gone, the next start recovers it; remove it by hand
only after checking that no `opencode` process of that runtime remains.
