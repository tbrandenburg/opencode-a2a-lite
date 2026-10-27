# Repository guidance

## Run A2A agents through MCP

Use this path when asked to delegate through MCP/A2A:
**OpenCode coordinator → MCP endpoint guard → a2abridge → A2A gateway → ACP worker**.
Do not silently substitute native subagents, the A2A CLI, or a direct ACP call.

### Which MCP server?

- **Implementation:** use the pinned **a2abridge 4.0.2** MCP server, launched through
  this repository's `examples/agent-network/bridge-proxy.ts` endpoint guard.
  The gateway is an **A2A HTTP server, not an MCP server**; do not configure its
  HTTP URL as a remote MCP endpoint or bypass the guard with a direct bridge launch.
- **Transport:** configure a **local stdio** server (`type: "local"`), with
  `codemode: false`. OpenCode launches Bun → `bridge-proxy.ts` → a2abridge.
- **Location/name:** use project-local `opencode.json` or `.opencode/opencode.json`,
  under `mcp.servers.network`. `network` is a configuration label/tool prefix,
  not another MCP product; renaming it requires updating the tool permission names.
- **Required values:** absolute paths to Bun, the guard script and the verified
  bridge binary; the running directory URL; a writable private receipt-file path;
  and a JSON array of exact approved worker root URLs. Create the receipt parent
  directory first. The peer argument is the JSON array, not a manifest filename.
- **Complete configuration:** copy and adapt the
  [project-local MCP fragment](/examples/agent-network/README.md#4-manually-merge-the-project-local-mcp-fragment),
  including its six explicit tool permissions. Replace path placeholders with
  literal absolute paths; JSON strings do not expand shell `$VARIABLES`.

### Set up and discover

1. Follow the [manual two-worker recipe](/examples/agent-network/README.md#manual-two-worker-recipe-separate-from-the-managed-demo)
   for runnable worker, directory, registration and project-local MCP configuration.
   Use Bun **1.3.9**, OpenCode **2.0.28**, checksummed a2abridge **4.0.2**, and A2A **1.0**.
   Check free loopback ports before startup; never stop another owner's processes.
   Keep gateways loopback-only; do not use public proxies or untrusted directories/cards.
2. Launch each worker in an explicitly trusted workspace. Set `A2A_NAME`,
   `A2A_DESCRIPTION` and optional comma-separated `A2A_TAGS` before startup; use
   the actual printed readiness URL and verify `/.well-known/agent-card.json`.
   Identity is descriptive metadata, not permission or authentication.
3. Keep the directory running, register the exact worker root URLs, and refresh
   heartbeats every **20 seconds**. Membership expires after **90 seconds**, with
   garbage collection every **30 seconds**. The
   [peer inventory](/examples/agent-network/peers.example.json) is illustrative;
   no runtime loads it or replaces directory membership with it.
4. Manually merge the recipe's `mcp.servers.network` fragment into the coordinator's
   project configuration with `codemode: false` and six explicit tool permissions.
   Preserve the existing endpoint guard and its exact URL allowlist, including `/`.
   Review inherited/ancestor configuration; project-local does not mean isolated.
   Never edit global configuration or install services as part of this setup.
   Keep provider keys out of files/logs and out of the bridge child environment;
   the guard strips that environment, whereas MCP `environment: {}` does not.
5. Inspect the actual MCP catalog; for the recipe's `network` server, direct tool
   names are `network_a2a_whoami`, `network_a2a_list_agents`,
   `network_a2a_send_message`, `network_a2a_send_streaming`, `network_a2a_get_task`
   and `network_a2a_cancel_task`. If unavailable, report the setup blocker rather
   than inventing a tool call. Use `network_a2a_list_agents` to discover cards and
   exact approved URLs. `opencode mcp list` or a catalog receipt alone does not
   prove model-callable readiness; verify an actual completed request.

### Delegate, continue and stop

- Send a bounded task and explicit acceptance criteria with
  `network_a2a_send_message({ peer_url, text, blocking: false })`.
  Retain the discovered peer URL and **returned** `contextId` and task `id`; never guess IDs.
- Poll `network_a2a_get_task({ peer_url, task_id })` using that task ID. Inspect
  the actual A2A state and artifacts: MCP success is not task completion.
  Distinguish completed, failed/rejected, canceled and pending work; surface
  tool errors and unknown tasks instead of reporting success.
- Continue the same peer with
  `network_a2a_send_message({ peer_url, text, context_id, blocking: false })`,
  using the returned context ID and **omitting `task_id`**. Retain the new task ID.
  Do not reuse a handle with another peer or silently restart an unknown/stale context.
- Choose one absolute local deadline for submission plus waiting; bound each call
  and polling sleep by its remaining time. Keep polling bounded and reserve
  **eight calls** for intervention within the guard's **40-attempt connection budget**.
  Do not increase the budget, poll rapidly, or reconnect to evade exhaustion.
  A gateway admits only one active turn; concurrent work fails busy, not queued.
- A local timeout/abort is **not remote cancellation**. Keep the handle and last
  observed state. If submission yields no handle, report **uncertain** and do not
  resend automatically. Explicitly cancel only when requested with
  `network_a2a_cancel_task({ peer_url, task_id })`; inspect the truthful result or
  surface the cancellation error, including a race lost to completion.
- Bridge 4.0.2 cannot pass `context_id` through `a2a_send_streaming`. Use
  nonblocking send plus polling for continuation; polling is not SSE streaming.
  Unary bridge calls have a **60-second** budget versus the gateway's default
  **120-second** prompt budget, so do not depend on long blocking sends.
- For host code, reuse the [typed task helper](/examples/agent-network/client-guide.md)
  and its monotonic `performance.now()` deadlines. It does **not** govern the
  model's direct MCP calls; apply these rules explicitly when using those tools.
- On success or failure, close owned MCP connections, stop owned heartbeat loops,
  unregister workers and stop owned gateway/directory processes. Verify process
  exit and released ports. Never reuse managed-demo URLs/profiles after cleanup.
  Report task outcome, verified artifacts and cleanup using sanitized evidence.
  Do not publish raw prompts, reasoning or provider diagnostics.

### Verify the setup

- Provider-free real-bridge checks:
  `A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test`.
- Opt-in **billable** real-model acceptance:
  `A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make network-demo`.
  This managed experiment verifies its own generated configuration and stops its
  endpoints; it does not leave a persistent network configured for later tasks.
- Done means the intended worker cards were discovered, the actual remote task
  completed with the expected artifact, and owned-resource cleanup was verified.
  Do not claim real-model E2E from provider-free fixtures or catalog arrival.

## Lessons Learned

- 2026-10-27: Pitfall: A close-during-initialization test closed before initialization began. Prevention: Synchronize lifecycle failure tests on a peer-side handshake; sleeps and process existence do not prove the target boundary was reached.
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
