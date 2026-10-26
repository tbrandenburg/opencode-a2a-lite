# Architecture pitfalls

Practical review notes for implementation; protocol requirements and local policy are identified separately.

| Pitfall                                                        | Consequence                                                                                | Guardrail                                                                                                                                                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Treating request acceptance/delivery as task completion        | A2A clients see success while OpenCode is still working, or never receive terminal status. | Keep A2A task lifecycle open until the ACP turn reaches its version-correct completion signal. The fork probe observed no reliable admission/delivery-ID correlation to later assistant/terminal events; do not assume otherwise. |
| Treating ACP updates as a replacement for the v1 prompt result | A waiter can hang or report completion prematurely.                                        | **Protocol:** use the response to `session/prompt` and its `stopReason` as the turn completion boundary; OpenCode 2.0.28 documents ACP protocol v1.                                                                               |
| Treating an absent update or quiet stdout as completion        | Buffered/slow turns can be truncated; stderr or process exit may indicate failure instead. | **Policy:** await explicit completion or a typed failure/cancellation, with bounded timeout and process-exit handling. Never infer success from silence.                                                                          |
| Writing logs or banners to ACP stdout                          | The peer cannot parse the NDJSON stream.                                                   | **Protocol:** stdout contains valid ACP messages only; send diagnostics to stderr. Each stdio message is newline-delimited JSON.                                                                                                  |
| Using a relative or missing working directory                  | OpenCode may reject session creation or execute against an unintended directory.           | **Protocol:** provide an absolute `cwd`; validate/resolve it at the adapter boundary.                                                                                                                                             |
| Reusing an ACP session without a deliberate mapping policy     | Prompts and cancellation can affect the wrong A2A task or conversation.                    | Maintain explicit task↔session↔prompt correlation; define session ownership and concurrency before enabling reuse.                                                                                                                |
| Dropping permission callbacks or auto-approving                | Tools may stall awaiting permission or perform actions the caller did not authorize.       | **Protocol:** implement ACP permission requests and cancellation response. **Policy:** do not silently approve; define the caller-facing decision behavior.                                                                       |
| Assuming a temporary workspace config isolates OpenCode        | Global/managed policy, plugins, or MCP servers may still be active or take precedence.     | Verify effective configuration and isolate every config, plugin, and MCP source before a live prompt; workspace files alone do not prove the execution boundary.                                                                  |
| Advertising capabilities that are not wired end-to-end         | A2A clients select unsupported streaming/cancellation/features.                            | **Protocol:** Agent Card capability declarations describe actual server support; keep declarations conservative and test each advertised operation.                                                                               |
| Assuming an in-memory task store is durable                    | Restart loses task lookup and continuation state.                                          | **Policy:** acceptable only for an explicitly ephemeral first version; document it and replace it before claiming restart-safe task continuity.                                                                                   |
| Coding against old A2A JS examples                             | Removed app wrappers or changed handler/store signatures cause integration failures.       | Use the v1 SDK composition documented in its [migration guide](https://github.com/a2aproject/a2a-js/blob/main/docs/migration-guide.md), and verify exact installed package API in the implementation step.                        |

## References checked

Step 8 lifecycle checks also verified the pinned
[ACP handler](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/cli/src/commands/handlers/acp.ts)
and [private-server lease](https://github.com/anomalyco/opencode/blob/v2.0.28/packages/cli/src/services/standalone.ts).
ACP starts its own standalone server, exits on connection closure, and releases
the private server through stdin EOF on its lease pipe. Give EOF a grace period
before signalling the owned process group; do not stop a shared OpenCode service.

Cancellation dispatch is not cancellation confirmation. Preserve root text until
the prompt response, and retain admission until cancellation writes settle so they
cannot land on a later turn. Permission callbacks during cancellation must return
`cancelled`, even when an explicit rejection is offered.

SDK 1.3's default cancellation event consumer reprocesses artifact appends while
the original execution consumer is active. The gateway's public-interface adapter
uses the existing consumer's terminal store save instead; regression tests require
exact stored text through cancellation and natural-completion races.
Do not replace that adapter with stock cancellation based only on a release
number. Verify the append reproducer and persistence ownership after explicit
generator closure, HTTP disconnect, and slow consumption as separate cases;
see [SDK cancellation evidence](/docs/sdk-cancellation.md).

- [ACP v1 initialization](https://agentclientprotocol.com/protocol/v1/initialization)
- [ACP v1 session setup](https://agentclientprotocol.com/protocol/v1/session-setup)
- [ACP v1 prompt turn and stop reasons](https://agentclientprotocol.com/protocol/v1/prompt-turn)
- [ACP v1 cancellation](https://agentclientprotocol.com/protocol/v1/cancellation)
- [OpenCode ACP documentation](https://opencode.ai/v2/docs/cli/acp)
- [A2A JS SDK sample](https://github.com/a2aproject/a2a-js/blob/main/src/samples/agents/sample-agent/index.ts)
- [A2A JS SDK migration guide](https://github.com/a2aproject/a2a-js/blob/main/docs/migration-guide.md)
- [OpenCode v2.0.28 release](https://github.com/anomalyco/opencode/releases/tag/v2.0.28)

**Uncertainty:** Context7 confirmed SDK v1 server components and ACP response/lifecycle shapes, but its available ACP client docs did not establish the current TypeScript `connect()` versus `connectWith()` signatures. Check the installed SDK declarations/API directly; use the long-lived `connect()` API for the gateway. A real two-prompt run against the installed OpenCode 2.0.28 executable remains required to prove compatibility.
