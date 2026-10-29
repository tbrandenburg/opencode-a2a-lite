---
name: multi-a2a-agent
description: Plan, operate, and evaluate multi-agent workflows coordinated by OpenCode through MCP and A2A adapters.
---

# Multi-Agent A2A Workflows

Use this skill when OpenCode coordinates agents through MCP tools and an A2A-to-agent runtime adapter. Adapt every command, component name, and operational step to the host project; this skill defines no project-specific endpoint, tool name, version, topology, or runbook.

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

Keep topology layouts, endpoint values, and allowlists specific to the host project and run; record them in the project's issue or operational documentation, not in this reusable skill.

Do not infer missing nodes, edges, roles, permissions, or termination rules from a topology name alone. Ask for a missing specification or report the run blocked.

## Prepare and run

1. Read the request, the topology specification, and the host project's operational guidance. Separate model/task goals from adapter acceptance criteria.
2. Review trusted projects, inherited configuration, provider access, worker identities, endpoint cards, peer allowlists, and the actual connected MCP tool catalog. Do not expose credentials or modify shared service state.
3. Check free loopback ports before starting anything. Start only owned resources, keep listeners private, and record their PIDs, ports, endpoint URLs, and returned task/context handles privately.
4. Use OpenCode as coordinator when the topology requires model-directed calls. Calls must traverse the configured MCP guard and adapter path; do not silently substitute a host script, direct protocol client, or a different delegation mechanism.
5. Enforce per-operation deadlines, poll spacing, and attempt limits with an independent supervisor. A prompt instruction or whole-process timeout is not equivalent. If limits cannot be supervised, do not submit work.
6. Never automatically retry or resend an uncertain submission, guess a handle, reconnect to evade a budget, or infer remote cancellation from local client shutdown.

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
