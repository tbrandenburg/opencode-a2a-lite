---
name: multi-a2a-agent
description: Use this skill to operate or evaluate the repository's A2A adapter from OpenCode through guarded MCP, including the supported one-worker smoke, topology-specific research, session evidence review, and OpenCode/MCP readiness diagnosis.
---

# Multi A2A Agent

Use OpenCode as the coordinator through the existing guarded route:

**OpenCode coordinator → local MCP endpoint guard → a2abridge → A2A gateway → ACP worker**

This skill guides use and evaluation of the adapter. It is not an orchestration runtime and does not add topology schedules, roles, scorers, runners, or platform features.

## Workflow

1. Identify the requested traffic pattern and read only its linked topology page. Treat topology pages marked `STUB` or `SCOPE-GATED` as incomplete instructions; do not invent missing steps.
2. For the currently supported manual baseline, follow [manual-one-worker.md](references/manual-one-worker.md) and its [full reviewed recipe](../../../examples/agent-network/README.md#manual-one-worker-cli-smoke).
3. Obtain separate billable opt-in for every live attempt. Use the pinned tools, trusted projects, private disposable state, loopback listeners, endpoint guard, exact peer/tool allowlists, and a warmed owned OpenCode server. Never use a cold `--standalone` invocation for the smoke.
4. Supervise each absolute submit-plus-wait deadline and poll spacing externally. A prompt or a whole-invocation timeout is not a substitute. If bounds cannot be enforced, do not submit; report the bounded-wait gate as `BLOCKED`.
5. Verify actual paired MCP tool calls, peer/context/task provenance, terminal A2A tasks and artifacts, worker inputs, and correlated coordinator/worker sessions. Never treat CLI exit zero or model self-report as evidence by itself.
6. Report four dimensions separately: OpenCode/MCP readiness, A2A adapter contract, topology/model behavior, and owned-resource operations. If OpenCode or MCP prevents a call, classify that blocker without calling it an adapter failure. If the adapter works but the topology answer or schedule fails, preserve both findings independently.
7. Analyze actual coordinator and worker session messages together with private receipts and task evidence. Keep raw prompts, answers, reasoning, credentials, handles, and provider diagnostics private; publish only sanitized results.
8. On every outcome, close the owned coordinator client/server and MCP connection; stop heartbeat, unregister the worker and record HTTP 204 while the directory is running; then stop the owned gateway and directory. Verify owned processes and every recorded port are released before removing private state.

## Topology pages

Load the relevant page only. Each page records historical evidence and adapter-focused questions; topology correctness is not an adapter acceptance criterion.

| Traffic pattern                                  | Page                                                                      | Status                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| One coordinator, one worker, two-turn continuity | [Manual one-worker](references/manual-one-worker.md)                      | Current manual baseline; one observed real-model pass, not a reliability claim |
| Pipeline                                         | [Pipeline](references/topology-pipeline.md)                               | Research stub                                                                  |
| Fan-out / fan-in                                 | [Fan-out/fan-in](references/topology-fan-out-fan-in.md)                   | Historical feasibility; fresh current-path test not established                |
| Diamond                                          | [Diamond](references/topology-diamond.md)                                 | Research stub                                                                  |
| Propose–critique–revise                          | [Propose–critique–revise](references/topology-propose-critique-revise.md) | Historical role-contract failure; details incomplete                           |
| Competing proposals / judge                      | [Judge](references/topology-competing-proposals-judge.md)                 | Historical inbound-integrity failure; final judge result unobserved            |
| Bounded ring                                     | [Bounded ring](references/topology-bounded-ring.md)                       | Research stub                                                                  |
| Decentralized tree                               | [Tree](references/topology-decentralized-tree.md)                         | Scope-gated; worker-side delegation is outside current scope                   |
| Decentralized mesh                               | [Mesh](references/topology-decentralized-mesh.md)                         | Scope-gated; worker-side delegation is outside current scope                   |

## Progressive disclosure and orchestration

The linked GitHub issues are the work queue for adding topology steps one at a time. Add only reviewed, evidenced adapter-focused instructions to the matching page; leave unsupported procedures visibly incomplete. Do not copy the retired managed lab into this skill.

Manual use of `opencode run --server` is documented for one worker. Orchestrated multi-worker runs are not currently supported: keep them blocked until a separate scope decision authorizes them. Do not restore retired runners or add Dagu/workflow infrastructure, schedules, roles, scorers, dependencies, models, or expanded budgets/timeouts.

`A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test` exercises the real bridge and controlled ACP adapter boundary without a provider. It is useful for isolating adapter behavior when OpenCode/MCP blocks a model-issued call, but it is not live-model or topology acceptance evidence.
