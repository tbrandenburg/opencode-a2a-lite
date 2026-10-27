# Topology investigation findings

> Historical findings. The managed lab is retired, not fixed; these observations
> and failure tables remain unchanged. Runner/source references below belong to
> [pre-retirement a70b639](https://github.com/tbrandenburg/opencode-a2a-lite/tree/a70b639/examples/agent-network).

## Verdict

**BROKEN investigation acceptance; comparative verdict INCOMPLETE.** The declared
run recorded 27 observations: 21 live-model cases and six controlled negative
experiments. Five live cases worked, 16 failed, and six controlled experiments
worked. Sixteen live cases did not reach independent final-answer scoring; that
is missing comparative evidence, not proof that their underlying topology cannot
work. Do not select a universal winning topology from this run.

The [implementation and reproduction guide](/docs/topology-investigation.md)
defines the fixed schedules, scoring contracts and safety boundaries.

## Evidence and experiment boundaries

The original run started **2026-10-27 14:53:31.816 UTC** and finished
**15:28:47.695 UTC**, using Bun 1.3.9, OpenCode 2.0.28, checksummed a2abridge 4.0.2,
A2A 1.0 and `openai/gpt-6-luna`. Its private, ignored output is
`.test-results/topology-investigation/97818199-727f-40f0-847c-a05834162934/`.
That directory contains 31 sanitized files and was preserved unchanged after
reporting fixes. Raw model answers, prompts, reasoning and provider diagnostics
were not retained. These local artifacts are not included in the repository.

The coordinator model issued MCP calls; host code supplied fixed stage barriers,
computed artifact hashes and observed worker execution. These are logical
topologies over the guarded physical star, not decentralized worker-to-worker
networks. Three variants with one trial each are not a reliability benchmark.
Hypotheses for review/judging were seeded; this does not measure unconstrained
idea generation. Token usage and monetary cost were unmeasured.

## Original matrix

Latencies include profile startup, execution and cleanup. Correct/scored is
independent of operational success; an unscored case is not a wrong answer.

| Schedule                     | Agents including coordinator | Final answers scored | Correct/scored | Overall working | Elapsed range | MCP attempts, total |
| ---------------------------- | ---------------------------: | -------------------: | -------------- | --------------: | ------------- | ------------------: |
| T1 pipeline                  |                            7 |                  0/3 | Unmeasured     |             0/3 | 50.7–166.1 s  |                  21 |
| T2 fan-out/fan-in            |                            7 |                  2/3 | 2/2            |             2/3 | 92.0–116.8 s  |                  33 |
| T3 diamond                   |                            5 |                  0/3 | Unmeasured     |             0/3 | 49.0–241.6 s  |                   7 |
| T4 propose–critique–revise   |                            3 |                  0/3 | Unmeasured     |             0/3 | 44.1–47.9 s   |                   8 |
| T5 competing proposals/judge |                            5 |                  0/3 | Unmeasured     |             0/3 | 99.1–136.5 s  |                  24 |
| T6 bounded ring              |                            7 |                  0/3 | Unmeasured     |             0/3 | 129.7–206.2 s |                  33 |
| Coordinator-only reference   |                            1 |                  3/3 | 3/3            |             3/3 | 15.0–22.6 s   |                   0 |

T2 passed V1 and V2 with actual six-worker overlap, verified artifact/proof
handoffs and 13 MCP attempts per successful case. These two observations
establish that a seven-agent model-driven MCP workflow can work under this
configuration. They do not establish its reliability or superiority over the
single-agent reference. The reference receives combined facts and is not MCP
delegation evidence.

Owned cleanup passed in 21/21 live cases, with exact released-port rebinding and
profile-process checks. No case exhausted the 40-attempt connection budget;
the highest live-case count was 13. Cleanup success does not make an incomplete
remote task a completed result.

## Failure analysis and corrections

The matrix exposed harness defects as well as model compliance failures. Original
scores were not rewritten or pooled with later diagnostics:

1. **Submission integrity versus retries.** The original scorer conflated a
   changed input hash with repeated or uncertain submission. Its original
   `noHiddenRetries` and `noUncertainResends` failures cannot independently prove
   a retry. The corrected scorer has a separate `inputIntegrity` check and finite
   missing/repeated/modified criteria. Expected input hashes are retained before
   dispatch. Exact-copy requirements remain unchanged.
2. **Readiness publication.** V3/T1 encountered malformed readiness JSON during
   startup. A controlled split-write reproduction demonstrated the publication
   race; readiness now uses a temporary file and atomic rename. Published
   malformed documents still fail validation rather than being ignored.
3. **Local turn timeout.** The original V1/T3 runtime failure had an aborted
   coordinator turn. Corrected classification preserves incomplete local waits
   and returned task handles; it does not infer remote cancellation.
4. **Artifact contribution checks.** V1/T6 and V2/T1 stopped at exact cumulative
   fact checks. The retained failure frame establishes a contribution mismatch;
   the raw answers were deliberately not retained, so the exact changed or missing
   fact cannot be reconstructed. This does not establish a transport defect.
5. **Explicit nonblocking contract.** An earlier, separate S2 T4 diagnostic
   completed transport, structure and correctness but omitted `blocking:false`
   on one send. Its strict operational failure was retained, not relaxed. That
   older relay-only diagnostic does not validate the later role-semantic checks.

### Fresh post-correction diagnostics

A deliberately separate two-case diagnostic is retained under
`.test-results/topology-investigation/56713c21-c230-4148-9dc7-fe690b44a8a9/`:

| Case  | Finding                                                          | Attempts | Cleanup |
| ----- | ---------------------------------------------------------------- | -------: | ------- |
| V1/T4 | `submission-modified`; input-integrity failure, not a retry      |        2 | Passed  |
| V3/T2 | `submission-repeated`; duplicate/uncertain-resubmission failures |        8 | Passed  |

Neither case reached final correctness scoring. These diagnostics verify that
the corrected reporter distinguishes two real adverse behaviors. They do not
replace original matrix observations or constitute a second complete matrix.
No prompts or objective oracles were changed to obtain a passing verdict.

## Controlled negative experiments

Six separate provider-free experiments passed through real guarded bridge,
gateway and controlled ACP processes, or real process/TCP lifecycle fixtures:

| ID  | Verified adverse behavior                                                                             |
| --- | ----------------------------------------------------------------------------------------------------- |
| N1  | Busy gateway rejects without executing another ACP turn; explicit fallback completes independently.   |
| N2  | Local wait deadline retains a pending handle without implicit cancellation.                           |
| N3  | Paused owned bridge produces an uncertain submission without invented IDs or automatic resend.        |
| N4  | Wrong-peer handle is rejected locally; stale remote context fails without silent restart.             |
| N5  | Missing and altered authoritative contributions are rejected, not accepted as correct output.         |
| N6  | SIGINT/SIGTERM release owned PIDs/ports and retain partial reports despite an evidence-write failure. |

The controlled interop used two predeclared isolated fixture connections with
27 and 13 attempts, respectively. Their separate evidence class is not a claim
of live-model reasoning success.

## Recommendation

- **For these small fully specified problems:** retain a coordinator-only
  default. It produced three correct answers with lower observed elapsed time;
  the comparison does not account for information-separation benefits or cost.
- **For genuinely separable private contributions:** fan-out/fan-in is the first
  multi-agent candidate worth further testing. Two successful seven-agent runs
  demonstrate feasibility, but the third failure and fresh duplicate-submission
  diagnostic preclude an unconditional recommendation.
- **For review, revision, judging, pipelines and rings:** verdict remains
  incomplete. First improve or investigate exact artifact-copying compliance and
  bounded submission behavior; then predeclare a new matrix without erasing this
  one. More relay rounds currently add failure opportunities without demonstrated
  task-quality benefit in the scored observations.
- **For decentralized trees/meshes:** no verdict. Worker-side MCP and delegation
  permissions were intentionally outside scope.

## Validation and independent follow-up

Reproduce implementation checks with `make check`, and production live gateway
acceptance with `make e2e`. The coordinator observed 361 deterministic tests with
zero failures after reporting/publication fixes, and 14 production live E2E
scenarios with zero failures. Ports must be checked before live service startup.

A later full E2E invocation stopped at E2E02 after E2E01 passed. Its generic
sanitized failure did not identify the precise assertion. A separate bounded
typed-state diagnostic passed command success, decoding, completed state, exact
marker and cleanup; a subsequent explicitly identified full validation passed
14/14 again. These passes do not explain or erase the intervening failure.
Track bounded failure-evidence improvements in
[issue #19](https://github.com/tbrandenburg/opencode-a2a-lite/issues/19).
The first ad-hoc diagnostic incorrectly used a numeric state literal; it is not
completion evidence. The replacement diagnostic used the pinned SDK enum.

The separate unchanged `make network-demo` run at 15:46:19.995–15:47:56.508 UTC
passed interoperability/lifecycle checks and returned the correct planning
solution/proofs, but failed its exact planner–reviewer–planner order assertion
at `collaborate.ts:158` because an extra planner turn occurred. This is a separate
live-model compliance follow-up, not a reason to weaken the assertion or alter
the topology matrix. Track the independent investigation in
[issue #18](https://github.com/tbrandenburg/opencode-a2a-lite/issues/18).

The scoped quality-drift review left warning-only structural gates unchanged.
Runtime budgets, example-harness structural coverage, branch measurement and
mutation-testing follow-ups are tracked separately in
[issue #20](https://github.com/tbrandenburg/opencode-a2a-lite/issues/20).
