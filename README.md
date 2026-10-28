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

## Scope freeze

The adapter contract covers protocol mapping, admission, streaming, context continuity,
cancellation, and owned-resource cleanup. Opaque model reasoning and output quality
are outside that contract; protocol completion is not proof of answer correctness.
Network/topology templates are research artifacts, not adapter features; no new
schedules, roles, scorers, or orchestration-platform work is in scope.
Active example TypeScript must not exceed production TypeScript by physical line
count. The managed network/topology lab is retired; only small guard/interop helpers
and manual usage guidance remain. Retirement does not resolve historical defects.

For model-issued MCP delegation, use the
[manual one-worker CLI smoke](/examples/agent-network/README.md#manual-one-worker-cli-smoke).
Its owned, warmed OpenCode server plus `opencode run --server` has one authorized
two-turn observation on 2026-10-28. Cold standalone startup exposed a readiness
race; the warmed observation does not resolve historical E2E/topology failures.
Every new live run still requires explicit billable opt-in.

## Highlights

- **Official SDKs:** A2A JSON-RPC/SSE and stable ACP v1, without OpenCode HTTP adapters.
- **Live conversations:** streamed assistant text and follow-up tasks in the same context.
- **Honest outcomes:** completion comes from the ACP prompt result; cancellation races retain the actual outcome.
- **Small footprint:** one managed ACP subprocess, one active prompt globally, in-memory state and no database.

## Quick start

### Prerequisites

- Linux, Bun **1.3.9**, and exactly **`opencode v2.0.28`** on PATH.
- Reviewed OpenCode provider/model configuration and real model access for prompts.
- The separate official [`a2a` CLI](https://github.com/a2aproject/a2a-cli) (tested with **0.3.1**) is the client, not part of this gateway.
- Contributors also need Node.js **22+** for the independent SDK reproducer and npm packaging,
  `jq` for stream-verifier tests, and GNU `timeout` for the live demo. Packaging checks need npm.

### One-command launch (unreleased)

**npm-registry publication of `@tbrandenburg/opencode-a2a-lite` is pending.**
Version **0.1.1** is prepared for public distribution, but npm authentication and
namespace ownership must be verified before registry publication. The following
is the intended post-publication UX, not a claim that an npm package is available:

```sh
# 1. In an explicitly trusted workspace, start the foreground gateway:
bunx @tbrandenburg/opencode-a2a-lite --workspace .
# Alternative package runner, with Bun AND npm/Node installed:
npx --yes @tbrandenburg/opencode-a2a-lite --workspace .

# 2. In another terminal, discover the card:
a2a card get http://127.0.0.1:41241
# 3. Stream a prompt:
a2a send -a http://127.0.0.1:41241 'Reply with a short greeting.' --stream
# Optional: continue with the actual contextId from the previous response:
a2a send -a http://127.0.0.1:41241 --context-id <returned-context-id> 'Follow-up question'
```

Use one launch command, not both simultaneously. `npx` is a package runner, **not
a Node-only runtime replacement**: the executable's Bun shebang requires Bun on PATH.
No repository clone, `make`, or consumer TypeScript compilation is needed for the
prebuilt tarball. Pin `@<version>` after publication for reproducible launches.

`--workspace <path>` is an explicit trust decision: relative paths (including `.`)
are resolved to absolute paths; paths with spaces must be quoted. The gateway
never implicitly trusts the current directory. It inherits OpenCode configuration,
tools, plugins and MCP; review and isolate those sources before launching. It is
not a sandbox. **Never expose this unauthenticated server through a public proxy.**

`--workspace` overrides `A2A_WORKSPACE` (which still requires an absolute path).
`--port <0..65535>` overrides `A2A_PORT`; default `41241`, or use `0` for an
OS-assigned port. Read stdout's `{"ready":true,"url":"http://127.0.0.1:.../"}`
and use that actual URL for client commands. SIGINT/SIGTERM stop the foreground
gateway and its owned ACP process group. `--help`/`-h` and `--version`/`-v` do not
require OpenCode, workspace or provider access. Invalid arguments fail nonzero
without reflecting untrusted input or peer diagnostics.

### Run from source (available now)

Use Bun **1.3.9** (pinned in `package.json` and CI) with the locked dependencies:

```sh
make install
make check
# Optional provider-free tarball installation/CLI checks (requires npm):
make package-smoke
# Same CLI, directly from the checkout:
bun src/cli.ts --workspace . --port 0
```

### Configure and run

Name workers before their first Agent Card is published, using the existing launch
command (run each in a separate terminal and use its printed readiness URL):

```sh
A2A_NAME=planner A2A_DESCRIPTION='Plans implementation work' A2A_TAGS='planning,design' \
  bun src/cli.ts --workspace . --port 0
A2A_NAME=reviewer A2A_DESCRIPTION='Reviews proposed changes' A2A_TAGS='review' \
  bun src/cli.ts --workspace . --port 0
```

These variables also work with the packaged launch command and `make run`.
Names (128 characters), descriptions (1,024), and tags (64 each, up to 16 supplied
entries) are trimmed and must be nonblank and contain no control characters.
`A2A_TAGS` is a comma-separated list with no quoting or escaping inside the value:
commas separate tags, and empty entries are invalid. Tags are case-sensitive,
deduplicated in input order, and appended after the retained `text` tag.
Omitted fields keep their existing defaults. Identity is descriptive metadata,
not authentication, permissions, model selection, or additional skills.

For embedding, see [`createGateway`](/src/server.ts). CLI identity settings above
do not require a TypeScript caller.

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
No HTTP port opens on workspace/ACP initialization failure. SIGINT/SIGTERM stop
admitting requests, attempt bounded cancellation of active work, then send stdin
EOF with a grace period before escalating. On Bun, the loopback listener remains
open but returns HTTP 503 for new requests through bridge cleanup and the following
1s HTTP drain; it is then force-closed with lingering connections. Only the bridge's owned
subprocess group is signalled. Confirmed ACP cancellation yields canceled; a timeout,
transport closure, or process death yields failed rather than invented cancellation.

### ACP bridge

The internal [`createAcpBridge`](/src/acp-client.ts) owns one pinned ACP subprocess,
forwards only active root-session assistant text and denies permission requests.
It is not a sandbox. Embedders must await terminal `close()` in `finally` and own
configuration isolation. See [architecture](/docs/architecture.md) for boundaries.

Default deadlines: 30s startup/session creation, 120s prompts, 5s cancellation,
then 5s process shutdown. Failures do not trigger retries or publish peer diagnostics.

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

The workflow below creates **GitHub releases only**, not npm packages. For the
separate secure npm publication and required external-directory/registry acceptance,
see [distribution and manual npm release](/docs/distribution.md). The proposed npm
scope remains unverified and registry publication is pending until that procedure is completed.

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

| Setting                | Description                                               | Default                                              |
| ---------------------- | --------------------------------------------------------- | ---------------------------------------------------- |
| `A2A_WORKSPACE`        | Existing, trusted absolute workspace path                 | Required                                             |
| `A2A_PORT`             | Loopback HTTP port; `0` chooses an OS-assigned free port  | `41241`                                              |
| `A2A_NAME`             | Descriptive worker name, at most 128 characters           | `OpenCode A2A Lite`                                  |
| `A2A_DESCRIPTION`      | Descriptive worker summary, at most 1,024 characters      | Existing plain-text ACP gateway description          |
| `A2A_TAGS`             | Up to 16 comma-separated tags, at most 64 characters each | No additional tags; `text` is retained               |
| OpenCode configuration | Provider, model, agent, tool/plugin/MCP permissions       | Operator-controlled workspace and launch environment |
| `OPENAI_API_KEY`       | Credential used by the isolated demo and live probes      | Required for those commands; never printed           |
| `TCK_DIR`              | External checkout of the pinned official TCK              | Required only for `make e2e-tck`                     |

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
| `make package-smoke`           | Inspect and run an npm tarball outside the checkout; no provider   |
| `make interop-test`            | Focused provider-free MCP/A2A checks; verified bridge required     |
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
Windows is unsupported. There is no Node-only runtime fallback: `npx` can launch
the packaged executable, but still needs Bun for subprocess/ACP behavior.

This is a single-process, trusted-workspace gateway: no authentication, multi-tenancy,
parallel prompt execution, durable recovery, rich media, interactive approval/forms,
push notifications, outbound A2A, or request-scoped model/workspace selection.
Task/context state is ephemeral, and an unhealthy ACP bridge requires a gateway restart.
Full TCK certification and live permission-callback invocation are not claimed;
see [the exact acceptance scope](/docs/acceptance.md).

## Development

The managed multiworker network/topology lab has been retired, including its model
profiles, readiness plugin, schedules, scorers, fixtures and runner commands. It was
research, not an adapter feature. Historical [network findings](/docs/agent-network-findings.md),
[topology findings](/docs/topology-investigation-findings.md),
[integrity diagnostics](/docs/topology-integrity-diagnostics.md) and
[authorized live results](/docs/authorized-live-acceptance.md) preserve original
failures and Git provenance; retirement does not make E2E06 or topology failures pass.
The pre-retirement source remains at
[a70b639](https://github.com/tbrandenburg/opencode-a2a-lite/tree/a70b639/examples/agent-network).

### OpenCode coordinator: use `opencode run`

Follow the [one-worker setup](/examples/agent-network/README.md#manual-one-worker-cli-smoke)
to start the worker/directory, configure the guarded project-local MCP entry, warm
the owned private OpenCode server, and set `SERVER` and `PROMPT` from the recipe.
After separate billable opt-in, run from the reviewed coordinator project:

```sh
opencode run --server "$SERVER" --agent coordinator --format json "$PROMPT"
```

No TypeScript coordinator is needed. The prompt discovers the worker, sends one
request, then follows up using the returned context and no old task ID. Verify
actual session tool calls, completed tasks/artifacts and owned cleanup—not just
the final answer. Reuse the same warmed server; cold `--standalone` is not a
substitute. The warmed one-worker smoke has one observed pass, not repeatability
evidence. The project [multi-a2a-agent skill](/.opencode/skills/multi-a2a-agent/SKILL.md)
contains this runbook and progressive topology references; multiworker pages remain
research-only, not runnable procedures. Optional
[TypeScript helpers](/examples/agent-network/client-guide.md) are for host/CI use;
see their [consumer inventory](/examples/agent-network/README.md#retained-support-inventory).

`A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test` retains
provider-free real-bridge coverage of the adapter boundary: catalog/discovery,
actual fresh-context SSE, continuation, busy, cancellation, uncertainty, guard
denials, receipt privacy and attempt budgets. It does not claim model reasoning
quality or model-callable readiness. The single-gateway `make demo` and 14-scenario
production `make e2e` remain opt-in; no managed multiworker runner remains.

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
installation, `make check`, `make package-smoke`, and checksummed bridge interop on pushes and pull requests
without provider secrets. The package smoke uses a disposable npm cache and consumer
directory outside the checkout, installs runtime dependencies from the registry,
and runs the installed `bin` via `npm exec`. It uses the controlled ACP fixture
for startup/lifecycle, not a live model or evidence of registry publication.
Live probes are opt-in; they never run as part of ordinary CI.
See [quality baseline](/docs/quality-baseline.md) for warning-first size/complexity
reporting, whole-test runtime, native function/line coverage, and measurement limits.
See [deterministic test selection](/docs/test-reduction.md) for the compact-suite
risk mapping, before/after evidence and required versus opt-in acceptance commands.

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
