# Post-change integrity diagnostics

> Historical verification record, not current runnable lab guidance. The managed
> lab and fault runner have been retired; their source remains at
> [a70b639](https://github.com/tbrandenburg/opencode-a2a-lite/tree/a70b639/examples/agent-network).
> Recorded outcomes below are unchanged and do not resolve live failures.

## Verdict and revision

**Provider-free implementation acceptance passes; the subsequently authorized
live acceptance has unresolved failures.** The
[authorized live report](/docs/authorized-live-acceptance.md) records those once-only
outcomes separately. This is a separate post-change
record, not a revision of the [original matrix findings](/docs/topology-investigation-findings.md)
or a reliability claim.

Verified implementation: `e413a55` (including the reviewed #23 selection and #22
corrections). Last controlled verification: `2026-10-27T18:12:13.456Z`.
Environment: Linux, Bun 1.3.9, OpenCode 2.0.28, A2A 1.0, ACP v1, a2abridge 4.0.2.
The verified bridge binary SHA256 remains
`bdfa1f6894f5547dfef539140139e162402ca6ab33bb7602d9335d125d414db2`.

The [field-level comparison contract](/docs/topology-integrity.md) defines exactly
which encodings may differ and which values remain exact. Coordinator-issued
MCP calls remain the live topology's transport; provider-free host fixtures below
are explicitly not equivalent model-issued evidence.

## Coordinator validation

```sh
make check TEST_FLAGS='--coverage --coverage-reporter=text --coverage-reporter=lcov --coverage-dir=coverage --reporter=junit --reporter-outfile=.test-results/junit.xml'
make package-smoke
A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test
A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge \
  make topology-investigation ARGS='--faults --allow-cancel'
```

| Check                                 | Observed outcome                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Formatting, lint, strict types, build | Passed; seven unchanged production size/complexity warnings remain visible                                                                     |
| Combined deterministic suite          | **70 pass, 0 fail, 0 skip; 1,414 assertions; 21 files**                                                                                        |
| Whole test-process wall time          | 33.388s for this combined gate; not the three-run #23 benchmark                                                                                |
| Installed npm artifact                | 12 allowlisted files; installed CLI/direct server, sanitized failures, discovery, SIGINT/SIGTERM and owned cleanup passed                      |
| Pinned real-bridge interop            | `providerFreeContextInterop:true`, `untrustedContextReflectionSanitized:true`; first independently planned fixture connection used 29 attempts |
| Controlled negative set               | **N1–N6 WORKING**, each with `cleanup:true`; its two independently planned interop connections used **28 and 17** calls                        |

The controlled set's unique output is
`.test-results/topology-investigation/d27ccb28-26af-4257-aa19-8fa3832e0dfd/`.
It records six observations, no live cases, and overall INCOMPLETE (6/27).
The script intentionally exits 1 / make exits 2 for an incomplete selected set;
this is not a failed controlled assertion. Per-connection 40-attempt limits and
eight-call reserves were unchanged and not pooled.

The [test-reduction report](/docs/test-reduction.md) separately retains the
361→69 #23 inventory, complete old→new mapping, three-run 72.563s→31.881s medians,
four fault seeds, prior failed checks and their corrections. #22 adds the one
disclosed N19 case, yielding 70. Measurements from these distinct revisions/runs
are not pooled.

## Independent failure dimensions and counterexamples

- Equivalent known-envelope formatting/key order passes submission, worker
  receipt and operational comparison. Actual guard-input/worker-input hashes must
  still match exactly; transport rewriting is not excused by semantic equivalence.
- Instruction, fact, marker, predecessor-hash, artifact-string and ordered-array
  corruption still fail. The objective, role and provenance oracles are unchanged.
- Captured guarded routing and strict explicit-nonblocking/task-omission policy
  have separate report checks. Missing `blocking:false` is not called guard bypass.
- Submitted identifier arguments are hashed with presence flags. An unknown
  context echoed by a failed task, including pending→failed observations, remains
  hashed in persisted audit/receipts/expectations/handle projections. The real MCP
  response is forwarded unchanged; genuine fresh/continuation contexts and
  generated task IDs remain available.
- Pre-send interruption gives unknown input integrity; positively observed input
  corruption remains failure. No local timeout implies remote cancellation or
  permits an uncertain resend.
- Contribution mismatches retain finite counts and at most sixteen hashed IDs;
  large assertion diffs retain an allowlisted repository frame without diff text.

The final adversarial re-review closed the two high and one medium #22 findings:
quadratic malformed-envelope searching, persisted identifier content, and
pre-send-abort misclassification. Five independent bounded parser children rejected
malformed escaped strings through 2,000,006 bytes; the largest probe took 2.58s
within a three-second child deadline. This is bounded regression evidence, not a
throughput benchmark. Independent privacy/abort probes and the focused regressions
passed. No new severity finding was established in that re-review.

The actual guarded MCP/bridge/gateway fixture independently verified unchanged
reflected response bytes, a generated task UUID, failed unknown-context state,
absence of ACP prompt execution, sanitized receipt bytes and projected evidence.
Restoring the old result-logging predicate made that privacy probe fail.

## Cleanup and unchanged boundaries

Free loopback ports were probed before service checks; fixture listeners used
ephemeral ports. Harness checks verified owned process exit and exact-port release.
Existing listeners on ports 3000/5173 were not stopped. Private fixture profiles,
connections, heartbeat loops and workers were drained by their owning harnesses.

Production `src/`, dependency/runtime pins, objective and role-semantic oracles,
the 14-scenario live harness, packaging scripts and original findings have no
functional diff from the frozen baseline. The guard's forwarding, endpoint/tool
decisions, budget and deadlines are unchanged; only diagnostic metadata changed.
Original matrix evidence was not rewritten or pooled with these new runs.

## Previously pending live gate and subsequent authorized outcome

No billable model request was made during the provider-free verification above.
The user subsequently authorized one execution of the following declared gate:

1. `make e2e`: retained fourteen real-model production scenarios.
2. One predeclared diagnostic set, in this order, one attempt each:
   `V1/B0-coordinator`, `V1/T1-pipeline`, `V1/T2-fanout`,
   `V1/T4-refinement`, `V1/T5-judge`.

That execution passed E2E01–05 then failed at E2E06; eight scenarios were not
reached. The five-case diagnostic recorded reference/fanout WORKING and pipeline/
refinement/judge BROKEN. Fanout now establishes a complete actual model-issued
workflow with verified artifact/proof integrity. Cleanup passed; no failure was
retried or replaced. See the [separate live report](/docs/authorized-live-acceptance.md)
and follow-ups #27/#28 for precise observed boundaries and unknown causes.

No automatic retry, complete matrix, alternate model, increased call budget or
host-scripted replacement for model-issued handoffs is authorized by this report.
The implementation stack has since been merged on explicit maintainer instruction.
The remaining failures still block a complete live-acceptance/reliability claim;
merging does not resolve the separately tracked live observations.

The unrelated pre-existing oversized-fact CPU concern is tracked in
[issue #24](https://github.com/tbrandenburg/opencode-a2a-lite/issues/24).
It remains unresolved here; finite diagnostic output is not a general CPU-bound
guarantee for arbitrary oversized worker contribution arrays.
