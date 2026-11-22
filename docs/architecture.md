# Architecture and scope

## Goal

Expose OpenCode as a small A2A agent while keeping OpenCode's ACP subprocess as the authority for coding-session behavior. The A2A server owns the external task boundary; an adapter translates task input into ACP session/prompt operations and translates ACP updates into A2A events.

```text
A2A client
  -> A2A v1 JSON-RPC + Agent Card (HTTP)
  -> A2A request handler / task store
  -> executor and ACP adapter
  -> OpenCode subprocess (ACP NDJSON over stdin/stdout)
```

Keep protocol responsibilities at their boundary: A2A task IDs and lifecycle belong to A2A; session IDs, prompt turns, permission requests and session updates belong to ACP. Do not treat the HTTP admission response as completion of the underlying OpenCode work.

## Contract decisions

- **A2A:** use the current JavaScript SDK v1 server composition (`AgentExecutor`, `DefaultRequestHandler`, task store, `AgentEvent` helpers, and Express JSON-RPC / Agent Card handlers). Declare only capabilities actually implemented. SDK sample: [A2A JS sample server](https://github.com/a2aproject/a2a-js/blob/main/src/samples/agents/sample-agent/index.ts); [migration guide](https://github.com/a2aproject/a2a-js/blob/main/docs/migration-guide.md).
- **ACP v1:** run the OpenCode executable as a subprocess using newline-delimited JSON-RPC on stdin/stdout; stdout is protocol-only and stderr is the logging channel. Supply an absolute working directory. The reviewed OpenCode 2.2.7 executable retains ACP protocol version 1, `session/new`, `session/prompt`, `session/cancel`, updates, and permission callbacks; see [runtime compatibility evidence](/docs/opencode-runtime-upgrade.md). See [ACP v1 initialization](https://agentclientprotocol.com/protocol/v1/initialization), [session setup](https://agentclientprotocol.com/protocol/v1/session-setup), [prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn), [cancellation](https://agentclientprotocol.com/protocol/v1/cancellation), and [OpenCode ACP docs](https://opencode.ai/v2/docs/cli/acp).
- **Turn completion:** ACP v1 `session/prompt` returns `PromptResponse.stopReason`. Use the response for that prompt as the authoritative completion signal, not a quiet stream or unrelated event. The MVP policy treats only `end_turn` as successful; explicitly map other defined stop reasons to truthful non-success outcomes. [ACP v1 prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn).
- **Correlation:** retain explicit mapping between A2A task, ACP session, and in-flight prompt. In the existing fork HTTP V2 probe, admission/delivery IDs did not correlate later assistant/terminal events; they are not substitutes for protocol task/session correlation. Treat that observation as fork-specific evidence, not a general protocol rule.

## Project policy (not protocol requirements)

Keep v1 scope narrow: map each A2A context to one ACP session in memory, reuse it for follow-up tasks while the gateway is running, and admit only one active prompt globally. Bound the number of sessions; restart recovery is unsupported. Deny unsupported interactive permission requests rather than silently approving them, and advertise only implemented capabilities in the Agent Card. These are implementation choices, not mandates imposed by ACP or A2A.

## Implementation boundaries

- `server.ts` composes the SDK, gates readiness on ACP, preserves explicit context intent through public SDK methods, and owns HTTP shutdown.
- `executor.ts` holds the bounded context map and single admission slot, publishes task/working/artifact/terminal events, and uses the prompt response as its outcome.
- `acp-client.ts` owns the pinned subprocess, persistent stable-v1 connection, update filtering, permission denial, deadlines and process cleanup. It never retries an uncertain prompt.
- CLI `launchGateway` resolves the operator-trusted executable once. Version, config and path probes use the private base environment without passed credentials; only ACP receives `--pass-env` values. This deliberately replaces the earlier same-snapshot requirement with the same executable and base environment. A library caller supplying `acp.env` retains that override and owns its isolation. Cleanup failures retain the runtime.
- `runtime-policy.ts` is the single source of the capability profiles (V2 `policies` plus agent `permissions`), the CLI validation rules and the startup summary; `runtime-policy-check.ts` verifies in preflight that OpenCode reported the private document unchanged (it silently drops invalid statements) and that every effective agent denies `execute`. `createRuntimeEnvironment` writes the config (`0600`) into the private XDG config; the CLI path always has a profile (default `read-only`), library callers with `acp.env` have none and cannot pass `policy`. The ACP adapter never auto-answers permissions.
- `resume.ts` validates the client-supplied `opencode.sessionId` and decides refusals. The bridge's `resumeSession` calls ACP `session/resume`; OpenCode's invalid-params answer (unknown id or foreign workspace) rejects only that request, while any other failure retires the bridge like session creation does. Resume is opt-in because a session exposes its earlier conversation. With `opencode.replay: true` the bridge uses `session/load` instead and `replay.ts` keeps the newest bounded set of replayed root user/assistant text (grouped by message id); `conversation.ts` publishes it as one `conversation` artifact. It is an artifact, not task history, because A2A history is the messages of that task and the SDK would append replayed messages after the current prompt.
- `permission.ts` and `permission-desk.ts` hold the permission-answer rules and the single pending request per task. With `--permissions ask` the first `execute()` stays running while the task is `input-required`; the answer arrives as a second `execute()` that hands it over and waits for the first to finish, after publishing the task snapshot so streams stay valid.
- `request-handler.ts` keeps the SDK's `InMemoryTaskStore` but synchronizes cancellation with its original event consumer; this avoids SDK 1.3 duplicate artifact persistence. This narrow workaround is regression-tested, not a second task database.

The cancellation adapter depends on the original SDK persistence consumer staying
alive. Explicitly closing the public SDK stream generator is distinct from an
HTTP client disconnect and is not a supported takeover mechanism. See
[SDK cancellation evidence](/docs/sdk-cancellation.md) before changing the
adapter or the transport's stream-consumption lifecycle.

## Operational pitfalls

- An explicitly selected workspace is not a sandbox. The gateway runs OpenCode
  as the invoking user, and workspace configuration can enable tools, plugins and MCP. It
  rejects only permission requests that actually reach its ACP callback. Review
  effective configuration; use OS isolation when the workspace or callers are untrusted.
- The HTTP listener has no authentication. Keep it on loopback and never expose it
  through a public proxy; loopback alone is not protection from other local users.
- ACP stdout is protocol-only. Drain stderr without publishing provider diagnostics.
  Use the prompt response, not quiet output or HTTP admission, as the completion signal.
- A timeout or dispatched cancellation is not confirmed cancellation. Preserve
  the original task outcome and context binding; never retry an uncertain prompt.
- Close owned subprocess groups and listeners without affecting unrelated services.
  OpenCode's private lease needs stdin EOF and a grace period before escalation.
  Process-group probe `EPERM` is inconclusive, not proof of cleanup.
- OpenCode V2 precedence, verified against the installed executable (2.3.2): global `policies` outrank project ones, so project config cannot lift a hard denial; agent `permissions` do the opposite (order: defaults, global, project, global agent, project agent), so a project agent rule beats the gateway's. `execute` (Code Mode) is not hard-deniable by policy even though a nested `fetch` is; hence the preflight agent check. `OPENCODE_CONFIG_CONTENT` ranks above project agents but appears as a pathless source that preflight rejects, and the CLI does not use it. A hard policy denial removes the tool or returns "Blocked by configuration policy" without a prompt.
- `supervised` stays withheld: it needs agent-level `shell: ask`, which project agent configuration can override and an approved command or edit can rewrite for the next launch. Releasing it needs trusted approval routing or OS sandboxing; see the evidence in [acceptance](acceptance.md).
- Private HOME and workspace configuration alone do not prove OS isolation. CLI
  preflight rejects managed Linux configuration and ancestor config and inspects
  effective sources, but project instructions and integrations remain trusted.

## Operator policy file and persistent state

Opt-in `--policy-file` and `--state-dir` (startup-only, private runtime only) are specified in [operator-policy-state.md](operator-policy-state.md): exact reviewed allow exceptions appended after the base, verified effective by preflight; one workspace-bound, single-owner state directory whose authority rows are cleared every launch. They add no scheduler, policy service, reload or A2A-visible control.

### Known OpenCode flake

OpenCode 2.3.2 intermittently (about 1 in 25 `debug agents` calls, also on `main`) omits the private
global config for a single process. Preflight therefore retries only the `debug agents` probe up to
three times in fresh processes (short backoff) and prints a sanitized note when a retry was needed; a
deterministic project weakening fails all three. Preflight observes one process while the ACP child
is another, so in such a window only the hard `policies` layer is guaranteed. A red `make
policy-smoke` should be re-run once before investigating.

## Deliberately unsupported

OpenCode HTTP adapters, ACP v2, rich file/image inputs, tool inputs/outputs and reasoning by default (the opt-in `--publish-activity` publishes tool call ids, titles, kinds, statuses and reasoning text), interactive forms and any permission handling beyond the opt-in single `allow_once`/reject question, request-scoped models or workspaces, parallel prompts, authentication/multi-tenancy, push notifications, outbound A2A, durable task/session recovery, replay, databases and distributed scheduling. The existing Python fork is unchanged. The loopback listener is for an operator-controlled trusted workspace, not an untrusted public endpoint.
