# Real acceptance evidence

## Safeguard follow-up verification

Coordinator verification at **2026-10-26T08:49:01Z** for issues #1 and #2:

- CI-equivalent `make check` with native coverage/JUnit passed **131 tests,
  0 failures, 583 assertions across 9 files**, plus formatting, lint, strict
  types and build. The measured test process took 36.734s; this is an observation,
  not a runtime budget. Six pre-existing structural findings remain warnings.
- JUnit contained 131 test cases and zero failures/errors; LCOV included the four
  expected production modules. Production remains 4 files / 801 physical lines;
  deterministic test files are 9 files / 1,733 physical lines, excluding fixtures.
- A deliberately failing test in a disposable directory made the real test
  wrapper exit 1 and record exit 1. The probe was removed; no failure was hidden.
- `make e2e` passed **14/14 real-model production-entrypoint scenarios** after
  integration and adversarial review. Production source remained unchanged; its
  source-tree hash still matches the four-file hash recorded below.
- After integration, `bun tests/live-cancellation.ts` passed with real root text,
  confirmed cancellation, stored canceled state and owned-process cleanup.
  A loopback port-0 bind checked free-port allocation before each live gate;
  no existing service was stopped.
- `bun test ./tests/server.test.ts --rerun-each=5` passed 85 tests / 355 assertions
  without retries. Both independent adversarial reviews returned zero findings.
  A final `/proc` ownership check found zero remaining live-acceptance processes.

The stock SDK defect is reported as
[a2aproject/a2a-js#798](https://github.com/a2aproject/a2a-js/issues/798).
[Cancellation evidence](/docs/sdk-cancellation.md) keeps issue #1 open until a
fixed official SDK release passes its removal gate.
[Quality measurements](/docs/quality-baseline.md) distinguish native function/line
coverage from unmeasured branch coverage and mutation score. The remaining
sections preserve the original MVP acceptance evidence and its historical counts.

## Outcome and limits

The real production-entrypoint acceptance gate passed **14/14 scenarios**.
The separately scoped official A2A 1.0 JSON-RPC TCK gate passed **17 tests,
0 failures, 0 skips**, with one explicitly deselected inapplicable test.
**Full TCK conformance is not established:** the initial broader MUST run had
**63 passed, 5 failed, 166 skipped** (234 reported test cases).

Live file-write denial passed with zero recorded tool calls and an absent target
file. A live ACP permission callback was **not established**: denied configuration
can remove tools before the model calls them. Callback rejection is verified by
the deterministic real-ACP-subprocess tests, not represented as live-model evidence.
This is configuration isolation, not an operating-system sandbox.

Last verified by the coordinator: **2026-10-26T07:28:38Z**, following a complete
`make install`, `make check`, `make demo`, `make e2e`, and applicable TCK rerun.
The source hashes below identify the exact tested production implementation.
The implementation commit is recorded in the publication section after committing;
later documentation-only changes do not change those source hashes.

Production source-tree SHA256 (`src/`, four files):
`3009fae7cc17278d2a658278f962562afd3b7ca57c543c6cbdbbb49c0f125dd5`.
Source plus acceptance/probe files (`src/`, `tests/`, `scripts/`, 22 files):
`f165ecaf7dcbb22d12fd8edbd28d7e5c109d62ff76c9e9d9729d915719edee53`.
The hash includes relative paths and bytes, not generated `dist/` output:

```sh
python3 - <<'PY'
from pathlib import Path
import hashlib
digest = hashlib.sha256()
roots = ('src',)  # Use ('src', 'tests', 'scripts') for the second hash.
for file in sorted(path for root in roots for path in Path(root).rglob('*') if path.is_file()):
    digest.update(str(file).encode() + b'\0' + file.read_bytes() + b'\0')
print(digest.hexdigest())
PY
```

## Exact versions and reproduction

| Component                              | Verified version                                             |
| -------------------------------------- | ------------------------------------------------------------ |
| Bun                                    | 1.3.9 (`cf6cdbbb`)                                           |
| OpenCode                               | `opencode v2.0.28` (enforced by isolation helper and bridge) |
| Official `a2aproject/a2a-cli`          | `a2a version v0.3.1`                                         |
| Model                                  | `openai/gpt-6-luna`                                          |
| A2A wire protocol / ACP                | 1.0 / 1                                                      |
| A2A JS SDK                             | `@a2a-js/sdk` 1.3.0                                          |
| ACP JS SDK                             | `@agentclientprotocol/sdk` 2.0.2                             |
| Express / TypeScript                   | 5.3.0 / 7.0.2                                                |
| Official TCK                           | 1.0.0, revision `d4d6fae7887f88ef607fb461c13e3b0e1802f19b`   |
| External TCK Python / uv               | CPython 3.13.9 / uv 0.12.7                                   |
| External TCK pytest / httpx / protobuf | 9.0.2 / 0.28.1 / 6.33.5                                      |

On Linux, install the pinned tools and provide `OPENAI_API_KEY` securely in the
environment. Neither a key nor inherited environment contents are logged.

```sh
make install
make check
make e2e
```

Expected summaries:

```text
93 pass
0 fail
376 expect() calls
Ran 93 tests across 7 files.
{"liveAcceptance":true,"passed":14,"failed":0}
```

[`tests/e2e.ts`](/tests/e2e.ts) is an executable, deliberately not named
`*.test.ts`; `bun test ./tests` does not discover paid acceptance runs. `make e2e`
builds and runs the compiled [`src/server.ts`](/src/server.ts) production
entrypoint. The live probes are not mocked. The deterministic suite separately
uses a controlled ACP subprocess peer and is not labelled E2E.

The shared [`isolation verifier`](/scripts/acp-smoke-config.ts) creates a private
HOME/XDG/workspace, permits exactly one verified configuration document, denies
tools, and excludes inherited provider overrides, plugins, instructions, skills,
MCP sources and shared-service discovery. Managed `/etc/opencode` causes a refusal.
Each HTTP server and private service uses port 0. Requests/readiness/shutdown have
deadlines; the official CLI receives only isolated HOME and PATH, not provider
credentials. CLI success means a valid protocol exchange, **not** successful task
completion: negative cases inspect `TASK_STATE_FAILED`, its safe diagnostic, and
empty artifacts. Provider stderr/reasoning and private diagnostics are not printed.

## Scenario matrix

| ID    | Real scenario and assertions                                                                                                                                                                                                  | Recorded outcome                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| E2E01 | Production readiness; official CLI card; streaming advertised; one JSONRPC interface at protocol 1.0; OS-assigned port                                                                                                        | Passed                                                                                  |
| E2E02 | Nonstream CLI prompt; random exact marker; completed task with real task/context IDs                                                                                                                                          | Passed                                                                                  |
| E2E03 | Stream CLI JSONL through existing independent jq verifier; submitted snapshot, working, stable identities/artifact, append ordering, final empty chunk, exactly one completion; stored text equals marker without duplication | Passed                                                                                  |
| E2E04 | Follow-up uses actual first context; recalls marker; same context and different task ID; completed                                                                                                                            | Passed                                                                                  |
| E2E05 | Second separate context and follow-up recall its own random marker, not the first marker; completed                                                                                                                           | Passed                                                                                  |
| E2E06 | Real 8000-word prompt produces text while working; concurrent new-context request returns busy failed task without artifacts; original still working                                                                          | Passed                                                                                  |
| E2E07 | Official CLI cancels the genuinely active task; stored terminal is canceled; partial text retained; completion-race branch requires honest not-cancelable response                                                            | Passed: **true cancellation**, not a completion race                                    |
| E2E08 | Ask model to write a disposable file, verify absence before/after; completed explanatory text; read only assistant content-type/count metadata across its fresh isolated session                                              | Passed: **0 recorded tool calls**, content types reasoning/text; no live callback claim |
| E2E09 | Unknown explicit context fails with no artifacts; fresh context completes with expected text                                                                                                                                  | Passed                                                                                  |
| E2E10 | Wait for real active text; locate exactly one direct ACP child of the owned gateway by PPid, cwd and argv; SIGKILL that PID only; task fails; context invalidates; zero replacement ACP children                              | Passed; no automatic restart/resend observed                                            |
| E2E11 | Stop and restart production process; old context fails; new context completes with expected text and new ID                                                                                                                   | Passed                                                                                  |
| E2E12 | Data-only input fails with text-only diagnostic and no artifacts; subsequent valid random-marker text completes                                                                                                               | Passed                                                                                  |
| E2E13 | Separate private HOME/service with deliberately invalid OpenAI credential; async task reaches failed, never completed; no credential text in artifacts                                                                        | Passed                                                                                  |
| E2E14 | SIGTERM production gateway during a real active text task; process exits; listener refuses connection; exact temporary-root `/proc` checks finish before temporary directories are removed                                    | Passed                                                                                  |

Cleanup runs in `finally`, checks `/proc` cwd ownership against exact temporary
roots, waits for the private lease to stop, and refuses removal while owned-root
processes remain. The child-death probe never signals a name-matched process or
an unrelated service. The three isolated workspaces must each report
`{"cleanup":true,"processesStopped":true}` before the final success record.

Initial harness development exposed two test assumptions, not production defects:
the CLI correctly exits 0 for a failed task, and a bare requested response token
once elicited “Understood.” The gate now checks task state/diagnostics and uses a
random remember-marker prompt for recovery. Successful evidence comes from a
fresh complete rerun; partial earlier runs are not counted as acceptance passes.

## Official TCK, external dependency only

The current official main branch supports A2A 1.0, including `supportedInterfaces`
and `SendMessage`/`SendStreamingMessage`. The remote also exposes legacy `0.3.x`
and `0.3.0-beta-x` branches; no downgrade or protocol rewrite was used.

Install outside the gateway repository (the gateway remains TypeScript-only):

```sh
git clone https://github.com/a2aproject/a2a-tck.git /tmp/opencode/a2a-tck-acceptance
git -C /tmp/opencode/a2a-tck-acceptance checkout d4d6fae7887f88ef607fb461c13e3b0e1802f19b
uv sync --frozen --project /tmp/opencode/a2a-tck-acceptance
TCK_DIR=/tmp/opencode/a2a-tck-acceptance make e2e-tck
```

The runner requires that exact clean tracked revision and its `.venv/bin/python`;
missing installation or an unexpected revision fails nonzero. No silent skip is
implemented. The gateway is real, isolated and ephemeral as in `make e2e`.

The applicable gate invokes the **unmodified official pytest tests** directly:

```sh
.venv/bin/python -m pytest --sut-host "$SUT_URL" --transport jsonrpc -m must \
  tests/compatibility/agent_card/test_agent_card.py \
  tests/compatibility/jsonrpc/test_error_codes.py \
  tests/compatibility/jsonrpc/test_sse_streaming.py::TestSseStreamingFormat \
  tests/compatibility/jsonrpc/test_sse_streaming.py::TestSseSubscribeToTask::test_subscribe_nonexistent_task_returns_error \
  -k 'not unsupported_operation_error' -q \
  --compatibility-report=reports/applicable --junitxml=reports/applicable.xml
```

`SUT_URL` above is the actual port-0 readiness URL; `make e2e-tck` supplies it.
Result: **17 passed, 1 deselected**. JUnit additionally enforces exactly 17 tests,
zero failures/errors/skips. The deselected test tries to trigger unsupported
streaming on a server that advertises streaming, so its precondition is false.
Coverage: card retrieval/schema/interfaces, JSON-RPC error codes and ranges
(missing task/cancel, unsupported push, wrong content type, unsupported version),
SSE JSON-RPC envelope/StreamResponse schema, missing-task subscription error.

The initial command used official `run_tck.py --transport jsonrpc --level must`
with explicit test paths after `--`. At this revision `run_tck.py:34-70` always
prepends `tests/compatibility/`, so paths **add** to rather than restrict collection.
The exact initial invocation (from the external clone, against its live readiness
URL) was:

```sh
.venv/bin/python run_tck.py --sut-host "$SUT_URL" --transport jsonrpc --level must -- \
  tests/compatibility/agent_card/test_agent_card.py \
  tests/compatibility/jsonrpc/test_error_codes.py \
  -k 'not unsupported_operation_error' -q
```

Its real result was 63 passed, 5 failed, 166 skipped. The failures were:

1. `TestTextArtifact::test_task_has_text_artifact[jsonrpc]`: expects literal
   `Generated text content` for `TCK artifact test`.
2. `TestFileArtifact::test_task_has_file_artifact[jsonrpc]`: expects raw file and `output.txt`.
3. `TestFileUrlArtifact::test_task_has_file_url_artifact[jsonrpc]`: expects URL file and `output.txt`.
4. `TestDataArtifact::test_task_has_data_artifact[jsonrpc]`: expects a particular JSON data part.
5. `TestMessageResponse::test_returns_message_with_text_part[jsonrpc]`: expects a direct Message, not a Task.

Those tests target the generated TCK scenario SUT's canned responses/message IDs;
this text-only live-model gateway does not implement that behavior. No test or
gateway was changed to fake those responses. The 166 skips are the external TCK's
own transport/scenario prerequisite decisions, not passes. Detailed initial and
applicable reports remain under the external clone's `reports/`; raw reports are
not copied here because they include host metadata and model text. The applicable
subset is useful protocol evidence, **not** a full certification. The TCK's
aggregate percentage includes unexecuted registry requirements and is not quoted
as the percentage of this subset passing.

## Size, state ownership and scope comparison

Compared against a fresh read-only clone of
[`tbrandenburg/opencode-a2a`](https://github.com/tbrandenburg/opencode-a2a), revision
`7c67017cd863347995884064d87c61848d79c1be`. No fork code was modified or executed.
Counts use production `src/**/*.ts` for lite and `src/**/*.py` for the fork,
excluding tests, generated build output, dependencies and documentation.

| Measure                                           | Lite working tree                      | Pinned Python fork                                |
| ------------------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| Production source files                           | 4                                      | 95                                                |
| Physical source lines, including comments/blanks  | 801                                    | 21,781                                            |
| Nonblank source lines (not compiler semantic LOC) | 766                                    | 19,630                                            |
| Direct required runtime dependencies              | 3                                      | 14                                                |
| Transport to OpenCode                             | Persistent official ACP SDK subprocess | Native HTTP V2 adapter/event hub/execution engine |

Lite's complete production file inventory: `src/acp-client.ts` 332 lines,
`src/executor.ts` 223, `src/request-handler.ts` 60, `src/server.ts` 186. These four
TypeScript modules are compiled by `make build`; test/script output in `dist/`
is excluded. Counts can be reproduced using `Path('src').rglob('*.ts')` or
`rglob('*.py')`, `read_text().splitlines()` and `bool(line.strip())`.

Lite's dependencies are `@a2a-js/sdk`, `@agentclientprotocol/sdk`, and `express`.
The fork's 14 required declarations in `pyproject.toml:27-47` are `a2a-sdk`,
`aiosqlite`, `certifi`, `click`, `fastapi`, `httpx`, `pydantic`,
`pydantic-settings`, `protobuf`, `pyasn1`, `sqlalchemy`, `sse-starlette`,
`urllib3`, and `uvicorn`. This compares direct declarations, not transitive package
counts, OpenCode's dependencies, deployment size, or security quality.

State ownership is simpler because scope is narrower, not because state vanished:

- Lite owns ACP transport/turn/cancel/shutdown state in `acp-client.ts:18-332`,
  context/session bindings and one admission slot in `executor.ts:32-223`, and
  task-store cancellation synchronization in `request-handler.ts:11-60`.
  The official SDK owns wire parsing, task storage, event buses and SSE.
- The fork additionally maintains native invocation enqueue/delivery/terminal and
  abort settlement (`upstream/v2_execution.py:49-99`), subscription/event correlation
  (`upstream/v2_events.py`), rich text/reasoning/tool chunk assembly and caches
  (`execution/stream_state.py:16-84`), identity/workspace-aware execution setup
  (`execution/coordinator.py:63-100`), persisted session/owner/interrupt bindings
  (`server/state_store.py:37-74`), and interrupt expiry/tombstone resolution
  (`interrupt_request_tracker.py:9-75`, `runtime_state.py:7-23`). This is a named
  state-area comparison, not a purported numeric count of finite-state machines.

Correctness evidence here covers lite's enumerated matrix plus deterministic
regressions, not the fork. Smaller LOC does not prove a more correct implementation.
Lite deliberately omits authentication/multi-tenancy, persisted restart recovery,
workspace routing, rich file/data/reasoning/tool outputs, interactive approval,
push notifications, deployment hardening, parallel turns and native HTTP recovery.
It is loopback-only; contexts/task storage remain memory-only, and a failed bridge
requires a new gateway instance. ACP's lack of a stable turn ID and escaped-process
limitations remain as described in the [README](/README.md). These omissions and
the live-callback/full-TCK limits preclude a claim of feature parity or unrestricted
production readiness.

## Follow-up tracking

- [SDK cancellation workaround](https://github.com/tbrandenburg/opencode-a2a-lite/issues/1): remove the narrow adapter only after upstream fixes and regression verification.
- [Quality-drift baseline](https://github.com/tbrandenburg/opencode-a2a-lite/issues/2): measure structural gates before extending the MVP; no extra infrastructure is part of this implementation.

## Publication identity

Tested implementation commit: `7914804242bd7a75779a2232f5c3320a130f2d5a`.
This documentation-only follow-up records that commit without modifying the
tested production, test, or script source trees. The hashes above remain unchanged.
Remote CI results are recorded in the implementation PR rather than inferred from
local checks. This first subprocess/security-boundary implementation is left open
for maintainer review rather than automatically merged as a low-risk change.
