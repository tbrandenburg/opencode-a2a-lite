# Fixed-schedule topology investigation

> Historical research guide; the managed topology runner, workloads and scorers
> are retired. Commands below require the [pre-retirement a70b639 source](https://github.com/tbrandenburg/opencode-a2a-lite/tree/a70b639/examples/agent-network),
> not the current checkout. Original findings/failures are unchanged; retirement
> makes no reliability or defect-resolution claim.

## Question and limits

See the [recorded investigation findings](/docs/topology-investigation-findings.md)
for the observed matrix, negative results, reporter corrections and conditional verdict.

Can guarded OpenCode MCP/A2A delegation carry six useful collaboration patterns,
with at most seven agents, without confusing a completed remote task with a
correct solution or a safe operation?

This is a fixed-schedule investigation, not an arbitrary graph platform. The
physical path remains **coordinator → guarded local stdio MCP → pinned a2abridge
→ loopback A2A gateway → ACP worker**. Logical worker-to-worker edges mean the
coordinator forwards a predecessor's exact envelope and its host-computed hash.
Workers neither call each other nor select topology. Host code declares barriers,
supplies stage instructions and observes worker execution; the **model issues
the actual MCP discovery, submission and task-observation calls**. Host code does
not substitute native subagents, the A2A CLI or direct ACP worker prompts.

Baselines use the coordinator alone and are explicitly not MCP evidence. The six
negative fixtures use real guarded bridge/gateway/controlled ACP processes but
no provider; their evidence class is `provider-free-controlled-ACP`, never
`live-model`. They test protocol and lifecycle contracts, not model reasoning.

## Plan and complete matrix

1. Define schedules, matched facts and an independent fixed optimum oracle.
2. Execute stage barriers through model-issued MCP calls with private profiles.
3. Independently score transport, structural topology, role semantics, objective
   correctness and operations. Persist each result immediately after cleanup.
4. Execute six bounded controlled negative experiments, preserving their
   sanitized assertion receipts separately from live-model observations.
5. Aggregate the planned 27 experiments and report missing evidence explicitly.
   A negative verdict is a finding, not grounds for weakening an oracle or retrying.

| Schedule       | Agents including coordinator | Turns | Logical pattern and semantic purpose                                                                                                                           |
| -------------- | ---------------------------: | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1-pipeline    |                            7 |     6 | Six workers accumulate private facts and predecessor proofs; final worker solves.                                                                              |
| T2-fanout      |                            7 |     7 | Six overlapping specialists each contribute necessary private facts; coordinator synthesizes with no private facts.                                            |
| T3-diamond     |                            5 |     4 | Planner forks to overlapping reviewers with conflicting hypotheses; integrator applies authoritative facts rather than recommendations.                        |
| T4-refinement  |                            3 |     3 | Proposer carries a deliberately attractive unverified hypothesis, critic detects infeasibility and proposes a correction, original context revises.            |
| T5-judge       |                            5 |     4 | Three overlapping workers preserve distinct seeded candidates and independently assess the same candidates; judge applies feasibility/value rubric, not votes. |
| T6-ring        |                            7 |     7 | Six-worker pipeline closes with a new task in the first worker's original context.                                                                             |
| B0-coordinator |                            1 |     1 | Full-fact single-agent baseline, without workers or MCP connection.                                                                                            |

Each schedule runs once per variant in a rotated, predeclared order:

| Variant | Cases in execution order                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------- |
| V1      | V1/T1-pipeline, V1/T2-fanout, V1/T3-diamond, V1/T4-refinement, V1/T5-judge, V1/T6-ring, V1/B0-coordinator |
| V2      | V2/T2-fanout, V2/T3-diamond, V2/T4-refinement, V2/T5-judge, V2/T6-ring, V2/B0-coordinator, V2/T1-pipeline |
| V3      | V3/T3-diamond, V3/T4-refinement, V3/T5-judge, V3/T6-ring, V3/B0-coordinator, V3/T1-pipeline, V3/T2-fanout |

These are 21 live-model cases plus the following six controlled experiments:

| ID                      | Controlled experiment                                                                     | Required observation; failure semantics                                                                                        |
| ----------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| N1-busy-fallback        | Hold an actual ACP turn, submit to occupied gateway, explicitly choose another worker.    | Busy task fails without ACP execution; other worker completes; original stays pending. No implicit queue or silent routing.    |
| N2-local-deadline       | Expire a short monotonic local wait on an active task.                                    | Return pending with original handle, not canceled/completed; bounded elapsed time; no implicit remote cancel.                  |
| N3-uncertain-submission | Pause the exact owned bridge child while guarded submission is pending.                   | Uncertain without fabricated handle; resume the same child and verify exactly one guarded submission, no resend.               |
| N4-context              | Supply another peer's handle and continue a remotely stale context.                       | Cross-peer rejection consumes no MCP call; stale remote context fails without silently starting another conversation.          |
| N5-contributions        | Controlled ACP returns missing facts and then changes an authoritative fact.              | The real envelope contribution validator rejects each output; expected topology outcome is BROKEN, not a correct task result.  |
| N6-interruption-cleanup | Send SIGINT and SIGTERM to owned lifecycle fixtures, including an evidence-write failure. | Owned PID exits, exact owned port is released, write failure is retained, and incomplete progressive summary remains readable. |

The interop fixture uses two independently planned bounded connections. The
first deliberately fails an ACP request, which retires that worker bridge;
busy/contribution probes use fresh controlled workers rather than pretending the
retired worker remains usable. This is fixture isolation, not a live-case retry
or reconnection to escape a call budget. N6 uses real lifecycle/child/TCP fixtures,
not an MCP reasoning result. Structured receipts identify the evidence source.

## Matched objective and role behavior

Every schedule and baseline receives the same eleven authoritative facts per
variant: six item cost/value pairs, one capacity bound, two dependencies and two
incompatibilities. Select the maximum-value indivisible subset of A–F. Zero
capacity is an explicit bound. The fixed oracle remains separate from prompts;
tests independently enumerate 64 subsets to verify a unique optimum per variant.

Fact ownership normally partitions those facts across first worker turns.
Fanout assigns them only to six remote specialists; removing any specialist
loses necessary information. The coordinator receives no private fact there.
For meaningful independent full-fact evaluation, T3 reviewers each receive a
copy of the authoritative workload, and T5 competitors each receive a copy.
These copies add no new facts. T4's first proposer has partial knowledge and is
not required to invent a complete solution before critique supplies missing facts.

The envelope contains cumulative `facts`, `inputHashes`, `proof`, `answer` and
`evaluation`. Intermediate `answer` remains null; provisional hypotheses and
critiques live in the separately scored evaluation field:

- T4 seeds B+E, attractive but incompatible. The proposer must expose that
  hypothesis. The critic must report exact cost/value and violated fact IDs,
  propose a feasible correction, and the final proposer must actually change its
  original candidate and incorporate that correction in the same remote context.
- T3 seeds conflicting B+E and A+D recommendations. Reviewers retain distinct
  recommendations but assess their violations honestly; integration must reject
  infeasible recommendations under an explicit `authoritative-facts` priority rule.
- T5 seeds A+B+C+F, D+E, and D as three competing candidates. Each competitor
  independently evaluates each candidate and retains its assigned one, even if
  infeasible. Judge verifies assessments and chooses feasible highest value,
  then lower cost, then lexical selection. It cannot pass by majority vote.

Seeded hypotheses are public non-authoritative inputs, not extra constraints or
hidden facts. They intentionally restrict this investigation's hypothesis space;
do not infer unconstrained search superiority from it. The final objective oracle
is unchanged. Missing/malformed assessments, ignored criticism, unchanged invalid
revisions and wrong judge choices fail semantic checks even if envelope hashes
and role labels match.

## Reproduce safely

Follow the [historical binary/prerequisite recipe](https://github.com/tbrandenburg/opencode-a2a-lite/blob/a70b639/examples/agent-network/README.md#prerequisites).
Pins: Linux x86_64, Bun **1.3.9**, OpenCode **2.0.28**, a2abridge **4.0.2**, A2A
**1.0**, `openai/gpt-6-luna`, and locked dependency versions. The runner verifies
the executable binary digest. Supply the provider key securely in the environment;
never copy it into configuration, commands, receipts or logs.

```sh
# Provider-free enumeration: exactly 27 lines, no worker/provider startup.
make topology-investigation ARGS='--list'

# Entire planned investigation: 21 billable cases followed by six controlled probes.
# --allow-cancel authorizes explicit cancellation within controlled fixtures only.
A2ABRIDGE_BIN="$PWD/.test-results/agent-network-tools/a2abridge" \
  make topology-investigation ARGS='--live --faults --allow-cancel'

# Exact subset; skipped rows remain missing/incomplete, never silently passed.
A2ABRIDGE_BIN="$PWD/.test-results/agent-network-tools/a2abridge" \
  bun run topology-investigation --live --case V1/T4-refinement --case V2/T5-judge

# Variant filter; multiple --variant flags are accepted. No implicit retries.
A2ABRIDGE_BIN="$PWD/.test-results/agent-network-tools/a2abridge" \
  bun run topology-investigation --live --variant V3 --case-ms 900000 --turn-ms 180000

# Provider-free probes only; successful probes still leave 21 live cases missing.
A2ABRIDGE_BIN="$PWD/.test-results/agent-network-tools/a2abridge" \
  bun run topology-investigation --faults --allow-cancel
```

`--live` is mandatory before model invocation. `--faults` without
`--allow-cancel` is rejected before fixture startup. Neither mode edits global
configuration or installs services. Unknown IDs, incompatible selections,
duplicate options and invalid deadlines fail before resources start. `--list`
always lists the complete plan without charging, even with selectors present.

Each live case owns its connection; never reconnect within a case. Ordinary work
stops before the eight-call intervention reserve of a 40-attempt connection.
Submissions require explicit `blocking:false`; continuations use returned context
ID on the same peer, omit task ID and retain a new returned task ID. A local
timeout is not remote cancellation. An uncertain submission is never resent.
The live harness does not issue explicit remote cancellation; owned process
shutdown still tears down its active work during cleanup.

SIGINT/SIGTERM abort the shared suite controller, stop further cases and preserve
partial reports while owned live resources drain. Controlled lifecycle tests
finish their bounded independent cleanup rather than killing their test wrapper
and orphaning child fixtures. Another owner's processes are never stopped.

## Report interpretation

Every invocation creates a unique ignored directory under
`.test-results/topology-investigation/<runid>/`, mode **0700**. Atomically replaced
files are **0600**: per-case JSON, `summary.json` and `findings.md`; fixture mode
also retains sanitized `controlled-interop.json` and `controlled-lifecycle.jsonl`
assertion receipts. No raw prompts, answers, reasoning or provider diagnostics
are persisted there. Existing S2 diagnostic evidence is not overwritten.

Per-case JSON retains an explicit sanitized `evidence` projection after private
profiles are deleted: expected marker hashes and peer URLs; step/task/context
handles; measured monotonic worker start/end intervals; inbound/output/artifact
hashes; hashed proof markers; guarded audit correlation IDs and catalog names;
coordinator turn timings/input hashes; extraction and heartbeat failure counts.
Expected step input hashes are assigned before the coordinator's model prompt;
remote steps retain the exact intended worker-envelope hash and expected submitted
context. Compare these with actual guard call hashes and handles even when an
input-copy mismatch prevents extraction of a validated step receipt. Unobserved
remote completion is never synthesized from a worker's execution alone.
Matching expected marker hashes to receipt proof hashes checks handoff fidelity
without publishing raw markers. Worker intervals preserve independently
inspectable overlap rather than only its pass/fail score. Unknown properties are
not copied. Summary case entries omit detailed evidence to avoid duplication.
Live-case `startedAt`/`finishedAt` bracket execution through owned cleanup;
`recordedAt` identifies persistence time. Summary metadata `finishedAt` is set
when the suite finishes its cleanup/reporting path, including interrupted runs.

- **Transport:** actual model-observed terminal task states, distinct from MCP
  call success, in-memory worker execution or catalog availability.
- **Structural topology:** expected turns, exact inbound hashes, cumulative
  proofs, real worker interval overlap, barriers, same-peer continuation handles.
- **Semantics:** role-specific proposal, critique, revision, competing evaluation
  and authoritative-fact conflict resolution, independently of structure.
  For schedules without these roles, `roleBehavior:pass` denotes not applicable,
  not empirical evidence that a semantic role executed.
- **Correctness:** schema, totals, capacity, dependencies, incompatibilities and
  fixed independent optimum. Correct/scored ratios use only this dimension,
  not overall operational success.
- **Operations:** guarded path, denied alternative tools, bounded deadlines,
  attempt budget/reserve, input integrity, no hidden retries/uncertain resends and
  owned cleanup. A single modified input fails `inputIntegrity`, not the retry or
  resend checks. Duplicate payloads and extra submissions are evaluated separately;
  uncertain resend requires a subsequent same-peer send after an unresolved
  submission; a result arriving after the extra send cannot erase that ordering.
  Insufficient audit evidence leaves that check unknown. Finite
  submission criteria distinguish missing, repeated and modified requests without
  retaining text or exception payloads. Earlier report versions predate this
  separation and must not be retroactively rewritten as new evidence.

Readiness JSON is published by a same-directory temporary write followed by
rename. The reader still rejects malformed published JSON immediately; there is
no parse-error retry or truncation-based suppression of malformed JSONL evidence.

The seven summary rows each show three planned cases, completed and scored
counts, independent correct count/ratio, overall-working count, observed latency
range, MCP attempts and cleanup failures. A separate dimension-count table shows
pass/fail/pending/unknown observations for transport, topology, semantics,
correctness and operations per schedule. Missing/unscored cases prevent a
complete comparison. Known failures produce BROKEN; missing/pending/uncertain
evidence produces INCOMPLETE unless a known failure also exists. `complete` is a
separate flag, so BROKEN can also have incomplete evidence. Fixture WORKING means
the expected adverse behavior was observed and checked, not that invalid output
became correct. A baseline can be correct without proving anything about MCP.
An aborted incomplete coordinator turn is a local-deadline/interruption signal
even when the overall case deadline has not expired. It leaves the case incomplete
unless an independent check failed, and does not imply remote cancellation.
Provider/runtime errors without such a local abort remain broken; pending remote
handles are retained rather than reclassified as canceled.

Exit zero requires a complete WORKING 27-case investigation. A subset or
fixture-only run therefore exits nonzero even when its observed cases work.
One ordinary broken case does not erase it or prevent subsequent cases; an
interruption or cleanup failure stops unsafe continuation. Reporting occurs
after case cleanup, so evidence-write failure cannot prevent resource draining.

Token usage and monetary cost are **unmeasured**, not zero. Latencies include
startup and cleanup; one trial per variant provides no statistical reliability
claim. More actors and relay rounds may increase latency/operational risk. Use
conditional recommendations tied to the measured dimensions, not universal
claims about topology quality. The coordinator should append the final empirical
verdict only after inspecting a full run; no live 21-case result is asserted by
this implementation guide.

## Evidence continuity

The preserved S2 diagnostic demonstrated completed transport/topology/correctness
with an operational failure: one model submission omitted explicit
`blocking:false`. That is a valid negative finding, not a transport failure or a
reason to relax the strict operational check. The separate original S2 observer
failure remains separate evidence. New S3 semantics require new observations;
older relay-only results do not retroactively validate critique or judge roles.

For deterministic implementation validation use `make check`. Provider-free
fixture receipt generation is opt-in through the commands above. Neither
deterministic tests nor controlled ACP fixtures establish real-model E2E.
