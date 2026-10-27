import { expect, test } from "bun:test";
import {
  auditOperations,
  pairedResult,
  sha256,
  submission,
  verifyContributions,
  workerReceipt,
  type Audit,
} from "../../examples/agent-network/topology-evidence.js";
import { sanitizedFailure } from "../../examples/agent-network/topology-failures.js";
import { scoreTopology } from "../../examples/agent-network/topology-receipts.js";
import { WORKLOADS } from "../../examples/agent-network/topology-workloads.js";
import { turnText } from "../../examples/agent-network/topology-prompts.js";
import type { WorkerObservation } from "../../examples/agent-network/workers.js";

const expectation = {
  stepId: "p1",
  peerUrl: "http://127.0.0.1:4123/",
  marker: "fresh-host-marker",
};
const turn = { id: "p1", actor: "W1", role: "solver", inbound: [] } as const;
const text = "exact model worker input";
const call: Audit = {
  event: "call",
  connection: "connection",
  id: "1",
  tool: "a2a_send_message",
  peer: expectation.peerUrl,
  inputHash: sha256(text),
  taskIdOmitted: true,
  blocking: false,
};
const result: Audit = {
  event: "result",
  connection: "connection",
  id: "1",
  tool: call.tool,
  ok: true,
  taskId: "task-1",
  contextId: "context-1",
  state: "TASK_STATE_SUBMITTED",
};

test("N14 modified input is not a retry; duplicates and uncertain resends remain failures", () => {
  const catalog: Audit = { event: "catalog", connection: "connection" };
  const expected = [{ peerUrl: expectation.peerUrl, inputHash: sha256(text) }];
  const changed = { ...call, inputHash: sha256("private-modification") };
  const evidence = auditOperations([catalog, changed, result], expected, false);
  expect(evidence.inputIntegrity).toBe(false);
  expect(evidence.noHiddenRetries).toBe(true);
  expect(evidence.noUncertainResends).toBe("pass");
  try {
    submission(expectation, text, [changed, result]);
    throw new Error("Expected modified submission rejection");
  } catch (error) {
    const failure = sanitizedFailure(error);
    expect(failure).toMatchObject({ kind: "SubmissionError", criterion: "submission-modified" });
    expect(JSON.stringify(failure)).not.toMatch(/private-modification|exact model worker input/);
  }
  expect(pairedResult(changed, [result])).toMatchObject({
    taskId: "task-1",
    contextId: "context-1",
  });
  expect(pairedResult(call, [result, { ...result }])).toBeUndefined();
  const duplicate = { ...call, id: "retry" };
  expect(() => submission(expectation, text, [call, duplicate])).toThrow("submission-repeated");
  expect(auditOperations([catalog, call, result, duplicate], expected, false)).toMatchObject({
    inputIntegrity: true,
    noHiddenRetries: false,
    noUncertainResends: "pass",
  });
  expect(auditOperations([catalog, call, duplicate], expected, false).noUncertainResends).toBe(
    "fail",
  );
  expect(auditOperations([call], expected, false).noUncertainResends).toBe("unknown");
  const uncertain = workerReceipt(turn, expectation, text, undefined, [call]);
  expect(uncertain).toMatchObject({
    taskId: null,
    contextId: null,
    state: "uncertain",
    started: 0,
    ended: 0,
  });
});

test("N15 worker provenance binds exact input/artifact and cumulative facts, hashes and proof", () => {
  const facts = WORKLOADS.V1.facts.slice(0, 2);
  const output = JSON.stringify({
    facts,
    inputHashes: {},
    proof: { p1: expectation.marker },
    answer: null,
  });
  const observation: WorkerObservation = {
    role: "W1",
    session: "session-1",
    taskId: "task-1",
    contextId: "context-1",
    input: text,
    output,
    started: 100,
    ended: 200,
    stopReason: "end_turn",
  };
  const completed = {
    ...result,
    id: "2",
    tool: "a2a_get_task",
    state: "TASK_STATE_COMPLETED",
    artifactHash: sha256(output),
  };
  const audit = [call, result, completed];
  const first = workerReceipt(turn, expectation, text, observation, audit);
  expect(first).toMatchObject({
    taskId: "task-1",
    contextId: "context-1",
    state: "completed",
    outputHash: sha256(output),
  });
  expect(() =>
    workerReceipt(turn, expectation, text, { ...observation, input: "changed" }, audit),
  ).toThrow("Worker input changed");
  expect(() =>
    workerReceipt(turn, expectation, text, { ...observation, contextId: "guessed" }, audit),
  ).toThrow("Context handle mismatch");
  expect(() =>
    workerReceipt(turn, expectation, text, observation, [
      call,
      result,
      { ...completed, artifactHash: "wrong" },
    ]),
  ).toThrow("Observed artifact mismatch");
  expect(() => verifyContributions(output, [facts, facts])).not.toThrow();
  expect(() =>
    verifyContributions(JSON.stringify({ facts: [], inputHashes: {}, proof: {}, answer: null }), [
      facts,
    ]),
  ).toThrow("Missing or conflicting");
  expect(() => verifyContributions(output, [facts, [{ ...facts[0]!, id: facts[1]!.id }]])).toThrow(
    "Conflicting inbound",
  );

  const final = { id: "finish", actor: "coordinator", role: "synthesis", inbound: ["p1"] } as const;
  const expectedFinal = { stepId: "finish", peerUrl: null, marker: "final-host-marker" };
  const proof = { p1: expectation.marker, finish: expectedFinal.marker };
  const last = {
    stepId: "finish",
    peerUrl: null,
    contextId: null,
    taskId: null,
    submittedContextId: null,
    taskIdOmitted: true,
    state: "completed" as const,
    started: 201,
    ended: 202,
    inputHashes: { p1: first.outputHash },
    outputHash: "b".repeat(64),
    proof,
  };
  const schedule = { id: "T1-pipeline" as const, stages: [[turn], [final]], final: "finish" };
  const answer = { selected: ["A", "B", "C", "F"], cost: 9, value: 19, proof };
  const evaluate = (patch = {}) =>
    scoreTopology(schedule, [expectation, expectedFinal], [first, { ...last, ...patch }], answer);
  expect(evaluate().status).toBe("pass");
  expect(evaluate({ proof: { finish: expectedFinal.marker } }).checks.proof).toBe("fail");
  expect(evaluate({ inputHashes: { p1: "c".repeat(64) } }).checks.edges).toBe("fail");
  expect(
    scoreTopology(schedule, [expectation, expectedFinal], [first, last], { ...answer, proof: {} })
      .checks.finalProof,
  ).toBe("fail");
  const encoded = JSON.parse(
    turnText(final, expectedFinal, { p1: { output, hash: first.outputHash } }, true),
  );
  expect(encoded.inbound.p1).toBe(output);
  expect(encoded.inputHashes).toEqual({ p1: first.outputHash });
});
