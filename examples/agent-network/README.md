# Guarded MCP interoperability

This directory retains a small endpoint guard, typed task helper and provider-free
interop transport/lifecycle helpers. It is not a managed agent team or an
orchestration platform. The managed network/topology runners, generated model
profiles, readiness plugin, workloads and scorers have been retired.

Historical source is retained at [pre-retirement revision a70b639](https://github.com/tbrandenburg/opencode-a2a-lite/tree/a70b639/examples/agent-network).
[Network findings](/docs/agent-network-findings.md),
[topology findings](/docs/topology-investigation-findings.md) and
[authorized live failures](/docs/authorized-live-acceptance.md) remain historical
evidence, not proof of resolved defects. Neither `network-demo` nor
`topology-investigation` is a current command. The single-gateway `make demo` and
production `make e2e` remain opt-in and billable.

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
Owned child and port cleanup is verified. See the [caller guide](/examples/agent-network/client-guide.md).

## Manual two-worker recipe

This operator-owned setup is separate from provider-free CI and makes billable
requests. It does not generate profiles or install a readiness plugin. The route is:

**OpenCode coordinator → local stdio endpoint guard → a2abridge → loopback A2A gateway → ACP worker**.

### 1. Review projects and check ports

Build with `make build`. Choose separate trusted worker and coordinator projects.
Review `opencode debug config` sources from each: global and ancestor configuration
is inherited, so project-local does not mean isolated. Review tools, plugins, MCP
and provider settings. Supply keys securely in launch environments, never files/logs.
Set these Bash variables to your own absolute paths:

```sh
export REPO=/absolute/path/to/opencode-a2a-lite
export PLANNER=/absolute/path/to/trusted-planner-project
export REVIEWER=/absolute/path/to/trusted-reviewer-project
export COORDINATOR=/absolute/path/to/trusted-coordinator-project
export STATE=/absolute/path/to/private-disposable-network-state
export A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge
umask 077
mkdir -p "$STATE" "$STATE/directory-home"
chmod 700 "$STATE" "$STATE/directory-home"
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

If occupied, stop; never kill another owner's process. Choose unused ports and
update launch commands, registrations and the exact allowlist consistently. A
released bind is not a reservation; startup must succeed too.

### 2. Start named workers and the directory

In each worker project's reviewed `opencode.json`, manually merge a tool-denied
worker agent (preserve unrelated settings; no global edits):

```json
{
  "default_agent": "worker",
  "permissions": [{ "action": "*", "resource": "*", "effect": "deny" }],
  "agents": {
    "worker": {
      "mode": "primary",
      "description": "Short-answer worker",
      "system": "Answer concisely. Do not delegate or use tools.",
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

Use the reviewed provider/model configuration. In three separate terminals:

```sh
A2A_NAME=planner A2A_DESCRIPTION='Plans implementation work' A2A_TAGS='planning,design' \
  bun "$REPO/dist/src/cli.js" --workspace "$PLANNER" --port 41241
```

```sh
A2A_NAME=reviewer A2A_DESCRIPTION='Reviews proposed changes' A2A_TAGS='review' \
  bun "$REPO/dist/src/cli.js" --workspace "$REVIEWER" --port 41242
```

```sh
env -i PATH="$PATH" HOME="$STATE/directory-home" \
  "$A2ABRIDGE_BIN" directory --addr 127.0.0.1:7777
```

Wait for actual `ready:true` URLs. Fetch each `/.well-known/agent-card.json` with
`curl --fail --max-time 5`; verify intended names, descriptions, tags and exact A2A
1.0 interface URLs. Identity is metadata, not permission or authentication. Never
expose gateways through public proxies or use untrusted directories/cards.

### 3. Register and refresh membership

In a control terminal, require `/agents` readiness, register exact root URLs, then
keep the foreground heartbeat running (HTTP 204 for registration/heartbeat):

```sh
curl --fail --silent --show-error --max-time 3 http://127.0.0.1:7777/agents
for peer in http://127.0.0.1:41241/ http://127.0.0.1:41242/; do
  curl --fail --silent --show-error --max-time 3 -o /dev/null -w '%{http_code}\n' \
    -H 'Content-Type: application/json' --data "{\"url\":\"$peer\"}" \
    http://127.0.0.1:7777/register || exit 1
done
while :; do
  for peer in http://127.0.0.1:41241/ http://127.0.0.1:41242/; do
    curl --fail --silent --show-error --max-time 3 -o /dev/null \
      -H 'Content-Type: application/json' --data "{\"url\":\"$peer\"}" \
      http://127.0.0.1:7777/heartbeat || exit 1
  done
  sleep 20
done
```

Membership TTL is 90 seconds; garbage collection runs every 30 seconds. Heartbeat
does not prove worker health. The directory is required for discovery; no static
inventory replaces it.

### 4. Manually merge the project-local MCP fragment

In the coordinator's `opencode.json` or `.opencode/opencode.json`, manually merge
this fragment. Replace path placeholders with literal absolute paths; JSON does
not expand shell variables. Preserve reviewed settings and choose the configured
coordinator agent. The private receipt parent must exist and be writable.

```json
{
  "default_agent": "coordinator",
  "permissions": [{ "action": "*", "resource": "*", "effect": "deny" }],
  "agents": {
    "coordinator": {
      "mode": "primary",
      "description": "Manual two-peer coordinator",
      "system": "Use only the six network tools. Discover exact worker URLs. Retain returned handles. Never use native subagents. Reserve eight calls within forty attempts; no automatic retries or cancellation.",
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
  }
}
```

`network` is a label, not a second MCP product. The gateway is an A2A HTTP server,
**not a remote MCP endpoint**. The final argument is a JSON URL array including
trailing `/`, not a manifest filename. Do not bypass the guard: it pins the binary,
filters six tools, enforces exact peers and 40 attempts, and passes only fixed PATH
and private HOME to the child. MCP `environment:{}` does not strip inherited keys.
The guard constrains arguments, not hostile cards/redirects or other local users;
it is not an OS/network sandbox. Review inherited configuration again.

### 5. Verify a real request and clean up

Inspect the actual tool catalog. If the six `network_a2a_*` tools are unavailable,
report a setup blocker; never substitute another delegation route. Catalog receipt
or `opencode mcp list` alone is not model-callable readiness. Discover intended
cards with `network_a2a_list_agents`, then submit a bounded expected-token request
with `network_a2a_send_message({peer_url, text, blocking:false})`. Retain returned
`contextId` and task `id`; poll `network_a2a_get_task({peer_url, task_id})` with a
bounded deadline and inspect actual terminal state/artifact. Continuation uses
`context_id` and omits `task_id`; no handle may cross peers. Unknown/stale contexts
fail, not silently restart. Verify an unapproved peer returns the local guard denial
and a `rejected`/`peer` receipt without forwarding.

Keep eight calls for intervention within forty attempted calls, including denials.
No rapid polling or reconnects to evade the cap. Local timeout/abort is not remote
cancellation; retain pending handles, or report uncertain submission without resend.
Explicitly cancel only when requested, and inspect its actual outcome/error.
Bridge 4.0.2 cannot stream a context continuation; use nonblocking send plus polling.
Its unary budget is 60 seconds versus the gateway's default 120-second prompt budget.
See [typed handles and deadlines](/examples/agent-network/client-guide.md).

On success or failure, close the coordinator/MCP connection, stop the heartbeat,
then unregister while the directory remains running:

```sh
for peer in http://127.0.0.1:41241/ http://127.0.0.1:41242/; do
  curl --fail --silent --show-error --max-time 3 -o /dev/null \
    -H 'Content-Type: application/json' --data "{\"url\":\"$peer\"}" \
    http://127.0.0.1:7777/unregister || exit 1
done
```

Even if unregister fails, stop owned foreground workers/directory in their original
terminals; wait for exit and repeat the exact-port bind check. Verify owned ACP
processes stopped before removing private state. Never kill by broad process name
or reuse stopped URLs/profiles. Remove/disable only the manually added MCP entry.
Retain sanitized task outcomes, expected-artifact checks and cleanup evidence, not
raw prompts, provider diagnostics, private databases or keys. Receipt hashes still
contain local URLs and opaque identifiers; treat them as private metadata.

References: [V2 configuration](https://opencode.ai/v2/docs/config),
[local MCP](https://opencode.ai/v2/docs/mcp-servers#local),
[permissions](https://opencode.ai/v2/docs/permissions),
[pinned directory source](https://github.com/vbcherepanov/a2abridge/blob/v4.0.2/internal/directory/registry.go).
