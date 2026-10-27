# Deterministic test selection

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

The test-bearing revision is `5f756b5`; production `src/`, example implementation,
scripts, dependency pins, build and CI commands have zero diff from the baseline.
The [complete 361-row mapping](/docs/test-reduction-map.md) records 41 KEEP,
164 REPLACE and 156 REMOVE decisions and enumerates the selected 69 cases.

| Group                          |  Before | Selected |
| ------------------------------ | ------: | -------: |
| Adapter core/configuration/ACP |     148 |       22 |
| Adapter HTTP/cancellation      |      67 |       21 |
| Release/demo tooling           |      26 |        8 |
| Agent-network examples         |     120 |       18 |
| **Expanded total**             | **361** |   **69** |

The 69-case selection is above the approximate 62-case allocation for named risks:
direct gateway trust validation, terminal-cancel/next-turn isolation, the V2/V3
oracle properties, real demo-stream validation, and distinct release preflight/
push/publication recovery boundaries. Redundant pure-parser help/version checks
are replaced by the required installed-package workflow; duplicate executor
context/admission scenarios are replaced by retained real HTTP boundaries.

| After run | Expanded cases | Assertions | Failures / skips | Whole-process wall time |
| --------- | -------------: | ---------: | ---------------- | ----------------------: |
| 1         |             69 |      1,304 | 0 / 0            |                 33.819s |
| 2         |             69 |      1,304 | 0 / 0            |                 32.586s |
| 3         |             69 |      1,304 | 0 / 0            |                 34.182s |

After median: **33.819s**, a **53.39% observed reduction** against 72.563s.
The 45s planning hypothesis was met locally, not imposed as a deadline or CI gate.
The three timing runs were sequential and used the exact command above.

First-run leaf-time attribution, reported separately from whole-process timing:

| File                                   | Before leaf seconds | After leaf seconds |
| -------------------------------------- | ------------------: | -----------------: |
| `tests/server.test.ts`                 |              23.492 |              8.030 |
| `tests/acp-client.test.ts`             |              15.137 |              6.075 |
| `tests/context-http.test.ts`           |              10.914 |              7.997 |
| `tests/cancellation-transport.test.ts` |               7.331 |              3.737 |

Physical deterministic test lines: **4,783 → 2,560**; supporting fixture lines:
**331 → 328**; combined **5,114 → 2,888**. Source stays **8 files / 997 lines**.
The maintained deterministic inventory is **26 → 21 files**, with no relocated
duplicate suites or new discovery exclusions.

Disposable fixture-entry counters observed these setup counts, outside the timed
runs (both instrumented validations passed). Version probes are not ACP sessions:

| Setup                                      | Before |  After |
| ------------------------------------------ | -----: | -----: |
| Shared ACP peer executions                 |     49 |     19 |
| Cancellation-transport peer executions     |      4 |      2 |
| New initialization-barrier peer executions |      0 |      2 |
| **Controlled ACP process executions**      | **53** | **23** |
| Executable version probes                  |     57 |     24 |
| Real Git release fixture setups            |     11 |      5 |

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
| Process death/deadlines, fail-closed startup, owned descendant cleanup without signaling another owner                    | A4–A8, H03/H04/H05, N10              |
| Concurrent/repeated cancel preserves identical chunks and empty final append; store and stream agree                      | C01, C04 comparator, C08             |
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
- Small direct CLI and identity assertions retain predicate representatives:
  unknown/duplicate/missing flags, absent/relative trust roots, decimal/range port
  rejection, four field-specific identity bounds, three malformed runtime
  containers/elements, a control character and an empty comma-delimited field.
- Accepted losses include alias/control-character permutations, dedicated context
  capacity and role/reference/media-type variants, some subprocess transport/auth/
  protocol-version/session-deadline variants, generator pause/resume timing,
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

Three faults were applied independently in a disposable issue-scoped worktree at
`5f756b5`, then removed. Each command exited 1 on a behavioral assertion, not a
compiler or fixture-startup error:

| Temporary production fault                     | Exact focused command                                          | Observed sensitivity                                              |
| ---------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| Restore stock SDK cancellation consumer        | `bun test ./tests/request-handler-cancellation.test.ts -t C01` | 1 failure: six extra persisted parts under two concurrent cancels |
| Remove streaming explicit-context preservation | `bun test ./tests/context-http.test.ts -t H09`                 | 1 failure: fresh/continued tasks failed instead of completing     |
| Release admission before cancellation settles  | `bun test ./tests/cancellation.test.ts -t C09`                 | 1 failure: premature request completed instead of failing busy    |

After restoring those edits, the disposable worktree had an empty `git diff`.
The coordinator's subsequent three full coverage/JUnit runs passed 69/69 with
zero skips. These three manual fault seeds are not a general mutation score.

## Validation boundary

The coordinator passed `make check` with the CI coverage/JUnit flags, three
additional comparable full-suite timing runs, `make package-smoke` (12 allowlisted
package files, real installed CLI/direct server and owned cleanup), and the pinned
`make interop-test` (provider-free real bridge, 28 attempts, 40-call limit with the
eight-call reserve). Production code and external acceptance scripts are unchanged.
Billable live-model acceptance is pending explicit authorization; provider-free
passes do not fulfill that gate. This report does not claim the issue's merged/
live-acceptance definition of done has been met.

## Required and opt-in acceptance

| Command                                                                | Purpose                                                                                  | Provider                                                      |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `make check`                                                           | Formatting, lint, strict types, deterministic unit/integration suite, build              | None                                                          |
| `make package-smoke`                                                   | Install and execute the real packed npm artifact outside this checkout                   | None                                                          |
| `A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test` | Real pinned bridge, gateway and controlled ACP process boundaries                        | None                                                          |
| `make topology-investigation ARGS='--faults --allow-cancel'`           | Six separately reported controlled negative experiments; intentionally incomplete matrix | None                                                          |
| `make e2e`                                                             | Retained 14-scenario production CLI/real-model acceptance                                | Billable, explicit opt-in                                     |
| `make demo`                                                            | Streamed real CLI conversation and marker recall                                         | Billable, explicit opt-in                                     |
| `make network-demo`                                                    | Model-issued guarded MCP collaboration                                                   | Billable, explicit opt-in                                     |
| `make topology-investigation ARGS='--live …'`                          | Selected fixed-schedule model-issued MCP cases                                           | Billable, explicit opt-in                                     |
| `TCK_DIR=/absolute/path/to/pinned/a2a-tck make e2e-tck`                | Separately installed official protocol checks                                            | External prerequisites; see [acceptance](/docs/acceptance.md) |

Check free loopback ports before service-based validation. Tests/harnesses use
ephemeral ports or probe their chosen port; an occupied listener is never stopped.
Provider-free fixtures establish transport/policy behavior, not live-model success.
Live acceptance and installed-package/real-bridge workflows are not removed or
relabeled to reduce the deterministic count.

The portable upstream-only SDK cancellation reproducer remains outside the passing
suite: `node scripts/repro-sdk-cancellation.mjs 0` is the control; arguments `1`
and `2` intentionally fail with pinned SDK 1.3.0. These are defect demonstrations,
not hidden passing-suite cases or replacements for adapter boundary tests.
