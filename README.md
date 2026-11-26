# opencode-a2a-lite

> Expose OpenCode through A2A, with ACP doing the heavy lifting.

[![CI](https://github.com/tbrandenburg/opencode-a2a-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/tbrandenburg/opencode-a2a-lite/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/tbrandenburg/opencode-a2a-lite)](https://github.com/tbrandenburg/opencode-a2a-lite/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform: Linux](https://img.shields.io/badge/platform-linux-lightgrey)
![Runtime: Bun](https://img.shields.io/badge/runtime-Bun%201.4.4-black)

A small OpenCode ACP → A2A 1.0 gateway for trusted workspaces: point any A2A
client at it and it drives OpenCode. It uses the official A2A and ACP SDKs: OpenCode
owns coding-session behavior, the gateway translates plain-text tasks, streamed output
and context continuity.

```text
A2A client ──HTTP/SSE──▶ opencode-a2a-lite ──ACP (stdio)──▶ opencode ──▶ trusted workspace
```

**Opt-in extras:** tool and reasoning activity, interactive permission approval, resuming
existing OpenCode sessions and replaying their history; see [Advanced features](#advanced-features).

**Not included:** HTTP OpenCode adapter, database, orchestrator, retries, sandbox.

> [!WARNING]
> The gateway has no authentication (it binds to `127.0.0.1`) and must **never** be
> exposed through a public proxy. The default `read` [access level](#access-levels)
> limits OpenCode's tools but is **not** an OS sandbox: nothing confines files, network or processes.
> Rejecting ACP permission requests is not a sandbox either, and cancellation does not roll back work.

The operator must trust the OpenCode executable selected on `PATH`: a version
string does not verify provenance. Preflight probes use the same resolved
executable and private base environment as ACP, but do not receive passed provider
variables; those values go only to the ACP child.

Choosing a workspace is an explicit trust decision, not a filesystem boundary:
OpenCode runs as the invoking user and can access resources permitted to that user.
For stronger isolation use a separately secured VM or container with minimal
workspace mounts, credentials and network access. The isolated demo uses a private
HOME/configuration, but is not an OS sandbox.

## Contents

- [Quick start](#quick-start)
- [Requirements](#requirements)
- [Usage](#usage)
- [Advanced features](#advanced-features)
- [Access levels](#access-levels)
- [Accepted limitations](#accepted-limitations)
- [Behavior and limitations](#behavior-and-limitations)
- [Development](#development)
- [Multi-agent coordination](#multi-agent-coordination)
- [Contributing and security](#contributing-and-security)

## Quick start

Three inputs, all optional: workspace, port and access level. Run it inside the
directory you trust, outside a checkout of this repository, with a provider key such as
`OPENAI_API_KEY` exported (well-known provider keys are passed to OpenCode automatically):

```sh
cd /absolute/path/to/trusted/workspace
npx --yes @tbrandenburg/opencode-a2a-lite@latest --port 0 --access read
```

Upgrading from 0.8? See the [v0.9.0 release notes](docs/release-0.9.0.md) for the old-to-new flag table.

This starts a **gateway server** on `127.0.0.1` and launches `opencode` as a child
process over ACP in that workspace. It does not run any task by itself: OpenCode only
works when an A2A client sends a prompt. On startup, the CLI prints aligned lifecycle
status to stderr and a machine-readable readiness record to stdout
(`{"ready":true,"url":"http://127.0.0.1:.../"}`). In a second terminal use the
**actual** URL (default port 41241):

```sh
a2a card get http://127.0.0.1:41241
a2a send -a http://127.0.0.1:41241 "Reply with a short greeting." --stream
a2a send -a http://127.0.0.1:41241 --context-id <returned-context-id> "Follow up"
```

The server runs in the foreground. Press Ctrl-C to see shutdown progress; it reports
`stopped` only after closing the listener and releasing its owned OpenCode process.
SIGTERM and SIGHUP also initiate shutdown.
Status lines use color only on interactive terminals, honor `NO_COLOR`, and remain
plain when redirected. Startup JSON stays on stdout; human-readable status is on stderr.

## Requirements

- Linux, **Bun 1.4.4**, and stable
  **`opencode` v2.2.7 or newer** on `PATH` (full live acceptance recorded on
  Linux with 2.2.7; a two-turn macOS live demo passed with 2.3.0). Capability profiles: provider-free
  `make policy-smoke` passed on 2.2.7 and 2.3.2; their live acceptance ran on 2.3.2 only.
- An explicitly trusted workspace and reviewed OpenCode provider, model, tools,
  plugins, MCP servers and configuration.
- The separate [official A2A CLI](https://github.com/a2aproject/a2a-cli)
  (tested with 0.3.1 on Linux and 0.4.0 in the macOS demo) to talk to the running gateway.

Runtime security and compatibility evidence is tracked for
[Bun](docs/bun-runtime-security.md) and [OpenCode](docs/opencode-runtime-upgrade.md).
Standalone Bun and OpenCode's embedded runtime are separate upgrade boundaries;
historical acceptance results do not establish compatibility of a new pair.
macOS library use remains experimental; the normal CLI fails closed until managed
preferences and private-runtime cleanup are verified on that platform. Historical
macOS demo results predate this change.

## Usage

```text
opencode-a2a-lite [--workspace <path>] [--port <0..65535>] [--access <read|edit|danger-full-access>]
                  [--pass-env NAME]... [--no-env] [--enable <activity|approve|resume>]...
                  [--prompt-timeout <duration|unlimited>]
opencode-a2a-lite --help | --version
```

| Option / variable    | Meaning                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--workspace`        | Trusted directory. Defaults to the current directory; `A2A_WORKSPACE` (absolute) is accepted, the flag wins.                                                 |
| `--port`, `A2A_PORT` | Listen port (bound to `127.0.0.1`). Default 41241; `0` requests an OS-assigned port.                                                                         |
| `--access`           | Startup-only [access level](#access-levels): `read` (default), `edit` or `danger-full-access`.                                                               |
| `--pass-env NAME`    | Also pass a named, existing variable to OpenCode; repeat for more. Runtime, configuration, endpoint, host, proxy and injection-sensitive names are rejected. |
| `--no-env`           | Do not pass the automatic provider keys (same as `--pass-env ""`).                                                                                           |
| `--enable activity`  | Opt-in: also publish tool calls and reasoning as an `activity` artifact. See [below](#tool-and-reasoning-activity).                                          |
| `--enable approve`   | Opt-in: let the client approve permission requests. See [below](#permission-requests). Rejected with `danger-full-access`.                                   |
| `--enable resume`    | Opt-in: let clients continue existing OpenCode sessions of this workspace. See [below](#continue-an-existing-session).                                       |
| `--prompt-timeout`   | Whole prompt deadline, default 60m; see below.                                                                                                               |

`--policy-file`, `--state-dir` and the `A2A_NAME`/`A2A_DESCRIPTION`/`A2A_TAGS` identity variables are
described on the [advanced page](docs/operator-policy-state.md).

The three `--enable` extras are independent, off by default, and each adds an Agent Card extension
when enabled. They widen what any client that can reach the **unauthenticated** port can see or
do, so enable them only for trusted clients on loopback. Each may be given once.

### Provider credentials

CLI launches use an ephemeral private HOME and XDG directories, a PATH consisting of absolute
entries and `LANG=C`. Saved logins, ambient OpenCode overrides and proxy variables are not copied.
These provider keys are passed automatically when set and non-empty:
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`,
`OPENROUTER_API_KEY`, `GROQ_API_KEY`. Launch prints the passed **names**, never values. Add more
with `--pass-env NAME`; disable the automatic ones with `--no-env`. Under `danger-full-access`
nothing is passed automatically because every command then sees the credentials; name what you
need with `--pass-env`. An absent or invalid credential can cause a sanitized task failure.

### Prompt execution deadline

The default whole ACP prompt deadline is now **60 minutes** (previously 120 seconds).
Use `--prompt-timeout 60m`, `--prompt-timeout 120s` to restore the old budget, or
another integer duration with suffix `ms`, `s`, `m` or `h` (30 through 2,147,483,647 ms).
`--prompt-timeout unlimited` explicitly disables the prompt deadline. It does not disable
startup/session allocation, cancellation, cleanup, or the independent permission-answer timeout.
Library callers use `acp.promptTimeoutMs` in server options (or `promptTimeoutMs` directly
in bridge options): omit it for the new default, pass an integer in milliseconds as before,
or pass `null` for unlimited. No A2A protocol or request-level configuration changes.

The budget covers the whole turn, including tools and silent downstream waits, not
an HTTP request or an individual model call. Output does not reset the deadline.
Operator permission waits suspend it; the full budget restarts when the last wait ends.
On expiry the bridge requests ACP cancellation within the separate cancellation budget,
then retires and cleans up its owned ACP process group. The task fails with
`ACP prompt timed out`, even if ACP acknowledges cancellation; it is never replayed.
Restart the gateway before admitting more work. Explicit cancellation remains bounded
and reports the actual ACP stop outcome.

Long or unlimited turns can hold the single admission slot and consume provider
credits, CPU, memory and downstream resources. Prefer a finite budget, monitor costs
and accepted tasks independently of HTTP timeouts, and use explicit cancellation or
owned gateway shutdown to stop unwanted work. Remote tool side effects may survive
local cancellation; verify them before retrying.

**Cleanup limitation:** Linux cleanup checks process groups and readable `/proc`
records for a per-launch marker and runtime references. This is not containment:
unreadable or tag-scrubbing descendants can escape detection and reopen the runtime.
If cleanup is unconfirmed, the runtime directory is retained for operator inspection.
No process outside the owned group is signaled.

Preflight rejects managed Linux `/etc/opencode`, configuration in workspace ancestors,
and unexpected configuration sources; choose a trusted standalone workspace. It checks
private paths and uses a standalone config probe before starting ACP. The private CLI
runtime currently fails closed on macOS pending verification of managed preferences.
Project-local configuration cannot lift the [access level](#access-levels)'s
hard denials, but project instructions remain trusted. Library callers explicitly supplying
`acp.env` retain their environment override, receive **no** gateway policy and are responsible
for isolation and tool controls. Combining that override with `passEnv` or `policy` is rejected.

Run the compiled CLI with `make run ARGS='--access edit'` from the trusted directory (or set
`A2A_WORKSPACE`); use `make dev` (same `ARGS`) for development.

### Package distribution

`@tbrandenburg/opencode-a2a-lite` is published on npm (see [Quick start](#quick-start)).
Pin a version with `@x.y.z` instead of `@latest`. The package requires Node.js 22 or
newer to use `npx`, plus Bun 1.4.4 and OpenCode 2.2.7 or newer on `PATH`. `bunx` can
be used instead of `npx` where Bun is installed. Inside a checkout of this repository
`npx` can fail with `opencode-a2a-lite: not found`; run it from another directory. See [distribution and release policy](docs/distribution.md) for
verification scope and release details.

## Advanced features

Everything here is opt-in except the task metadata. Examples use the official
[`a2a` CLI](https://github.com/a2aproject/a2a-cli).

### Task metadata

Every task carries these keys in its metadata (visible with `a2a send -o json` or `a2a task get -o json`):

| Key                                                                                       | Meaning                                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `opencode.sessionId`                                                                      | The OpenCode session behind the task, within the gateway's runtime state. |
| `opencode.stopReason`                                                                     | The ACP stop reason of the turn.                                          |
| `opencode.resumed`                                                                        | `"true"` when the task resumed an existing session.                       |
| `opencode.replayed`, `opencode.replayTruncated`                                           | Replay count, and `"true"` when anything was cut.                         |
| `opencode.permissionPending`, `opencode.permissionRequestId`, `opencode.permissionDenied` | Permission state; see [Permission requests](#permission-requests).        |

A failed task names the failing phase (for example `ACP session creation failed`); the underlying
OpenCode diagnostic is never published.

### Continue an existing session

By default each new conversation gets a new OpenCode session, and a follow-up only works while the
gateway keeps that context in memory. With `--enable resume` a client can continue **any existing
session in the gateway's runtime state for that workspace**:

```sh
a2a send -a <url> --metadata '{"opencode.sessionId":"ses_…"}' "Continue where we left off"
a2a send -a <url> --context-id <returned-context-id> "Follow up"
```

- Get the id from earlier task metadata. It may be sent in message or
  request metadata. Without the flag the metadata is refused, never silently ignored.
- OpenCode itself rejects ids that are unknown or belong to another workspace
  (`ACP session resume rejected`); that fails only the one task. A session can be bound to one
  context at a time, and a context cannot be re-bound to another session. CLI runtime state is
  ephemeral, so restart does not recover sessions. A library caller using persistent `acp.env`
  state owns that separate risk.
- Only one writer should use a session at a time; stop an open OpenCode TUI on it first.
- Sessions hold earlier conversation content, which any client that can reach the port can then
  read. The Agent Card declares `urn:opencode-a2a-lite:resume:v1`.

**History replay.** Add `"opencode.replay": true` to receive the earlier conversation too:

```sh
a2a send -a <url> -o json --metadata '{"opencode.sessionId":"ses_…","opencode.replay":true}' "Continue"
```

The task gets a `conversation` artifact before the new answer: data parts
`{"role": "user" | "assistant", "text": "…"}`, oldest first. Only plain user and assistant text is
replayed, the newest 100 messages of at most 20,000 characters each (`opencode.replayTruncated`
when anything was cut). Tool calls, tool output and reasoning are never replayed. The value must be
a boolean and is only valid on the first message that resumes a session.

### Tool and reasoning activity

`--enable activity` adds an `activity` artifact of data parts, in order: tool call entries
`{toolCallId, title, kind, status}` and reasoning as `{"thought": "…"}`. Tool inputs and outputs
are never published. Titles and reasoning may reveal paths, commands or workspace data. Reasoning
appears only for models and effort settings that emit it (for example Claude Haiku 5.5 with
`effort=high`). The Agent Card declares `urn:opencode-a2a-lite:activity:v1`.

### Permission requests

By default the gateway rejects every permission request. A turn stopped that way ends `canceled`
with the message "Permission request rejected" and `opencode.permissionDenied: "true"`; a client
cancellation carries neither. Permissions that OpenCode's own configuration allows are never
asked, so they are never rejected, so review that configuration.

With `--enable approve` the client decides. The task pauses as `input-required` with a question
and a data part `{"permission": {requestId, title, kind, options}}`; answer on the **same task**:

```sh
a2a send -a <url> "Run the tests"                  # → input-required: Allow "bun test (execute)"?
a2a send -a <url> --task-id <id> allow             # or: reject
```

Or send a data part `{"permissionResponse": {"requestId": "…", "optionId": "…"}}`.

- Only `allow_once` and the reject options are offered, never `allow_always`. A wrong request id,
  an option that was not offered, or an unrecognised answer leaves the request open.
- No answer within 120 seconds rejects once. While waiting, the single prompt slot stays held
  (other tasks get "busy") and the prompt deadline is suspended. Canceling the task cancels the
  request without marking a denial.
- **Anyone who can reach the port can approve tool runs in this mode.** The Agent Card declares
  `urn:opencode-a2a-lite:permissions:v1`.

## Access levels

`--access` selects a startup-only capability profile (`read` = `read-only` internally) for the private CLI runtime; it is never request-scoped
and no A2A message, task metadata or workspace file can change it. The gateway writes it into the
private global OpenCode config (`0600`, ephemeral HOME) as ordered V2 `policies` (hard denials) plus
matching agent `permissions`. Launch prints a sanitized summary before readiness: profile, ACP
approvals, shell behavior, blocked integration classes and `OS isolation: none`.

| Capability                            | `read` (default) | `edit`   | `danger-full-access`                |
| ------------------------------------- | ---------------- | -------- | ----------------------------------- |
| read, glob, grep project files        | allow            | allow    | allow                               |
| edit, write, patch                    | deny             | allow\*  | allow                               |
| shell, Git, tests, builds             | deny             | deny     | **auto-allow, host-user authority** |
| webfetch / websearch                  | deny             | deny     | allow                               |
| subagents, Code Mode (`execute`)      | deny             | deny     | allow                               |
| MCP, plugins, skills                  | deny             | deny     | deny (not inherited or enabled)     |
| OS sandbox, filesystem/network limits | **none**         | **none** | **none**                            |

\* `edit` also hard-denies edits to `opencode.json(c)`, `.opencode/`, `.agents/` and `.claude/`
(best effort; see limits). Reads and edits outside the workspace are denied through
`external_directory`. Use `--enable approve` only for requests that reach the ACP
callback; a hard denial is never approvable.

- **`danger-full-access`** is its own acknowledgement; `--enable approve` is rejected with it
  (nothing is left to approve), before readiness. A prominent stderr warning is printed before readiness. Shell, edits and web tools run
  without any ACP prompt and with the invoking user's filesystem, process and network authority; any
  local client that can reach the unauthenticated port can trigger them. Use only on a disposable
  user, host or workspace. Credentials named with `--pass-env` are available to every command. An
  unexpected ACP permission request is still rejected, never auto-answered.
- **There is no `supervised` level.** OpenCode V2 policies are binary denials and cannot force an
  `ask`; the per-agent `shell: ask` works (verified), but a project agent rule is appended after the
  gateway's and turns it into an unprompted run (verified, see
  [acceptance](docs/acceptance.md)). One-time approval therefore cannot be guaranteed from the private
  global config alone, so the release gate is not met and no `--access` value selects it.
- **Fail closed:** startup compares the private config OpenCode reports with what was written
  (OpenCode silently drops invalid statements) and evaluates every effective agent's rules. A project
  agent that re-enables Code Mode (`execute`), which hard policies do not gate and which exposes
  worktree and session utilities, aborts startup with a sanitized error. Changes to workspace
  configuration made after launch are not re-evaluated until the next launch.
- **Known limits (not claims of isolation):**
  - Path checks are lexical: a symlink inside the workspace that points outside lets `read` expose
    that file and, under `edit`, `write` **overwrite** it (verified). Startup does not scan for
    escaping symlinks (a tree walk is racy and costly); do not trust workspaces containing them.
  - `edit` can write files that run later outside the gateway: `.git/hooks/*`, `Makefile`,
    `package.json` scripts, `.envrc`, test or build files. Review diffs before running anything,
    and treat `edit` output as untrusted code.
  - `grep` rules match the regex, not a search path; provider traffic and file contents sent to the
    model are outside any boundary; `read` does not prevent reading secrets in the workspace.
  - `.env` files are read-protected by an `ask` rule. Under `--enable approve` any client of the
    unauthenticated port can approve such a read; with the default `reject` the read fails.
  - Preflight evaluates the configuration present at launch. For non-full profiles every agent must
    deny `execute` and `external_directory` (any later project rule for them, for any resource,
    aborts startup); for `danger-full-access` every visible primary agent must keep its allows. Edits made
    after launch are re-evaluated at the next launch. On the tested versions the hard policy alone
    already blocks outside paths even when a project agent allows `external_directory`; the agent
    check is defence in depth.

## Accepted limitations

The private runtime, capability profiles, operator policy file and persistent state are **soft
execution hardening, not isolation**. These limits are known, recorded in issues
[#87](https://github.com/tbrandenburg/opencode-a2a-lite/issues/87),
[#88](https://github.com/tbrandenburg/opencode-a2a-lite/issues/88) and
[#89](https://github.com/tbrandenburg/opencode-a2a-lite/issues/89), and accepted by the maintainer.
Do not rely on the gateway to contain a hostile workspace, model or local client.

- **No OS sandbox, no authentication.** The worker runs as the invoking user with ordinary
  filesystem, process and network access; any local client that can reach the loopback port can use
  whatever the profile allows, including `danger-full-access` shell commands and `--enable approve`
  approvals. Use a disposable user, host or VM for anything unattended.
- **No `supervised` level.** A project agent rule can turn a gateway `shell: ask` into an
  unprompted run, so one-time shell approval cannot be guaranteed; it is not selectable.
- **Cleanup is best effort.** Before the private runtime root is deleted the gateway checks that the
  process group is gone and that no readable process carries the launch tag or uses the root. A
  descendant that scrubs its environment, becomes unreadable or reopens the root later can evade this;
  the root is then retained or leaks. Escaping descendants are treated as an accepted limit for a
  trusted worker, not as containment.
- **The executable is trusted by the operator.** The first `opencode` on `PATH` (or the library
  caller's `acp.executable`) is resolved once and used for every launch; a version string is not
  provenance. Probes run without passed credentials, but the ACP child receives them.
- **Linux only for the CLI.** The CLI private runtime and the state lock use `/proc`, so on macOS the
  CLI fails closed with a clear message; library callers can still supply their own `acp.env`.
- **Preflight sees one process.** OpenCode 2.3.x and 2.4.x intermittently omit the private global config in
  a single `debug agents` process ([#93](https://github.com/tbrandenburg/opencode-a2a-lite/issues/93));
  2.4.x is accepted but not shown to be more reliable. Startup retries that probe with backoff for up
  to about 180 s (plus one in-flight probe) or 10 attempts, then fails closed and reports the
  attempt count (or, when the probes were slow, that the host appears overloaded). Gateways started on the same
  host take a per-user launch lock so their startup checks run one at a time. The real ACP child is a different process, so in that window only the hard
  policies are guaranteed. Configuration changed after launch is re-checked at the next launch.
- **`edit` risks.** Symlinks inside the workspace that point outside it, and files that run later
  (`.git/hooks/*`, `Makefile`, `package.json` scripts, `.envrc`), are not blocked; see the profile
  limits above.
- **Operator exceptions run code.** An allowed MCP server, skill or plugin is trusted code with host-user
  authority; `plugin.use` is covered by schema and configuration tests only, and shell or edit
  exceptions are rejected. Bind mounts are not detected by the workspace-containment checks.
- **Persistent state holds conversations.** `--state-dir` keeps session history on disk (mode `0700`);
  approvals, credentials and automations are cleared each launch, verified against OpenCode 2.3.2
  only. Deleting it is the operator's job, see [operator policy and state](docs/operator-policy-state.md).
- **Evidence scope.** Live acceptance used one provider and model on Linux with OpenCode 2.3.2; other
  versions, providers and `danger-full-access` against a real model were not exercised, and `make policy-smoke`
  (real OpenCode, scripted local model) is not part of CI. See [acceptance](docs/acceptance.md).

## Behavior and limitations

The official A2A SDK owns HTTP JSON-RPC, Agent Cards, task persistence and SSE.
The executor accepts nonempty plain text only; multiple text parts are joined with
newlines. A new conversation omits `contextId`; follow-ups pass the returned
`contextId` **without an old task ID**. Each turn creates a new A2A task while
reusing the ACP session for that context.

- Exactly one prompt is active globally; another request fails busy without a queue.
- Contexts/tasks live in memory. Default context capacity is 100; restarting clears
  them. No durable recovery, multi-tenancy or parallel model execution.
- Only ACP `end_turn` means completed; confirmed `cancelled` means canceled.
  Errors and other stop reasons fail the task without publishing private diagnostics.
- Permission requests are rejected unless `--enable approve` is set and a client answers.
- Defaults: 30-second startup/session allocation, 120-second prompt, 5-second
  cancellation and 5-second ACP shutdown. Failure retires the unhealthy bridge.
- Streaming sends stable artifact IDs and ordered append events. Task states are
  SDK-owned; the small [request-handler adapter](src/request-handler.ts) is retained
  for a documented upstream cancellation persistence defect.

See [architecture and implementation pitfalls](docs/architecture.md) and
[SDK cancellation removal criteria](docs/sdk-cancellation.md).
Full A2A TCK certification, rich media, push notifications and runtime-selected workspaces
are not claimed. Interactive approval, session resume and replay exist only as the opt-in
features above.

## Development

Run from source:

```sh
make install             # frozen Bun lockfile
make check               # format, lint, typecheck, deterministic tests, build
bun src/cli.ts --workspace /absolute/path/to/trusted/workspace --port 0
```

| Command                                                                | Purpose                                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `make check`                                                           | Formatting, lint, strict types, deterministic regressions, build                                              |
| `make package-smoke`                                                   | Installed-tarball and subprocess lifecycle checks, without provider                                           |
| `make runtime-smoke`                                                   | Linux-only private runtime and real OpenCode startup, no model prompt                                         |
| `make policy-smoke`                                                    | Profiles, operator exceptions and persistent-state downgrade against real OpenCode and a scripted local model |
| `A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test` | Pinned, provider-free guarded MCP/bridge/gateway acceptance                                                   |
| `make demo`                                                            | Isolated official A2A CLI two-turn smoke (**live, billable**)                                                 |
| `make e2e`                                                             | Production live-model acceptance (**live, billable**)                                                         |
| `TCK_DIR=/absolute/path/to/pinned/a2a-tck make e2e-tck`                | Applicable external A2A TCK checks                                                                            |
| `make release BUMP=patch`                                              | Check, commit and push tag for npm publication and a GitHub release.                                          |
| `make clean`                                                           | Remove build, coverage and test results                                                                       |

CI is configured to check core deterministic tests and installed packaging on Linux and macOS;
the provider-free team launcher fixtures and checksummed MCP bridge run on Linux.
Live demo/E2E are Linux-only explicit manual commands requiring a provider key,
OpenCode and the official A2A CLI; `make demo` also needs `jq` and GNU `timeout`.
For the exact live evidence/limitations see [acceptance](docs/acceptance.md).
`bun scripts/quality-report.ts` summarizes the latest local measurements;
native line/function coverage is not branch coverage or a correctness guarantee.

## Multi-agent coordination

The **gateway does not orchestrate other agents**. Optional guarded MCP interoperability
helpers and their independent gate live in [`interop/`](interop/README.md).
The experimental [team examples](examples/teams/README.md) provide a local roster
launcher; read their supervision and cleanup limitations before use.
For a manually owned model-issued MCP → A2A flow use the
[one-worker recipe](docs/manual-one-worker.md), or the
[explicit two-worker pipeline recipe](docs/manual-two-worker-pipeline.md) and
[passive supervision](docs/passive-mcp-supervision.md). The
[portable OpenCode multi-agent skill](.opencode/skills/multi-a2a-agent/SKILL.md)
includes eight topology procedures. The [historical research index](docs/history.md)
links scoped observations, not proof of general reliability.

The managed network/topology research lab has been **retired, not fixed**. Its
original failures and unverified outcomes are linked in the
[historical research index](docs/history.md). Do not treat provider-free passing
checks as evidence of real-model outcome quality.

## Contributing and security

Review [AGENTS.md](AGENTS.md) for repository boundaries and safe test practices.
Run `make check` and focused tests before proposing changes. Changes to streaming,
cancellation, permissions or lifecycle also require the relevant authorized live
acceptance evidence. Do not publish credentials, raw prompts, private reasoning or
provider diagnostics in issues, CI logs or PRs. Report vulnerabilities through
[GitHub security reporting](https://github.com/tbrandenburg/opencode-a2a-lite/security).

[MIT License](LICENSE).
