# Repository guidance

## Product scope

This project is a **small, trusted-workspace ACP → A2A gateway**, not a multi-agent
orchestration platform. Keep adapter responsibilities limited to protocol mapping,
single-turn admission, stream/context continuity, cancellation, accurate task
outcomes and owned-resource cleanup. Model reasoning quality is separate from
adapter correctness. Do not add production schedulers, roles, scorers, model
profiles, retries or new dependencies to restore the retired managed lab.

Start with [README](README.md), [architecture](docs/architecture.md),
[pitfalls](docs/pitfalls.md), and [SDK cancellation constraints](docs/sdk-cancellation.md).
The [historical index](docs/history.md) records the retired lab and unresolved
findings; retirement does **not** mean failures have been fixed.

## Safety and test boundaries

- **Never** expose the unauthenticated gateway through a public proxy.
  Workspaces must be explicitly trusted; production inherits OpenCode configuration,
  provider access, tools, plugins and MCP. ACP permission rejection is not a sandbox.
- Use the pinned Linux/Bun 1.3.9/OpenCode 2.0.28 runtime. For MCP interop use the
  verified a2abridge 4.0.2 binary and its endpoint guard with exact peer/tool
  allowlists. No global service/configuration edits.
- Do not publish prompts, credentials, private reasoning, raw provider diagnostics
  or private network reports in logs, issues or pull requests.
- Run `make check` and relevant focused tests. CI also executes
  `make package-smoke` and verified, provider-free `make interop-test`.
  Never silently substitute these for live-model evidence.
- `make demo`, `make e2e`, `bun scripts/acp-smoke.ts` and the
  `tests/live-*.ts` probes require explicit live execution and provider access.
  These are **not** part of ordinary CI.
- The SDK 1.3 cancellation persistence adapter must remain until a pinned,
  published upstream SDK version passes its reproducer and transport regressions.
  Do not replace accurate terminal task states with optimistic cancellation.
- Do not accidentally reintroduce compiled test duplicates in `dist/` to Bun's
  test discovery; keep `bun test ./tests` scoped.

## Optional guarded MCP workflows

For model-issued delegation, the reviewed route is:
**OpenCode coordinator → guarded MCP endpoint → a2abridge → A2A gateway → ACP worker**.
Do not substitute native subagents, direct ACP calls or the A2A CLI when the request
specifically requires this route. The gateway itself is an A2A server, not an MCP
server.

Use [one-worker setup](docs/manual-one-worker.md) for a continuity smoke and the
[full two-worker bootstrap](docs/manual-two-worker-pipeline.md) with
[passive supervision](docs/passive-mcp-supervision.md) for the separately requested
pipeline smoke. For other approved topology investigations, consult the specific
issue and [portable skill](.opencode/skills/multi-a2a-agent/SKILL.md) rather than
inventing a new runner.

Trust exact worker cards/peer URLs; check the actual model-visible tool catalog,
not just network availability. Submit using `blocking:false`, follow up with the
returned `context_id` and **no** old `task_id`, verify stored task artifacts,
and retain actual pending/uncertain outcomes. Each guarded connection has a
40-attempt ceiling and the operator reserves eight calls for intervention.
Use bounded monotonic deadlines and spaced polls; do not resend uncertain tasks
or assume a zero process exit implies task completion.

All smoke infrastructure must be **owned and isolated**: use a fresh private HOME,
then derive XDG variables from that HOME in later shell commands. Verify the
effective OpenCode configuration before starting a private service. Never change
a separate, existing OpenCode service or its state/registration as a diagnostic
side effect. Clean up only owned processes, directory registrations, workspaces and
ports. Do not infer that an unfinished task was canceled.

## Common implementation traps

- Bun HTTP shutdown requires rejecting new work while the bridge closes and
  retaining the listener handle until incomplete HTTP clients are force-drained.
- `prepack` must remove old compiled JS before building; wildcard runtime
  packaging must not include obsolete `dist/src` files.
- A new context uses a new ACP session; continuation must reuse the actual ACP
  session binding and reject stale context IDs rather than restarting silently.
- Timeout and cancellation are different operations: do not label a lost or
  uncertain completion as `canceled`.
- Do not assume cold, standalone OpenCode has registered MCP tools. The manual
  workflow verifies the tools from the **same warmed owned server** before work.
- Treat test names, receipt environment variables and external acceptance
  contracts as consumers when editing fixtures or reducing tests.

For past incidents and detailed investigation evidence, follow the Git-provenance
links in [docs/history.md](docs/history.md) instead of expanding this file into a
chronological incident diary.

## Lessons Learned

- 2026-10-30: Pitfall: Updating negative fixtures can remove independent policy and precedence checks. Prevention: retain original adversarial cases and add overlapping-invalid-input tests; verify each policy mutation makes a targeted assertion fail.
- 2026-10-30: Pitfall: Disposable OpenCode homes can collide on managed-service ports, and a scrubbed `PATH` can hide the pinned executable. Prevention: bind-check and set private service ports, retain pinned binary paths, and run effective-config probes from the disposable project cwd.
