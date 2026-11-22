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
MCP/team workflows. macOS gateway use remains experimental.

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
checks. `make runtime-smoke` starts the real OpenCode executable without a model
prompt. On Linux, `A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make
interop-test` verifies the separate guarded interop path. `make demo` and Linux
`make e2e` require explicit live authorization, reviewed isolation, provider
access and the official A2A CLI; never silently substitute provider-free evidence.

Issue #87's private CLI runtime requires a fresh authorized live acceptance receipt;
the historical runs above predate it. `make runtime-smoke` checks standalone runtime
paths and config sources without prompting a provider. It does not establish live
provider authentication, continuity, or cleanup of every possible detached descendant.

### Private runtime containment investigation

Issue #87 is not mergeable with the current fail-closed cleanup: after a preflight
process starts, normal shutdown retains the private runtime and reports cleanup as
unconfirmed. `make package-smoke` fails its runtime-removal assertion. A process-group
probe cannot detect a child that starts a new session, and the smoke cwd scan cannot
detect a process that changes directory while retaining an open runtime file.

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

The provider-free `tests/runtime-probes.test.ts` detached-child regression demonstrates
why scanning `/proc` is insufficient: a child changes its cwd to `/`, has no open
runtime file or runtime path in its initial environment, and then reopens and writes
the retained runtime on a later request. Process inspection can also fail or race with
changes. These checks are evidence of references at an instant, not proof of owned
descendant termination or that the runtime cannot be reopened.

A proposed per-launch environment marker plus `/proc` cwd/fd scan also requires an
explicit policy for unreadable processes. On the investigated shared Linux host, a
read-only inspection found four live same-UID processes with `EACCES` reading
`environ` or `cwd`, and three with `EACCES` reading `fd`. An experimental scanner
that treated these entries as inconclusive reported a freshly created empty runtime
as in use, although no child had received its marker. Thus the requested rule to
fail closed on unreadable same-UID entries conflicts with successful cleanup on that
host; no process was signaled or modified. The experimental scanner was not adopted.
Using a marker would also not prove containment: an exec with a scrubbed environment
can remove the marker, after which the descendant may reopen the runtime.

Bun 1.4.4 exposes `Bun.spawn` with a cgroup option that places a child before
execution, but the existing implementation uses Node-compatible `child_process`
streams and the package also supports Node. A delegated cgroup, compatible spawn
implementation, containment permissions, and cleanup proof are not established.
Do not replace the fail-closed behavior with process or cwd snapshots. Do not infer
private-root cleanup from `make runtime-smoke`'s process-cleanup summary.

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
