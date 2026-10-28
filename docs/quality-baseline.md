# Local quality baseline

Issue [#2](https://github.com/tbrandenburg/opencode-a2a-lite/issues/2) adds measurements, not a correctness score or a no-growth ratchet. Formatting, existing lint errors, strict typing, deterministic tests and build remain failure gates. Structural findings are warnings.

## Run locally

```sh
make install # frozen lockfile
make check
bun scripts/quality-report.ts
```

`make test` runs `bun test ./tests` exactly once through a small wrapper. The wrapper measures whole-process monotonic wall time, writes `.test-results/test.json`, and exits with the test process's exit code. No retries or skips are added. `make lint` similarly preserves Oxlint's exit code and saves diagnostics. Direct `bun run test`/`bun run lint` remain available but do not produce wrapper measurements.

CI supplies optional native flags to that same test invocation:

```sh
make check LINT_FLAGS='--format github' \
  TEST_FLAGS='--coverage --coverage-reporter=text --coverage-reporter=lcov --coverage-dir=coverage --reporter=junit --reporter-outfile=.test-results/junit.xml'
bun scripts/quality-report.ts
```

Reports are ignored under `.test-results/` and `coverage/`. The wrapper removes previous default LCOV/JUnit/test measurements before each test invocation so an ordinary run cannot reuse previous coverage. Reports otherwise describe the latest corresponding commands; use `make clean` before a fresh independent baseline, particularly if an earlier gate may fail before tests execute. CI starts from a fresh checkout.

CI summary/artifact steps use `always()` so earlier failures still produce available diagnostics; they do not replace, swallow, or relax the failed check. A formatter/linter/type-check failure before tests yields unavailable test measurements, not a passing suite. The summary includes commit/tool versions, physical file inventory, test exit/wall time, native coverage and captured warnings. The commit identifies checked-out code; uncommitted local edits are explicitly not represented by it. JUnit is an interchange artifact, not a reliable per-file wall-clock profiler.

## Scope and initial observations

- Production inventory: `src/acp-client.ts`, `src/executor.ts`, `src/request-handler.ts`, `src/server.ts`: 4 files, 801 physical lines at the starting revision `515b40a47323ab90a740a345a0e716e2c622b4b2`.
- Deterministic test inventory: `tests/**/*.test.ts`: 7 files, 1,423 physical lines at that revision. Fixtures, scripts and opt-in live harnesses are excluded, as are dependencies, generated output and worktrees. Blank/comment lines count; a trailing newline does not add an extra line.
- Oxlint warns on production complexity above 10 and production files above 200 physical lines. Deterministic test files warn above 500 physical lines. `skipBlankLines` and `skipComments` are explicitly false. No `max-lines-per-function` rule is enabled. Existing warnings are review prompts, not a demand for mechanical function splitting.
- The initial local `make check` after this change passed 93 tests / 376 assertions with whole-test-process wall time 36.481s. Six structural diagnostics were warnings: source sizes 332 and 223; complexity values 11, 14, 21 and 13. These observations are not a runtime distribution or budget.
- After integrating the cancellation regressions and reporting follow-up, the coordinator's CI-equivalent gate passed 131 tests / 583 assertions across 9 files with whole-test-process wall time 35.397s. Production stayed at 801 physical lines; deterministic test files totalled 1,733. See [acceptance evidence](/docs/acceptance.md) for the real-model gate and review results.

The issue records an intermittent `ACP startup timed out` with the server success fixture's 800ms startup deadline. The coordinator subsequently observed another unchanged-root baseline pass (93/376), followed by a post-build run with 7/93 failures (344 assertions, 48.59s): server SSE, five invalid-input/ACP-failure cases, and incomplete-HTTP shutdown failed during fixture startup. Discovery remained 93 tests across 7 files. Concurrent agent activity was present, but this does not prove causality. The exact scheduling/root cause is unproven.

Only the normal server fixture now has 3,000ms bounded startup headroom; non-normal fixture modes retain 800ms, and production defaults and dedicated negative-test deadlines are unchanged. A repeat of the server fixture file passed 85 tests / 355 assertions across five repetitions without retries (66.81s). Two subsequent coverage-enabled full checks passed 93/376 with whole-test-process times 47.803s and 33.204s, including execution after generated build output existed. This evidence reduces concern but cannot prove an intermittent failure impossible; final comparable performance measurements should be sequential.

## Coverage interpretation and limits

Bun 1.3.9 supplies native function/line coverage, LCOV and JUnit without another dependency or runner. The summary reports per-production-file **LCOV hit/found counters** and percentages, not Bun's displayed per-file-average aggregate. There are no coverage percentage gates. Coverage only includes loaded files, so the report separately compares discovered production files with the four expected modules and verifies discovered source membership in LCOV. Differences produce warnings, not hidden omissions or a new blocking ratchet.

**Branch coverage is unmeasured. Mutation score is unmeasured.** Missing reports are unmeasured, not zero. LCOV conversion cannot invent missing branch counters. Line coverage cannot establish branch behavior, cancellation correctness, or executable signal handling. No test is added merely to increase a coverage percentage. Keep real-model acceptance outside the default test suite.

Select any runtime warning budget only after comparable hosted measurements. Consider a bounded manual mutation spike or branch-tool feasibility study separately if a demonstrated need justifies the cost; neither is a scheduled job or new service in this baseline.

## CI supply chain and references

Checkout is pinned to verified `actions/checkout` v7.0.1 commit `3d3c42e5aac5ba805825da76410c181273ba90b1`, whose action metadata declares Node 24 (runner v2.327.1+). `contents: read`, `push`/`pull_request`, and `persist-credentials: false` remain unchanged. Artifact upload is also SHA-pinned and uses Node 24. Hosted verification is recorded in the implementation PR; local checks alone do not establish removal of runtime annotations or successful artifact publication.

Hosted reporting prints a completion notice rather than replaying captured GitHub annotation commands. Complete diagnostics remain in the step summary and uploaded Markdown, without duplicating the annotations emitted by the lint step.

Research used current Context7 documentation and these primary sources, checked against the installed pinned tools:

- [Bun native coverage](https://bun.com/docs/test/code-coverage) and [JUnit reporters](https://bun.com/docs/test/reporters).
- [Oxlint complexity](https://oxc.rs/docs/guide/usage/linter/rules/eslint/complexity) and [max-lines options](https://oxc.rs/docs/guide/usage/linter/rules/eslint/max-lines).
- [Checkout release](https://github.com/actions/checkout/releases/tag/v7.0.1) and [immutable runtime metadata](https://github.com/actions/checkout/blob/3d3c42e5aac5ba805825da76410c181273ba90b1/action.yml).
