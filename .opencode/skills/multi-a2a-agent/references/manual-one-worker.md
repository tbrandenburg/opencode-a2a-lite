# Manual one-worker MCP→A2A runbook

**Status:** Current supported manual baseline. One two-turn real-model pass was observed; it does not establish repeatability. This tests the adapter path and marker continuity, not a multi-worker topology.

**Canonical exact recipe:** [examples/agent-network/README.md — Manual one-worker CLI smoke](../../../../examples/agent-network/README.md#manual-one-worker-cli-smoke). Use that source for the reviewed configuration fragments, prompt text, API filters, and cleanup commands; do not reconstruct them from memory.

## 1. Authorize and prepare

- Obtain separate billable opt-in for this attempt.
- Review one trusted worker project and a distinct trusted coordinator project, their inherited OpenCode configuration, provider/model setup, and any environment overrides. Do not copy or print credentials.
- Use Bun 1.3.9, OpenCode 2.0.28, checksummed a2abridge 4.0.2, and A2A 1.0 as pinned in the canonical recipe. Build the repository.
- Create fresh mode-0700 disposable state and private HOME/XDG directories. Export `HOME` first; derive XDG paths in a later command; confirm `opencode debug paths` stays inside the disposable state before changing any service setting. Never alter MADE's shared OpenCode service or `service.json` registration.
- Check the chosen loopback ports are free. Do not stop another owner's listeners.

## 2. Start the worker and directory

- Configure a named worker with tools denied and the reviewed existing provider/model configuration.
- Start the compiled gateway on loopback and verify its actual ready URL, agent card, A2A 1.0 interface, identity, description, and tags.
- Start the loopback A2A directory in its own private HOME. Register only the exact worker URL and keep its heartbeat active.
- Worker gateway, directory, heartbeat, and project-local config are expected setup steps. Their absence before setup is not a reason to stop; missing trust, provider access, actual tools, or review evidence are real blockers.

## 3. Configure guarded MCP and warm OpenCode

- Merge the canonical project-local coordinator config. Keep the endpoint guard, exact peer allowlist, secret stripping, attempt budget, and exactly six network tools. The gateway is A2A HTTP, not a remote MCP server.
- Start an owned coordinator `opencode serve` on loopback with its private HOME. Never apply this isolation or its service settings to MADE's existing service.
- Warm that same server using the recipe's bounded read-only agent/MCP probes. Require the exact coordinator identity, `network` connected, and the guard's six-tool catalog receipt before any model prompt. Pending status is not ready; repeat probes only within the recipe's 30-second startup deadline. Do not substitute a fixed sleep.
- Run the recipe's exact two-turn prompt against that same server with `opencode run --server ...`; do not use cold `--standalone` for this smoke.

## 4. Supervise one attempt

- Externally enforce each absolute 30-second submit-plus-wait deadline and observe poll spacing. A prompt instruction or whole-invocation timeout alone is not equivalent. If these bounds cannot be supervised, do not submit and mark bounded-wait status `BLOCKED`.
- First send: `blocking:false`, approved peer, no context/task handles. Preserve the actual returned context and task handles. Poll that task to terminal and inspect its stored artifact before continuing.
- Follow-up: same peer, actual returned context, omit the prior task ID, use a new nonblocking send, then poll its new task to terminal and inspect the artifact.
- Count every attempt, including denials; stop ordinary calls at 32/40 to preserve the eight-call reserve. At most eight spaced polls per turn. No retries, resend, reconnect, guessed handles, or implicit cancellation.

## 5. Review independent evidence

Verify actual paired MCP tool calls, exact dispatched and worker-received inputs, same-peer/context provenance, distinct task IDs, terminal states, stored artifacts, worker root-session messages, coordinator tool records, and marker continuity. Follow all message-list cursors. Use session analysis to correlate the actual coordinator and worker sessions; do not infer from A2A IDs or the newest session alone.

Report OpenCode/MCP readiness, adapter protocol results, model answer behavior, and operations separately. A correct task does not erase another failed gate; a wrong model answer does not by itself prove adapter failure. Missing evidence remains `INCOMPLETE`.

## 6. Clean up and retain privacy

Close the coordinator client, owned server, and MCP connection. Stop heartbeat, unregister while the directory remains up, record and require HTTP 204, then stop the owned gateway and directory. Verify owned process exit and every recorded port is released before removing state. Publish only sanitized checks; keep raw prompts, answers, handles, receipts, and diagnostics private.

## Adapter boundary fallback

If OpenCode/MCP tool exposure blocks the real model-issued call, classify that blocker rather than calling it an adapter failure. The provider-free `A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test` uses the real bridge/gateway with a controlled ACP peer to exercise the adapter boundary; label it provider-free and do not claim model or topology acceptance.
