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
