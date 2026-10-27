# Local OpenCode agent network experiment

A fixed, reproducible acceptance experiment, not a general agent orchestration platform.
It uses real model calls and can incur provider charges. It does not install services,
modify global OpenCode configuration, or leave a network running after completion.

## Six-topology investigation

The separate [27-case investigation guide](/docs/topology-investigation.md) defines
six logical schedules, three matched variants, a coordinator-only baseline,
role-semantic checks and six provider-free controlled negative experiments.
It preserves independent transport, structural topology, role semantics,
correctness and operational verdicts. The physical worker transport remains a
coordinator-mediated guarded MCP star.

```sh
make topology-investigation ARGS='--list'
# Billable; same prerequisites and verified binary as below. No automatic retries.
A2ABRIDGE_BIN="$PWD/.test-results/agent-network-tools/a2abridge" \
  make topology-investigation ARGS='--live --faults --allow-cancel'
```

The negative fixtures issue explicit cancellation only with `--allow-cancel`;
the 21 live-model cases do not request remote cancellation. Results are private,
progressive files beneath a unique ignored `.test-results/topology-investigation/`
directory. A subset or fixture-only invocation remains an incomplete 27-case
investigation and exits nonzero; that is not a failed assertion in the fixture.
Per-case files retain allowlisted task/hash/timing provenance and hashed proof
markers after profile cleanup; summaries show independent dimension counts and
execution/persistence timestamps without duplicating detailed evidence.

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

## Manual two-worker recipe (separate from the managed demo)

[`peers.example.json`](/examples/agent-network/peers.example.json) is an example-only
inventory with exactly `peers: [{ name, url }]`. Names must be trimmed, nonempty
and unique; URLs must be unique canonical HTTP(S) loopback roots, including `/`.
Credentials, paths below the root, query/fragment delimiters (even bare `?`/`#`),
extra fields, scripts and discovery expressions are outside this contract.
The focused test checks this sample; **no runtime loads this file**. Neither the
gateway nor the managed harness reads it or discovers workers from it.

The fixed ports below illustrate that inventory. The managed `network-demo` instead
uses actual ephemeral readiness URLs. Its generated configuration and private
profiles are not reusable after it stops its endpoints. Never copy those expired
URLs into a persistent project configuration.

### 1. Review projects and check ports

Use the prerequisites and verified 4.0.2 binary above, including both SHA256 pins.
Install locked repository dependencies with `bun install --frozen-lockfile` and
build with `make build`. This manual recipe is billable when a model request runs.
It does not install a directory service, hooks, skills or global MCP configuration.

Choose three separate, clean, explicitly trusted project directories. Review their
tools/plugins/MCP and provider configuration before launch. OpenCode V2 merges
global and ancestor configuration up to the filesystem root; project-local files
alone do **not** isolate that configuration. Run `opencode debug config` from each
project and review the reported sources (not a merged-config readiness report).
Do not continue with unreviewed sources. The managed demo above, not this manual
recipe, supplies automated private HOME/XDG isolation and configuration assertions.

Use Bash for the shell fragments. In each terminal used below, set these values
to your own absolute paths. Do not commit local paths, private profiles, receipts
or credentials:

```sh
set -o pipefail
export REPO=/absolute/path/to/opencode-a2a-lite
export PLANNER=/absolute/path/to/trusted-planner-project
export REVIEWER=/absolute/path/to/trusted-reviewer-project
export COORDINATOR=/absolute/path/to/trusted-coordinator-project
export STATE=/absolute/path/to/private-disposable-network-state
export A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge
umask 077
mkdir -p "$STATE" "$STATE/directory-home"
chmod 700 "$STATE" "$STATE/directory-home"
```

Before starting anything, check the three fixed ports with a real loopback bind:

```sh
bun -e '
  import { createServer } from "node:net";
  for (const port of [41241, 41242, 7777]) {
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    console.log(`free loopback port: ${port}`);
  }
'
```

If occupied, stop here; do not kill another owner's process. Choose unused ports
and consistently update the inventory copy, launch commands, registrations and MCP
allowlist. Checking and releasing a port is not a reservation: startup must still
succeed, and cards must match the intended workers.

### 2. Start named workers and the directory

For clean worker projects, manually merge this complete worker configuration into
each project's `opencode.json` (preserve unrelated reviewed settings; do not
overwrite existing files blindly). It denies worker tools rather than relying on
the descriptive identity for authorization:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": { "providerID": "openai", "model": "gpt-6-luna" },
  "default_agent": "worker",
  "permissions": [{ "action": "*", "resource": "*", "effect": "deny" }],
  "agents": {
    "worker": {
      "mode": "primary",
      "description": "Short-answer network worker",
      "system": "Answer the incoming request concisely. Do not delegate or use tools.",
      "permissions": [{ "action": "*", "resource": "*", "effect": "deny" }]
    }
  },
  "plugins": [],
  "skills": [],
  "instructions": [],
  "snapshots": false,
  "warming": false
}
```

Supply `OPENAI_API_KEY` securely in the worker/coordinator launch environments;
never write it into these files or print it. In terminal 1, keep the planner in
the foreground:

```sh
A2A_NAME=planner A2A_DESCRIPTION='Plans implementation work' A2A_TAGS='planning,design' \
  bun "$REPO/dist/src/cli.js" --workspace "$PLANNER" --port 41241
```

In terminal 2, keep the reviewer in the foreground:

```sh
A2A_NAME=reviewer A2A_DESCRIPTION='Reviews proposed changes' A2A_TAGS='review' \
  bun "$REPO/dist/src/cli.js" --workspace "$REVIEWER" --port 41242
```

Identity is configured before the first card: strings are trimmed and must not
contain control characters; name/description limits are 128/1,024 characters.
`A2A_TAGS` is comma-separated, with no empty entries or internal quoting/escaping;
at most 16 tags of 64 characters each. Tags are deduplicated and `text` is retained
on the `text-prompt` skill. Metadata is descriptive, not authentication.

Wait for each foreground gateway's `ready: true` output, then verify both cards
in a control terminal (requires `jq`):

```sh
curl --fail --silent --show-error --max-time 5 http://127.0.0.1:41241/.well-known/agent-card.json |
  jq -e '.name == "planner" and .description == "Plans implementation work" and
    any(.supportedInterfaces[]; .url == "http://127.0.0.1:41241/" and .protocolVersion == "1.0") and
    any(.skills[]; .id == "text-prompt" and (.tags | index("planning")) != null)'
curl --fail --silent --show-error --max-time 5 http://127.0.0.1:41242/.well-known/agent-card.json |
  jq -e '.name == "reviewer" and .description == "Reviews proposed changes" and
    any(.supportedInterfaces[]; .url == "http://127.0.0.1:41242/" and .protocolVersion == "1.0") and
    any(.skills[]; .id == "text-prompt" and (.tags | index("review")) != null)'
```

In terminal 3, start the owned directory in the foreground without provider keys:

```sh
env -i PATH="$PATH" HOME="$STATE/directory-home" \
  "$A2ABRIDGE_BIN" directory --addr 127.0.0.1:7777
```

### 3. Register and refresh membership

In terminal 4, first require a successful directory response, then register the
exact root URLs. Registration and heartbeat return HTTP 204:

```sh
curl --fail --silent --show-error --max-time 3 http://127.0.0.1:7777/agents | jq -e 'type == "array"'
for peer in http://127.0.0.1:41241/ http://127.0.0.1:41242/; do
  curl --fail --silent --show-error --max-time 3 -o /dev/null -w '%{http_code}\n' \
    -H 'Content-Type: application/json' --data "{\"url\":\"$peer\"}" \
    http://127.0.0.1:7777/register || exit 1
done
```

Keep this foreground heartbeat loop running in terminal 4; a failed refresh exits
visibly rather than silently leaving stale membership:

```sh
while :; do
  for peer in http://127.0.0.1:41241/ http://127.0.0.1:41242/; do
    curl --fail --silent --show-error --max-time 3 -o /dev/null \
      -H 'Content-Type: application/json' --data "{\"url\":\"$peer\"}" \
      http://127.0.0.1:7777/heartbeat || exit 1
  done
  sleep 20
done
```

This 20-second interval matches the existing harness; it is membership refresh,
not an arbitrary readiness delay. In pinned a2abridge 4.0.2, membership has a
90-second TTL and garbage collection runs every 30 seconds. Removal is not
instantaneous at 90 seconds. Heartbeats refresh registration without probing
worker health. The directory remains required for `a2a_list_agents`; a static
manifest is not a replacement and does not provide public/LAN discovery.

### 4. Manually merge the project-local MCP fragment

Merge the following into the coordinator project's `opencode.json` or
`.opencode/opencode.json`, not a user-global file. Replace every absolute path
placeholder with a literal path: JSON strings do not expand shell `$VARIABLES`.
The private receipt parent directory must exist and be writable. Keep the
directory, workers and heartbeat running throughout the coordinator session.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": { "providerID": "openai", "model": "gpt-6-luna" },
  "default_agent": "coordinator",
  "permissions": [{ "action": "*", "resource": "*", "effect": "deny" }],
  "agents": {
    "coordinator": {
      "mode": "primary",
      "description": "Manual two-peer coordinator",
      "system": "Use only the six network tools. Discover planner and reviewer by their cards. Preserve exact peer URLs including the trailing slash. Never delegate through native subagents.",
      "permissions": [
        { "action": "*", "resource": "*", "effect": "deny" },
        { "action": "network_a2a_whoami", "resource": "*", "effect": "allow" },
        { "action": "network_a2a_list_agents", "resource": "*", "effect": "allow" },
        { "action": "network_a2a_send_message", "resource": "*", "effect": "allow" },
        { "action": "network_a2a_send_streaming", "resource": "*", "effect": "allow" },
        { "action": "network_a2a_get_task", "resource": "*", "effect": "allow" },
        { "action": "network_a2a_cancel_task", "resource": "*", "effect": "allow" }
      ]
    }
  },
  "mcp": {
    "servers": {
      "network": {
        "type": "local",
        "command": [
          "/absolute/path/to/bun",
          "/absolute/path/to/opencode-a2a-lite/examples/agent-network/bridge-proxy.ts",
          "/absolute/path/to/verified/a2abridge",
          "http://127.0.0.1:7777",
          "/absolute/path/to/private-disposable-network-state/mcp-receipts.jsonl",
          "[\"http://127.0.0.1:41241/\",\"http://127.0.0.1:41242/\"]"
        ],
        "cwd": "/absolute/path/to/trusted-coordinator-project",
        "codemode": false,
        "timeout": { "startup": 30000, "catalog": 30000, "execution": 150000 }
      }
    }
  },
  "plugins": [],
  "skills": [],
  "instructions": [],
  "snapshots": false,
  "warming": false
}
```

The final argument is an explicit JSON array of URL strings, **not** the manifest
filename. The existing guard verifies the binary pin, filters to these six tools,
enforces exact approved `peer_url` arguments and strips inherited provider keys
before spawning a2abridge (only fixed `PATH` and private `HOME` are passed).
An MCP `environment: {}` would not strip secrets: V2 environment settings extend
the inherited environment. Do not replace the guard with a direct binary launch.
The guard itself is trusted local code, not an OS sandbox; directory/cards remain
trusted local resources. Native subagents, shell, inbox and completion tools are
not part of this recipe.

### 5. Verify a real request and clean up

From the coordinator project, review `opencode debug config`, then start `opencode`
and select the configured coordinator. Ask it to call `network_a2a_list_agents`,
confirm both exact URLs/cards, and call `network_a2a_send_message` with
`peer_url: "http://127.0.0.1:41241/"`, `text: "Reply only MANUAL-PEER-OK"`,
`blocking: true`. Require `TASK_STATE_COMPLETED` and an artifact containing the
expected token. Also ask it to call `network_a2a_get_task` with unlisted
`peer_url: "http://127.0.0.1:41243/"`, `task_id: "guard-probe"`; require the
guard-denial result and a receipt with `event: "rejected"`, `reason: "peer"`.
No listener at that unlisted port is needed.

`opencode mcp list` and receipt `catalog` events only establish connection/catalog
arrival; they do not prove that the model received callable tools. Inspect the
actual tool calls and completed A2A task. This manual fragment does not install
the readiness observer; the managed live acceptance retains its existing observer
and permission-filtered request snapshots unchanged. Do not claim equivalent
automated readiness coverage from this manual check.

Retain only sanitized evidence: worker identities/URLs, completed state, pass/fail
for the expected token and guard rejection, plus the guard's metadata/hash
receipts. Do not publish raw prompts, provider diagnostics, private databases or
keys. Each bridge connection has a 40-call budget; avoid rapid model-tool polling.

The operator owns these foreground processes. On success **or failure**, close
the coordinator session/MCP connection, interrupt the terminal-4 heartbeat loop,
then unregister the workers while the directory is still running:

```sh
for peer in http://127.0.0.1:41241/ http://127.0.0.1:41242/; do
  curl --fail --silent --show-error --max-time 3 -o /dev/null \
    -H 'Content-Type: application/json' --data "{\"url\":\"$peer\"}" \
    http://127.0.0.1:7777/unregister || exit 1
done
```

Even if unregister fails, continue cleanup: interrupt the owned workers and
directory in their original terminals and wait for exit. Never use a broad
process-name kill. Check the three ports are free again with the bind probe and
verify owned OpenCode/profile processes have stopped before removing disposable
state. Stop endpoints before disabling/removing the manually added MCP entry;
it is not usable while those endpoints are stopped. To test expiration instead
of explicit unregister, stop heartbeat and observe `/agents` until the two exact
entries disappear, allowing more than 120 seconds with a bounded deadline.

Configuration references: [V2 config](https://opencode.ai/v2/docs/config),
[V2 local MCP](https://opencode.ai/v2/docs/mcp-servers#local),
[V2 permissions](https://opencode.ai/v2/docs/permissions), and
[pinned directory TTL/GC source](https://github.com/vbcherepanov/a2abridge/blob/v4.0.2/internal/directory/registry.go).
