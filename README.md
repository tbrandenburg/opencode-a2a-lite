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
> exposed through a public proxy. Trusted workspace configuration can enable tools, plugins and MCP. Rejecting ACP
> permission requests is **not** an OS sandbox, and cancellation does not roll back work.

The operator must trust the OpenCode executable selected on `PATH`: a version
string does not verify provenance. Preflight probes use the same resolved
executable and private base environment as ACP, but do not receive `--pass-env`
values; those values go only to the ACP child.

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
- [Behavior and limitations](#behavior-and-limitations)
- [Development](#development)
- [Multi-agent coordination](#multi-agent-coordination)
- [Contributing and security](#contributing-and-security)

## Quick start

Run it from any directory outside a checkout of this repository:

```sh
npx --yes @tbrandenburg/opencode-a2a-lite@latest --workspace /absolute/path/to/trusted/workspace --port 0 --pass-env OPENAI_API_KEY
```

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
  Linux with 2.2.7; a two-turn macOS live demo passed with 2.3.0).
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
opencode-a2a-lite --workspace <path> [--port <0..65535>]
                  [--publish-activity] [--permissions <reject|ask>] [--allow-resume] [--pass-env NAME]...
opencode-a2a-lite --help | --version
```

| Option / variable                                                               | Meaning                                                                                                                                                                          |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--workspace`, `A2A_WORKSPACE`                                                  | Explicitly trusted directory. The env var must be an **absolute** path. No implicit current-directory trust.                                                                     |
| `--port`, `A2A_PORT`                                                            | Listen port (bound to `127.0.0.1`). Default 41241; `0` requests an OS-assigned port. Flags override env.                                                                         |
| `--pass-env NAME`                                                               | Pass a named, existing provider variable to OpenCode; repeat for additional variables. Runtime, configuration, endpoint, host, proxy and injection-sensitive names are rejected. |
| `--publish-activity`                                                            | Opt-in: also publish tool calls and reasoning as an `activity` artifact. See [below](#tool-and-reasoning-activity).                                                              |
| `--permissions <reject\|ask>`                                                   | `reject` (default) rejects every OpenCode permission request; `ask` lets the client decide. See [below](#permission-requests).                                                   |
| `--allow-resume`                                                                | Opt-in: let clients continue existing OpenCode sessions of this workspace. See [below](#continue-an-existing-session).                                                           |
| `A2A_NAME` (128), `A2A_DESCRIPTION` (1024), `A2A_TAGS` (16 tags, 64 chars each) | Agent card metadata only, **not** access control. Nonblank, control-free.                                                                                                        |

The three opt-in flags are independent, off by default, and each adds an Agent Card extension
when enabled. They widen what any client that can reach the **unauthenticated** port can see or
do, so enable them only for trusted clients on loopback.

CLI launches use an ephemeral private HOME and XDG directories, a PATH consisting of
absolute entries, `LANG=C`, and explicit `--pass-env` variables. Ambient OpenCode
overrides, proxy variables, saved logins and unrelated provider keys are not copied.
For example, export `OPENAI_API_KEY` in the invoking environment and name it with
`--pass-env OPENAI_API_KEY`; values are not printed. An absent or invalid provider
credential can cause a sanitized task failure: check provider setup rather than expecting
fallback to the host login. Review and configure the provider and model in the trusted
workspace as needed. Persistent login/state is not supported by this CLI mode.

**Cleanup limitation:** Linux cleanup checks process groups and readable `/proc`
records for a per-launch marker and runtime references. This is not containment:
unreadable or tag-scrubbing descendants can escape detection and reopen the runtime.
If cleanup is unconfirmed, the runtime directory is retained for operator inspection.
No process outside the owned group is signaled.

Preflight rejects managed Linux `/etc/opencode`, configuration in workspace ancestors,
and unexpected configuration sources; choose a trusted standalone workspace. It checks
private paths and uses a standalone config probe before starting ACP. The private CLI
runtime currently fails closed on macOS pending verification of managed preferences.
Project-local configuration and instructions may still load plugins, MCP and tools and
can access files and network as the invoking OS user. Library callers explicitly supplying
`acp.env` retain their environment override and are responsible for isolation.
Combining that override with `passEnv` is rejected.

Run the compiled server with `A2A_WORKSPACE=/absolute/trusted/path make run`;
use `make dev` for development.

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
gateway keeps that context in memory. With `--allow-resume` a client can continue **any existing
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

`--publish-activity` adds an `activity` artifact of data parts, in order: tool call entries
`{toolCallId, title, kind, status}` and reasoning as `{"thought": "…"}`. Tool inputs and outputs
are never published. Titles and reasoning may reveal paths, commands or workspace data. Reasoning
appears only for models and effort settings that emit it (for example Claude Haiku 5.5 with
`effort=high`). The Agent Card declares `urn:opencode-a2a-lite:activity:v1`.

### Permission requests

By default the gateway rejects every permission request. A turn stopped that way ends `canceled`
with the message "Permission request rejected" and `opencode.permissionDenied: "true"`; a client
cancellation carries neither. Permissions that OpenCode's own configuration allows are never
asked, so they are never rejected, so review that configuration.

With `--permissions ask` the client decides. The task pauses as `input-required` with a question
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
- Permission requests are rejected unless `--permissions ask` is set and a client answers.
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

| Command                                                                | Purpose                                                               |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `make check`                                                           | Formatting, lint, strict types, deterministic regressions, build      |
| `make package-smoke`                                                   | Installed-tarball and subprocess lifecycle checks, without provider   |
| `make runtime-smoke`                                                   | Linux-only private runtime and real OpenCode startup, no model prompt |
| `A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test` | Pinned, provider-free guarded MCP/bridge/gateway acceptance           |
| `make demo`                                                            | Isolated official A2A CLI two-turn smoke (**live, billable**)         |
| `make e2e`                                                             | Production live-model acceptance (**live, billable**)                 |
| `TCK_DIR=/absolute/path/to/pinned/a2a-tck make e2e-tck`                | Applicable external A2A TCK checks                                    |
| `make release BUMP=patch`                                              | Check, commit and push tag for npm publication and a GitHub release.  |
| `make clean`                                                           | Remove build, coverage and test results                               |

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
