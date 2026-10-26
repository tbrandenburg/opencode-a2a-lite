# opencode-a2a-lite

```text
███ ██  ███ █ █ ███ ███ ██  ███      █  ██   █      █   ███ ███ ███
█ █ █ █ █   ███ █   █ █ █ █ █       █ █   █ █ █     █    █   █  █
█ █ ██  ██  ███ █   █ █ █ █ ██  ███ ███  █  ███ ███ █    █   █  ██
█ █ █   █   ███ █   █ █ █ █ █       █ █ █   █ █     █    █   █  █
███ █   ███ █ █ ███ ███ ██  ███     █ █ ███ █ █     ███ ███  █  ███
```

> Expose OpenCode through A2A, with ACP doing the heavy lifting.

[![Build](https://github.com/tbrandenburg/opencode-a2a-lite/actions/workflows/ci.yml/badge.svg)](https://github.com/tbrandenburg/opencode-a2a-lite/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](/LICENSE)

**A thin, prompt-oriented bridge—not another execution engine.**

A small OpenCode ACP-to-A2A gateway. The ACP bridge and official
A2A v1 server support text execution, streaming, context/session continuity, and
global single-turn admission, bounded cancellation, and owned-process shutdown.
`make demo` exercises the compiled gateway with the official A2A CLI and a live model.

Architecture: **A2A 1.0 → stable ACP v1 → OpenCode 2.0.28**. The gateway has no
OpenCode HTTP adapter, database, recovery engine, or automatic prompt retry.
See [architecture](/docs/architecture.md) and [pitfalls](/docs/pitfalls.md).

## Highlights

- **Official SDKs:** A2A JSON-RPC/SSE and stable ACP v1, without OpenCode HTTP adapters.
- **Live conversations:** streamed assistant text and follow-up tasks in the same context.
- **Honest outcomes:** completion comes from the ACP prompt result; cancellation races retain the actual outcome.
- **Small footprint:** one managed ACP subprocess, one active prompt globally, in-memory state and no database.

## Quick start

### Prerequisites

- Linux, Bun **1.3.9**, and Node.js **22+** for the deterministic subprocess compatibility probe.
- `jq` for stream-verifier tests; GNU `timeout` for the live demo.
- OpenCode **2.0.28**, the official [`a2a` CLI](https://github.com/a2aproject/a2a-cli) (tested with **0.3.1**), and real model access for live commands.

### Install

Use Bun **1.3.9** (pinned in `package.json` and CI) with the locked dependencies:

```sh
make install
make check
```

### Configure and run

For the isolated demo, securely provide `OPENAI_API_KEY` in the environment.
The demo uses `openai/gpt-6-luna` and a disposable, tool-restricted workspace;
it does not modify your OpenCode configuration.

```sh
# Set OPENAI_API_KEY securely in your environment, then:
make demo
```

Expected result: verified CLI discovery, streamed task completion, a follow-up
recalling a random marker, and successful owned-process/workspace cleanup.

### What the demo verifies

Requires Linux, Bun, reviewed `opencode v2.0.28`, the official `a2a` CLI (verified
with v0.3.1), `jq`, and GNU `timeout`. It makes two billable model requests using
the smoke helper's configured OpenAI model. The API key is checked for presence,
never printed. The demo builds and launches `dist/src/server.js` on loopback port
0 (OS-assigned), reads its readiness URL, fetches its card with `a2a card get`, and
sends a random marker with `a2a send --stream -o json`. jq aggregates every JSONL
event and verifies task/context IDs, initial task and working status, stable
artifact append semantics, reconstructed marker text, and exactly one completion.
A second streamed CLI request uses the actual returned context ID and must recall
the marker under a new task ID.

The demo reuses the reviewed isolation/configuration verifier: private temporary
HOME/XDG/workspace, denied tools, empty plugins/skills/instructions, no MCP sources,
and disabled shared-service discovery. It refuses unexpected effective config or
managed `/etc/opencode` configuration. This is isolation, not an OS sandbox.
Readiness and requests have deadlines. EXIT/SIGINT/SIGTERM stop the owned gateway
(which closes its ACP process group and private-server lease); cleanup verifies
workspace processes stopped before removing temporary files. Diagnostics remain
private and are deleted, not echoed as raw stderr or model reasoning. Failure
reports identify the stage; no user configuration is modified.

## Usage

```sh
A2A_WORKSPACE=/absolute/path/to/trusted/workspace make run
# Optional foreground watch mode:
A2A_WORKSPACE=/absolute/path/to/trusted/workspace make dev
# In another terminal:
a2a card get http://127.0.0.1:41241
# Stream a prompt:
a2a send -a http://127.0.0.1:41241 "Reply with a short greeting." --stream
# Continue with the actual contextId returned by the previous response:
a2a send -a http://127.0.0.1:41241 --context-id <returned-context-id> "Follow-up question"
```

Use the reviewed OpenCode 2.0.28 executable on PATH. Startup executes `--version`
and requires exactly `opencode v2.0.28` before starting ACP; a mismatch fails closed.
Set `A2A_PORT` to override
41241 (0 chooses a free ephemeral port). The server binds only to loopback and
prints a JSON readiness record with its actual URL **after** ACP initialization
and HTTP listening succeed. Agent Card discovery is at `/.well-known/agent-card.json`;
the official SDK JSON-RPC handler is mounted at `/`. The card advertises streaming
and a plain-text prompt skill; push notifications and extended cards are disabled.

The executor accepts non-empty user text only, rejects mixed/file/data input, and
joins multiple text parts with newlines. Omit `contextId` to create a conversation;
follow-up messages use the returned `contextId` without a `taskId` or task references.
Each conversation reuses one ACP session, while each turn gets a new A2A task.
Explicit unknown or expired context IDs fail without creating a session, including
IDs from before a gateway restart. ACP execution exceptions and non-completion stop
reasons other than confirmed cancellation invalidate that context.

Contexts are held only in memory, with a default capacity of 100. New conversations
are rejected at capacity; retained contexts remain usable. There is no eviction or
persistence. Restarting clears the map. `createGateway({ executor: { maxContexts } })`
can set a different positive finite integer capacity. This bounds gateway context
bindings, not OpenCode's own internal history storage or the SDK task store.

One turn is admitted globally, with the slot reserved before ACP session allocation.
Concurrent work on the same or another context fails immediately as busy, without
queueing, creating a session, or submitting a prompt. Retry only after the active
turn finishes. The official SDK still owns JSON-RPC parsing, task storage and SSE;
the two public SDK send entrypoints preserve whether the caller supplied a context
ID before the SDK generates its default.

Streams begin with a task snapshot and working status, followed by assistant text
artifact deltas with a stable artifact ID (`append=false` first, then `true`). An
empty final append marks `lastChunk` without repeating text. The SDK stores deltas
as separate text parts in one artifact. Only ACP `end_turn` completes the task;
`cancelled` cancels it, while refusal, limits, unknown stop reasons, and execution
errors fail it. Provider diagnostics are not included in failure messages.

Cancellation uses the global active-task/session record and waits for ACP;
it never invents a canceled status on receipt of a cancel request. Use
`a2a task cancel -a http://127.0.0.1:41241 <returned-task-id>`. During session allocation,
cancellation explicitly returns not-cancelable; retry after allocation finishes.
Root text continues until the original prompt settles, including when natural
completion wins the race. The admission slot remains reserved until both the prompt
and its cancellation operation settle (or the bridge retires). A losing cancel
returns not-cancelable while the task retains its actual completed/failed state.
Repeated cancellation of a canceled task is idempotent. A narrow public-SDK adapter
waits for the original task-store consumer instead of creating SDK 1.3's second
cancellation consumer, which would duplicate artifact appends.
The adapter remains pinned to SDK 1.3.0 until a verified upstream fix is published.
The persistence defect is reported as [a2a-js#798](https://github.com/a2aproject/a2a-js/issues/798).
See [SDK cancellation evidence and removal criteria](/docs/sdk-cancellation.md)
for the reproducer and the distinction between closing an SDK generator and
disconnecting an HTTP client.

`A2A_WORKSPACE` must name an existing, explicitly trusted absolute directory.
The server inherits the launch environment and OpenCode configuration: it does
**not** isolate HOME/XDG, plugins, MCP, tools, or shared-service discovery. Before
launching, the operator must review effective configuration and isolate those
sources as appropriate; denied ACP permission callbacks are not a sandbox.
Do not expose this unauthenticated development server through a public proxy.
The isolated smoke configuration helper is used by live probes and the demo; it is
not imported by the production gateway.

[`createGateway`](/src/server.ts) provides reusable `start()` / idempotent terminal
`close()` and accepts `createExecutor(bridge)` as an optional executor override.
No HTTP port opens on workspace/ACP initialization failure. SIGINT/SIGTERM close
the listener and stop admitting requests, attempt bounded cancellation of active
work, then send stdin EOF with a grace period before escalating. Lingering HTTP
connections are terminated 1s after bridge shutdown. Only the bridge's owned
subprocess group is signalled. Confirmed ACP cancellation yields canceled; a timeout,
transport closure, or process death yields failed rather than invented cancellation.

### ACP bridge

[`createAcpBridge`](/src/acp-client.ts) takes a trusted absolute `cwd`, optional
`executable`, `args` (default `["acp"]`), and `env` (default a snapshot of the parent
environment). Configuration and tool isolation remain the caller's responsibility;
permission requests select an offered rejection normally, or return `cancelled`
when no rejection is offered, during cancellation/shutdown, or outside an active
matching session. They never select allow. This is not a sandbox for the agent process.

- `start()` starts one owned child and persistent SDK connection, initializes once,
  and requires protocol version 1 plus the executable pin. This instance cannot
  restart after failure/close. `versionArgs` can adapt a wrapper's version invocation;
  it cannot disable or change the required version value.
- `newSession()` returns the SDK session response using the fixed workspace and no MCP servers.
- `prompt(sessionId, text, onText)` returns the actual SDK `PromptResponse`, preserving
  its stop reason. One prompt may be active per bridge. Only active root-session
  assistant text is forwarded; child metadata, thoughts, tools, and non-text are excluded.
- `cancel(sessionId)` sends one cancellation notification and waits for prompt completion,
  retaining text until that result. Concurrent cancels share the same operation.
  Unknown sessions reject; cancelling an idle known session is a no-op.
- `close()` is terminal and idempotent. It first attempts active cancellation, then
  rejects remaining requests and sends stdin EOF, escalating to SIGTERM/SIGKILL
  on its owned POSIX process group if needed.
  Call and await it in `finally`, including after failures, to observe cleanup errors.

Deadlines default to 30s for startup/session creation, 120s for prompts, 5s for
cancellation, and 5s for process shutdown after cancellation. Set `startupTimeoutMs`, `promptTimeoutMs`,
`cancelTimeoutMs`, or `closeTimeoutMs` to override. Timeout/transport/process failures
fail closed without retries. Raw subprocess stderr and peer errors are not published.

Stable ACP has no turn ID: updates after prompt settlement are dropped, but an old update
sent by a faulty peer during a later prompt on the same session is indistinguishable
from current text. POSIX descendants that deliberately escape the owned process
group are outside this bridge's cleanup contract; Windows is unsupported.

The earlier isolated OpenCode 2.0.28 continuity probe is available as
[`scripts/acp-smoke.ts`](/scripts/acp-smoke.ts), with effective configuration checks
in [`scripts/acp-smoke-config.ts`](/scripts/acp-smoke-config.ts). It requires live
provider credentials and does not run as part of `make check`.

Run `bun tests/live-context.ts` for the isolated real-CLI context acceptance gate
(requires `a2a`, reviewed OpenCode 2.0.28, and live provider credentials). It uses the
same configuration-verification helper and an ephemeral HTTP port, extracts the
returned context IDs, checks two independent marker conversations across four
turns, verifies two ACP sessions, and closes its owned gateway before cleanup.

Run `bun tests/live-cancellation.ts` for isolated real-CLI cancellation acceptance.
It submits a long text task asynchronously, captures the actual task ID, waits for
real assistant text while working, cancels via the CLI, checks canceled task lookup,
then verifies that owned workspace processes stopped before removing temporary files.
Neither live probe prints model reasoning or raw provider diagnostics.

## Releases

Maintainers need Bun, Git, `make`, and an authenticated GitHub CLI (`gh`) with
repository contents write access. Start on the repository's default branch with
a clean working tree and HEAD matching `origin` (commit and push changes first).

```sh
make release                 # Default: patch, e.g. 0.1.0 -> 0.1.1
make release BUMP=patch
make release BUMP=minor       # e.g. 0.1.1 -> 0.2.0
make release BUMP=major       # e.g. 0.2.0 -> 1.0.0
make release VERSION=0.1.0    # Explicit version; also supports the first release
```

`VERSION` takes precedence over `BUMP`. Versions must be plain `x.y.z`, cannot
decrease, and must have an unused `v`-prefixed tag. The command fetches `origin`,
runs `make check`, updates and commits `package.json` when the version changes,
creates an annotated tag, atomically pushes the default branch and tag, then
publishes a GitHub release on `origin` with generated notes. Runtime Agent Card
and ACP client versions come from `package.json`. It does not publish to npm or
attach binaries; GitHub provides source archives. Branch protection still applies.

Failures stop without deleting commits or tags. If the push fails, resolve the
reported cause, then push the retained release commit/tag with
`git push --atomic origin HEAD:refs/heads/<default-branch> refs/tags/v<version>`.
If GitHub publication fails after pushing, inspect `gh release view v<version>`;
if no release exists, retry with
`gh release create v<version> --verify-tag --generate-notes --title v<version>`.
Do not rerun the bump command to recover an existing release tag.

## Configuration

| Setting                | Description                                              | Default                                              |
| ---------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| `A2A_WORKSPACE`        | Existing, trusted absolute workspace path                | Required                                             |
| `A2A_PORT`             | Loopback HTTP port; `0` chooses an OS-assigned free port | `41241`                                              |
| OpenCode configuration | Provider, model, agent, tool/plugin/MCP permissions      | Operator-controlled workspace and launch environment |
| `OPENAI_API_KEY`       | Credential used by the isolated demo and live probes     | Required for those commands; never printed           |
| `TCK_DIR`              | External checkout of the pinned official TCK             | Required only for `make e2e-tck`                     |

The production gateway inherits OpenCode configuration; it does not use a separate
HTTP API selector or silently choose another backend. Never commit credentials.
Programmatic timeout and context-capacity options are described above.

## How it works

1. The official A2A SDK accepts a text message and manages its task and SSE events.
2. The executor maps its context to an ACP session and streams root assistant text into one artifact.
3. The ACP prompt's `stopReason` determines the final task state—not admission, idle status, or emitted text.

```text
Official A2A CLI / client
          | JSON-RPC + SSE
          v
   server.ts -> executor.ts -> acp-client.ts
                                  | stable ACP v1 / stdio
                                  v
                            opencode acp
```

The SDK owns task storage and event delivery. A narrow
[`request-handler.ts`](/src/request-handler.ts) adapter avoids duplicate artifact
persistence during SDK 1.3 cancellation. See [architecture](/docs/architecture.md).

## Commands

| Command                        | Description                                                        |
| ------------------------------ | ------------------------------------------------------------------ |
| `make help`                    | List available commands                                            |
| `make install`                 | Install the frozen Bun lockfile                                    |
| `make check`                   | Format check, lint, strict types, deterministic tests and build    |
| `make dev`                     | Run the foreground TypeScript watch server                         |
| `make build`                   | Compile TypeScript into `dist/`                                    |
| `make run`                     | Build and run the compiled foreground server                       |
| `make fmt` / `make fmt-check`  | Format with Oxfmt / check without changes                          |
| `make lint` / `make typecheck` | Run Oxlint / strict TypeScript checking                            |
| `make test`                    | Run deterministic tests without model access                       |
| `make doctor`                  | Check local prerequisites without installing software              |
| `make demo`                    | Real isolated CLI conversation with streamed completion and recall |
| `make e2e`                     | Real-model acceptance, including cancellation and failure paths    |
| `make e2e-tck`                 | Applicable checks from the externally installed official TCK       |
| `make clean`                   | Remove generated build and test artifacts                          |

## Compatibility and limitations

Verified with Bun 1.3.9, OpenCode 2.0.28, A2A 1.0, stable ACP v1, and a2a CLI 0.3.1.
Windows is unsupported. There is no Node/npm fallback workflow because Bun passed
the subprocess, stream, and real ACP compatibility gates.

This is a single-process, trusted-workspace gateway: no authentication, multi-tenancy,
parallel prompt execution, durable recovery, rich media, interactive approval/forms,
push notifications, outbound A2A, or request-scoped model/workspace selection.
Task/context state is ephemeral, and an unhealthy ACP bridge requires a gateway restart.
Full TCK certification and live permission-callback invocation are not claimed;
see [the exact acceptance scope](/docs/acceptance.md).

## Development

```sh
make install
make check
```

`make install` uses `bun install --frozen-lockfile`; dependency versions are exact.
`make check` runs formatting, lint, type checking, subprocess tests, and compilation.
Type checking includes source, tests, fixtures, and TypeScript scripts. Tests target
`./tests`, excluding generated copies and user-installed skills. Formatting and lint
also exclude generated/user directories.

Tests use the official ACP SDK with a controlled subprocess peer, not a paid model.
They cover lifecycle failures, ordering, permissions, busy/stale contexts, cancellation
races, timeouts, and cleanup. The [CI workflow](/.github/workflows/ci.yml) runs locked
installation and `make check` on pushes and pull requests without provider secrets.
Live probes are opt-in; they never run as part of ordinary CI.
See [quality baseline](/docs/quality-baseline.md) for warning-first size/complexity
reporting, whole-test runtime, native function/line coverage, and measurement limits.

### Real acceptance

```sh
# Requires the same isolated live prerequisites as the demo:
make e2e
```

The executable harness in [`tests/e2e.ts`](/tests/e2e.ts) tests the compiled
production entrypoint with the official CLI, real OpenCode, and OpenAI
`openai/gpt-6-luna`. It checks 14 scenarios including streaming, context isolation,
busy admission, cancellation, denied file creation, provider failure, actual owned
ACP-child death, restart, and active shutdown. Each gateway uses an OS-assigned
loopback port. Failures exit nonzero without publishing private model diagnostics.
No fixtures, replacement model servers, or skipped live tests are used.

The separately installed official A2A TCK can be run with
`TCK_DIR=/absolute/path/to/pinned/a2a-tck make e2e-tck`. Missing dependencies fail,
not skip. The applicable 17-check subset passed, but the broader TCK run had five
scenario-SUT failures; **full TCK conformance is not claimed**. Installation,
revision pins, exact results, the permission-callback limitation, and the source
size/scope comparison are recorded in [docs/acceptance.md](/docs/acceptance.md).

## Security

Do not expose this unauthenticated loopback service through a public proxy. Review
the workspace and effective OpenCode permissions, plugins, MCP servers and provider
configuration before running it. Denying ACP permission requests is not an OS sandbox,
and cancellation is not rollback. Demo/E2E isolation does not apply automatically
to ordinary `make run` launches.

Do not post credentials, private prompts, reasoning, or raw provider logs in issues.
For vulnerability reporting, use the repository's
[GitHub security reporting options](https://github.com/tbrandenburg/opencode-a2a-lite/security).

## Contributing

Keep changes focused on the thin gateway. Read [AGENTS.md](/AGENTS.md),
[architecture](/docs/architecture.md), and [pitfalls](/docs/pitfalls.md), run
`make check`, and describe behavioral evidence and limitations in your PR.
Changes to streaming, permissions, cancellation, or lifecycle need the relevant
live acceptance checks as well as deterministic regressions.

## License

[MIT](/LICENSE).
