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
- **ACP v1:** run the OpenCode executable as a subprocess using newline-delimited JSON-RPC on stdin/stdout; stdout is protocol-only and stderr is the logging channel. Supply an absolute working directory. OpenCode 2.0.28 documents ACP protocol version 1, `session/new`, `session/prompt`, `session/cancel`, updates, and permission callbacks. See [ACP v1 initialization](https://agentclientprotocol.com/protocol/v1/initialization), [session setup](https://agentclientprotocol.com/protocol/v1/session-setup), [prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn), [cancellation](https://agentclientprotocol.com/protocol/v1/cancellation), and [OpenCode ACP docs](https://opencode.ai/v2/docs/cli/acp).
- **Turn completion:** ACP v1 `session/prompt` returns `PromptResponse.stopReason`. Use the response for that prompt as the authoritative completion signal, not a quiet stream or unrelated event. The MVP policy treats only `end_turn` as successful; explicitly map other defined stop reasons to truthful non-success outcomes. [ACP v1 prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn).
- **Correlation:** retain explicit mapping between A2A task, ACP session, and in-flight prompt. In the existing fork HTTP V2 probe, admission/delivery IDs did not correlate later assistant/terminal events; they are not substitutes for protocol task/session correlation. Treat that observation as fork-specific evidence, not a general protocol rule.

## Project policy (not protocol requirements)

Keep v1 scope narrow: map each A2A context to one ACP session in memory, reuse it for follow-up tasks while the gateway is running, and admit only one active prompt globally. Bound the number of sessions; restart recovery is unsupported. Deny unsupported interactive permission requests rather than silently approving them, and advertise only implemented capabilities in the Agent Card. These are implementation choices, not mandates imposed by ACP or A2A.

## Implementation boundaries

- `server.ts` composes the SDK, gates readiness on ACP, preserves explicit context intent through public SDK methods, and owns HTTP shutdown.
- `executor.ts` holds the bounded context map and single admission slot, publishes task/working/artifact/terminal events, and uses the prompt response as its outcome.
- `acp-client.ts` owns the pinned subprocess, persistent stable-v1 connection, update filtering, permission denial, deadlines and process cleanup. It never retries an uncertain prompt.
- `request-handler.ts` keeps the SDK's `InMemoryTaskStore` but synchronizes cancellation with its original event consumer; this avoids SDK 1.3 duplicate artifact persistence. This narrow workaround is regression-tested, not a second task database.

The cancellation adapter depends on the original SDK persistence consumer staying
alive. Explicitly closing the public SDK stream generator is distinct from an
HTTP client disconnect and is not a supported takeover mechanism. See
[SDK cancellation evidence](/docs/sdk-cancellation.md) before changing the
adapter or the transport's stream-consumption lifecycle.

## Deliberately unsupported

OpenCode HTTP adapters, ACP v2, rich file/image inputs, reasoning/tool output, interactive permission/forms, request-scoped models or workspaces, parallel prompts, authentication/multi-tenancy, push notifications, outbound A2A, durable task/session recovery, replay, databases and distributed scheduling. The existing Python fork is unchanged. The loopback listener is for an operator-controlled trusted workspace, not an untrusted public endpoint.
