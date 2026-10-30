# opencode-a2a-lite

> Expose OpenCode through A2A, with ACP doing the heavy lifting.

[![CI](https://github.com/tbrandenburg/opencode-a2a-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/tbrandenburg/opencode-a2a-lite/actions/workflows/ci.yml) · [MIT](LICENSE)

A small, **loopback-only** OpenCode ACP → A2A 1.0 gateway for trusted Linux workspaces.
It uses the official A2A and ACP SDKs. OpenCode owns coding-session behavior; this
gateway translates plain-text tasks, streamed output and context continuity.
There is no HTTP OpenCode adapter, database, orchestrator, retry system or sandbox.

## Requirements

- Linux, **Bun 1.3.9**, and **exactly `opencode v2.0.28`** on `PATH`.
- An explicitly trusted workspace and reviewed OpenCode provider, model, tools,
  plugins, MCP servers and configuration.
- The separate [official A2A CLI](https://github.com/a2aproject/a2a-cli)
  (tested with 0.3.1) to interact with the running gateway.

**Security:** the gateway has no authentication and must never be exposed through
a public proxy. The production launch inherits OpenCode configuration; denying ACP
permission requests is **not** an OS sandbox. Cancellation does not roll back work.

## Quick start from source

```sh
make install             # frozen Bun lockfile
make check               # format, lint, typecheck, deterministic tests, build
bun src/cli.ts --workspace /absolute/path/to/trusted/workspace --port 0
```

Wait for a JSON stdout record containing `{"ready":true,"url":"http://127.0.0.1:.../"}`,
then use the **actual** URL in a second terminal:

```sh
a2a card get http://127.0.0.1:41241
a2a send -a http://127.0.0.1:41241 "Reply with a short greeting." --stream
a2a send -a http://127.0.0.1:41241 --context-id <returned-context-id> "Follow up"
```

Those commands show the default port (41241); when starting with `--port 0`, replace
it with the printed port. The server is foreground-only and terminates its owned ACP
process group on SIGINT/SIGTERM.

### CLI and environment

```text
opencode-a2a-lite --workspace <path> [--port <0..65535>]
opencode-a2a-lite --help | --version
```

- `--workspace` explicitly trusts the directory; relative flags are resolved.
  Alternatively set `A2A_WORKSPACE` to an **absolute** path. There is no implicit
  current-directory trust.
- `--port` or `A2A_PORT` selects a loopback port. Default: 41241; zero requests
  an OS-assigned port. Flags override environment variables.
- `A2A_NAME` (128 characters), `A2A_DESCRIPTION` (1024) and `A2A_TAGS` (up to
  16 comma-separated tags, 64 characters each) customize card metadata, **not**
  identity-based access or permissions. Values must be nonblank and control-free.

To run the compiled server, use
`A2A_WORKSPACE=/absolute/trusted/path make run`. For development, use `make dev`.

### Package distribution

`@tbrandenburg/opencode-a2a-lite` is at repository version **0.1.2**.
**npm registry publication has not been verified.** Do not assume these commands
work until the scope/registry is checked:

```sh
bunx @tbrandenburg/opencode-a2a-lite --workspace .
npx --yes @tbrandenburg/opencode-a2a-lite --workspace .
```

Both runners still require Bun; `npx` also requires Node/npm. The verified
`make package-smoke` check packs and tests an installed tarball, **not** registry
publication. Read [distribution and release policy](docs/distribution.md).

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

## Verification and development

| Command | Purpose |
| --- | --- |
| `make check` | Formatting, lint, strict types, deterministic regressions, build |
| `make package-smoke` | Installed-tarball and subprocess lifecycle checks, without provider |
| `A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test` | Pinned, provider-free guarded MCP/bridge/gateway acceptance |
| `make demo` | Isolated official A2A CLI two-turn smoke (**live, billable**) |
| `make e2e` | Production live-model acceptance (**live, billable**) |
| `TCK_DIR=/absolute/path/to/pinned/a2a-tck make e2e-tck` | Applicable external A2A TCK checks |
| `make release BUMP=patch` | Check, commit/tag and create **GitHub** release, not npm publication |
| `make clean` | Remove build, coverage and test results |

CI checks deterministic tests, installed packaging and the checksummed provider-free
MCP bridge. Live demo/E2E are explicit manual commands requiring a provider key,
OpenCode and the official A2A CLI; `make demo` also needs `jq` and GNU `timeout`.
For the exact live evidence/limitations see [acceptance](docs/acceptance.md).
For quality measurement see [quality baseline](docs/quality-baseline.md).

### Optional multi-agent coordination

The **gateway does not orchestrate other agents**. Optional guarded MCP interoperability
helpers and their independent gate live in [`interop/`](interop/README.md).
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
