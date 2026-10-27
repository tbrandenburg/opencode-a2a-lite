# Repository guidance

## Adapter scope freeze

- Follow the [adapter contract](/README.md#scope-freeze), separate from opaque model quality.
- No new schedules, roles, scorers, platform features, frameworks, dependencies, models, or expanded budgets/timeouts.
- Preserve manual endpoint-guard guidance and historical failures; the managed lab
  is retired, not fixed. Do not restore its model profiles, scorers or runners.
- Meet the post-retirement example-size target by removing the managed lab, not
  relocating it under tests; retain only minimal decoupled interoperability helpers.

## Run A2A agents through MCP

Use this path when asked to delegate through MCP/A2A:
**OpenCode coordinator → MCP endpoint guard → a2abridge → A2A gateway → ACP worker**.
Do not silently substitute native subagents, the A2A CLI, or a direct ACP call.

1. Follow the [manual recipe](/examples/agent-network/README.md#manual-two-worker-recipe).
   Use Bun **1.3.9**, OpenCode **2.0.28**, checksummed a2abridge **4.0.2**, A2A **1.0**.
   Check ports before startup; never stop another owner's processes. Trust workspaces,
   directory and cards explicitly; keep gateways loopback-only, without public proxies.
2. Use `examples/agent-network/bridge-proxy.ts`, never a direct bridge launch. The
   gateway is **A2A HTTP, not MCP**. Manually merge the documented project-local
   `mcp.servers.network` fragment: local stdio, `codemode:false`, six explicit tool
   permissions, absolute Bun/guard/binary paths, directory URL, private writable
   receipt path and JSON array of exact root peer URLs including `/`. No manifests
   or shell-variable expansion. Review inherited configuration; never edit global
   configuration or install services. The guard strips child secrets; `environment:{}` does not.
3. Set identity before startup, use actual readiness URLs, verify intended cards,
   register roots and refresh heartbeats every **20s** (TTL **90s**, GC **30s**).
   Identity is metadata, not authorization. Keep the directory running for discovery.
4. Inspect the actual catalog: `network_a2a_whoami`, `network_a2a_list_agents`,
   `network_a2a_send_message`, `network_a2a_send_streaming`, `network_a2a_get_task`,
   `network_a2a_cancel_task`. Unavailable tools are a blocker, not permission to
   substitute another route. Catalog receipt/`opencode mcp list` is not model-callable readiness.
5. Discover exact URLs, then send bounded text with `blocking:false`. Retain returned
   peer/context/task IDs; poll actual task state/artifacts. Continue with `context_id`
   and **omit `task_id`**; retain the new task ID. Never cross peers, guess handles,
   silently restart stale contexts, or mistake MCP success for completed work.
6. Use one absolute local deadline for submit+wait, bound calls/sleeps by remaining
   time and reserve **eight calls** within **40 attempts**, including denials.
   No rapid polling, budget increases or reconnect evasion. Busy fails, not queues.
   Local timeout/abort is not remote cancellation: retain pending handles or report
   uncertain submission without resend. Cancel only when requested; inspect actual
   outcome/error, including a race lost to completion. Surface unknown-task errors.
7. Bridge 4.0.2 cannot stream continuation; use nonblocking send+polling (not SSE).
   Unary budget is **60s**, gateway prompt default **120s**. Reuse the
   [typed helper](/examples/agent-network/client-guide.md) for host code; its monotonic
   deadlines do not govern direct model MCP calls, which need equivalent instructions.
8. On success/failure close owned MCP connections, stop heartbeats, unregister workers
   and stop owned gateways/directory. Verify PID exit and exact-port release. Never
   reuse stopped URLs/profiles. Publish only sanitized outcome/artifact/cleanup checks.

Provider-free gate: `A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test`.
This verifies the adapter boundary, not real-model E2E or model reasoning. The managed
network/topology lab is retired; history at `a70b639` and factual findings remain.
Production `make e2e` and the single-gateway `make demo` remain opt-in and billable.

## Lessons Learned

- 2026-10-27: Pitfall: Port-release probes mistook TCP TIME_WAIT for a leaked listener. Prevention: Match server socket-reuse semantics and verify listener/process absence before classifying a failed raw bind as cleanup failure.
- 2026-10-27: Pitfall: Renaming a test and dropping receipt hooks broke external acceptance. Prevention: Treat consumed test-name filters and receipt environment variables as APIs; search their callers and run external acceptance before accepting a test reduction.
- 2026-10-27: Pitfall: Timed lifecycle tests conflated fixture startup with their intended boundary. Prevention: Use lightweight, request-level peer handshakes; distinguish fixture cold-start cost from the failure under test, and never treat sleeps or process existence as readiness.
- 2026-10-27: Pitfall: Independent test-budget exceptions exceeded the combined cap. Prevention: Reserve shared headroom before delegation; reconcile expanded counts across scopes and remove cross-layer duplicates only after naming their retained boundary replacements.
- 2026-10-27: Pitfall: Cross-process readiness readers observed partially written JSON. Prevention: Publish readiness through a same-directory temporary file and atomic rename; test a paused writer with a concurrent reader.
- 2026-10-27: Pitfall: Modified submission text was mislabeled as a retry. Prevention: Score input integrity, duplicate sends and uncertain resubmission independently; retain expected hashes before dispatch and preserve returned handles on mismatches.
- 2026-10-27: Pitfall: A renamed coordinator bypassed a role-filtered readiness observer. Prevention: Share the audited role identifier and exercise the bundled observer against the configured role before paid acceptance.
- 2026-10-27: Pitfall: Fractional timer delivery allowed an early extra poll on CI. Prevention: Round waits upward and recheck absolute monotonic wake/deadline targets after delivery; exercise fractional intervals with real timers.
- 2026-10-27: Pitfall: Live-model contract failures lacked bounded mismatch evidence. Prevention: Specify current-versus-intended result semantics and retain sanitized boolean mismatch metadata; do not infer transport failure from a reasoning-oracle failure.
- 2026-10-27: Pitfall: CI fixtures assumed an agent-host temporary directory existed. Prevention: Create unique fixtures beneath os.tmpdir() and validate with a fresh TMPDIR; never inherit machine-specific directory prerequisites.
- 2026-10-27: Pitfall: Fast status polling exhausted a bounded MCP tool budget before intervention. Prevention: Derive polling intervals from startup deadlines and call budgets, reserving calls for cancellation and cleanup.
- 2026-10-27: Pitfall: Successful-run cleanup hid interrupted-run leaks and evidence-write failures. Prevention: Propagate signals to owned resources, drain cleanup independently of reporting, and test interruption with real child/TCP fixtures.
- 2026-10-26: Pitfall: Bun HTTP close ordering hides incomplete sockets and invalidates later force-close calls. Prevention rule/countermeasure: Verify shutdown against the pinned runtime with incomplete TCP headers; retain force-close capability through bounded draining.
- 2026-10-26: Pitfall: Incremental compilation leaves obsolete JavaScript eligible for wildcard npm inclusion. Prevention rule/countermeasure: Clean generated runtime output in prepack and seed a stale artifact in packaging acceptance to verify its exclusion.
- 2026-10-26: Pitfall: Temporary workspaces can inherit global OpenCode tools/plugins/MCP. Prevention: isolate HOME/config discovery and verify configuration sources before live prompts; inspect the pinned schema rather than interpreting source-list diagnostics as merged configuration.
- 2026-10-26: Pitfall: Compiled test copies inflated the Bun suite. Prevention: target `bun test ./tests` explicitly; verify test counts again after building, and exclude generated/user directories from formatter and linter discovery.
- 2026-10-26: Pitfall: Tight success-path subprocess deadlines failed during concurrent validation. Prevention: give normal fixture startup bounded scheduler headroom, retain separate short timeout tests, and measure runtime baselines without concurrent validation workloads.
- 2026-10-26: Pitfall: Reprinting captured GitHub workflow commands doubled annotations. Prevention: retain raw diagnostics in summary/artifact files and print only a completion notice from hosted reporting steps.
- 2026-10-26: Pitfall: Negated GitHub closing-keyword references still closed an unresolved issue. Prevention: use plain related-issue references for open dependencies; never combine a closing keyword and issue reference in negated prose.
