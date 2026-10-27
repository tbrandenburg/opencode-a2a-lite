import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Step } from "./topology-cases.js";
import type { StepExpectation, StepReceipt, ObservedState } from "./topology-receipts.js";
import {
  isRecord,
  isProof,
  isFinalAnswer,
  type TurnOutput,
  type Fact,
} from "./topology-workloads.js";
import type { WorkerObservation } from "./workers.js";
import { SubmissionError } from "./topology-failures.js";
import type { Check } from "./topology-scores.js";

export const sha256 = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
export type Audit = Record<string, unknown>;
export function parseTurn(text: string): TurnOutput {
  const value: unknown = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  assert(isRecord(value), "Invalid worker envelope");
  assert.equal(
    ["answer,facts,inputHashes,proof", "answer,evaluation,facts,inputHashes,proof"].includes(
      Object.keys(value).sort().join(),
    ),
    true,
    "Invalid envelope keys",
  );
  assert(
    Array.isArray(value.facts) &&
      value.facts.every((fact: unknown) => isRecord(fact) && typeof fact.id === "string"),
    "Invalid facts",
  );
  assert(isProof(value.proof) && isProof(value.inputHashes), "Invalid proof/hash maps");
  assert(Object.values(value.inputHashes).every((hash) => /^[a-f0-9]{64}$/.test(hash)));
  assert(value.answer === null || isFinalAnswer(value.answer), "Invalid final answer");
  return value as unknown as TurnOutput;
}
export function verifyContributions(text: string, contributions: readonly (readonly Fact[])[]) {
  const expected = contributions.flat().filter((fact, index, facts) => {
    const prior = facts.findIndex((other) => other.id === fact.id);
    assert.deepEqual(fact, facts[prior], "Conflicting inbound facts");
    return prior === index;
  });
  const ordered = (facts: readonly Fact[]) =>
    [...facts].sort((left, right) => left.id.localeCompare(right.id));
  assert.deepEqual(
    ordered(parseTurn(text).facts),
    ordered(expected),
    "Missing or conflicting contribution",
  );
}
export function observedState(state: unknown): ObservedState {
  if (state === "TASK_STATE_COMPLETED") return "completed";
  if (state === "TASK_STATE_FAILED") return "failed";
  if (state === "TASK_STATE_REJECTED") return "rejected";
  if (state === "TASK_STATE_CANCELED") return "canceled";
  if (
    [
      "TASK_STATE_SUBMITTED",
      "TASK_STATE_WORKING",
      "TASK_STATE_INPUT_REQUIRED",
      "TASK_STATE_AUTH_REQUIRED",
    ].includes(String(state))
  )
    return "pending";
  return "unknown";
}
export function pairedResult(call: Audit, audit: readonly Audit[]): Audit | undefined {
  const results = audit.filter(
    (entry) =>
      entry.event === "result" &&
      entry.connection === call.connection &&
      entry.id === call.id &&
      entry.tool === call.tool,
  );
  return results.length === 1 ? results[0] : undefined;
}
export function submission(expectation: StepExpectation, text: string, audit: readonly Audit[]) {
  const calls = audit.filter(
    (entry) =>
      entry.event === "call" &&
      entry.tool === "a2a_send_message" &&
      entry.peer === expectation.peerUrl &&
      (entry.context ?? null) === (expectation.submittedContextId ?? null),
  );
  if (calls.length === 0) throw new SubmissionError("submission-missing");
  if (calls.length > 1) throw new SubmissionError("submission-repeated");
  if (calls[0]!.inputHash !== sha256(text)) throw new SubmissionError("submission-modified");
  return { call: calls[0]!, result: pairedResult(calls[0]!, audit) };
}
export function workerReceipt(
  turn: Step,
  expected: StepExpectation,
  text: string,
  observation: WorkerObservation | undefined,
  audit: readonly Audit[],
): StepReceipt {
  const sent = submission(expected, text, audit);
  const result = sent.result;
  const observations = audit.filter(
    (entry) =>
      entry.event === "result" &&
      entry.connection === sent.call.connection &&
      entry.taskId === result?.taskId &&
      entry.contextId === result?.contextId,
  );
  const latest = observations.at(-1);
  const output = observation ? parseTurn(observation.output) : undefined;
  if (observation) {
    assert.equal(observation.input, text, "Worker input changed");
    assert.equal(observation.taskId, result?.taskId, "Task handle mismatch");
    assert.equal(observation.contextId, result?.contextId, "Context handle mismatch");
    if (observedState(latest?.state) === "completed")
      assert.equal(latest?.artifactHash, sha256(observation.output), "Observed artifact mismatch");
  }
  return {
    stepId: turn.id,
    peerUrl: expected.peerUrl,
    contextId: typeof result?.contextId === "string" ? result.contextId : null,
    taskId: typeof result?.taskId === "string" ? result.taskId : null,
    submittedContextId: typeof sent.call.context === "string" ? sent.call.context : null,
    taskIdOmitted: sent.call.taskIdOmitted === true,
    state:
      typeof result?.taskId === "string" && typeof result.contextId === "string"
        ? observedState(latest?.state)
        : "uncertain",
    started: observation?.started ?? 0,
    ended: observation?.ended ?? 0,
    outputHash: observation ? sha256(observation.output) : "",
    proof: output?.proof ?? {},
    inputHashes: output?.inputHashes ?? {},
  };
}

export function auditOperations(
  audit: readonly Audit[],
  expected: readonly Pick<StepExpectation, "peerUrl" | "inputHash">[],
  baseline: boolean,
) {
  const catalogs = audit.filter((entry) => entry.event === "catalog");
  const ids = [...new Set(audit.map((entry) => entry.connection))];
  const calls = audit.filter((entry) => entry.event === "call");
  const sends = calls.filter((entry) => entry.tool === "a2a_send_message");
  const rejections = audit.filter((entry) => entry.event === "rejected");
  const unique = sends.every(
    (entry) =>
      sends.filter((other) => other.inputHash === entry.inputHash && other.peer === entry.peer)
        .length === 1,
  );
  const extra = sends.some(
    (entry) =>
      sends.filter((other) => other.peer === entry.peer).length >
      expected.filter((input) => input.peerUrl === entry.peer).length,
  );
  const uncertainResend = sends.some((entry, index) => {
    const result = pairedResult(entry, audit);
    const resolved =
      result?.ok === true &&
      typeof result.taskId === "string" &&
      typeof result.contextId === "string";
    return sends
      .slice(index + 1)
      .some(
        (next) =>
          next.peer === entry.peer && (!resolved || audit.indexOf(result!) > audit.indexOf(next)),
      );
  });
  const captured =
    catalogs.length > 0 &&
    ids.length === 1 &&
    sends.every((entry) => typeof entry.peer === "string" && typeof entry.inputHash === "string");
  const noUncertainResends: Check = baseline
    ? sends.length === 0
      ? "pass"
      : "fail"
    : uncertainResend
      ? "fail"
      : captured
        ? "pass"
        : "unknown";
  return {
    connections: ids.map((id) => ({
      calls: audit.filter(
        (entry) => entry.connection === id && ["call", "rejected"].includes(String(entry.event)),
      ).length,
      interventionCalls: 0,
    })),
    guardedPath: baseline
      ? audit.length === 0
      : catalogs.length > 0 &&
        ids.length === 1 &&
        calls.length > 0 &&
        calls.every((call) => pairedResult(call, audit)?.ok === true) &&
        rejections.length === 0,
    noHiddenRetries:
      unique && !extra && (baseline ? sends.length === 0 : catalogs.length > 0 && ids.length === 1),
    inputIntegrity: sends.every((entry) =>
      expected.some((input) => input.peerUrl === entry.peer && input.inputHash === entry.inputHash),
    ),
    noUncertainResends,
    safeCalls:
      sends.every((call) => call.blocking === false && call.taskIdOmitted === true) &&
      calls.every((call) =>
        ["a2a_list_agents", "a2a_whoami", "a2a_send_message", "a2a_get_task"].includes(
          String(call.tool),
        ),
      ),
  };
}
