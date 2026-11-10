# OpenCode runtime review for issue #61

## Decision and evidence boundary

Review target: **exactly OpenCode 2.2.7**, paired with standalone **Bun 1.4.4**.
The production admission check remains literal, not a minimum-version range.
OpenCode 2.1.3 is the security floor, not the selected compatibility target.

The [release list](https://github.com/anomalyco/opencode/releases) contained V2
2.2.7 and 2.2.6 when checked on 2026-11-10; `/releases/latest` selects V1 1.19.5
and must not drive this upgrade. Select 2.2.7 because it incorporates 2.2.6's
ACP unused-session cleanup and later Console-policy/MCP refresh fixes, rather
than deliberately starting from the historical mitigation floor. Its added
ACP steering extension is not used by this gateway. Its changed cold plugin
catalog behavior requires the live configuration check described below.

This document records provider-free executable evidence, **not completed live
acceptance**. The assigned live-provider run belongs to the coordinating session.
SDK 1.3.0 and the cancellation persistence adapter are unchanged; see
[the separate removal gate](/docs/sdk-cancellation.md).

## Release and actual embedded runtime

[Published immutable release v2.2.7](https://github.com/anomalyco/opencode/releases/tag/v2.2.7):

- Release ID `440226160`, published `2026-11-10T10:37:15Z`, neither draft nor prerelease.
- Tag commit `fedc6f208aa2bd54c1019227214568083f6380ad`.
- Linux x64 asset ID `731038589`, `opencode-linux-x64.tar.gz`.
- API asset digest and downloaded archive SHA-256 both
  `89a6cee227b54bc011179c528a5e63176032462b1a5e21723b616801cddc2ca7`.
- Extracted executable SHA-256
  `589253d36810f21217edd51545cd435b328cdc3cf4f451fbe0cce6f88afcf5e1`.
- Actual executable: `opencode --version` prints `opencode v2.2.7`.
- Actual executable: `BUN_BE_BUN=1 opencode --version` prints `1.4.4`;
  `BUN_BE_BUN=1 opencode -e 'console.log(Bun.revision)'` prints
  `38afee6c84fcf48c0edb2466aa4b27d287a59c30`.

This verifies the shipped executable, not just
[the source packageManager pin](https://github.com/anomalyco/opencode/blob/v2.2.7/package.json).
The local old executable's embedded runtime reported Bun 1.4.2 through the same
Bun-mode probe. Updating standalone Bun cannot repair that executable.

[Bun GHSA-26q8-h657-pf84](https://github.com/oven-sh/bun/security/advisories/GHSA-26q8-h657-pf84)
specifies affected versions below 1.4.4 and key-based rejection including
cross-signed paths. The actual candidate executable's embedded `fetch` was run
without credentials, proxy variables, extra CA variables or TLS overrides:

| HTTPS control                              | Result         |
| ------------------------------------------ | -------------- |
| `example.com`                              | HTTP 200       |
| `github.com`                               | HTTP 200       |
| `dv-g3b-emudhra.we-have-a-problem.com`     | `CERT_REVOKED` |
| `dv-g3b-aaa-emudhra.we-have-a-problem.com` | `CERT_REVOKED` |

The two negative hosts are the incident-chain and AAA cross-signed controls
listed in [the disclosure references](https://openwall.com/lists/oss-security/2026/10/20/1).
A separate fetch of the disclosure landing page was reset; it is not counted as
certificate-rejection evidence. These are external observations, not CI tests,
and exercise embedded Bun `fetch`, not a model/provider request.

Reproduce the controls using the digest-verified executable:

```sh
env -i HOME="$PRIVATE_HOME" PATH=/usr/bin:/bin BUN_BE_BUN=1 "$OPENCODE_BIN" -e '
for (const host of ["example.com", "github.com",
  "dv-g3b-emudhra.we-have-a-problem.com",
  "dv-g3b-aaa-emudhra.we-have-a-problem.com"]) {
  try {
    const response = await fetch("https://" + host + "/", {
      signal: AbortSignal.timeout(15000), redirect: "manual"
    });
    console.log(JSON.stringify({host, status: response.status}));
    await response.body?.cancel();
  } catch (error) {
    console.log(JSON.stringify({host, code: error.code, name: error.name}));
  }
}'
```

Timeout, refusal, DNS failure or a generic handshake failure would be inconclusive.
Do not set `BUN_BE_BUN` when launching ACP or the gateway.

## ACP 2.0.28 → 2.2.7 contract review

Compared the exact published tag versions of `packages/cli/src/acp/` and the
private-server/configuration implementations, not a generic HTTP API migration.
Source links below point at 2.2.7; substitute `v2.0.28` for the reviewed baseline.

| Contract                               | Finding and adapter consequence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Handshake                              | [service.ts:119–162](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/cli/src/acp/service.ts#L119-L162) still returns protocol 1 and accepts empty client capabilities. Model/image/MCP/load capabilities are not requests to use them. New steering metadata is optional. No protocol widening.                                                                                                                                                                                                                                                                                                                                                 |
| cwd and sessions                       | `newSession` parses absolute cwd, allocates a session, and attaches it. Resume checks the saved directory. [sessions.ts:124–175](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/cli/src/acp/sessions.ts#L124-L175) retains session bindings; resume returns config options, not another session ID. Gateway continuation continues to use its original binding, never implicit restart.                                                                                                                                                                                                                                                        |
| Root text and child metadata           | [translate.ts](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/cli/src/acp/translate.ts), [child.ts](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/cli/src/acp/child.ts), and [capabilities.ts](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/cli/src/acp/capabilities.ts) are byte-identical between reviewed tags. Root `agent_message_chunk` text remains the accepted output. Child metadata at envelope/update/content boundaries is rejected regardless of its truthiness; reasoning/tool updates are ignored. Added realistic child-object and tool-call fixture controls preserve exact root text assertions. |
| Permission requests                    | [permission.ts](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/cli/src/acp/permission.ts) is byte-identical. Reject-once/always selection and cancelled fallback remain valid; no permissions are advertised or auto-approved. Requests outside the active turn still cancel.                                                                                                                                                                                                                                                                                                                                                                  |
| Stop reasons/errors                    | `translate.ts` and [error.ts](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/cli/src/acp/error.ts) are byte-identical. Interrupted/aborted maps to cancelled; length/content-filter retain their non-success reasons. Other errors remain request failures. Only end_turn is success locally.                                                                                                                                                                                                                                                                                                                                                  |
| Cancellation                           | [turn.ts:273–337](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/cli/src/acp/turn.ts#L273-L337) retains interrupt, event drain, abandoned-tool handling, child permission follow-up and prompt-result settlement. Candidate diff adds steering, not a replacement cancellation path. Existing bounded local cancellation and terminal-race policy remain necessary.                                                                                                                                                                                                                                                                            |
| Session lifecycle additions            | Candidate tracks unprompted sessions and removes one on explicit session/close when still empty. The gateway does not call session/close between turns. Real acceptance verifies resume and explicit unused-session removal.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Private server lease                   | [ACP handler](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/cli/src/commands/handlers/acp.ts) still calls Standalone.start and exits on transport EOF or private-server death. [standalone.ts](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/cli/src/services/standalone.ts) is byte-identical: private random password, --stdio --port 0, stdin ownership lease. Keep EOF grace before owned-group escalation.                                                                                                                                                                                                                  |
| Config discovery                       | [discovery.ts](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/core/src/config/discovery.ts) adds concurrent discovery/absent-entry optimization and optional Claude exclusion. Ancestor/global/managed discovery remains relevant. [global-roots.ts](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/util/src/global-roots.ts) is byte-identical. Private HOME/XDG and effective source enumeration remain mandatory.                                                                                                                                                                                                               |
| Effective config and service disabling | [debug/config.ts](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/cli/src/commands/handlers/debug/config.ts) remains byte-identical, returning ordered source entries. [service-config.ts](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/cli/src/services/service-config.ts#L250-L283) still stops a discovered service before setting disabled=true. The helper now seeds a fresh private service.json with a bind-checked loopback port before invoking this command, then verifies disabled=true. It never operates on shared HOME/state.                                                                                       |

### Public 2.1 changes: relevance classification

The [2.1.0 breaking-change entry](https://github.com/anomalyco/opencode/blob/v2.2.7/CHANGELOG.md#v210--2026-10-20)
enumerates the following distinct migrations:

| Public migration                                                       | Relevance to this gateway                                                                                                                                                         |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text/reasoning/event replay fields and ProviderState renamed to native | No direct consumer: gateway reads ACP text and stopReason, not OpenCode HTTP events or replay fields. Upstream ACP translation is unchanged.                                      |
| Tool providerState/providerResultState merged into tool.native         | No direct consumer: tool output is excluded. Permission options, not provider replay state, determine denial.                                                                     |
| Key credential configuration → metadata                                | No public credential writes in the gateway; isolated live helper supplies its explicitly selected provider environment key. Existing credential migration is OpenCode-owned.      |
| Summary recent → metadata.keepID                                       | No direct consumer: no gateway history/compaction parser. Long-history behavior still needs upstream/provider validation, not inferred from short-turn acceptance.                |
| providerContext → native.messages and changed replay matching          | No direct field consumer, but semantically relevant to OpenCode-managed continuation after compaction/model changes. No such broad compatibility claim follows from this upgrade. |
| Removal of session.compacted                                           | No direct subscription: gateway subscribes only to ACP session/update.                                                                                                            |
| Plugin compaction hook providerState → native                          | No bundled gateway plugin. Operator-installed plugins remain an indirect compatibility risk because production inherits configuration; review their migration independently.      |

2.2.7 additionally changes cold agent/integration catalog waiting; it is not
irrelevant just because the external gateway transport is ACP. During the
provider-free probe, initial session/new options showed Build/free-model defaults,
while a subsequent resume reflected the configured smoke agent. Options can
change asynchronously. Before live prompts, verify the expected agent, model,
denied permissions and MCP/plugin discovery in that **same** private server;
the helper's separate debug-config probe establishes source isolation, not warmed
session catalog readiness. No model was called during this observation.

The coordinator's denied-tool evidence query also needs a storage migration:
[projector.ts:662–688](https://github.com/anomalyco/opencode/blob/v2.2.7/packages/core/src/session/projector.ts#L662-L688)
stores assistant envelopes with empty inline content; content is in `session_part`.
Querying only `session_message.data.content` cannot prove absence of tool calls.
This is an acceptance-helper concern, not a new production database adapter.

## Validation and remaining acceptance

From a frozen checkout, with the verified Bun binary first on PATH:

```sh
bun install --frozen-lockfile
ACP_SMOKE_OPENCODE="$OPENCODE_BIN" bun tests/acp-runtime-acceptance.ts
bun test ./tests/acp-client.test.ts ./tests/context-http.test.ts \
  ./tests/cancellation.test.ts ./tests/cancellation-transport.test.ts \
  ./tests/server.test.ts ./tests/request-handler-cancellation.test.ts
make check
make package-smoke
```

Recorded on 2026-11-10:

- Frozen install with Bun 1.4.4: checked 132 installs across 173 packages,
  no lockfile changes. An initial install used local Bun 1.3.9 before the private
  patched runtime was obtained; subsequent validation uses 1.4.4.
- Real candidate provider-free acceptance: configVerified, productionBridge,
  separateSessions, staleRejected, protocolV1, absoluteCwd, resumeBinding,
  wrongCwdRejected, idleCancel, unusedSessionRemoved, stdinEofExit,
  leasedServerStopped, listenerReclaimed, processesStopped and cleanup were true.
  Owned server PID disappearance and reclaiming its actual listening port were
  independently checked after EOF.
- Format, lint and strict types passed. Lint retained seven existing complexity/
  file-size warnings in production modules. Separate `bun run build` passed.
- First six-file focused run: 18 pass / 11 fail, HTTP teardown timeouts.
  A local old-Bun controlled-peer comparison also had startup/test timeouts
  (23 pass / 6 fail / 2 unhandled errors), so load-sensitive deadlines are not
  evidence of an OpenCode executable regression. They were not enlarged.
- `make check`: 51 pass / 17 fail, 68 tests, 449 assertions; startup and HTTP
  teardown timeouts prevented completion. Build was run separately afterward.
- `make package-smoke`: timed out at 180 seconds without a success summary.
  Three remaining owned installed-package wrapper/gateway PIDs were terminated
  by exact verified PID, then zero processes remained under that private cwd.
- Bun 1.4.4's `node:http` closeAllConnections leaves the listener open. A direct
  executable reproduction printed afterCloseAllConnections=true (listening),
  then explicitClose=true. The existing gateway Bun shutdown path waits for
  close without explicitly closing the listener. This cross-runtime blocker is
  handed to the coordinator/Bun integration owner, outside this change's scope.

**Acceptance remains incomplete:** coordinator integration must repair/revalidate
HTTP shutdown, rerun sequential deterministic and package gates and the verified
provider-free interop gate, and perform the separately authorized real-provider
continuity/permission/cancellation/death/restart/shutdown matrix. No live-provider
call or general model/MCP readiness claim is made here.
