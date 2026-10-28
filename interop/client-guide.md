# Caller-owned contexts and local deadlines

`task-client.ts` is an optional host helper, not a production client API or
an orchestrator. It uses the existing official MCP client → endpoint guard →
a2abridge 4.0.2 → gateway path. It creates no registry, queue, retry loop or server.
The provider-free interop gate uses it; model-driven callers remain operator-owned.
For user-facing usage, start with the [one-worker CLI smoke](/.opencode/skills/multi-a2a-agent/references/manual-one-worker.md),
not this optional host API. That recipe uses real `opencode run --server` against
an owned warmed private server and existing session inspection, with no TypeScript
coordinator. It has one dated authorized two-turn pass. When a live attempt is part
of the current user request, do not seek separate billing approval; the user monitors
spend. Cold standalone readiness and larger topologies remain unverified; this
helper/CI is not a substitute for live evidence.

## Supported flow

```ts
const peer = createTaskClient(connection, worker.url);
const options = { deadline: performance.now() + 30_000, signal: controller.signal };
const submitted = await peer.submit("First turn", options);
if (submitted.outcome === "uncertain") {
  // The request may have been accepted. No handle was received. Do not resend.
  return submitted;
}
const observed = await peer.wait(submitted, options);
// Persist/retain observed.handle in the caller, even if observed is pending.
// For a new turn, choose a new local deadline, and pass observed.handle to submit.
```

Deadlines are **absolute monotonic `performance.now()` milliseconds**, not epoch
timestamps. Submission and waiting share one deadline when they are one operation.
Every MCP call receives the remaining timeout, maximum total timeout and abort
signal; progress cannot extend it. Every polling sleep is capped by the remaining
time and abortable. No new poll starts after deadline/abort. Event-loop scheduling
still has bounded test headroom; JavaScript cannot interrupt a blocked event loop.

The immutable handle contains the **actual** peer URL, context ID and task ID.
Follow-up submissions send `context_id`, omit `task_id` and request nonblocking
execution. Each turn gets a distinct task ID. A helper bound to another peer
rejects the handle locally. Unknown/expired contexts fail remotely; the helper
does not omit the context and silently restart the conversation.

`Observation.task` uses the pinned official A2A SDK decoder (numeric SDK state
enum and decoded parts). `payloadText` accepts both decoded and wire task parts.
`outcome` distinguishes `completed`, `failed` (including rejected), `canceled` and
`pending` (including interrupted/input-required work). MCP tool success is not
evidence of task completion. Malformed results fail validation.

## Stop waiting is not cancel work

- A local wait returns `pending` with `reason: deadline | aborted | poll-limit |
  budget`, its retained handle and last observed task. The remote task may have
  progressed since that observation. No automatic remote cancellation occurs.
- A timed-out, aborted or disconnected **submission** without a received handle
  returns `uncertain` and its cause, without invented identifiers. No resend or
  background recovery is attempted. Submission tool errors remain visible in
  `cause` too: a bridge error, including its own unary timeout, does not prove that
  the peer never accepted the request. This is intentionally conservative.
- `peer.get(handle, newOptions)` can inspect a task after a local wait expires.
  `peer.cancel(handle, newOptions)` is a **separate explicit remote operation**.
  Use a fresh deadline/signal and keep the MCP connection open for intervention.
- Cancel returns the actual observed outcome, not a promised `canceled` label.
  Cancel errors and unknown-task errors propagate; the caller retains its handle.
  In a losing race, this gateway can report “ACP did not cancel the task” while a
  subsequent `get` reports `completed`. Do not retry cancellation automatically.
- MCP abort sends a request-cancellation notification; that is not proof of A2A
  cancellation. Lifecycle shutdown closes the connection/resources, unlike a
  per-operation signal, and therefore prevents further calls on that connection.

Polling defaults to eight attempts, spaced across the remaining deadline. A
caller may select at most 24 polls, but the helper stops with eight calls remaining
on the connection for intervention/final verification. The existing guard still
caps attempted calls at 40. Discovery and other `connection.call` requests count
against that same local budget. Do not bypass accounting with raw
`connection.client.callTool`, increase the guard budget, or reconnect to evade it.
`stopWhen` permits a bounded partial-output probe without waiting for completion.

## Bridge pin and coordinator guidance

Bridge 4.0.2's unary peer budget is 60 seconds; the gateway default prompt budget
is 120 seconds. Prefer nonblocking send plus bounded task polling for longer work,
not a 150-second blocking MCP call. Polling is **not SSE streaming**.

The pinned `a2a_send_streaming` schema has no `context_id`. The helper rejects
`mode: "streaming"` before dispatch (including context-bearing requests); select
the default polling mode explicitly for continuation. Fresh-context direct
streaming remains available through the existing raw tool. Actual streaming
continuation needs a separately reviewed upstream schema and pin change.

**This host helper does not govern the model's direct MCP tool calls.** Equivalent
coordinator instructions must tell the model to retain returned peer/context/task
IDs, continue via nonblocking `a2a_send_message` with `context_id` but no `task_id`,
inspect task state rather than MCP success, reserve intervention calls, and treat
local timeouts as pending/uncertain rather than canceled. Neither those instructions
nor the helper change gateway concurrency/security semantics. The guard enforces
the 40-attempt cap, not the eight-call reserve; direct model calls need independently
observed bounds/reserve and cannot inherit this helper's clock or polling sleeps.

Research references:

- [Official MCP v1 protocol cancellation and timeout options](https://ts.sdk.modelcontextprotocol.io/protocol.html)
- [Pinned bridge schemas and 60-second unary deadline](https://github.com/vbcherepanov/a2abridge/blob/v4.0.2/internal/agent/mcp.go)

## Provider-free evidence

```sh
bun test ./tests/agent-network
A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test
make check
```

Download the documented 4.0.2 Linux amd64 release and verify both archive and
executable hashes using the existing [download instructions](/.opencode/skills/multi-a2a-agent/references/manual-one-worker.md#prerequisites).
The target fails for an absent/wrong binary. It launches real gateways and
controlled ACP subprocesses with synthetic environments, no provider/model or
OpenCode installation, reusing the existing directory, guard, MCP and lifecycle
helpers. It checks actual ACP session receipts, continuation/isolation, failed and
stale contexts, timeout/abort retention, explicit cancellation/errors/losing races,
and guarded call receipts. Two independent scenario connections each retain eight
intervention calls within the 40-attempt cap; denials count too.

To deterministically stall MCP, the gate verifies the executable of the exact
child PID of its owned proxy, pauses it, then resumes it in `finally`. A timed-out
submission reaches the guard, but may or may not reach ACP after resumption; its
outcome remains uncertain. There is no guessed handle or automatic resend.
Deterministic SDK tests separately observe abort delivery during hung tool calls.

CI downloads and checksums the pinned bridge and runs this gate without provider
secrets. It also checks the six-tool catalog, discovery, fresh-context SSE text and
stored output, local endpoint/tool denials and reflected-identifier receipt privacy.
It does not prove a model's native tool registration or model output quality. The
managed model-driven lab is retired; historical failures remain documented.
