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
2. For the currently supported manual baseline, follow [manual-one-worker.md](references/manual-one-worker.md).
3. Run live inference only when it is part of the current user-requested task. The user monitors provider spend; do not ask for separate per-attempt billing approval. Use the pinned tools, trusted projects, private disposable state, loopback listeners, endpoint guard, exact peer/tool allowlists, and a warmed owned OpenCode server. Never use a cold `--standalone` invocation for the smoke.
4. Supervise each absolute submit-plus-wait deadline and poll spacing externally. A prompt or a whole-invocation timeout is not a substitute. If bounds cannot be enforced, do not submit; report the bounded-wait gate as `BLOCKED`.
5. Verify actual paired MCP tool calls, peer/context/task provenance, terminal A2A tasks and artifacts, worker inputs, and correlated coordinator/worker sessions. Never treat CLI exit zero or model self-report as evidence by itself.
6. Report four dimensions separately: OpenCode/MCP readiness, A2A adapter contract, topology/model behavior, and owned-resource operations. If OpenCode or MCP prevents a call, classify that blocker without calling it an adapter failure. If the adapter works but the topology answer or schedule fails, preserve both findings independently.
7. Load the `session-analysis` skill and manually inspect/correlate the actual coordinator and worker sessions, private MCP receipts, and task evidence. Use the agent's reasoning to classify what happened; do not use a hard-coded script to score topology behavior or interpret sessions. Keep raw prompts, answers, reasoning, credentials, handles, and provider diagnostics private; publish only sanitized results.
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

OpenCode is the topology coordinator: instruct it with prompts and require it to use guarded MCP calls to actual A2A agents. Do not implement a TypeScript/host-side coordinator, direct A2A CLI calls, Dagu/workflow infrastructure, or the retired managed runner. The currently executable manual recipe covers one worker; multi-worker pages remain stubs until their issues add reviewed steps.

## Manual topology execution and analysis

Step through each topology manually: prepare the worker projects/configuration and directory using the linked playbook, start the owned gateway/guard resources, warm the owned OpenCode server, then run one coordinator prompt with `opencode run --server`. OpenCode—not a helper script—must choose and issue each topology action through MCP to the actual A2A agents. Inspect the resulting coordinator/worker sessions and task evidence yourself with `session-analysis`, then classify the adapter and topology layers separately.

Scripts are permitted only as helpers for transport/endpoint guarding, readiness/port probes, secret-safe receipt handling, or owned-process cleanup. Do not add or run scripts that create topology schedules, issue model prompts/tool calls, score model answers, or analyze session histories. Do not extend optional interop support for topology orchestration.

## Best-effort topology research

Treat each topology as a bounded adapter investigation, not a requirement to make the topology solve its task. Make one baseline `opencode run` attempt, then allow at most **three targeted correction attempts**; stop after two if another attempt would only polish topology behavior or produce no new adapter evidence. Do not ask for separate billing approval for each correction; the user monitors provider spend. Never automatically retry, resend an uncertain task, reconnect to escape a budget, change timeouts/budgets, or weaken an adapter contract.

Preserve the baseline prompt/setup and change one prompt-level or documented configuration factor per correction. Do not write TypeScript or extend optional interop support to make a topology pass. If OpenCode/MCP blocks tool exposure, report that layer; if A2A calls/tasks/artifacts pass but the topology answer or schedule does not, report the adapter as working and the topology outcome separately. A correctly classified, bounded experiment is useful even when the topology does not work; after the cap, stop and record `BLOCKED`, `BROKEN`, or `INCOMPLETE` with the evidence rather than continuing indefinitely.

`A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test` exercises the real bridge and controlled ACP adapter boundary without a provider. It is useful for isolating adapter behavior when OpenCode/MCP blocks a model-issued call, but it is not live-model or topology acceptance evidence.
