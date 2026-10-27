# Deterministic test selection

> Historical #23 measurements and decisions below are retained unchanged. P2 later
> retired the managed network/topology lab, not adapter regressions. Research paths
> and historical commands refer to [a70b639 source](https://github.com/tbrandenburg/opencode-a2a-lite/tree/a70b639/examples/agent-network)
> and [tests](https://github.com/tbrandenburg/opencode-a2a-lite/tree/a70b639/tests/agent-network).
> The final acceptance-command section is current; historical counts are not the
> current inventory. Retirement is not a pass for the recorded live failures.

Issue [#23](https://github.com/tbrandenburg/opencode-a2a-lite/issues/23) refocuses
the maintained deterministic suite, including release/demo tooling and network
examples. Production behavior and the runtime/SDK pins are not part of this
test-only change. The subsequent integrity correction is separate work in
[issue #22](https://github.com/tbrandenburg/opencode-a2a-lite/issues/22).

## Measurement contract

The before revision is `64e5b27092a62e09e5c5503aa4f4795ef4444be7`, the head of
draft PR #21 when this work started. Measurements use Linux, Bun 1.3.9 and locked
dependencies, with sequential runs and these unchanged CI flags:

```sh
make test TEST_FLAGS='--coverage --coverage-reporter=text --coverage-reporter=lcov --coverage-dir=coverage --reporter=junit --reporter-outfile=.test-results/junit.xml'
```

Count JUnit **leaf `testcase` elements**, including `test.each` expansion, not
declarations or nested suite totals. Leaf durations are attribution estimates,
not per-file wall-clock measurements. Whole-process time includes the runner and
report generation. No timing threshold, coverage target, skip, discovery exclusion,
production deadline or retry is introduced to hit a count/runtime goal.

| Before run | Expanded cases | Assertions | Failures / skips | Whole-process wall time |
| ---------- | -------------: | ---------: | ---------------- | ----------------------: |
| 1          |            361 |      2,549 | 0 / 0            |                 72.563s |
| 2          |            361 |      2,549 | 0 / 0            |                 72.928s |
| 3          |            361 |      2,549 | 0 / 0            |                 72.370s |

Before median: **72.563s**. These measurements supersede neither the historical
single run nor its original artifacts. Concurrent system load is not controlled;
this is a local before/after comparison, not a reliability benchmark.

An additional `strace -f -e trace=execve` setup-count experiment failed 5/361 tests
at startup deadlines and took 111.18s. It is excluded from timing comparisons and
setup evidence, not concealed as a pass. Lightweight fixture-entry counters in a
disposable working copy replaced tracing; they do not ship in the maintained suite.

## Selected result and comparable timings

The final test-bearing revision is `aab8b00`; production `src/`, example implementation,
scripts, dependency pins, build and CI commands have zero diff from the baseline.
The [complete 361-row mapping](/docs/test-reduction-map.md) records 41 KEEP,
170 REPLACE and 150 REMOVE decisions and enumerates the selected 69 cases.

| Group                          |  Before | Selected |
| ------------------------------ | ------: | -------: |
| Adapter core/configuration/ACP |     148 |       21 |
| Adapter HTTP/cancellation      |      67 |       21 |
| Release/demo tooling           |      26 |        8 |
| Agent-network examples         |     120 |       19 |
| **Expanded total**             | **361** |   **69** |

The 69-case selection is above the approximate 62-case allocation for named risks:
direct gateway trust validation, terminal-cancel/next-turn isolation, the V2/V3
oracle properties, real demo-stream validation, and distinct release preflight/
push/publication recovery boundaries. Redundant pure-parser help/version checks
are replaced by the required installed-package workflow; duplicate executor
context/admission scenarios are replaced by retained real HTTP boundaries.

| After run | Expanded cases | Assertions | Failures / skips | Whole-process wall time |
| --------- | -------------: | ---------: | ---------------- | ----------------------: |
| 1         |             69 |      1,318 | 0 / 0            |                 32.047s |
| 2         |             69 |      1,318 | 0 / 0            |                 31.881s |
| 3         |             69 |      1,318 | 0 / 0            |                 31.801s |

After median: **31.881s**, a **56.06% observed reduction** against 72.563s.
The 45s planning hypothesis was met locally, not imposed as a deadline or CI gate.
The three timing runs were sequential and used the exact command above.
Scheduler load and concurrent development activity were not controlled. The
earlier pre-review selection also had 69 cases, with times 33.819s, 32.586s and
34.182s (median 33.819s, 1,304 assertions). Those observations remain historical
evidence, not the accepted final inventory: adversarial review found missing
protocol rejection and external interruption receipts despite that passing count.
The intermediate `6fa56ac` selection recorded 32.776s, 32.596s and 32.858s
(median 32.776s), then a later gate failed H03 before its marker was observed.
After replacing the unnecessary SDK-loaded negative peer, an agent gate exposed
the corresponding H12 startup timeout. The final lightweight peer handles both
negative modes without changing deadlines; its three runs are the table above.

First-run leaf-time attribution, reported separately from whole-process timing:

| File                                   | Before leaf seconds | After leaf seconds |
| -------------------------------------- | ------------------: | -----------------: |
| `tests/server.test.ts`                 |              23.492 |              7.527 |
| `tests/acp-client.test.ts`             |              15.137 |              5.207 |
| `tests/context-http.test.ts`           |              10.914 |              7.779 |
| `tests/cancellation-transport.test.ts` |               7.331 |              3.770 |

Physical deterministic test lines: **4,783 → 2,583**; supporting fixture lines:
**331 → 343**; combined **5,114 → 2,926**. The twelve additional fixture lines
provide the lightweight initialization/protocol peer; aggregate maintained code
and actual setup counts shrink. Source stays **8 files / 997 lines**.
The maintained deterministic inventory is **26 → 21 files**, with no relocated
duplicate suites or new discovery exclusions.

Disposable fixture-entry counters observed these setup counts, outside the timed
runs (both instrumented validations passed). Version probes are not ACP sessions:

| Setup                                       | Before |  After |
| ------------------------------------------- | -----: | -----: |
| Shared ACP peer executions                  |     49 |     19 |
| Cancellation-transport peer executions      |      4 |      2 |
| New initialization/protocol peer executions |      0 |      3 |
| **Controlled ACP process executions**       | **53** | **24** |
| Executable version probes                   |     57 |     25 |
| Real Git release fixture setups             |     11 |      5 |

The baseline cancellation-peer counter was collected in a separate passing
four-case file run because its initial counter was placed after connection close;
the other baseline counters come from the passing full inventory run. Counters
record only fixture kind and version/run, not argv, environment or model content.

## Named safety risks

| Protected behavior                                                                                                        | Selected scenario(s)                 |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Exact root assistant text; exclude child/other/private/late-idle output; truthful order                                   | A1, E1/E2/E4, H09                    |
| Continuation, isolated conversations, unknown and post-restart stale IDs through unary **and** streaming HTTP             | H08, H09                             |
| Synchronous admission before allocation; busy causes no ACP submission; hold until cancellation settles                   | E8, H10, C09                         |
| Offered permission rejection versus cancellation when no reject exists                                                    | A2 (two actual permission exchanges) |
| Process death/deadlines, fail-closed startup, owned descendant cleanup without signaling another owner                    | A4–A8, H03/H04/H05/H12, N10          |
| Concurrent/repeated cancel preserves identical chunks and empty final append; store and stream agree                      | C01, independent SDK comparator, C08 |
| Cancel loses to completion/failure; bounded failure; old terminal cancel cannot affect next turn                          | C02, C03, C06, C08, C10              |
| Explicit generator-return ownership versus disconnected/paused HTTP persistence                                           | C05 versus C07/C08                   |
| Loopback/trusted workspace and sanitized rejection; no early readiness; existing listener survives conflict               | C1/C3/C4/C5, I4, H01/H03/H05/H11     |
| Incomplete HTTP headers and work rejection during drain remain separate                                                   | H06 versus H07                       |
| Local deadline is not remote cancel; uncertain submission has no invented handle/resend; guard URL/tool/budget            | N01–N07, N14                         |
| Missing/bad evidence cannot become success; no raw provider/model diagnostics; interrupted cleanup saves partial findings | N10, N14/N15/N17/N18                 |

H03/H04 share an explicit initialization-marker fixture: they observe entry into
ACP initialization before checking timeout or requesting close. A sleep alone is
not evidence that startup reached that boundary.

## Disclosed repeated workloads and accepted losses

- The three retained N11 properties evaluate **64 subsets each / 192 total**,
  with test-owned fixed optima; their expected answers do not call the objective
  solver. They are the original bounded property checks, not hidden old tables.
- The unchanged demo-stream corruption test has **12 negative vectors**. Its
  separate positive test invokes real jq. Neither was moved out of discovery.
- C01/C02/C03 select **three** mode/terminal-state pairs with two concurrent cancel
  requests each, replacing the 27-case mode × count × state product. This is not
  preservation of that product inside one test.
- C07/C08 each retain the existing **64 × 65,536-byte repeated-text burst (4 MiB)**
  to distinguish socket persistence from generator ownership. This is a fixed
  stress workload, not 64 independent scenarios.
- H08/H09 each use four successful turns across two contexts, plus unknown-ID,
  restart/stale-ID and fresh-conversation assertions in one context lifecycle.
- N07 performs 24 fractional polls, then seven same-connection calls to exercise
  the eight-call reserve. N16 has five explicit judge observations, including one
  valid result and four corruptions. Neither hides a removed Cartesian matrix.
- N10 has two expanded signal cases, SIGINT and SIGTERM, preserving the external
  acceptance name-filter/receipt contract. N17 includes one fixed optimal selection
  with incorrect declared cost/value and proves actual scoring propagates failure
  to BROKEN; it does not derive its expected totals from the scorer.
- Small direct CLI and identity assertions retain predicate representatives:
  unknown/duplicate/missing flags, absent/relative trust roots, decimal/range port
  rejection, four field-specific identity bounds, three malformed runtime
  containers/elements, a control character and an empty comma-delimited field.
- Accepted losses include alias/control-character permutations, dedicated context
  capacity and role/reference/media-type variants, some subprocess transport/auth/
  session-deadline variants, generator pause/resume timing,
  refinement/diamond semantic variants, overlap-scorer mutations and malformed
  experiment tables. The mapping explicitly identifies these; retained checks do
  not establish identical exhaustive coverage.
- Release selection retains bump arithmetic, one real success, dirty/check
  preflight guards and distinct atomic-push/publication failures. Explicit-version
  lexical/rollback bounds and branch/upstream/duplicate-tag preflight checks were
  removed, not silently represented as equivalent to the retained guards.
- The separate installed-package workflow is unchanged, including its existing
  CLI input vectors, two signal paths, installed artifact inspection and owned
  process checks. The 14 live E2E scenarios are unchanged and separately required.

Dead shared fixture modes for removed version-output/hang, session-hang,
cancel-permission, standalone stubborn-child, transport/auth and cancel-loses
permutations were removed after reference reconciliation. `startup-exit` remains
because installed-package acceptance consumes it. No fixture mode was removed
from an external acceptance command.

## Deliberately seeded fault evidence

Four faults were applied independently in a disposable issue-scoped worktree at
`6fa56ac`, then removed. H12 was also fault-seeded again at final `aab8b00` after
changing its peer; the three mandatory tests and production code are unchanged.
The mandatory faults had also been detected at the initial selection. Each
command exited 1 on a behavioral assertion, not a
compiler or fixture-startup error:

| Temporary production fault                     | Exact focused command                                          | Observed sensitivity                                              |
| ---------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| Restore stock SDK cancellation consumer        | `bun test ./tests/request-handler-cancellation.test.ts -t C01` | 1 failure: six extra persisted parts under two concurrent cancels |
| Remove streaming explicit-context preservation | `bun test ./tests/context-http.test.ts -t H09`                 | 1 failure: fresh/continued tasks failed instead of completing     |
| Release admission before cancellation settles  | `bun test ./tests/cancellation.test.ts -t C09`                 | 1 failure: premature request completed instead of failing busy    |
| Remove ACP protocol-version rejection          | `bun test ./tests/server.test.ts -t H12`                       | 1 failure: incompatible startup resolved instead of rejecting     |

After restoring those edits, the disposable worktree had an empty `git diff`.
The coordinator's subsequent three full coverage/JUnit runs passed 69/69 with
zero skips. These four manual fault seeds are not a general mutation score.

## Adversarial review corrections

The first 69-case selection passed while a removed ACP protocol-version check
still allowed HTTP readiness. Review restored H12 rather than treating executable
version mismatch or initialization timeout as equivalent coverage.

The coordinator's first controlled run recorded **N1–N5 WORKING, N6 BROKEN** under
`.test-results/topology-investigation/3cd6572e-bcea-4351-94b7-4b41135270a1/`.
The reduction had renamed the consumed lifecycle test, removed its receipt writer
and retained only SIGTERM. N10 now restores both signals, exact-port rebind proof,
the unchanged external filter and private JSONL receipts. A separate coordinator
run at `.test-results/topology-investigation/c48b25e6-c271-4f40-9815-57d8b95c4421/`
verified **N1–N6 WORKING with cleanup=true**. The first failed evidence remains
unchanged. The overall six-case invocation is intentionally INCOMPLETE (6/27),
exiting 1 at the script/2 through make because live cases were not enabled.

Two medium scorer gaps were corrected in N17: failed dimensions cannot become
WORKING, and an optimal selection with false declared totals must fail correctness.
To retain 69 cases, redundant E3 mixed-parts unit coverage was replaced by retained
real HTTP H02, and the normal C04 stock-SDK comparator was removed in favor of the
pre-existing independent portable comparator. No deleted table was moved to a new
optional suite. Obsolete private stock-fixture mode was removed after reference
search; the independent script remains unchanged and was verified with 0/1/2
cancel requests (control exit 0; known-defect cases intentionally exit 1).

## Validation boundary

The coordinator passed `make check` with the CI coverage/JUnit flags, three
additional comparable full-suite timing runs, `make package-smoke` (12 allowlisted
package files, real installed CLI/direct server and owned cleanup), and the pinned
`make interop-test` (provider-free real bridge, 28 attempts, 40-call limit with the
eight-call reserve). Production code and external acceptance scripts are unchanged.
Billable live-model acceptance was pending at that provider-free verification;
those passes did not fulfill it. The user subsequently authorized one live run
on integration revision `a7f178d`: `make e2e` passed E2E01–05, then failed at
E2E06 with `Private diagnostics withheld`; E2E07–14 were not reached. Harness
cleanup passed, and no retry was used to replace the failure. Production `src/`
and the live harness are unchanged by this refactor. The exact failing sub-step
and cause are unestablished; follow-up [#27](https://github.com/tbrandenburg/opencode-a2a-lite/issues/27)
tracks the retained observation alongside the earlier diagnostic issue #19.
The run's private evidence root is
`.test-results/authorized-live/47844f6a-827d-40c2-9685-0e98ff622252/`.
The test-refactor implementation has since been merged; this does not turn the
failed production live gate into a pass. The separately authorized topology results belong to
[PR #26](https://github.com/tbrandenburg/opencode-a2a-lite/pull/26), not this
test-only benchmark or the original matrix.

## Required and opt-in acceptance

| Command                                                                | Purpose                                                                     | Provider                                                      |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `make check`                                                           | Formatting, lint, strict types, deterministic unit/integration suite, build | None                                                          |
| `make package-smoke`                                                   | Install and execute the real packed npm artifact outside this checkout      | None                                                          |
| `A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test` | Real pinned bridge, gateway and controlled ACP process boundaries           | None                                                          |
| `make e2e`                                                             | Retained 14-scenario production CLI/real-model acceptance                   | Billable, explicit opt-in                                     |
| `make demo`                                                            | Streamed real CLI conversation and marker recall                            | Billable, explicit opt-in                                     |
| `TCK_DIR=/absolute/path/to/pinned/a2a-tck make e2e-tck`                | Separately installed official protocol checks                               | External prerequisites; see [acceptance](/docs/acceptance.md) |

Check free loopback ports before service-based validation. Tests/harnesses use
ephemeral ports or probe their chosen port; an occupied listener is never stopped.
Provider-free fixtures establish transport/policy behavior, not live-model success.
Production live acceptance and installed-package/real-bridge workflows remain.
The managed lab's fault/model runners were explicitly retired as features, not
excluded from test discovery or relabeled as passing boundary acceptance.

The portable upstream-only SDK cancellation reproducer remains outside the passing
suite: `node scripts/repro-sdk-cancellation.mjs 0` is the control; arguments `1`
and `2` intentionally fail with pinned SDK 1.3.0. These are defect demonstrations,
not hidden passing-suite cases or replacements for adapter boundary tests.
