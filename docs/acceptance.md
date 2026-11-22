# Acceptance evidence and limits

Provider-free tests establish protocol and lifecycle behavior under controlled ACP
peers; they are not evidence of live-model quality. Live tests are explicit,
billable operations. All results below apply only to the stated configurations and
dates, not every later runtime, provider, architecture or model.

## macOS live demo

On **2026-11-15**, isolated `make demo` passed on macOS 13.7.8 x86_64 with Bun
1.4.4, OpenCode 2.3.0, official A2A CLI 0.4.0 and `openai/gpt-6-luna`.
Effective configuration verification passed; the compiled gateway started, the
CLI discovered its Agent Card, a streamed task completed, and a follow-up
completed in the same context with a new task. Workspace cleanup reported that
its processes stopped. Provider-free `make runtime-smoke` also verified gateway
port reclamation.

This is one two-turn demo, not the full live acceptance matrix or evidence for
other macOS architectures, versions, providers, cancellation, or optional guarded
MCP/team workflows. The current CLI private runtime and live demo are Linux-only;
macOS library use remains experimental.

## Capability profiles (issue #88)

On **2026-11-22**, Linux x64, Bun 1.4.4, OpenCode 2.3.2, official A2A CLI 0.3.1 and
`openai/gpt-6-luna`. Results apply to this configuration only; `full-access` and `supervised`
were **not** live-tested (`full-access` awaits a separate disposable-host decision; `supervised`
is not shipped).

**Provider-free, real OpenCode (`make policy-smoke`, scripted local model):** the executable ran
scripted tool calls and the results were observed as tool outcomes and filesystem sentinels.
`read-only`: read/grep/glob work; edit, write, shell, webfetch, websearch and subagent are
unavailable or "Blocked by configuration policy"; a project `opencode.json` that allows everything
(policies, permissions, agents, an MCP server that would `touch` a sentinel) changes none of it,
and the MCP sentinel is never created. `edit`: edit/write work; edits of `opencode.json` and
`.opencode/` and a `../` write are denied; shell and webfetch are denied. `full-access`: shell,
write and `execute` complete without any prompt. Evidence and findings behind the design:

- Global `policies` outrank project `policies`; agent `permissions` order is defaults, global,
  project, global agent, project agent, so a project agent rule beats the gateway's.
- With a hostile project agent allowing `*`, Code Mode (`execute`) is reachable even under
  `tool.use * deny` (an explicit `execute:*` deny did not remove it) and exposes
  `opencode.worktree_create`, which created a git worktree in the workspace repository. Nested
  `fetch` and shell remain blocked. Startup preflight now evaluates every effective agent and
  rejects this before readiness (`make policy-smoke`, `tests/runtime-policy.test.ts`).
- A policy statement OpenCode drops (invalid action) disappears from `debug config`; preflight
  compares the reported private document with the written one.
- A workspace symlink to an outside file is readable by `read` (lexical path check): a known gap.

**`supervised` release gate: not met, not shipped.** Verified with real OpenCode: agent-level
`shell: ask` with a policy allow makes the first command request permission, and a non-interactive
rejection leaves no side effect. But a project agent `shell: allow`, appended after the global
agent rules, runs the same command with no prompt (the probe `supervised-withheld`). Preflight can
refuse such a configuration at launch, yet configuration an approved command or edit rewrites is only
re-evaluated at the next launch, and the ACP one-time approve/reject/re-prompt flow was not
demonstrated against real OpenCode. Releasing it needs trusted approval routing or OS sandboxing and
those real-runtime tests; tracked as a follow-up in the PR.

**Live (authorized, billable), read-only and edit:** see the sanitized receipt in the pull
request. Both profiles completed streamed tasks and a same-context follow-up; denied actions had no
filesystem effect and the SQLite tool records showed the denials; SIGINT removed the listener, the
OpenCode child and the private runtime.

## Runtime upgrade verification (issues #60 and #61)

On **2026-11-10**, the Linux x64 live acceptance run used standalone Bun 1.4.4,
OpenCode 2.2.7 (embedded Bun 1.4.4), official A2A CLI 0.3.1 and
`openai/gpt-6-luna`. Production admits stable OpenCode 2.2.7 or newer, but this
run does not establish full live compatibility for newer versions. The complete
[dated evidence and source identities](https://github.com/tbrandenburg/opencode-a2a-lite/blob/519075932bb8398b76407127bac593af2e29687b/docs/acceptance.md#runtime-upgrade-verification-issues-60-and-61)
remain in Git; see also [Bun security](bun-runtime-security.md) and
[OpenCode compatibility](opencode-runtime-upgrade.md).

- `make e2e` passed **14/14 live scenarios**, including confirmed cancellation,
  streaming/storage, context continuity and isolation, busy rejection, stale
  contexts, actual child death, restart, invalid input/credentials and shutdown.
- Write denial left the target absent and recorded zero tool calls. A **live ACP
  permission callback was not established**: deny configuration may remove tools
  before invocation. Callback rejection is controlled-ACP evidence only.
- Provider-free checks included installed-package lifecycle, the verified
  a2abridge 4.0.2 interop gate, real-executable ACP sessions and cleanup, and
  separate standalone/embedded runtime TLS probes.
- Earlier intermittent startup and interop failures were not erased by a later
  passing run; see issues [#63](https://github.com/tbrandenburg/opencode-a2a-lite/issues/63)
  and [#64](https://github.com/tbrandenburg/opencode-a2a-lite/issues/64).
  Optional multi-worker reliability, broad model compatibility and full TCK
  certification were not established.

### Reproduction boundaries

Run `make install`, `make check`, and `make package-smoke` for provider-free
checks. On Linux, `make runtime-smoke` starts the real OpenCode executable without a model
prompt. On Linux, `A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make
interop-test` verifies the separate guarded interop path. `make demo` and Linux
`make e2e` require explicit live authorization, reviewed isolation, provider
access and the official A2A CLI; never silently substitute provider-free evidence.

Issue #87's private CLI runtime requires a fresh authorized live acceptance receipt;
the historical runs above predate it. `make runtime-smoke` checks standalone runtime
paths and config sources without prompting a provider. It does not establish live
provider authentication, continuity, or cleanup of every possible detached descendant.
The selected executable is operator-trusted, not authenticated by its version.
Probes deliberately omit passed credentials while retaining the ACP base environment
and resolved executable; this is stricter than the original same-snapshot requirement.

### Private runtime containment investigation

Linux cleanup combines process-group shutdown with a bounded `/proc` scan for an
inherited per-launch marker and readable cwd/fd references inside the runtime.
This is best-effort evidence, not proof of descendant termination or containment;
the residual escape risk is an accepted limit for trusted workers.

On the investigated Linux host, `/proc/self/cgroup` identified a root-owned session
cgroup whose `cgroup.procs` was not writable by the invoking user. An unprivileged
`unshare --user --map-root-user --pid --fork /bin/true` failed with `Operation not
permitted` while writing `uid_map`. A user systemd manager was available, and
`systemd-run --user --scope --quiet --collect /bin/true` succeeded; its transient
scope was user-owned. This is not a portable ownership proof: it adds a user-systemd
dependency and requires a supervised unit lifecycle, permissions and escape analysis,
and evidence for failure and abnormal termination paths. The experiment did not
establish those properties. A subreaper can adopt orphaned descendants, but it is
not inherited by children and does not by itself contain or stop a live process tree.

An exec with a scrubbed environment can remove the marker, and a descendant with
no currently visible runtime reference can reopen it after the scan. Linux `/proc`
environment data may not reflect later environment changes. Entries returning
`EACCES`, `EPERM`, `ENOENT`, or `ESRCH` are ignored; these can include owned
descendants, such as non-dumpable processes. Unexpected scan errors retain the root.
Snapshots race with process changes and cannot detect every listener or future access.
The provider-free detached-child tests cover marker inheritance and tag scrubbing,
but do not establish complete ownership.

Bun 1.4.4 exposes `Bun.spawn` with a cgroup option that places a child before
execution, but the existing implementation uses Node-compatible `child_process`
streams and the package also supports Node. A delegated cgroup, compatible spawn
implementation, containment permissions, and cleanup proof are not established.
Do not infer complete descendant ownership or private-root cleanup from
`make runtime-smoke`'s process-cleanup summary.

The [isolation verifier](../scripts/acp-smoke-config.ts) creates private HOME,
XDG and workspace state, verifies configuration, disables tools/plugins and
excludes inherited overrides. It refuses managed `/etc/opencode`; private service
and HTTP listeners use loopback and ephemeral ports. This is **configuration
isolation, not an OS sandbox**. Do not publish raw prompts, credentials, provider
diagnostics or private reasoning. Cleanup must verify owned resources; stopping a
client is not proof of remote cancellation.

## Official A2A TCK

A historical, separately scoped applicable A2A 1.0 JSON-RPC TCK run passed
**17 tests, with one inapplicable test deselected**. A broader initial MUST run
reported **63 passed, 5 failed and 166 skipped**. The failures expected canned
scenario output or rich/direct-message responses not implemented by this text-only
gateway; skips are not passes. **Full TCK conformance is not claimed.**

The external TCK must be a clean checkout of revision
`d4d6fae7887f88ef607fb461c13e3b0e1802f19b` with its frozen `.venv`; run
`TCK_DIR=/absolute/path/to/pinned/a2a-tck make e2e-tck` on Linux with explicit
authorization and provider access for the isolated gateway. Missing or wrong
prerequisites fail rather than skip. The [original methodology, exact
selection and limitations](https://github.com/tbrandenburg/opencode-a2a-lite/blob/519075932bb8398b76407127bac593af2e29687b/docs/acceptance.md#official-tck-external-dependency-only)
remain in Git.

## Other historical results

The [historical research index](history.md) retains the retired managed lab's
failures, bounded observations and original reports. Retirement does not mean
those failures were fixed. The [SDK cancellation removal gate](sdk-cancellation.md)
remains separate from all live-model results. The archived acceptance document
also retains older source hashes, diagnostics, test matrices and comparison data;
its counts and runtime pins are not the current release contract.
