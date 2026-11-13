# opencode-a2a-lite

> Expose OpenCode through A2A, with ACP doing the heavy lifting.

[![CI](https://github.com/tbrandenburg/opencode-a2a-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/tbrandenburg/opencode-a2a-lite/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platform: Linux](https://img.shields.io/badge/platform-linux-lightgrey)
![Runtime: Bun](https://img.shields.io/badge/runtime-Bun%201.4.4-black)

A small OpenCode ACP → A2A 1.0 gateway for trusted Linux workspaces: point any A2A
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

## Contents

- [Quick start](#quick-start)
- [Requirements](#requirements)
- [Usage](#usage)
- [Behavior and limitations](#behavior-and-limitations)
- [Development](#development)
- [Multi-agent coordination](#multi-agent-coordination)
- [Contributing and security](#contributing-and-security)

## Quick start

```sh
make install             # frozen Bun lockfile
make check               # format, lint, typecheck, deterministic tests, build
bun src/cli.ts --workspace /absolute/path/to/trusted/workspace --port 0
```

Wait for a JSON stdout record such as `{"ready":true,"url":"http://127.0.0.1:.../"}`,
then in a second terminal use the **actual** URL (default port 41241):

```sh
a2a card get http://127.0.0.1:41241
a2a send -a http://127.0.0.1:41241 "Reply with a short greeting." --stream
a2a send -a http://127.0.0.1:41241 --context-id <returned-context-id> "Follow up"
```

The server runs in the foreground and terminates its owned ACP process group on
SIGINT/SIGTERM.

## Requirements

- Linux, **Bun 1.4.4**, and stable **`opencode` v2.2.7 or newer** on `PATH`
  (live acceptance recorded on 2.2.7).
- An explicitly trusted workspace and reviewed OpenCode provider, model, tools,
  plugins, MCP servers and configuration.
- The separate [official A2A CLI](https://github.com/a2aproject/a2a-cli)
  (tested with 0.3.1) to talk to the running gateway.

Runtime security and compatibility evidence is tracked for
[Bun](docs/bun-runtime-security.md) and [OpenCode](docs/opencode-runtime-upgrade.md).
Standalone Bun and OpenCode's embedded runtime are separate upgrade boundaries;
historical acceptance results do not establish compatibility of a new pair.

## Usage

```text
opencode-a2a-lite --workspace <path> [--port <0..65535>]
opencode-a2a-lite --help | --version
```

| Option / variable                                                               | Meaning                                                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `--workspace`, `A2A_WORKSPACE`                                                  | Explicitly trusted directory. The env var must be an **absolute** path. No implicit current-directory trust. |
| `--port`, `A2A_PORT`                                                            | Loopback port. Default 41241; `0` requests an OS-assigned port. Flags override env.                          |
| `A2A_NAME` (128), `A2A_DESCRIPTION` (1024), `A2A_TAGS` (16 tags, 64 chars each) | Agent card metadata only, **not** access control. Nonblank, control-free.                                    |

Run the compiled server with `A2A_WORKSPACE=/absolute/trusted/path make run`;
use `make dev` for development.

### Package distribution

`@tbrandenburg/opencode-a2a-lite` is at repository version **0.2.0**.
**npm registry publication has not been verified**; do not assume these work until
the scope/registry is checked:

```sh
bunx @tbrandenburg/opencode-a2a-lite --workspace .
npx --yes @tbrandenburg/opencode-a2a-lite --workspace .
```

Both runners still require Bun. `make package-smoke` tests an installed tarball,
**not** registry publication. See [distribution and release policy](docs/distribution.md).

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
- Defaults: 30-second startup/session allocation, 120-second prompt, 5-second
  cancellation and 5-second ACP shutdown. Failure retires the unhealthy bridge.
- Streaming sends stable artifact IDs and ordered append events. Task states are
  SDK-owned; the small [request-handler adapter](src/request-handler.ts) is retained
  for a documented upstream cancellation persistence defect.

See [architecture](docs/architecture.md), [pitfalls](docs/pitfalls.md) and
[SDK cancellation removal criteria](docs/sdk-cancellation.md).
Full A2A TCK certification, interactive approval, rich media, push notifications
and runtime-selected workspaces are not claimed.

## Development

| Command                                                                | Purpose                                                              |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `make check`                                                           | Formatting, lint, strict types, deterministic regressions, build     |
| `make package-smoke`                                                   | Installed-tarball and subprocess lifecycle checks, without provider  |
| `A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test` | Pinned, provider-free guarded MCP/bridge/gateway acceptance          |
| `make demo`                                                            | Isolated official A2A CLI two-turn smoke (**live, billable**)        |
| `make e2e`                                                             | Production live-model acceptance (**live, billable**)                |
| `TCK_DIR=/absolute/path/to/pinned/a2a-tck make e2e-tck`                | Applicable external A2A TCK checks                                   |
| `make release BUMP=patch`                                              | Check, commit/tag and create **GitHub** release, not npm publication |
| `make clean`                                                           | Remove build, coverage and test results                              |

CI checks deterministic tests, the provider-free team launcher fixtures, installed
packaging and the checksummed provider-free MCP bridge. Live demo/E2E are explicit manual commands requiring a provider key,
OpenCode and the official A2A CLI; `make demo` also needs `jq` and GNU `timeout`.
For the exact live evidence/limitations see [acceptance](docs/acceptance.md).
For quality measurement see [quality baseline](docs/quality-baseline.md).

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
includes eight topology procedures; the
[topology study pages](docs/topology-studies/topology-pipeline.md) contain scoped
observations, not proof of general reliability.

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
