# Repository guidance

## Adapter scope and approved topology investigations

- Follow the [adapter contract](/README.md#scope-freeze), separate from opaque model quality.
- Issues [#36–#42](https://github.com/tbrandenburg/opencode-a2a-lite/issues/36) are explicitly approved for bounded, issue-scoped topology investigations through prompt-driven OpenCode MCP calls. This approval removes the former blanket prohibition/scope gate for those investigations only.
- No new production schedules, roles, scorers, platform features, frameworks, dependencies, models, or expanded budgets/timeouts. Do not add a topology runner or host-side coordinator; preserve the retired managed lab as retired.
- Preserve manual endpoint-guard guidance and historical failures; the managed lab
  is retired, not fixed. Do not restore its model profiles, scorers or runners.
- Meet the post-retirement example-size target by removing the managed lab, not
  relocating it under tests; retain only minimal decoupled interoperability helpers.

## Run A2A agents through MCP

Use this path when asked to delegate through MCP/A2A:
**OpenCode coordinator → MCP endpoint guard → a2abridge → A2A gateway → ACP worker**.
Do not silently substitute native subagents, the A2A CLI, or a direct ACP call.

Use the [one-worker CLI recipe](/.opencode/skills/multi-a2a-agent/references/manual-one-worker.md)
for its baseline. For approved issues #36–#42, also read the linked topology page
and follow that issue's manual procedure and bounded-attempt limits; do not treat
the baseline recipe as a blanket restriction to one worker. Prefer its owned,
warmed private-server variant. From the configured coordinator project, with
`SERVER` and `PROMPT` set to the reviewed endpoint and issue-specific instructions:

```sh
opencode run --server "$SERVER" --agent coordinator --format json "$PROMPT"
```

- No TypeScript coordinator is needed; [typed helpers](/interop/client-guide.md)
  are optional host/CI support. Use Bun **1.3.9**, OpenCode **2.0.28**, checksummed
  a2abridge **4.0.2** and A2A **1.0**. Keep the documented endpoint guard, exact peer/tool
  allowlists, secret stripping and private receipts; the gateway is A2A HTTP, not MCP.
- Check free ports, trust workspaces/cards explicitly, review inherited configuration,
  and keep listeners loopback-only. No global edits, installed services or interruption
  of another owner's processes. `--standalone` is not configuration/storage isolation.
- The private HOME and `XDG_STATE_HOME` in this runbook belong only to its owned smoke
  process. Never apply that isolation or its server settings to MADE's existing
  OpenCode service; doing so can move or replace the `service.json` registration that
  MADE's HTTP history adapter reads.
- Discover workers, send with `blocking:false`, then follow up on the same peer with
  the returned `context_id` and **no `task_id`**. Inspect actual terminal tasks/artifacts
  and coordinator/worker sessions. Missing tools/evidence block acceptance.
- Reserve **eight of 40 attempts**, including denials; supervise absolute submit+wait
  deadlines and spaced polls. Prompts do not enforce bounds. No guessed handles,
  automatic resend/reconnect or implicit cancellation; retain pending/uncertain outcomes.
- For issues #41–#42, the approval explicitly opens bounded assessment of worker-side
  delegation using manually reviewed, issue-local configuration and existing guarded
  routes. It does not authorize production delegation features or guard changes.
- Live model attempts may incur provider charges; the user monitors spend. Run them
  when they are part of the current user-requested task, without asking for separate
  per-attempt billing authorization. The warmed one-worker
  variant has one dated observed pass; cold standalone startup and selected topology
  outcomes remain unverified until their issue evidence is reviewed. Neither catalog
  readiness nor CLI exit zero proves acceptance.
  On success/failure/interruption close owned MCP, stop heartbeats, unregister workers,
  then stop owned gateways and finally the directory. Verify PID/port release and publish
  only sanitized checks. Follow the recipe's membership and cleanup order exactly.

### Manual one-worker live runbook

For a requested real-model MCP→A2A smoke, execute the [reviewed one-worker recipe](/.opencode/skills/multi-a2a-agent/references/manual-one-worker.md); do not stop merely because its project-local `network` MCP config, worker gateway, or directory is not present yet. Those are created and started as recipe setup. Missing provider access, trusted project/config review, actual tools, bounded supervision, or acceptance evidence are genuine blockers.

1. Run only when the live attempt is part of the current user-requested task; the user monitors provider spend, so do not seek separate per-attempt billing authorization. Review the trusted coordinator/worker projects, inherited OpenCode config and provider/model settings. Use fresh mode-0700 private state/HOMEs, verified pinned tools, and checked free loopback ports; do not copy or print credentials or change global/shared configuration. Set `HOME` first, then derive its `XDG_*` paths in a later shell command; verify `opencode debug paths` before any service setting.
2. Build the repo. Start the tool-denied worker gateway and loopback A2A directory from dedicated owned processes, verify readiness/cards, register the exact worker URL, and maintain its heartbeat.
3. Manually merge the documented project-local coordinator config with the endpoint guard, exact worker allowlist and six permitted network tools. Do not bypass the guard or expose listeners beyond loopback.
4. Start an owned coordinator `opencode serve` on loopback with the private HOME. Warm that **same** server using the recipe's bounded read-only probes; require the correct coordinator, connected `network` MCP and actual six-tool catalog before submitting. Run `opencode run --server "$SERVER" --agent coordinator --format json "$PROMPT"` against that server—never cold `--standalone` for this smoke.
5. Use the recipe's two-turn marker prompt. An external supervisor must enforce each absolute 30-second submit-plus-wait deadline and observe spaced polling; a whole-invocation timeout or prompt instruction alone is not equivalent. If the supervisor cannot enforce these bounds, do not submit and record the bounded-wait gate as BLOCKED. Stop ordinary work at 32/40 calls, allow at most eight spaced polls per turn, and do not retry, resend, reconnect, or implicitly cancel. Verify actual paired tool calls, returned peer/context/task handles, both completed task artifacts, exact worker inputs, correlated coordinator/worker sessions and marker continuity. A zero CLI exit or self-report is insufficient; missing/uncertain evidence is INCOMPLETE.
6. On every outcome, close the coordinator client and owned server/MCP connection; stop heartbeat, unregister while the directory remains up, record and require HTTP 204, then stop the owned gateway and directory. Verify owned processes and every recorded port are released before removing private state. Publish only sanitized outcomes and cleanup evidence.

Report model behavior/task completion separately from transport, topology and operations gates. A successful task does not erase another failed gate; missing required evidence makes overall acceptance INCOMPLETE without relabeling observed successful task behavior as a model failure.

This runbook documents the one-worker baseline, not the topology procedures. The
user-approved issues #36–#42 authorize bounded investigations only through their
linked issue procedures. They do not restore the retired multiworker lab or turn
historical topology observations into new live results.

Provider-free gate: `A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test`.
This verifies the adapter boundary, not real-model E2E or model reasoning. The managed
network/topology lab is retired; history at `a70b639` and factual findings remain.
Production `make e2e` and the single-gateway `make demo` are manual, provider-billed operations and do not run in ordinary CI. Do not ask for separate billing approval when they are part of the current user request.

## MADE OpenCode HTTP history registration

- When diagnosing MADE's `opencode-v2` history adapter, treat OpenCode's local HTTP
  service and its `service.json` as existing user state. Inspect them read-only in the
  Python backend's actual user/environment context. Do not start a second `opencode
  serve`, change its hostname/port, switch `HOME` or `XDG_STATE_HOME`, relocate state,
  or create/edit/delete the registration as a troubleshooting step. These changes can
  make the server and MADE resolve different registration files or disrupt HTTP history
  reads.
- First compare the backend and service process user, `HOME`, and `XDG_STATE_HOME`, and
  check the expected registration path without displaying its password. Validate the
  registered URL and credential presence without rewriting the file. If the service or
  registration is missing or invalid, report the finding and preserve the current
  state; only change service configuration when the user explicitly requests that
  repair and the exact service/process to change is established.
- Keep diagnosis distinct from repair instructions: do not tell the user to start or
  restart `opencode serve`, choose a new hostname/port, create a registration, or switch
  MADE to another adapter merely because this error appeared or `service.json` is
  missing. A missing registration is a finding, not authorization to bootstrap or
  reconfigure the service. Explain that the `opencode-v2` adapter does not manage the
  service lifecycle, summarize the verified cause, and preserve existing state. If the
  user explicitly asks for repair, first establish the exact intended service and
  process; then make only that requested change and verify it without exposing secrets.
- If providing diagnostic commands, make them read-only and run them in MADE's actual
  Python backend context. Do not present generic commands from a shell session as proof
  of what the backend sees. Never print the registration contents or password; report
  only path/existence, parse validity, URL validation result, and whether credentials
  are present.
- Keep the isolated, owned server used by the A2A smoke strictly separate from MADE's
  service. Its private state is disposable smoke infrastructure and must never become
  MADE's configured state or be used to repair the adapter registration.
- When creating an isolated HOME and XDG paths in shell, assign HOME first, then derive
  XDG_CONFIG_HOME, XDG_STATE_HOME, and other HOME-relative paths in later commands.
  Do not place `HOME="$STATE/worker-home"` and `XDG_CONFIG_HOME="$HOME/.config"`
  in the same `export` command: shell expansions use the pre-command HOME, which can
  direct setup commands such as `opencode service set` at the user's global config.
  Before changing service settings, confirm the active HOME and config path; only modify
  service state when the user explicitly requested that repair and the intended service
  is established.

## Lessons Learned

- 2026-10-28: Pitfall: Setting `HOME` and deriving `XDG_CONFIG_HOME` in the same shell
  `export` used the old HOME, so `opencode service set disabled true` changed the user's
  global OpenCode service configuration instead of the intended private worker config.
  Prevention: export HOME in its own command, derive XDG paths afterward, and verify the
  effective config path before service-setting commands.
- 2026-10-28: Pitfall: Isolating or restarting OpenCode while investigating MADE's
  history adapter can move or replace the `service.json` registration and break HTTP
  history reads. Prevention: inspect the existing service registration read-only in
  MADE's backend context; never alter its HOME, XDG state, listener, or registration as
  a diagnostic step. Keep A2A smoke servers in separate private state.

- 2026-10-28: Pitfall: An operator-invented three-second polling minimum interrupted a completed first worker task before its follow-up; the recipe specified spaced polls but no numeric minimum. Prevention: Derive acceptance gates from the reviewed contract, retain observed timing separately, and distinguish supervisor interruption from adapter failure. Preserve earlier evidence when authorizing a fresh corrected smoke; never resend an uncertain task.
- 2026-10-28: Pitfall: A cold OpenCode 2.0.28 standalone run constructed its primary request with zero MCP tools, while a warmed private server exposed the six expected tools. Prevention: Review a same-server warmup approach explicitly, verify actual model tool calls rather than transport/catalog readiness alone, and do not silently substitute the shared service or assume a fixed sleep fixes readiness.
- 2026-10-28: Pitfall: Pinned CLI help advertised parameters that raw API requests ignored. Prevention: Verify pinned request resolution, not just help; use operation IDs when query interpolation requires them and check pagination separately.
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
