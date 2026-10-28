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

<a id="manual-two-worker-recipe"></a>

## Manual one-worker CLI smoke

This operator-owned setup is separate from provider-free CI and makes billable
requests. **Live gate BLOCKED: separate billable opt-in has not been provided;
this recipe is unverified end-to-end.** Version/help and documentation review are
not model-callable readiness or real-model acceptance. It does not generate
profiles, add a runner or install a readiness plugin. The route is:

**OpenCode coordinator → local stdio endpoint guard → a2abridge → loopback A2A gateway → ACP worker**.

### 1. Review projects and check ports

Build with `make build`. Choose one trusted worker and a separate trusted coordinator project.
Review `opencode debug config` sources from each: global and ancestor configuration
is inherited, so project-local does not mean isolated. Review tools, plugins, MCP
and provider settings. Supply keys securely in launch environments, never files/logs.
Set these Bash variables to your own absolute paths. Use a fresh, operator-owned
`STATE` directory; do not overwrite a prior attempt's evidence. Repeat the path
exports and `umask 077` in each dedicated terminal below; shell variables are not
shared between terminals. Confirm Bun `1.3.9` and `opencode v2.0.28` with `--version`.

```sh
export REPO=/absolute/path/to/opencode-a2a-lite
export WORKER=/absolute/path/to/trusted-worker-project
export COORDINATOR=/absolute/path/to/trusted-coordinator-project
export STATE=/absolute/path/to/private-disposable-network-state
export A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge
umask 077
mkdir -p "$STATE" "$STATE/directory-home" "$STATE/worker-home"
chmod 700 "$STATE" "$STATE/directory-home" "$STATE/worker-home"
bun -e '
  import { createServer } from "node:net";
  for (const port of [41241, 7777]) {
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

### 2. Start one named worker and the directory

In the worker project's reviewed `opencode.json`, manually merge a tool-denied
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

Use the existing reviewed provider/model configuration; do not add a model/profile.
It must be available from the reviewed worker project/launch environment after
switching HOME; do not copy credentials or assume normal global settings carry over.
The coordinator uses `run --standalone` below. **`acp` has no `--standalone` flag.**
For the worker, use a dedicated shell with the following private HOME/XDG paths
before configuring its service discovery. Review inherited `OPENCODE_*` overrides
and managed/ancestor config; stop if they redirect storage or server discovery.
Do not run `service set` with your normal HOME/XDG: it stops the shared service.
This follows the private-discovery technique in the existing
[ACP smoke configuration](/scripts/acp-smoke-config.ts), not an isolation sandbox.

```sh
export HOME="$STATE/worker-home"
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share"
export XDG_STATE_HOME="$HOME/.local/state" XDG_CACHE_HOME="$HOME/.cache"
opencode debug paths
# Confirm these resolve inside the disposable worker home before proceeding.
opencode service set disabled true
cd "$WORKER"
opencode debug config
# Privately review sources; supply the approved provider key in this launch environment.
echo "owned gateway PID: $$"
exec env A2A_NAME=smoke-worker A2A_DESCRIPTION='Short text continuity smoke' A2A_TAGS='text' \
  bun "$REPO/dist/src/cli.js" --workspace "$WORKER" --port 41241
```

`exec` replaces only this dedicated shell: record its PID privately before launch.
Record the gateway's actual readiness URL and its owned ACP/private-server PIDs
from the process tree, without dumping argv/environments. In a second dedicated terminal:

```sh
echo "owned directory PID: $$"
exec env -i PATH="$PATH" HOME="$STATE/directory-home" \
  "$A2ABRIDGE_BIN" directory --addr 127.0.0.1:7777
```

Wait for the gateway's actual `ready:true` URL. Fetch its `/.well-known/agent-card.json` with
`curl --fail --max-time 5`; verify intended names, descriptions, tags and exact A2A
1.0 interface URLs. Identity is metadata, not permission or authentication. Never
expose gateways through public proxies or use untrusted directories/cards.

### 3. Register and refresh membership

In a control terminal, require `/agents` readiness, register exact root URLs, then
keep the foreground heartbeat running (HTTP 204 for registration/heartbeat):

```sh
curl --fail --silent --show-error --max-time 3 http://127.0.0.1:7777/agents || exit 1
peer=http://127.0.0.1:41241/
curl --fail --silent --show-error --max-time 3 -o /dev/null -w '%{http_code}\n' \
  -H 'Content-Type: application/json' --data "{\"url\":\"$peer\"}" \
  http://127.0.0.1:7777/register || exit 1
echo "owned heartbeat shell PID: $$"
while :; do
  curl --fail --silent --show-error --max-time 3 -o /dev/null \
    -H 'Content-Type: application/json' --data "{\"url\":\"$peer\"}" \
    http://127.0.0.1:7777/heartbeat || exit 1
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
      "description": "Manual one-worker CLI smoke coordinator",
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
          "[\"http://127.0.0.1:41241/\"]"
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

### 5. Run the CLI only after separate billable authorization

Inspect the actual catalog: `network_a2a_whoami`, `network_a2a_list_agents`,
`network_a2a_send_message`, `network_a2a_send_streaming`, `network_a2a_get_task`,
`network_a2a_cancel_task`. If unavailable, report a blocker; never substitute native
subagents, the A2A CLI or direct ACP. Catalog receipts or `opencode mcp list` alone
are not model-callable readiness. Run from a dedicated coordinator terminal with
its reviewed launch environment, not the worker's private HOME/XDG:

```sh
cd "$COORDINATOR"
opencode --version   # must print opencode v2.0.28
opencode run --help
export MARKER="$(bun -e 'console.log(crypto.randomUUID())')"
PROMPT="Use only the six configured network_a2a_* tools through the guarded MCP route.
If they are unavailable, stop and report BLOCKED. Call whoami and list_agents;
select only the verified smoke-worker at http://127.0.0.1:41241/.
Send exactly this first text via send_message with blocking:false and no context_id
or task_id: Remember this synthetic marker: $MARKER. Reply with exactly $MARKER.
Retain the actual peer URL, returned contextId and task id. Inspect get_task using
that peer and task_id until terminal, within one 30-second submit-plus-wait deadline.
Only after completed with an observed artifact, send exactly this follow-up text:
What synthetic marker did I ask you to remember? Reply with only that marker.
Use the same peer and actual returned context_id, blocking:false, and OMIT task_id.
Retain the new task id and inspect its terminal state/artifact under a new
30-second submit-plus-wait deadline. Never guess handles or cross peers.
Allow at most eight spaced polls per turn; no rapid polling. Count every attempted
call including errors/denials; stop ordinary work at 32 of 40 to reserve eight calls.
No retries, resend, reconnect, cancellation or alternative delegation route.
Unknown/stale task/context errors remain errors, never start a replacement context.
If waiting expires retain pending handles; if submission has no returned handle
report uncertain without resend. Missing evidence is INCOMPLETE, not success.
Report actual handles/states and artifact checks, not a claim that you succeeded."
echo "owned coordinator PID: $$"
exec opencode run --standalone --agent coordinator --format json \
  --title "adapter-smoke-$MARKER" "$PROMPT" \
  > "$STATE/coordinator.jsonl" 2> "$STATE/coordinator.stderr"
```

Record this dedicated shell's PID before `exec`; interrupt only that owned client
if necessary. Both worker turns are inside **one CLI invocation/MCP connection**;
do not use `run --continue` or a second invocation to reset the guard budget.
The OpenCode coordinator session ID is separate from the A2A context/task IDs.
Record the actual session reference from the CLI events or targeted session list
below; do not assume an A2A context ID is an OpenCode session ID.

The 30-second local operation example matches the [host guide](/examples/agent-network/client-guide.md).
Unlike that helper, direct model calls have no demonstrated monotonic deadline or
poll-spacing enforcement here. `run` has no timeout flag, and six-tool permissions
do not provide a sleep/clock tool. The operator must supervise absolute monotonic
cutoffs, remaining call time and spacing; if this cannot be enforced/observed,
record the bounded-wait gate as BLOCKED rather than claim the prompt enforces it.
The guard enforces 40 attempts, **not the eight-call reserve**. Do not extend budgets
or add tools/runners to obtain a pass. Local timeout/abort is not remote cancellation.
Explicit cancellation requires separate authorization and an inspected actual
outcome/error (including a race lost to completion); retain unknown-task errors.
Bridge 4.0.2 cannot stream a context continuation; use nonblocking send plus polling.
Its unary budget is 60 seconds versus the gateway's default 120-second prompt budget.

### 6. Review existing session and task evidence privately

`--standalone` uses a private server, not a disposable database. Do not delete normal
OpenCode data. In the **same coordinator environment/project**, identify the actual
session by its fresh title, location and time; never select the newest unrelated
session. Then substitute that observed ID:

```sh
cd "$COORDINATOR"
set -o pipefail
opencode session list --standalone --max-count 20 --format json \
  > "$STATE/coordinator-sessions.json"
export SESSION=ses_REPLACE_WITH_OBSERVED_COORDINATOR_ID
opencode api --standalone session.message.list \
  --param "sessionID=$SESSION" --param limit=100 --param order=asc |
  jq '{cursor, data: [.data[] |
    if .type == "user" then {id, type, text}
    elif .type == "assistant" then {id, type, content: [.content[] |
      select(.type == "text" or .type == "tool") |
      if .type == "tool" then {type, id, name, state: (.state |
        {status, input, content, error})} else {type, text} end]}
    else empty end]}' > "$STATE/coordinator-review.json"
```

Use these existing V2 interfaces, not SQL or a new exporter. Follow returned
`cursor.next` pages when present: repeat `session.message.list` with the same
`--param "sessionID=$SESSION" --param limit=100`, add `--param "cursor=$CURSOR"`
using the actual returned next cursor, and omit `order`. Keep the same filter and
retain each page privately; a truncated page is not complete evidence.
OpenCode 2.0.28's [API handler](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/cli/src/commands/handlers/api.ts)
applies `--param` only to operation IDs, not raw method/path requests; use the
operation-ID form for both coordinator and worker inspection.
This allowlist omits reasoning/native/metadata fields; do
not use `--thinking`, publish raw JSONL/stderr, or export other projects. Even the
filtered file contains private synthetic prompts, tool inputs/results and answers.
Inspect it locally only. If the pinned API response differs from the documented
shape, stop and report the mismatch; do not infer missing evidence.

In a separate inspection terminal, restore the worker's exact HOME/XDG from step 2,
`cd "$WORKER"`, and use the same `session list --standalone` and message API/filter
with the **observed worker session ID** and distinct private output filenames.
Check location, launch time and the unique first marker prompt, then verify both
received prompts are in that one root session. Do not guess its ID from the A2A
handle. Missing/ambiguous worker correlation leaves continuity unverified.

Acceptance review (CLI exit 0 and assistant self-report are insufficient):

- Coordinator tool records show actual discovery, two nonblocking sends and task
  lookups through `network_a2a_*`, with tool inputs/results, not just proposed calls.
  Within guard receipts, pair call/result by connection and MCP ID; correlate with
  session records by tool, peer, input/handle hashes and order. Provider tool IDs
  are not MCP IDs. Missing/unpaired/ambiguous evidence remains unverified.
- First send has no context/task argument; follow-up sends the returned context,
  omits task ID, stays on the same approved peer and returns a distinct task ID.
  Both observed terminal tasks are `completed` with actual stored text artifacts.
- Compare exact intended text, model-declared arguments, guard-dispatched input
  hashes and worker-received user text separately. Compare the worker's root
  assistant text to stored A2A artifact text in order; do not include reasoning,
  child-session text or tool output as ACP/root answer text.
- Record marker-content checks separately from protocol/state checks. A wrong
  answer, slow first text or extra model-selected call alone is not an adapter bug.
  Retain observed byte/state mismatches and original failures for a small boundary
  reproduction; do not retry for a favorable result or restore a role scorer.
- Missing tools/evidence, unknown tasks, pending work, uncertain submission or
  unverified bounds remain BLOCKED/INCOMPLETE, never inferred completion/cancellation.

The API paths/filters follow [V2 API documentation](https://opencode.ai/v2/docs/api)
and its [OpenAPI](https://opencode.ai/v2/openapi.json); pinned version/help was
inspected without starting a service. API responses and this live flow have **not**
been exercised against the pinned model setup. Session review is client-side
evidence, not a production OpenCode HTTP adapter.

### 7. Owned cleanup, including failure or interruption

Keep a private PID/port ledger: gateway, its ACP/private-server descendants,
directory, heartbeat shell, coordinator and its guard/bridge/private-server
descendants. Record actual listener ports (including ephemeral private servers),
not only requested ports. Use `ps -o pid,ppid,pgid,comm -p <owned-pids>` and
`ss -ltnp` locally without publishing their raw output. Identity/PID existence
alone is not readiness. Do not signal a PID whose ownership cannot be confirmed.

On success, failure, local deadline or SIGINT/SIGTERM, close the owned
coordinator/MCP connection, stop the foreground heartbeat in its own terminal,
then unregister while the directory remains running. Review private evidence when
possible, but never delay resource cleanup for reporting:

```sh
curl --fail --silent --show-error --max-time 3 -o /dev/null \
  -H 'Content-Type: application/json' --data '{"url":"http://127.0.0.1:41241/"}' \
  http://127.0.0.1:7777/unregister
```

Record unregister/reporting failures, but continue cleanup independently. Stop the
owned foreground gateway, then directory, with Ctrl-C in their dedicated terminals
or `kill -TERM <verified-owned-pid>` from the ledger. Verify PID exit, descendant
exit and absence of listeners on every recorded exact port, then repeat the bind
probe for those ports. TIME_WAIT without a listener/process is not a leaked server.
Do not delete state while owned processes remain. Inspection commands also create
short-lived private servers: verify their exit. Never use name/pattern-wide kills,
stop/restart/configure an existing shared service or delete its database.

If interrupted before review, preserve state/handles and record evidence as missing;
resource cleanup must not wait for reporting. Gateway shutdown may attempt its
existing bounded active cancellation, but client closure alone proves no remote
cancellation. Record actual observed outcome or unknown. Do not reuse stopped
URLs/contexts. Remove/disable only the manually added MCP entry; remove disposable
private state only after review and verified owned exit, never normal databases.
Publish only revision/pins, command shape, boolean task/context/artifact/content
checks, outcome and cleanup checks. Retain actual session/task handles privately,
not raw prompts/answers, provider diagnostics, databases, keys or reasoning.
Receipt hashes still contain local URLs and opaque identifiers: private metadata.

## Retained support inventory

Physical TypeScript LOC at the issue #31 documentation baseline and after this
doc-only change: production `src/` **8 files / 997 lines**; examples **6 / 886**;
test cases `tests/**/*.test.ts` **15 / 2,245**; test support/fixtures/opt-in
entrypoints (other `tests/**/*.ts`) **11 / 2,016**;
`scripts/` **8 / 995** (build/quality/package/live support). Categories are disjoint;
the 886 example lines are not hidden in the test total. Count tracked `.ts` files
with `git ls-files` and physical lines with `wc -l`. No helper is moved or removed:

| Module            | Lines | Concrete retained consumer/contract                                                                                                                                       |
| ----------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bridge-proxy.ts` |   303 | Manual MCP fragment; `profiles.ts` launch; `proxy.test.ts`: pinned bridge, tool/URL restrictions, secret stripping, private receipts, 40-attempt cap.                     |
| `guard-task.ts`   |   122 | Guard, `interop.ts`, `proxy.test.ts`: paired receipt/task metadata and reflected-ID privacy without rewriting forwarded responses.                                        |
| `lifecycle.ts`    |    60 | `transport.ts`, `interop.ts`, `lifecycle.test.ts`: interruption and independently drained owned-resource cleanup.                                                         |
| `profiles.ts`     |    21 | `transport.ts`, `task-client.ts`, `interop.ts`: small types, object validation and guard argv, not generated model profiles.                                              |
| `task-client.ts`  |   163 | Optional typed host guide, `interop.ts`, `task-client.test.ts`: actual peer/context/task handles, bounded waiting, pending/uncertain retention. Not the CLI smoke runner. |
| `transport.ts`    |   217 | `interop.ts`, `task-client.test.ts`, `lifecycle.test.ts`: official MCP transport, call deadlines/accounting, directory/process/port lifecycle and task text decoding.     |

The [CI bridge gate](/.github/workflows/ci.yml) invokes `interop.ts` with a
checksummed real bridge and controlled ACP, independently of model installation.
These retained modules are not duplicate CLI/session engines; deterministic guard,
cancellation, artifact append, context, admission and cleanup coverage remains
separate from this optional live gate. No maintained TypeScript grows or relocates.

References: [V2 configuration](https://opencode.ai/v2/docs/config),
[CLI automation](https://opencode.ai/v2/docs/cli#automation),
[CLI commands](https://opencode.ai/v2/docs/cli/commands),
[private/shared service behavior](https://opencode.ai/v2/docs/troubleshooting),
[local MCP](https://opencode.ai/v2/docs/mcp-servers#local),
[permissions](https://opencode.ai/v2/docs/permissions),
[pinned directory source](https://github.com/vbcherepanov/a2abridge/blob/v4.0.2/internal/directory/registry.go).
