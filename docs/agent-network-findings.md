# OpenCode / a2abridge network findings

## Worker identity, manual peers and bounded waits acceptance

The issue #11–#13 integration was verified on **2026-10-27**, with the same
Bun/OpenCode/bridge/model pins listed below. No production transport, SDK pin,
gateway admission policy or runtime package dependency changed.

- Coordinator deterministic gate: `make check` with coverage/JUnit reporting;
  **277 tests across 17 files, zero failures**, plus formatting, lint, types and
  build. Seven advisory production size/complexity warnings remained.
- `make package-smoke`: **12 allowlisted package files**, installed CLI and direct
  server identity, sanitized failure cases, signals and process cleanup passed.
- `A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test`: passed in
  a synthetic environment with a fresh temporary base; **29/40 attempted calls**.
  It exercised real MCP/guard/bridge/gateway/controlled-ACP traffic, not a model.
  The upstream SDK emitted a terminal-task subscription diagnostic during a
  negative scenario; the gate's outcome/cancellation assertions passed.
- The production `make e2e` gate passed **14 scenarios, zero failures** after
  identity integration, including context isolation, streaming, cancellation,
  backend death, invalid credentials and shutdown. An independent process scan
  found zero remaining live-probe processes.

The manual recipe's two JSON fragments were exercised in private, configuration-
verified projects using its fixed illustrative ports and compiled CLI launches.
The coordinator completed a real model → MCP → A2A → gateway → ACP request;
an independent task lookup verified the completed state and exact expected
artifact. Both first cards had the intended identity/tags; an unlisted peer was
denied. Heartbeats were stopped and actual directory expiration was observed.
Four profile cleanups passed, and the three ports were reusable afterward.
For acceptance instrumentation only, the reviewed metadata-only readiness
observer was merged into the manual coordinator fragment: **four** permission-
filtered snapshots passed. The published manual fragment itself has no observer
and does not promise automatic readiness from catalog arrival.

Two unchanged integrated `make network-demo` attempts were retained separately:

| Start/end UTC     | Outcome | Evidence                                                                                                                                       |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 12:16:33–12:18:19 | Failed  | Interoperability, lifecycle and planning passed; contract results mismatched the unchanged oracle at `collaborate.ts:88`; cleanup passed.      |
| 12:19:35–12:21:18 | Passed  | Both collaboration tasks, exact handoff/proof checks, 25 paired calls/results, 11 permission-filtered snapshots, heartbeat and cleanup passed. |

The failing run's raw model answer was deliberately not retained, so its exact
mismatching results are unknown. Prompt ambiguity is a hypothesis, not a proven
cause. The separate [live contract-results follow-up](https://github.com/tbrandenburg/opencode-a2a-lite/issues/14)
preserves the sanitized failure and investigation. No assertion was weakened,
no automatic retry was introduced, and these two attempts are not a reliability
benchmark. Focused provider-free issue #13 acceptance does not resolve the broader
CI/interoperability scope of [issue #10](https://github.com/tbrandenburg/opencode-a2a-lite/issues/10).

## Scope and first observed result

The first successful live run completed on **2026-10-27**, from
**08:35:12.567Z to 08:36:39.635Z**. Two collaboration tasks passed using an
actual OpenCode coordinator, a2abridge MCP server, and two independent OpenCode
A2A gateway workers. No model or transport fixtures were substituted.

After safety review and diagnostic improvements, the final complete run passed
from **09:07:34.817Z to 09:09:13.015Z**. This report preserves unsuccessful attempts
as well as the final result; a passing run is not a reliability benchmark.

The durable definition and run instructions are in
[examples/agent-network](/examples/agent-network/README.md). Nothing was installed
as a user service or written to global OpenCode configuration. The experiment
stops its network at the end; it is not a persistent agent directory deployment.

## Components and measured evidence

| Component         | Verified configuration                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| Gateway           | This repository's actual `createGateway`, executor and ACP bridge; SDK 1.3.0                      |
| OpenCode          | Exact `opencode v2.0.28`; private ACP processes and isolated HOME/XDG per role                    |
| Model             | `openai/gpt-6-luna` for coordinator, planner and reviewer                                         |
| Bridge            | a2abridge 4.0.2, commit `047afda`, Linux amd64 release executable                                 |
| Bridge artifact   | Archive SHA256 `b74f01378c880486a41acd5780364e238d59a1a1aec418c322d1c5bd7f40772a`                 |
| Executable pin    | SHA256 `bdfa1f6894f5547dfef539140139e162402ca6ab33bb7602d9335d125d414db2`                         |
| Harness           | Bun 1.3.9; official MCP TypeScript SDK 1.29.0 as a development dependency                         |
| Discovery         | Explicit registration and heartbeat to a temporary loopback directory, then MCP `a2a_list_agents` |
| Coordinator tools | Six allowlisted native MCP tools; Code Mode, shell, edit and native subagents denied              |
| Workers           | Deny-only tool policy, no configured MCP servers, separate workspaces and contexts                |

The bridge child receives a synthetic environment without the provider key.
The coordinator and workers receive only the existing live-probe environment
allowlist. Each role's observed configuration source document is compared with
an independently constructed expected configuration, rather than treating
`debug config` as a merged configuration dump.

The final coordinator configuration explicitly admits one audited local readiness
observer plugin; workers retain empty plugin configurations. The table's tool
restriction refers to model-callable tools, not this metadata-only observer.

## Collaboration tasks

### 1. Constrained planning

Planner knew three indivisible candidates: alpha cost 4/value 8, beta cost 3/value 6,
gamma cost 2/value 3, with capacity 5. Reviewer independently knew that beta requires
alpha. The coordinator had to obtain the proposal, request review, and return the
review to the planner before deciding.

Observed correct final choice: **alpha**, cost **4**, value **8**. The tempting
beta+gamma value-9 combination is infeasible once the reviewer's constraint is known.
The first successful run used **3 worker turns** and **5 coordinator MCP calls**;
the coordinator turn took **18,912 ms**.

### 2. Contract review

Planner had the proposal `return !limit || value <= limit;` and the intended
nullish-unlimited/inclusive-bound semantics. Reviewer had four cases:
`(1,0)`, `(0,0)`, `(2,null)`, `(3,3)`.

Observed correct results: **false, true, true, true**, with the **nullish-only**
unlimited guard rather than truthiness. This was contract analysis, not a claim
that arbitrary generated code was executed. The first successful run used
**3 worker turns** and **7 coordinator MCP calls**; its turn took **23,599 ms**.

## Why this is evidence of actual delegation

- Workers received unpredictable per-run proof strings in their separate system
  contexts; those strings were not supplied to the coordinator initially.
- Both final answers included the correct proofs.
- Worker receipts show real ACP prompt turns; corresponding MCP requests have
  matching SHA256 input hashes and peer URLs.
- Each task's measured worker order was **planner → reviewer → planner**.
- The reviewer received the planner proof, and the final planner turn received
  the reviewer proof. The final oracle now asserts that order and placement.
- Actual runtime registration and permission-filtered model-request snapshots prove
  tool visibility. A real-connection catalog receipt alone is not that proof; the
  host-side MCP preflight is also a separate connection.

The coordinator was the model deciding and issuing the handoff tool calls, not
a host script supplying precomputed worker answers. The host validated known
synthetic task invariants; it did not run a broader benchmark.

## Interoperability and lifecycle observations

The first successful run recorded **25 forwarded MCP calls / 25 result receipts**:
11 sends, 9 task lookups, 3 discoveries, 1 streaming send and 1 cancel. One MCP
error result was the intentional unknown-task probe, not a failed acceptance run.
Two additional tool requests were rejected locally: an unapproved endpoint and
an unlisted tool.

Passed observations:

- Exact streamed marker reconstruction and terminal completion.
- Follow-up using the actual returned context ID, a distinct task ID and exact marker recall.
- Cancellation after real assistant text appeared, with stored canceled state.
- A concurrent request to the same worker failed as busy, while another worker
  remained callable. Each gateway's global single-turn limit therefore remains
  a real deployment constraint, not a shared queue.
- The native-write probe left its sentinel absent without delegating the write.
  This supports the configured restriction, not an OS sandbox guarantee.
- Four isolated profile cleanups succeeded; an independent `/proc` check found
  zero remaining processes rooted in the live-probe workspaces.

## Limitations and hiccups

1. **Polling budget failure:** the first attempt passed basic interoperability
   but polled every 100 ms and hit the proxy's 40-call safety budget before it
   attempted cancellation. Receipts proved a `budget` rejection. Polling was
   changed to every 4 seconds; the budget was not increased. That failed attempt
   was retained outside the checkout; the passing run was a fresh complete run.
2. **Stream continuation:** a2abridge's `a2a_send_streaming` schema does not accept
   a context ID. Use `a2a_send_message(context_id=...)`, omitting task ID, for follow-ups.
3. **Blocking deadlines:** bridge unary calls have a 60-second budget, versus the
   gateway's default 120-second prompt deadline. Use asynchronous send plus task
   polling for longer work; a bridge timeout is not proof of canceled execution.
4. **No automatic OpenCode wake-up:** the bridge's own mailbox is not equivalent
   to this gateway driving OpenCode through ACP. This experiment uses the bridge
   as an outbound client, not as a replacement worker runtime.
5. **Application-level guard only:** exact peer argument checks and six-tool
   filtering do not secure arbitrary card targets, redirects, hostile registries,
   or the host filesystem/network. Loopback does not isolate users on the same host.
6. **Catalog readiness is not request readiness:** OpenCode 2.0.28 starts MCP
   asynchronously and debounces late tool registration. A proxy receipt written
   when a catalog is received can precede the actual registry update. One run
   returned without delegation; those retained receipts cannot establish its exact
   cause. A separate minimal probe successfully called `a2a_whoami` twice. The
   final harness adds an actual-runtime readiness observer, not a fixed startup
   sleep: `ctx.tool.list()` checks registration, and the `context` hook independently
   checks the permission-filtered tool keys used by each coordinator request.
   A per-process UUID prevents diagnostic CLI servers from satisfying that barrier.
7. **Proof-format failures:** two subsequent runs reached real handoffs but failed
   exact proof comparison. One recorded the correct planning decision, matching
   reviewer proof, but a 33-character planner value versus the expected 20 characters.
   The earlier system prompt used a `plannerProof=...` example while requesting JSON;
   the extra length is consistent with copying the field label, but raw answers
   were deliberately not retained, so that retrospective cause is not proven.
   Shortening markers alone did not solve it. Explicit JSON field/value examples
   and instructions to copy only the value preceded the final passing run. Exact
   equality, worker-turn order, handoff placement and hash checks were not relaxed.
8. **Synthetic task boundary:** the tested agents reasoned about planning and a
   contract; they did not edit this repository or prove reliable arbitrary coding.
9. **Scope:** no Claude Code, cross-host federation, authenticated multi-tenant
   network, failure recovery across restarts, load test, or full A2A conformance
   certification was established.

## Final safety-review validation

The final live run passed the complete interoperability, lifecycle, collaboration
and cleanup sequence after the safety changes:

| Check                        | Final observed result                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Planning                     | alpha, cost 4, value 8; 3 worker turns; 6 MCP calls; 28,404 ms                                                               |
| Contract review              | false/true/true/true; nullish-only guard; 3 worker turns; 4 MCP calls; 25,838 ms                                             |
| Actual model tool visibility | 1 registration receipt and **13/13 permission-filtered snapshots**, each with the exact six expected tools                   |
| Protocol receipts            | **23 calls / 23 results**, paired by connection + request ID; **2 distinct MCP connections**                                 |
| Tool inventory               | 11 sends, 7 lookups, 3 discoveries, 1 stream, 1 cancel; one intentional unknown-task error                                   |
| Handoff provenance           | Exact planner → reviewer → planner order; nonoverlapping turns; correct random peer proof placement; matching request hashes |
| Cleanup                      | Four private profile roots removed only after process checks; no cleanup errors                                              |

The startup barrier uses an audited, locally generated OpenCode plugin admitted
only in the coordinator's expected configuration. Workers have no plugins. Its
activation token is set only on the real ACP launch, not configuration diagnostics.
It observes registry/tool names and session IDs, not messages, reasoning, headers,
provider credentials, or schemas. Snapshot mismatch fails closed before dispatch.
This is diagnostic instrumentation, not a new general OpenCode plugin feature.

Actual SIGINT and SIGTERM were separately delivered to the **real harness PID during
worker startup**, before task requests. Both invocations exited nonzero with
`interrupted: true`, successful private-profile cleanup and empty MCP call receipts.
The deterministic lifecycle tests additionally exercise real child/TCP resources,
LIFO drain after an actual evidence-write failure, pre-aborted/idempotent cleanup,
interruption before readiness, and a nonexecutable directory binary. They do not
use a model or claim to be real-model E2E tests.

The full acceptance attempts during development were:

| Attempt start (UTC, 2026-10-27) | Result | Observation                                                                          |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| 08:33:11                        | Failed | Fast polling exhausted the fixed MCP budget                                          |
| 08:35:12                        | Passed | First complete two-task network run                                                  |
| 08:50:51                        | Failed | Catalog present, zero coordinator delegation calls; exact cause unproven             |
| 09:01:24                        | Failed | Actual registered request tools and handoffs; exact proof mismatch                   |
| 09:04:26                        | Failed | Correct planning decision, planner proof mismatch; shorter marker alone insufficient |
| 09:07:34                        | Passed | Final instrumented acceptance with strict provenance/order and cleanup checks        |

These are **six evolving development attempts**, not six equivalent statistical
trials; do not turn two passes into a production success-rate claim. Failed-run
metadata was retained privately outside the checkout. The ignored current evidence
directory contains the final passing run, and later runs replace it.

Initial hosted CI exposed another harness-only assumption: five deterministic
fixture cases expected `/tmp/opencode` to exist. The hosted runner did not have
that agent-host directory, so those cases failed with ENOENT. Fixtures now use
`os.tmpdir()` and unique subdirectories rather than requiring host preparation;
validation uses a fresh temporary base as well as clean hosted CI.

Final integration gates:

```sh
make -j1 install check \
  TEST_FLAGS='--coverage --coverage-reporter=text --coverage-reporter=lcov --coverage-dir=coverage --reporter=junit --reporter-outfile=.test-results/junit.xml'
TMPDIR=<external-temporary-base> make package-smoke
A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make network-demo
```

- Frozen dependency installation, formatting, lint, strict types and build passed.
- Deterministic suite: **212 pass, 0 fail, 845 assertions across 14 test files**;
  whole-process time **67.032 seconds**. Seven existing advisory production
  size/complexity warnings remain; none was suppressed.
- Provider-free installed-tarball acceptance passed with **11 allowlisted files**;
  the example files and development-only MCP SDK were not added to the runtime payload.
- The final real-model network command passed as recorded above. The existing
  broader `make e2e` suite was not rerun for this experiment; production source and
  SDK runtime pins were unchanged.
- The final adversarial source/evidence review returned **zero findings** after
  interruption, evidence-write, spawn-error, readiness and receipt-correlation fixes.
- Coverage shown by Bun includes imported example/helpers; it does not aggregate
  paid subprocess runs. No branch-coverage or mutation-score improvement is claimed.

The verified executable is cached locally under the ignored
`.test-results/agent-network-tools/a2abridge`; it is not vendored into the source
tree or installed globally. Follow the example README to reproduce on another host.
The example, grouped deterministic tests and report are versioned through normal
repository review; generated receipts and binaries are excluded. The network run
did not modify production source, global settings or GitHub issues, and did not
publish a package release.

## Small improvements worth considering

These are recommendations, not new production features in this experiment:

1. **Configurable worker identity before startup.** Accept a name, description
   and capability tags through the gateway's public construction/configuration
   boundary. The demo currently labels the returned live card after startup;
   a supported identity option would make role-specific discovery simpler.
2. **An optional thin MCP front door.** For clients that only need to call this
   gateway, an MCP facade could reuse the existing task/message/cancel backend.
   That removes the separate bridge, mailbox and directory machinery without
   replacing the A2A SDK or creating another execution engine. Keep it optional
   so A2A-only consumers retain the small runtime surface.
3. **A small outbound connector for network coordinators.** For OpenCode calling
   several A2A services, use an explicit peer manifest and an MCP client facade
   with named agents, per-session context continuity and typed task handles.
   Carry opaque task/context IDs in code rather than asking the model to
   reconstruct them; keep unrelated sessions and peers isolated.
4. **Consistent asynchronous contracts.** Support context continuation for both
   streaming and unary calls; return task handles for work exceeding an MCP wait
   budget. Inspect terminal state explicitly and cancel explicitly: a local
   timeout must not imply that remote execution stopped.
5. **Keep the integration checks.** Exercise actual tool registration, request
   snapshots, busy admission, cancellation and interruption. The OpenCode 2.0.28
   readiness race belongs to the client runtime; hiding it behind arbitrary
   gateway sleeps or blind retries would not be a sound protocol fix.

The smallest first step is worker identity plus a documented peer manifest.
The optional MCP facade/connector is the larger usability improvement if MCP
networks become a supported use case. Neither requires a distributed scheduler,
automatic public discovery, or changing the loopback/authentication boundary.

## Source references

- [a2abridge release](https://github.com/vbcherepanov/a2abridge/releases/tag/v4.0.2)
- [Pinned MCP tool implementation](https://github.com/vbcherepanov/a2abridge/blob/v4.0.2/internal/agent/mcp.go)
- [OpenCode V2 MCP documentation](https://opencode.ai/v2/docs/mcp-servers)
- [OpenCode V2 permissions](https://opencode.ai/v2/docs/permissions)
- [OpenCode V2 ACP](https://opencode.ai/v2/docs/cli/acp)
