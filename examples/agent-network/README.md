# Local OpenCode agent network experiment

A fixed, reproducible acceptance experiment, not a general agent orchestration platform.
It uses real model calls and can incur provider charges. It does not install services,
modify global OpenCode configuration, or leave a network running after completion.

## Topology

```text
OpenCode coordinator (private ACP session; native subagents denied)
  -> MCP stdio endpoint guard / sanitized receipt logger
  -> pinned a2abridge 4.0.2
  -> A2A 1.0 JSON-RPC on loopback
       -> planner gateway -> OpenCode ACP worker
       -> reviewer gateway -> OpenCode ACP worker
```

The directory is an owned, temporary loopback service. The harness registers each
gateway's base URL and refreshes its heartbeat. The coordinator discovers those
workers using the bridge's real `a2a_list_agents` tool.

`network.json` defines the roles, synthetic knowledge, model and executable pin.
`profiles.ts` generates private role-specific OpenCode configurations outside the
checkout and verifies their configuration sources. Workers have no tools. The
coordinator permits only six named MCP tools, with Code Mode disabled; it does not
use the A2A skill, shell delegation, or native OpenCode subagents.

The coordinator explicitly admits one private, locally built readiness-observer
plugin. It waits for the actual tool registry and records the permission-filtered
tool names used by model requests. It adds no tools and reads no prompt content.
Worker plugins remain empty; ordinary global/project plugins are excluded.

## Prerequisites

Source stays under `examples/agent-network/`, deterministic checks under
`tests/agent-network/`, and the durable report under `docs/`. Downloaded binaries,
build output, private profiles and generated receipts are not source artifacts;
the repository-local disposable outputs use the ignored `.test-results/` tree.

- Linux x86_64, Bun 1.3.9, exact `opencode v2.0.28` and locked project dependencies.
- `OPENAI_API_KEY` supplied securely in the launch environment; never put it in a file here.
- The experiment uses `openai/gpt-6-luna`, as defined in `network.json`.
- A reviewed a2abridge **4.0.2 Linux amd64** binary. Other builds intentionally fail the binary pin.
- Internet access for the download and real provider requests.

From the repository root, download only the release artifact, not its auto-installer:

```sh
mkdir -p .test-results/agent-network-tools
curl --fail --location --max-time 60 \
  --output .test-results/agent-network-tools/bridge.tar.gz \
  https://github.com/vbcherepanov/a2abridge/releases/download/v4.0.2/a2abridge_4.0.2_linux_amd64.tar.gz

printf '%s  %s\n' \
  b74f01378c880486a41acd5780364e238d59a1a1aec418c322d1c5bd7f40772a \
  .test-results/agent-network-tools/bridge.tar.gz | sha256sum --check

tar -xzf .test-results/agent-network-tools/bridge.tar.gz \
  -C .test-results/agent-network-tools a2abridge

make install
A2ABRIDGE_BIN="$PWD/.test-results/agent-network-tools/a2abridge" make network-demo
```

The extracted binary's SHA256 must be
`bdfa1f6894f5547dfef539140139e162402ca6ab33bb7602d9335d125d414db2`.
Release checksums verify the retained artifact, not an independent security audit
or a provenance guarantee. No installer, IDE autodetection, hooks, service setup,
or user-global MCP registration is used.

## What runs

1. Verify free loopback ports and independent HOME/XDG/configuration roots.
2. Start two real gateway workers, the directory, and a provider-key-free MCP bridge.
3. Use the official MCP client SDK for discovery, message, exact-streaming and
   returned-context continuity checks. Exercise unknown task, disallowed endpoint,
   and unlisted-tool errors.
4. Start a real long model task; verify busy rejection on that gateway, a successful
   request on the other gateway, and actual task cancellation through MCP.
5. Start the real OpenCode coordinator. It proposes through the planner, passes the
   proposal to the reviewer, and sends the review back to the planner:
   - choose the highest-value feasible work package under separate estimates/constraints;
   - review a truthiness-based limit check against four adversarial cases.
6. Validate exact decisions, role order, received random peer proofs, and matching
   MCP/worker input hashes. Probe that native writing does not create a sentinel.
7. Close owned resources and verify profile processes stopped before deleting them.

These are synthetic reasoning and contract-review tasks, not modifications to
production source or execution of arbitrary agent-generated code.

## Evidence and boundaries

The ignored `.test-results/agent-network/` directory contains:

- `summary.json`: decisions, test outcomes, timings, cleanup and tool counts.
- `mcp-receipts.json`: connection/request IDs, tool names, peer URLs, hashes and outcomes.
- `worker-receipts.json`: role/session IDs, input hashes, timing and received-peer-proof flags.
- `runtime-readiness.json`: actual registration and permission-filtered tool-snapshot metadata.

Raw prompts, MCP result bodies, provider diagnostics, and reasoning are not copied
to these records. Private OpenCode databases and bridge logs are deleted with the
temporary profiles. Do not treat metadata files as anonymous: they retain local
URLs, timestamps, and opaque session identifiers. A later run replaces this evidence.

The endpoint guard constrains `peer_url` tool arguments and filters the catalog.
The directory/cards are trusted local test resources. This is **not** an OS/network
sandbox or authorization against another local user. Unknown Agent Card targets,
redirects, hostile registries, cross-host authentication and production multi-tenancy
are outside this experiment. Keep the gateway loopback-only; do not expose it through
a public proxy.

Each bridge connection has a 40-call safety budget. This is a fixed two-worker
experiment, not a claim that arbitrary larger workflows will fit that budget.

The upstream bridge's stream tool cannot pass a context ID; continuation uses
`a2a_send_message`. Its unary calls have a 60-second budget, so short blocking calls
are appropriate here; longer work uses nonblocking send, bounded polling and explicit
cancellation. MCP success is not task completion: the checks inspect A2A task states.

See [recorded findings](/docs/agent-network-findings.md).
