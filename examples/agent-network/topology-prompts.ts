import type { Step } from "./topology-cases.js";
import type { StepExpectation } from "./topology-receipts.js";
import { roleInstructions } from "./topology-semantics.js";

export const topologySystem = `You are a coordinator in a fixed-schedule topology experiment, not an autonomous topology selector.
Only model-issued network MCP calls may contact workers. No native agents, shell, files, web, Code Mode or alternative transport.
Use only a2a_list_agents, a2a_send_message (blocking:false), and a2a_get_task. Never cancel remotely.
Never resend a submission after error or absent handle. Return INCOMPLETE instead. Keep actual returned contextId and task id.
Continuation uses returned context_id on the same peer and MUST omit task_id. Never guess or replace a context.
Execute only this host-declared stage, then stop. Submit independent stage tasks together before waiting, so real execution overlaps.
Each declared case owns one connection with 40 attempts; stop ordinary work at 32, reserving eight for intervention. Never reconnect.
Host readiness observes worker completion in memory; it does not call workers for you. Host supplies hashes; do not calculate SHA256.
Worker inputs must be copied exactly as supplied. Never invent completion, proof, facts or handles.`;

export const envelopeInstructions = `Return ONLY JSON with exactly facts,inputHashes,proof,answer,evaluation.
facts is the deduplicated union of your private facts and inbound facts, without inventing or changing facts.
inputHashes is exactly the supplied map. proof merges cumulative inbound proof maps and this step's marker under its stepId.
Retain facts/proofs from your earlier turns in this same context. Do not include the separate worker identity proof in this proof map.
On nonfinal turns answer is null. On the final turn answer has exactly selected,cost,value,proof.
Solve the maximum-value indivisible subset of items A..F, each at most once; enforce bounds, dependencies, incompatibilities.
Cost must be >= minCost and <= capacity, including explicit zero capacity. Unknown facts are not permission to invent constraints.
The final answer proof must equal the cumulative proof map. selected is sorted. Explain nothing outside JSON.`;

export function turnText(
  turn: Step,
  expectation: StepExpectation,
  inbound: Record<string, { hash: string; output: string }>,
  final: boolean,
  facts?: object,
) {
  return JSON.stringify({
    instructions: envelopeInstructions,
    stepId: turn.id,
    role: turn.role,
    roleInstructions: roleInstructions(turn),
    marker: expectation.marker,
    final,
    inputHashes: Object.fromEntries(Object.entries(inbound).map(([id, entry]) => [id, entry.hash])),
    inbound: Object.fromEntries(Object.entries(inbound).map(([id, entry]) => [id, entry.output])),
    ...(facts ? { privateFacts: facts } : {}),
  });
}
