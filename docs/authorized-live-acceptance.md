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
