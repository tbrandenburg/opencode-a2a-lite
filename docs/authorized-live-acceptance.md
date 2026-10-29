# Authorized live acceptance results

> Historical once-only live results; failure tables and Git provenance below are
> unchanged. The managed topology lab is retired, not fixed. Its source remains at
> [a70b639](https://github.com/tbrandenburg/opencode-a2a-lite/tree/a70b639/examples/agent-network).
> Production `make e2e` is a manual live gate, not part of ordinary CI; retirement does not resolve E2E06.

## Verdict

**Live acceptance is BROKEN; the comparative verdict remains INCOMPLETE.**
The authorized production harness passed five scenarios and stopped at E2E06;
eight scenarios were not reached. The separately declared topology set recorded
two WORKING and three BROKEN cases. Fanout establishes one complete model-issued
guarded MCP workflow with verified artifact/proof integrity, not a reliability
claim or a universal topology recommendation.

These observations were attempted once at `a7f178d`, after explicit user opt-in.
They are separate from the original matrix and the provider-free checks. No
failure was replaced by a retry, skipped assertion, changed oracle, larger budget
or longer application deadline. Token usage and monetary cost remain unmeasured.
After recording the live outcomes, coordinator `make check` passed format, lint,
strict types, build and **70 tests / 1,414 assertions** (32.407s test-process wall
time). Production/tests/examples/scripts/pins have no diff from the executed
revision. That deterministic pass does not replace the failed live observations.

## Pins, invocation and evidence

Linux; Bun 1.3.9; OpenCode 2.0.28; A2A CLI 0.3.1; a2abridge 4.0.2; A2A 1.0;
`openai/gpt-6-luna`. Verified bridge SHA256:
`bdfa1f6894f5547dfef539140139e162402ca6ab33bb7602d9335d125d414db2`.
Provider credentials were checked for presence, not printed or copied into reports.

The private, ignored evidence root is
`.test-results/authorized-live/47844f6a-827d-40c2-9685-0e98ff622252/`.
It contains the pre-run `plan.json`, sanitized E2E log/result, five-case invocation,
topology report and independent cleanup verification. The original matrix was
not rewritten or pooled with these observations.

Exact commands executed, in order:

```sh
make e2e
A2ABRIDGE_BIN="$PWD/.test-results/agent-network-tools/a2abridge" \
  bun .test-results/authorized-live/47844f6a-827d-40c2-9685-0e98ff622252/five-cases.ts
```

The retained invocation calls the existing `runTopologyCases()` API with the five
declared cases below, `optIn:true`, `caseMs:900000`, `turnMs:180000`, progressive
`createInvestigationReport()` persistence and signal-driven cleanup. It does not
submit worker calls on the model's behalf or use an alternate delegation path.
The model coordinator issued actual guarded MCP calls through the pinned bridge.
It stops continuation on interruption/cleanup failure, without retries.

## Production E2E: five passed, one failed stage, eight not reached

Start/end: `2026-10-27T20:00:33.260844Z` / `20:02:21.623642Z`.
Whole command duration: 108.363s. Harness exit 1 / make exit 2.

| Scenario | Recorded result                                                         |
| -------- | ----------------------------------------------------------------------- |
| E2E01    | Passed: production discovery, protocol 1.0, ephemeral listener          |
| E2E02    | Passed: exact text and completed state                                  |
| E2E03    | Passed: stable streamed identity/order, three chunks, no duplicate text |
| E2E04    | Passed: same-context marker recall under a new task                     |
| E2E05    | Passed: two isolated contexts and exact markers                         |
| E2E06    | Failed with `Private diagnostics withheld`                              |
| E2E07–14 | Not reached because the unchanged harness stops on failure              |

E2E06 covers long-task submission/first-text observation and busy admission. The
generic non-assertion error does **not** locate its precise failing sub-step or
establish a provider, CLI, model, transport or gateway cause. Private diagnostics
were intentionally removed during cleanup. Production `src/`, dependency pins
and the live harness have no diff from the frozen baseline; that fact does not
make the failed acceptance pass.

The log records `cleanup:true, processesStopped:true`; independent inspection
found zero remaining private-profile processes. The unresolved observation and
need for bounded sub-step evidence are tracked in
[issue #27](https://github.com/tbrandenburg/opencode-a2a-lite/issues/27), related
to the earlier E2E02 diagnostic issue #19. No additional E2E run was attempted.

## Five V1 topology cases: declared order, one attempt each

Start/end: `2026-10-27T20:04:53.801Z` / `20:12:20.572Z`.
The report is under `topology/0bb9ffbe-da2f-4c56-aad6-4f3e58ed951e/` beneath the
private evidence root. The five-case process exited 1 because three cases failed;
this is not merely the expected nonzero status of an otherwise-passing subset.

| Order / case              | Outcome | Seconds including cleanup | MCP attempts | Independent finding                                                                                                        |
| ------------------------- | ------- | ------------------------: | -----------: | -------------------------------------------------------------------------------------------------------------------------- |
| 1 — Coordinator reference | WORKING |                      17.1 |            0 | Transport/topology/correctness/operations pass; not MCP evidence                                                           |
| 2 — Pipeline              | BROKEN  |                     108.2 |            7 | p1–p3 completed; one changed contribution stops progression; later stages/final answer unobserved                          |
| 3 — Fanout                | WORKING |                     114.2 |           13 | Six workers and synthesis complete; overlap, handles, hashes, proof, correctness and operations pass                       |
| 4 — Refinement            | BROKEN  |                      98.5 |            7 | Transport/topology/final correctness/operations pass; `semantics.refine` fails                                             |
| 5 — Judge                 | BROKEN  |                     108.8 |            8 | Three proposer evaluations pass; judge inbound artifact-string integrity fails before its reasoning/final answer is scored |

Pipeline's finite `contribution-mismatch` counts are missing 0, extra 0,
changed 1, repeated 0. One identifier hash is retained; raw changed fact values
are not. Refinement's role result is step-level, so the exact failed assessment/
revision/review-following sub-criterion is not established by this evidence.
Correct final-answer scoring does not erase the role-contract failure.

Judge's `submission-modified` evidence has `encodingOnly:false`,
`changedFields:["inbound"]` and `malformedEnvelope:false`. Expected/observed raw
hashes differ. This establishes a nested artifact string/map difference, not
whether its inner formatting or fact values changed, nor which predecessor was
affected. The exact nested-artifact contract remains enforced. Returned handles
are retained; an unobserved judge task is not reported as completed or canceled.

No hidden retry, uncertain resend, parameter-policy failure or guard bypass was
observed in these five cases. There were 35 MCP attempts across four independent
network-case connections; the largest used 13. The 40-attempt/eight-reserve limits
remained per connection. No formatting-only submission difference occurred in
this live selection: deterministic regressions establish that equivalence path,
while the fanout establishes a real completed guarded workflow.

The three remaining topology observations are tracked with finite evidence in
[issue #28](https://github.com/tbrandenburg/opencode-a2a-lite/issues/28). They do
not establish intrinsic reasoning failure of the judge or a transport cause for
the refinement role mismatch. No new complete/repeated matrix is authorized.

## Cleanup and next decision

Cleanup passed in 5/5 topology cases. Independent verification rebound 27/27
observed loopback probe ports and found zero remaining private-profile processes.
The production run also confirmed cleanup before reporting failure. Pre-existing
listeners on ports 3000/5173 remained occupied and were not stopped.

The authorized gate is now **executed**, not awaiting permission. The specific
#22 criterion requiring one completed model-issued workflow is met by fanout;
this does not turn the production E2E failure or three broken case contracts into
passes. PRs #21, #25 and #26 were subsequently merged into `main` on explicit
maintainer instruction, retaining the deterministic/real-bridge successes alongside
these live outcomes without a complete live-gate or reliability claim.
Follow-ups #27/#28 remain open. The unrelated pre-existing oversized-fact CPU concern
remains tracked separately in #24. Any later reproduction should follow the current
best-effort topology correction cap; the user monitors provider spend. A later success
would not erase or explain these failed observations.

## Additional bounded adapter assessments (2026-10-29)

These issue-scoped live assessments supplement the historical matrix above; they do
not rewrite it or establish reliability, topology superiority, or general model
quality. Each used Bun 1.3.9, OpenCode 2.0.28, checksummed a2abridge 4.0.2, A2A 1.0,
the existing guarded route, disposable playground projects, private HOME/XDG state,
and `openai/gpt-6-luna`. `make build` passed before each assessment. Calls and
results below are per active guard connection unless noted; ordinary work stopped
below 32 of 40 attempts, preserving eight calls. No guard denial was observed.

| Issue                                                                       | Guarded calls (connection counts) | Observed traffic / result                                                                                                                                             | Not established                                                                                                     |
| --------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [#35](https://github.com/tbrandenburg/opencode-a2a-lite/issues/35)          | 10/10; 1 connection.              | Two nonblocking pipeline tasks completed (6.043s, 6.635s); exact worker inputs/artifacts correlated.                                                                  | Full six-worker pipeline, continuation, streaming, cancellation, denied-peer behavior.                              |
| [#36](https://github.com/tbrandenburg/opencode-a2a-lite/issues/36)          | 18/18; 1 connection.              | W1→W6→W1 tasks completed (10.182s, 11.708s, 3.464s). W1 reused its original context and got a distinct task ID.                                                       | Full six-worker ring, semantic/model quality.                                                                       |
| [#37](https://github.com/tbrandenburg/opencode-a2a-lite/issues/37)          | 17/17; 1 connection.              | P→K→P tasks completed (10.631s, 12.613s, 4.219s); exact artifacts relayed, P continued in its original context.                                                       | Critique quality, semantic improvement, historical `semantics.refine` result.                                       |
| [#38](https://github.com/tbrandenburg/opencode-a2a-lite/issues/38)          | 17/17; 1 connection.              | Two nonblocking proposals were working at first poll; both exact artifacts reached J. Three tasks completed (17.350s, 19.553s, 11.023s).                              | Third proposer, judge quality, historical inbound-artifact failure.                                                 |
| [#39](https://github.com/tbrandenburg/opencode-a2a-lite/issues/39)          | 14/14; 1 connection.              | Three nonblocking tasks were working at first poll and completed (13.640s, 13.638s, 13.775s).                                                                         | Remaining three specialists, reliability, answer quality.                                                           |
| [#40](https://github.com/tbrandenburg/opencode-a2a-lite/issues/40)          | 22/22; 1 connection.              | Planner→R1/R2→I completed (5.853s, 12.548s, 10.327s, 6.641s); exact branch artifacts reached I. Coordinator final text omitted markers that appeared in I's artifact. | General proposal/review quality, streaming, cancellation, denied-peer behavior.                                     |
| [#41](https://github.com/tbrandenburg/opencode-a2a-lite/issues/41)          | C: 9/9; W1: 6/6.                  | W1's actual ACP session delegated to W2; child completed in 6.361s and W1 root in 18.357s with the child artifact.                                                    | Other mesh edges, recursion, full mesh behavior.                                                                    |
| [#42 baseline](https://github.com/tbrandenburg/opencode-a2a-lite/issues/42) | C: 9/9; W1: 1/1; W2: 1/1.         | W1→W2 and W2→W4 child artifacts completed (13.607s, 5.146s). Both worker sends used `blocking:true`; C's root was last observed `WORKING`.                            | Required nonblocking worker contract (observed `blocking:true`); terminal root result, sibling branches, full tree. |

### #42: three targeted corrections (2026-10-29)

The [sanitized correction evidence](https://github.com/tbrandenburg/opencode-a2a-lite/issues/42#issuecomment-6495535029)
adds an observed pass for the bounded C→W1→W2→W4 path. It does not replace the
baseline or establish a full-tree/reliability result. The baseline plus these three
corrections exhausts the issue's attempt cap; no additional attempt was made.

| Correction | Changed factor                                                                                        | Observed outcome                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1          | Propagate literal `blocking:false` to each worker and forwarded child task.                           | W1 sent nonblocking; W2 emitted tool-call-shaped text without an actual MCP call. C and W1 exhausted six polls; the passive watchdog enforced the root's 30-second cutoff. INCOMPLETE.       |
| 2          | Warm the same ACP-owned private worker servers through bounded read-only agent/config/MCP probes.     | Both worker levels made real nonblocking calls and collected completed child tasks. C stopped after six polls before observing a terminal root result; watchdog cutoff retained. INCOMPLETE. |
| 3          | Use the runbook's existing maximum of eight spaced polls instead of the earlier six-poll restriction. | C collected the completed root artifact on poll eight; both worker sends and the root send used `blocking:false`. Observed bounded-path pass.                                                |

The third correction added the missing terminal-root adapter evidence, not answer-quality
polishing. Each used fresh synthetic input and isolated state; no uncertain task was
resent. Model, pins, peer allowlists, 30-second operation deadlines and the eight-call
reserve remained unchanged. The worker readiness intervention coincided with actual
tool use; it does not conclusively diagnose the earlier tool-shaped text or fix cold ACP.

Final actual-session and guard evidence:

- C→W1 completed in **14.502s**, W1→W2 in **9.127s**, W2→W4 in **3.605s**;
  poll counts were eight, five and two. The passive metadata-only watchdog reported
  `interrupted:false, pending:0`; each nested operation finished before the root deadline.
- C, W1 and W2 recorded **11/11**, **6/6**, **3/3** paired calls/results on one
  active connection each, zero denials, and fewer than 32 ordinary attempts per caller.
- At each hop the actual model arguments matched the guard-dispatched input hash
  and receiving worker text. Returned task/context bindings stayed stable through
  terminal results; completed artifact hashes matched worker root answers. The
  synthetic leaf marker returned unchanged through W4, W2, W1 and C.
- Six-tool catalogs were verified, but C actually invoked four distinct tools
  (whoami, list_agents, send_message, get_task); W1/W2 invoked send_message/get_task.
  A six-tool catalog is not evidence that every tool was invoked.
- W1's child allowlist stayed W2/W3, W2's W4/W5; W4 had no outgoing tools. Sibling
  branches were not started. Three unregister responses were HTTP 204, 17 recorded
  PIDs were absent, and 13 recorded/reviewed ports rebound. Shared listeners were untouched.

Streaming, cancellation, forbidden-peer denial, unvisited branches, repeatability and
general model quality remain unverified here. No production code, guard change,
topology runner or session analyzer was added; operational helpers were disposable.

## Cross-scenario findings

- A connected six-tool catalog was necessary but insufficient: acceptance used actual
  coordinator or worker-session tool calls paired with the guard receipts.
- The observed same-peer continuation paths in #36 and #37 used the actual returned
  context ID and omitted the prior task ID; both returned distinct task IDs in the
  continuing worker session.
- Hash-correlated worker inputs and stored artifacts confirmed exact handoffs in
  #35–#40. Fan-out and branch identity were reported only for the peers/tasks actually
  observed; the unstarted parts of the six-worker and three-proposer layouts remain
  unverified.
- Worker-side MCP was a separate surface from coordinator-to-worker traffic. In #41,
  W1 made a real guarded worker call. In the #42 baseline, W1 and W2 made real calls, but both
  supplied `blocking:true`; the bridge completed those requests, yet the required
  nonblocking worker-call contract was not met. The C root task remained without an
  observed terminal state. These caller/orchestration and missing-evidence findings
  are not evidence of an A2A transport defect. The separately recorded third correction
  above observed nonblocking worker calls and a completed root result without erasing
  the preceding incomplete observations.
- Every run used owned loopback processes and verified unregister responses and port
  rebinds. Existing listeners on 3000/5173 and the shared OpenCode service were left
  untouched. Costs were not measured; private prompts, outputs, handles and raw
  receipts were not published.
- During #36 cleanup, gateway processes became zombies under the owned tmux server
  after their panes closed; stopping the remaining owned resources and that tmux
  server reaped them. Verify exact process states and port rebinds; never use broad kills.
- A separate final `make check` passed formatting, lint (with warnings), strict types,
  66 tests / 497 assertions, and build. A separate real `make e2e` passed 14/14
  scenarios with cleanup verified. These later runs do not replace or explain the
  historical failures recorded above.
