# opencode-a2a-lite

> Expose OpenCode through A2A, with ACP doing the heavy lifting.

[![CI](https://github.com/tbrandenburg/opencode-a2a-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/tbrandenburg/opencode-a2a-lite/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/tbrandenburg/opencode-a2a-lite)](https://github.com/tbrandenburg/opencode-a2a-lite/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform: Linux and experimental macOS](https://img.shields.io/badge/platform-linux%20%7C%20macOS%20experimental-lightgrey)
![Runtime: Bun](https://img.shields.io/badge/runtime-Bun%201.4.4-black)

A small OpenCode ACP → A2A 1.0 gateway for trusted workspaces: point any A2A
client at it and it drives OpenCode. It uses the official A2A and ACP SDKs: OpenCode
owns coding-session behavior, the gateway translates plain-text tasks, streamed output
and context continuity.

```text
A2A client ──HTTP/SSE──▶ opencode-a2a-lite ──ACP (stdio)──▶ opencode ──▶ trusted workspace
```

**Not included:** HTTP OpenCode adapter, database, orchestrator, retries, sandbox.

> [!WARNING]
> The gateway has no authentication (it binds to `127.0.0.1`) and must **never** be
> exposed through a public proxy. It inherits OpenCode configuration, tools, plugins and MCP. Rejecting ACP
> permission requests is **not** an OS sandbox, and cancellation does not roll back work.

Choosing a workspace is an explicit trust decision, not a filesystem boundary:
OpenCode runs as the invoking user and can access resources permitted to that user.
For stronger isolation use a separately secured VM or container with minimal
workspace mounts, credentials and network access. The isolated demo uses a private
HOME/configuration, but is not an OS sandbox.

## Contents

- [Quick start](#quick-start)
- [Requirements](#requirements)
- [Usage](#usage)
- [Behavior and limitations](#behavior-and-limitations)
- [Development](#development)
- [Multi-agent coordination](#multi-agent-coordination)
- [Contributing and security](#contributing-and-security)

## Quick start

Run it from any directory outside a checkout of this repository:

```sh
npx --yes @tbrandenburg/opencode-a2a-lite@latest --workspace /absolute/path/to/trusted/workspace --port 0
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
Status lines use color only on interactive terminals, honor `NO_COLOR`, and remain
plain when redirected. Startup JSON stays on stdout; human-readable status is on stderr.

## Requirements

- Linux, or macOS for experimental gateway use, **Bun 1.4.4**, and stable
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
macOS package installation requires a release containing the `darwin` package
manifest entry; older published versions remain Linux-only. The isolated `make demo`
also supports macOS, but the full live acceptance suite, guarded MCP and team
launcher still use Linux-specific tooling.

## Usage

```text
opencode-a2a-lite --workspace <path> [--port <0..65535>] [--publish-activity]
opencode-a2a-lite --help | --version
```

| Option / variable                                                               | Meaning                                                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `--workspace`, `A2A_WORKSPACE`                                                  | Explicitly trusted directory. The env var must be an **absolute** path. No implicit current-directory trust. |
| `--port`, `A2A_PORT`                                                            | Listen port (bound to `127.0.0.1`). Default 41241; `0` requests an OS-assigned port. Flags override env.     |
| `A2A_NAME` (128), `A2A_DESCRIPTION` (1024), `A2A_TAGS` (16 tags, 64 chars each) | Agent card metadata only, **not** access control. Nonblank, control-free.                                    |

Run the compiled server with `A2A_WORKSPACE=/absolute/trusted/path make run`;
use `make dev` for development.

### Package distribution

`@tbrandenburg/opencode-a2a-lite` is published on npm (see [Quick start](#quick-start)).
Pin a version with `@x.y.z` instead of `@latest`. The package requires Node.js 22 or
newer to use `npx`, plus Bun 1.4.4 and OpenCode 2.2.7 or newer on `PATH`. `bunx` can
be used instead of `npx` where Bun is installed. Inside a checkout of this repository
`npx` can fail with `opencode-a2a-lite: not found`; run it from another directory. See [distribution and release policy](docs/distribution.md) for
verification scope and release details.

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
- Permission requests are rejected/canceled, not silently approved.
- A failed task names the failing phase (for example `ACP session creation failed`); the
  underlying OpenCode diagnostic is never published. A bridge failure is permanent until restart.
- Every task's metadata carries `opencode.sessionId` and `opencode.stopReason` (after a session
  exists). The session id is the key for finding the full transcript in OpenCode itself.
- `--publish-activity` (off by default) adds an `activity` artifact of data parts with only tool
  call id, title, kind and status; tool inputs, outputs and reasoning are never published. Titles
  may reveal paths or commands, so enable it only for clients you trust. The Agent Card then
  declares the `urn:opencode-a2a-lite:activity:v1` extension.
- Defaults: 30-second startup/session allocation, 120-second prompt, 5-second
  cancellation and 5-second ACP shutdown. Failure retires the unhealthy bridge.
- Streaming sends stable artifact IDs and ordered append events. Task states are
  SDK-owned; the small [request-handler adapter](src/request-handler.ts) is retained
  for a documented upstream cancellation persistence defect.

See [architecture and implementation pitfalls](docs/architecture.md) and
[SDK cancellation removal criteria](docs/sdk-cancellation.md).
Full A2A TCK certification, interactive approval, rich media, push notifications
and runtime-selected workspaces are not claimed.

## Development

Run from source:

```sh
make install             # frozen Bun lockfile
make check               # format, lint, typecheck, deterministic tests, build
bun src/cli.ts --workspace /absolute/path/to/trusted/workspace --port 0
```

| Command                                                                | Purpose                                                              |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `make check`                                                           | Formatting, lint, strict types, deterministic regressions, build     |
| `make package-smoke`                                                   | Installed-tarball and subprocess lifecycle checks, without provider  |
| `make runtime-smoke`                                                   | Isolated gateway and real OpenCode startup, without a model prompt   |
| `A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test` | Pinned, provider-free guarded MCP/bridge/gateway acceptance          |
| `make demo`                                                            | Isolated official A2A CLI two-turn smoke (**live, billable**)        |
| `make e2e`                                                             | Production live-model acceptance (**live, billable**)                |
| `TCK_DIR=/absolute/path/to/pinned/a2a-tck make e2e-tck`                | Applicable external A2A TCK checks                                   |
| `make release BUMP=patch`                                              | Check, commit and push tag for npm publication and a GitHub release. |
| `make clean`                                                           | Remove build, coverage and test results                              |

CI is configured to check core deterministic tests and installed packaging on Linux and macOS;
the provider-free team launcher fixtures and checksummed MCP bridge run on Linux.
Live demo/E2E are explicit manual commands requiring a provider key,
OpenCode and the official A2A CLI; `make demo` also needs `jq` and GNU `timeout`.
On macOS its isolated workspace cleanup additionally uses `/usr/sbin/lsof`.
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
