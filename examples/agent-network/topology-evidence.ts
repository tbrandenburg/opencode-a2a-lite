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
// Submitted arguments are model-controlled, not returned handle provenance.
export function submittedIdentifiers(args: Record<string, unknown>) {
  return {
    contextPresent: Object.hasOwn(args, "context_id"),
    ...(typeof args.context_id === "string" ? { contextHash: sha256(args.context_id) } : {}),
    taskPresent: Object.hasOwn(args, "task_id"),
    ...(typeof args.task_id === "string" ? { taskHash: sha256(args.task_id) } : {}),
  };
}
export function submittedIdentifier(call: Audit, field: "context" | "task") {
  const digest = call[`${field}Hash`];
  if (Object.hasOwn(call, `${field}Present`))
    return {
      present: call[`${field}Present`] !== false,
      hash: typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest) ? digest : null,
    };
  return {
    present: Object.hasOwn(call, field),
    hash: typeof call[field] === "string" ? sha256(call[field]) : null,
  };
}
export function matchesSubmitted(call: Audit, field: "context" | "task", expected: string | null) {
  const submitted = submittedIdentifier(call, field);
  return expected === null
    ? !submitted.present
    : submitted.present && submitted.hash === sha256(expected);
}

// Per-connection receipt provenance, not authorization or a forwarded-result edit.
export function createResultMetadata() {
  const known = new Set<string>();
  const reflected = new Set<string>();
  const key = (peer: unknown, field: string, digest: string) =>
    JSON.stringify([peer, field, digest]);
  const project = (entry: Audit, peer: unknown): Audit => {
    const output = { ...entry };
    for (const field of ["context", "task"] as const) {
      const value = entry[`${field}Id`];
      if (typeof value !== "string") continue;
      const digest = sha256(value);
      if (!reflected.has(key(peer, field, digest))) continue;
      delete output[`${field}Id`];
      output[`${field}Hash`] = digest;
      output[`${field}Untrusted`] = true;
    }
    return output;
  };
  return {
    project,
    capture(entry: Audit, call?: Audit): Audit {
      const peer = call?.peer;
      for (const field of ["context", "task"] as const) {
        const value = entry[`${field}Id`];
        const digest = typeof value === "string" ? sha256(value) : entry[`${field}Hash`];
        if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) continue;
        const identity = key(peer, field, digest);
        const failed = ["TASK_STATE_FAILED", "TASK_STATE_REJECTED"].includes(String(entry.state));
        const echo = call && typeof value === "string" && matchesSubmitted(call, field, value);
        if (
          !known.has(identity) &&
          (entry[`${field}Untrusted`] === true || (echo && (field === "context" || failed)))
        )
          reflected.add(identity);
        if (typeof value === "string" && !reflected.has(identity)) known.add(identity);
      }
      return project(entry, peer);
    },
  };
}
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
      matchesSubmitted(entry, "context", expectation.submittedContextId ?? null),
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
  if (submittedIdentifier(sent.call, "context").present && result?.contextId !== undefined)
    assert(
      typeof result.contextId === "string" &&
        matchesSubmitted(sent.call, "context", result.contextId),
      "Continuation handle mismatch",
    );
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
            typeof result?.taskId === "string" &&
            matchesSubmitted(call, "task", result.taskId) &&
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
    submittedContextId: expected.submittedContextId ?? null,
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
          JSON.stringify(submittedIdentifier(other, "context")) ===
            JSON.stringify(submittedIdentifier(entry, "context")),
      ).length === 1,
  );
  const extra = sends.some(
    (entry) =>
      sends.filter(
        (other) =>
          other.peer === entry.peer &&
          JSON.stringify(submittedIdentifier(other, "context")) ===
            JSON.stringify(submittedIdentifier(entry, "context")),
      ).length >
      expected.filter(
        (input) =>
          input.peerUrl === entry.peer &&
          matchesSubmitted(entry, "context", input.submittedContextId ?? null),
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
      sends.length <= expected.length &&
      sends.every(
        (entry) =>
          expected.filter(
            (input) =>
              input.peerUrl === entry.peer &&
              matchesSubmitted(entry, "context", input.submittedContextId ?? null) &&
              (input.inputEnvelope
                ? input.inputHash === input.inputEnvelope.rawHash &&
                  equivalentInput(input.inputEnvelope, entry.inputHash, entry.inputEnvelope)
                : input.inputHash === entry.inputHash),
          ).length === 1,
      ),
    noUncertainResends,
    submissionsObserved: sends.length === expected.length,
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

export function inputIntegrityCheck(evidence: {
  inputIntegrity: boolean;
  submissionsObserved: boolean;
  workerInputsObserved: boolean;
}): Check {
  if (!evidence.inputIntegrity) return "fail";
  return evidence.submissionsObserved && evidence.workerInputsObserved ? "pass" : "unknown";
}
