# Guarded MCP interoperability

This directory retains a small endpoint guard, typed task helper and provider-free
interop transport/lifecycle helpers. It is not a managed agent team or an
orchestration platform. The managed network/topology runners, generated model
profiles, readiness plugin, workloads and scorers have been retired.

Historical source is retained at [pre-retirement revision a70b639](https://github.com/tbrandenburg/opencode-a2a-lite/tree/a70b639/examples/agent-network).
[Network findings](https://github.com/tbrandenburg/opencode-a2a-lite/blob/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs/agent-network-findings.md),
[topology findings](https://github.com/tbrandenburg/opencode-a2a-lite/blob/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs/topology-investigation-findings.md) and
[authorized live failures](https://github.com/tbrandenburg/opencode-a2a-lite/blob/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs/authorized-live-acceptance.md) remain historical
evidence, not proof of resolved defects. Neither `network-demo` nor
`topology-investigation` is a current command. The single-gateway `make demo` and
production `make e2e` are manual, provider-billed operations and do not run in ordinary CI.

## Prerequisites

- Linux x86_64, Bun **1.3.9**, locked dependencies; manual model use also requires
  reviewed OpenCode **2.0.28**, provider access and explicitly trusted workspaces.
- Reviewed **a2abridge 4.0.2 Linux amd64** binary. Download the release artifact,
  not an installer; do not install services or modify global configuration:

```sh
mkdir -p .test-results/agent-network-tools
curl --fail --location --connect-timeout 10 --max-time 60 \
  --output .test-results/agent-network-tools/bridge.tar.gz \
  https://github.com/vbcherepanov/a2abridge/releases/download/v4.0.2/a2abridge_4.0.2_linux_amd64.tar.gz
printf '%s  %s\n' \
  b74f01378c880486a41acd5780364e238d59a1a1aec418c322d1c5bd7f40772a \
  .test-results/agent-network-tools/bridge.tar.gz | sha256sum --check
tar -xzf .test-results/agent-network-tools/bridge.tar.gz -C .test-results/agent-network-tools a2abridge
printf '%s  %s\n' \
  bdfa1f6894f5547dfef539140139e162402ca6ab33bb7602d9335d125d414db2 \
  .test-results/agent-network-tools/a2abridge | sha256sum --check
make install
A2ABRIDGE_BIN="$PWD/.test-results/agent-network-tools/a2abridge" make interop-test
```

Checksums verify the retained artifact, not an independent security audit. Missing
or mismatched binaries fail, never skip. The gate uses real MCP, the pinned bridge,
real gateways and controlled ACP subprocesses—not OpenCode model calls. It checks
the six-tool catalog, discovery, actual fresh-context SSE, stored text, continuation,
isolation, busy, cancellation races, uncertainty, endpoint/tool denials, receipt
privacy/pairing and the 40-attempt cap with eight reserved calls. Two independently
planned connections each stay within 32 attempts; this is not budget evasion.
Owned child and port cleanup is verified. See the [caller guide](/interop/client-guide.md).

## Retained support inventory

The active `examples/agent-network/` tree has been removed. Six optional TypeScript
modules (886 lines) remain under `interop/`, outside production and test source;
each is retained for a named manual, test, CI, or host-guide consumer:

| Module                    | Lines | Concrete retained consumer/contract                                                                                                                                                    |
| ------------------------- | ----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interop/bridge-proxy.ts` |   303 | Manual MCP fragment in the skill; `profiles.ts` launch; `tests/agent-network/proxy.test.ts`: pinned bridge, tool/URL restrictions, secret stripping, private receipts, 40-attempt cap. |
| `interop/guard-task.ts`   |   122 | `tests/agent-network/interop.ts` and `proxy.test.ts`: paired receipt/task metadata and reflected-ID privacy without rewriting forwarded responses.                                     |
| `interop/lifecycle.ts`    |    60 | `transport.ts`, interop gate, and `lifecycle.test.ts`: interruption and independently drained owned-resource cleanup.                                                                  |
| `interop/profiles.ts`     |    21 | `transport.ts`, `task-client.ts`, and interop gate: small types, object validation, and guard argv, not generated model profiles.                                                      |
| `interop/task-client.ts`  |   163 | Optional typed host guide, interop gate, and `task-client.test.ts`: actual peer/context/task handles, bounded waiting, pending/uncertain retention; not a CLI smoke runner.            |
| `interop/transport.ts`    |   217 | Interop gate, `task-client.test.ts`, and `lifecycle.test.ts`: official MCP transport, call deadlines/accounting, directory/process/port lifecycle, and task text decoding.             |

The [CI bridge gate](/.github/workflows/ci.yml) invokes `interop.ts` with a
checksummed real bridge and controlled ACP, independently of model installation.
These retained modules are not duplicate CLI/session engines; deterministic guard,
cancellation, artifact append, context, admission and cleanup coverage remains
separate from this optional live gate. No retired topology runner or schedule was
moved under `interop/` or `tests/`.

References: [V2 configuration](https://opencode.ai/v2/docs/config),
[CLI automation](https://opencode.ai/v2/docs/cli#automation),
[CLI commands](https://opencode.ai/v2/docs/cli/commands),
[private/shared service behavior](https://opencode.ai/v2/docs/troubleshooting),
[local MCP](https://opencode.ai/v2/docs/mcp-servers#local),
[permissions](https://opencode.ai/v2/docs/permissions),
[pinned directory source](https://github.com/vbcherepanov/a2abridge/blob/v4.0.2/internal/directory/registry.go).
