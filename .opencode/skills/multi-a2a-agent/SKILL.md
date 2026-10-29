---
name: multi-a2a-agent
description: Coordinate agents through guarded MCP and A2A adapters. Use for pipeline, bounded ring, propose-critique-revise, judge, fan-out/fan-in, diamond, tree, or mesh workflows, including readiness, task/artifact verification, bounded supervision, and owned cleanup.
---

# Multi-Agent A2A Workflows

Adapt commands, component names, and operational steps to the host project. Keep reusable coordination patterns here; keep concrete instance layouts, endpoints, tool names, versions, budgets, authorization, and run evidence in the host project's runbook.

## Select one topology

Read this common workflow first, then load only the matching reference. These are
procedural templates, not recovered verbatim prompts, executable runners, or evidence
that a particular scale works. Require the host's approved instance/edge map before
execution; do not infer missing peers or increase a prior experiment's limits.

| Need                                                        | Reference                                                                       | Control                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| Forward each completed result to the next stage             | [Pipeline](references/topology-pipeline.md)                                     | Coordinator relays every hop                        |
| Close a bounded relay in the starting worker's context      | [Bounded ring](references/topology-bounded-ring.md)                             | Coordinator relays every hop                        |
| Return an actual critique to the original proposer          | [Propose–critique–revise](references/topology-propose-critique-revise.md)       | Coordinator relays and continues proposer context   |
| Compare independent proposals through a separate judge      | [Competing proposals / judge](references/topology-competing-proposals-judge.md) | Coordinator gathers and forwards original artifacts |
| Collect independent contributions for coordinator synthesis | [Fan-out / fan-in](references/topology-fan-out-fan-in.md)                       | Coordinator dispatches and collects                 |
| Branch a common input, then join separate reviews           | [Diamond](references/topology-diamond.md)                                       | Coordinator preserves branch identities at the join |
| Delegate through parent-child-only peer links               | [Decentralized tree](references/topology-decentralized-tree.md)                 | Worker sessions issue child calls                   |
| Exercise selected peer links without unbounded propagation  | [Decentralized mesh](references/topology-decentralized-mesh.md)                 | Worker sessions issue a finite peer-call wave       |

## Identify the architecture before execution

Establish the actual control and data paths. A common arrangement is:

```text
OpenCode coordinator
  → OpenCode MCP client
  → local MCP server or endpoint guard
  → MCP-to-A2A client/bridge
  → A2A HTTP agent endpoint
  → protocol adapter
  → worker runtime/session
```

The host project may use different names or combine components. Identify which component enforces tool/peer policy, which translates MCP operations to A2A, and which adapts A2A requests to the worker protocol. Treat a discovery directory as control-plane infrastructure unless evidence shows task traffic passes through it.

Before a run, require a topology specification that names:

- Every coordinator, worker, judge, relay, and adapter instance, including its process/session boundary.
- Each directed logical message edge and the exact physical route used to carry it.
- Which model/session issues each MCP call; whether workers can call other workers; and how results return.
- The A2A endpoint and ACP or other worker endpoint associated with each agent instance.
- The guard's permitted tool set and exact peer allowlist for each caller.
- How context IDs, task IDs, artifacts, deadlines, and terminal states are correlated.

Keep concrete topology layouts, endpoint values, and allowlists specific to the host project and run; record them in the project's issue or operational documentation, not in this reusable skill. The linked references describe generic patterns only.

Do not infer missing nodes, edges, roles, permissions, or termination rules from a topology name alone. Ask for a missing specification or report the run blocked.

## Prepare and run

1. Read the request, the topology specification, and the host project's operational guidance. Separate model/task goals from adapter acceptance criteria.
2. Prepare and review owned coordinator/worker projects using the host runbook; do not mistake missing disposable setup for a blocker. Review inherited configuration, provider access, worker identities, cards, and exact tool/peer allowlists. Do not expose credentials or modify shared service state.
3. Check free loopback ports before starting anything. Start only owned resources, keep listeners private, and record their PIDs, ports, endpoint URLs, and returned task/context handles privately.
4. Use OpenCode as coordinator when the topology requires model-directed calls. Calls must traverse the configured MCP guard and adapter path; do not silently substitute a host script, direct protocol client, or a different delegation mechanism.
5. Enforce per-operation deadlines, poll spacing, and attempt limits with an independent supervisor. A prompt instruction or whole-process timeout is not equivalent. If limits cannot be supervised, do not submit work.
6. Never automatically retry or resend an uncertain submission, guess a handle, reconnect to evade a budget, or infer remote cancellation from local client shutdown.

Before a model prompt, verify the intended agent and connected tools on the actual
server used by that session. Inspect worker readiness separately when workers can
delegate; warming a different inspection server does not warm an ACP-owned server.
A catalog is a readiness signal, not proof that the model called a tool.

Map the following contract to the host's actual tool schema once, then apply it to
every hop, including worker-originated calls:

- Explicitly set the tool's nonblocking submission parameter; do not rely on defaults
  or the word "nonblocking" in prose. Forward the explicit argument requirement in
  child-task instructions and verify the actual worker arguments afterward.
- Bind a returned handle to its exact peer, context and task. Start independent
  workers with fresh contexts. For continuation, use the actual returned context;
  where the adapter requires a new task, omit the prior task ID and verify a new one.
- Wait only through the supported task-observation tool. Require a terminal completed
  task and stored artifact before forwarding it as a result. Retain failed, pending,
  uncertain or unexpected states without inventing success or a replacement task.
- Budget polls and elapsed time independently under the reviewed limits. A smaller
  invented poll cap can exhaust before the deadline; a higher cap cannot extend it.
  Supervise each nested operation and its ancestors, including across connections.
- Preserve artifact text and source attribution. Do not paraphrase, normalize, or
  silently substitute a predecessor's artifact when a downstream worker needs it.

## Verify and report

Inspect actual coordinator and worker sessions, paired MCP call/result records, peer/context/task provenance, worker inputs, terminal task states, stored artifacts, and owned-resource cleanup. A catalog entry, successful CLI exit, or model self-report alone is not acceptance evidence.

Report these layers separately:

- OpenCode readiness and MCP tool exposure.
- Guard and adapter behavior, based on observed calls and results.
- Topology execution and model/task outcome.
- Resource operations and cleanup.

Classify missing or ambiguous evidence as `BLOCKED` or `INCOMPLETE`; do not turn a topology/model failure into an adapter failure or vice versa. Keep prompts, answers, credentials, raw receipts, and provider diagnostics private. Publish only sanitized evidence.

## Clean up

On success, failure, timeout, or interruption, close owned clients and MCP connections; stop owned heartbeats; unregister workers while their directory is still available; then stop owned gateways and directory processes in dependency order. Verify exact owned PIDs and every recorded listener are gone before removing private state. Never stop or reconfigure another owner's process or shared service.
