import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { envelopeMetadata, equivalentInput, inputDifference } from "./topology-envelope.js";
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
import { ContributionError, SubmissionError } from "./topology-failures.js";
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
  const actual = parseTurn(text).facts;
  const missing = expected.filter((fact) => !actual.some((entry) => entry.id === fact.id));
  const extra = actual.filter((fact) => !expected.some((entry) => entry.id === fact.id));
  const changed = actual.filter((fact) =>
    expected.some((entry) => entry.id === fact.id && !isDeepStrictEqual(entry, fact)),
  );
  const repeated = actual.filter(
    (fact, index) => actual.findIndex((entry) => entry.id === fact.id) !== index,
  );
  if (missing.length + extra.length + changed.length + repeated.length)
    throw new ContributionError(
      {
        missing: missing.length,
        extra: extra.length,
        changed: changed.length,
        repeated: repeated.length,
      },
      [
        ...new Set([...missing, ...extra, ...changed, ...repeated].map((fact) => sha256(fact.id))),
      ].slice(0, 16),
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
  if (typeof call.connection !== "string" || typeof call.id !== "string") return undefined;
  const results = audit.filter(
    (entry) =>
      entry.event === "result" &&
      entry.connection === call.connection &&
      entry.id === call.id &&
      entry.tool === call.tool,
  );
  return results.length === 1 ? results[0] : undefined;
}
export function correlateSubmission(
  expectation: StepExpectation,
  text: string,
  audit: readonly Audit[],
) {
  const expected = expectation.inputEnvelope ?? envelopeMetadata(text);
  const calls = audit.filter(
    (entry) =>
      entry.event === "call" &&
      entry.tool === "a2a_send_message" &&
      entry.peer === expectation.peerUrl &&
      (entry.context ?? null) === (expectation.submittedContextId ?? null),
  );
  if (calls.length === 0)
    throw new SubmissionError(
      audit.some(
        (entry) =>
          entry.event === "call" &&
          entry.tool === "a2a_send_message" &&
          equivalentInput(expected, entry.inputHash, entry.inputEnvelope),
      )
        ? "submission-binding"
        : "submission-missing",
    );
  if (calls.length > 1) throw new SubmissionError("submission-repeated");
  return { call: calls[0]!, result: pairedResult(calls[0]!, audit) };
}
export function submission(expectation: StepExpectation, text: string, audit: readonly Audit[]) {
  const expected = expectation.inputEnvelope ?? envelopeMetadata(text);
  const sent = correlateSubmission(expectation, text, audit);
  if (
    (expectation.inputHash !== undefined && expectation.inputHash !== expected.rawHash) ||
    !equivalentInput(expected, sent.call.inputHash, sent.call.inputEnvelope)
  )
    throw new SubmissionError(
      "submission-modified",
      inputDifference(expected, sent.call.inputHash, sent.call.inputEnvelope),
    );
  return sent;
}
export function workerReceipt(
  turn: Step,
  expected: StepExpectation,
  text: string,
  observation: WorkerObservation | undefined,
  audit: readonly Audit[],
): StepReceipt {
  if (observation) expected.workerInputHash = sha256(observation.input);
  const sent = submission(expected, text, audit);
  const result = sent.result;
  if (sent.call.context !== undefined && result?.contextId !== undefined)
    assert.equal(result.contextId, sent.call.context, "Continuation handle mismatch");
  const observations = audit.filter(
    (entry) =>
      entry.event === "result" &&
      entry.connection === sent.call.connection &&
      entry.taskId === result?.taskId &&
      entry.contextId === result?.contextId &&
      (entry === result ||
        audit.some(
          (call) =>
            call.event === "call" &&
            call.tool === "a2a_get_task" &&
            call.peer === expected.peerUrl &&
            call.task === result?.taskId &&
            pairedResult(call, audit) === entry,
        )),
  );
  const latest = observations.at(-1);
  const output = observation ? parseTurn(observation.output) : undefined;
  if (observation) {
    assert.equal(observation.role, turn.actor, "Worker peer role mismatch");
    assert.equal(sha256(observation.input), sent.call.inputHash, "Worker input changed");
    assert(
      equivalentInput(
        expected.inputEnvelope ?? envelopeMetadata(text),
        sha256(observation.input),
        envelopeMetadata(observation.input),
      ),
      "Worker envelope changed",
    );
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
  expected: readonly Pick<
    StepExpectation,
    "peerUrl" | "inputHash" | "inputEnvelope" | "submittedContextId"
  >[],
  baseline: boolean,
  observations: readonly WorkerObservation[] = [],
) {
  const catalogs = audit.filter((entry) => entry.event === "catalog");
  const ids = [...new Set(audit.map((entry) => entry.connection))];
  const calls = audit.filter((entry) => entry.event === "call");
  const sends = calls.filter((entry) => entry.tool === "a2a_send_message");
  const rejections = audit.filter((entry) => entry.event === "rejected");
  const unique = sends.every(
    (entry) =>
      sends.filter(
        (other) =>
          other.inputHash === entry.inputHash &&
          other.peer === entry.peer &&
          (other.context ?? null) === (entry.context ?? null),
      ).length === 1,
  );
  const extra = sends.some(
    (entry) =>
      sends.filter(
        (other) => other.peer === entry.peer && (other.context ?? null) === (entry.context ?? null),
      ).length >
      expected.filter(
        (input) =>
          input.peerUrl === entry.peer &&
          (input.submittedContextId ?? null) === (entry.context ?? null),
      ).length,
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
        calls.every((call) => pairedResult(call, audit) !== undefined),
    noHiddenRetries:
      unique && !extra && (baseline ? sends.length === 0 : catalogs.length > 0 && ids.length === 1),
    inputIntegrity:
      observations.every((observation) =>
        sends.some((call) => {
          const result = pairedResult(call, audit);
          return (
            result?.taskId === observation.taskId &&
            result?.contextId === observation.contextId &&
            call.inputHash === sha256(observation.input)
          );
        }),
      ) &&
      sends.length === expected.length &&
      sends.every(
        (entry) =>
          expected.filter(
            (input) =>
              input.peerUrl === entry.peer &&
              (input.submittedContextId ?? null) === (entry.context ?? null) &&
              (input.inputEnvelope
                ? input.inputHash === input.inputEnvelope.rawHash &&
                  equivalentInput(input.inputEnvelope, entry.inputHash, entry.inputEnvelope)
                : input.inputHash === entry.inputHash),
          ).length === 1,
      ),
    noUncertainResends,
    workerInputsObserved:
      baseline ||
      (sends.length > 0 &&
        sends.every((call) => {
          const result = pairedResult(call, audit);
          return observations.some(
            (observation) =>
              observation.taskId === result?.taskId && observation.contextId === result?.contextId,
          );
        })),
    safeCalls:
      rejections.length === 0 &&
      sends.every((call) => call.blocking === false && call.taskIdOmitted === true) &&
      calls.every((call) =>
        ["a2a_list_agents", "a2a_whoami", "a2a_send_message", "a2a_get_task"].includes(
          String(call.tool),
        ),
      ),
  };
}
