import { expect, test } from "bun:test";
import {
  auditOperations,
  correlateSubmission,
  pairedResult,
  sha256,
  submission,
  verifyContributions,
  workerReceipt,
  type Audit,
} from "../../examples/agent-network/topology-evidence.js";
import { sanitizedFailure } from "../../examples/agent-network/topology-failures.js";
import {
  scoreTopology,
  type StepExpectation,
} from "../../examples/agent-network/topology-receipts.js";
import { WORKLOADS } from "../../examples/agent-network/topology-workloads.js";
import { turnText } from "../../examples/agent-network/topology-prompts.js";
import type { WorkerObservation } from "../../examples/agent-network/workers.js";
import { envelopeMetadata } from "../../examples/agent-network/topology-envelope.js";
import { scoreOperations } from "../../examples/agent-network/topology-scores.js";

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
  expect(correlateSubmission(expectation, text, [changed, result]).result).toMatchObject({
    taskId: "task-1",
    contextId: "context-1",
  });
  expect(() => submission(expectation, text, [])).toThrow("submission-missing");
  expect(pairedResult(call, [result, { ...result }])).toBeUndefined();
  const duplicate = { ...call, id: "retry" };
  expect(() => submission(expectation, text, [call, duplicate])).toThrow("submission-repeated");
  expect(auditOperations([catalog, call, result, duplicate], expected, false)).toMatchObject({
    inputIntegrity: false,
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
  expect(auditOperations([catalog, call, result], expected, false).workerInputsObserved).toBe(
    false,
  );
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
  const poll = { ...call, id: "2", tool: "a2a_get_task", task: "task-1" };
  const audit = [call, result, poll, completed];
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
      poll,
      { ...completed, artifactHash: "wrong" },
    ]),
  ).toThrow("Observed artifact mismatch");
  expect(() =>
    workerReceipt(turn, expectation, text, { ...observation, taskId: "guessed" }, audit),
  ).toThrow("Task handle mismatch");
  expect(() =>
    submission({ ...expectation, peerUrl: "http://127.0.0.1:4124/" }, text, audit),
  ).toThrow("submission-binding");
  expect(() => submission({ ...expectation, submittedContextId: "changed" }, text, audit)).toThrow(
    "submission-binding",
  );
  expect(workerReceipt(turn, expectation, text, observation, [call, result, completed]).state).toBe(
    "pending",
  );
  expect(() =>
    workerReceipt(turn, { ...expectation, submittedContextId: "prior" }, text, observation, [
      { ...call, context: "prior" },
      result,
    ]),
  ).toThrow("Continuation handle mismatch");
  expect(() => verifyContributions(output, [facts, facts])).not.toThrow();
  try {
    verifyContributions(output, [
      [{ id: "item-A", kind: "item", item: "A", cost: 999, value: 3 }, facts[1]!],
    ]);
    throw new Error("Expected changed authoritative fact rejection");
  } catch (error) {
    expect(sanitizedFailure(error)).toMatchObject({
      criterion: "contribution-mismatch",
      contributions: { missing: 0, extra: 0, changed: 1, repeated: 0 },
    });
  }
  try {
    verifyContributions(
      JSON.stringify({
        facts: [facts[0], facts[0], facts[1]],
        inputHashes: {},
        proof: {},
        answer: null,
      }),
      [facts],
    );
    throw new Error("Expected repeated fact rejection");
  } catch (error) {
    expect(sanitizedFailure(error)).toMatchObject({
      criterion: "contribution-mismatch",
      contributions: { missing: 0, extra: 0, changed: 0, repeated: 1 },
    });
  }
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

test("N19 known envelope formatting survives worker receipt and operations; semantic changes fail without retry classification", () => {
  const inbound = JSON.stringify({
    facts: WORKLOADS.V1.facts,
    proof: { prior: "private-artifact-marker" },
    order: ["A", "B"],
  });
  const declared = turnText(
    turn,
    expectation,
    { prior: { output: inbound, hash: sha256(inbound) } },
    false,
    WORKLOADS.V1.facts,
  );
  const value = JSON.parse(declared);
  const pretty = JSON.stringify(Object.fromEntries(Object.entries(value).reverse()), null, 2);
  const expected: StepExpectation = {
    ...expectation,
    inputHash: sha256(declared),
    inputEnvelope: envelopeMetadata(declared),
    submittedContextId: null,
  };
  const sent = { ...call, inputHash: sha256(pretty), inputEnvelope: envelopeMetadata(pretty) };
  const catalog = { event: "catalog", connection: "connection" };
  const output = JSON.stringify({
    facts: [],
    inputHashes: value.inputHashes,
    proof: { p1: expectation.marker },
    answer: null,
  });
  const observation: WorkerObservation = {
    role: "W1",
    session: "session",
    taskId: "task-1",
    contextId: "context-1",
    input: pretty,
    output,
    started: 1,
    ended: 2,
    stopReason: "end_turn",
  };
  const audit = [
    catalog,
    sent,
    { ...result, state: "TASK_STATE_COMPLETED", artifactHash: sha256(output) },
  ];
  expect(sha256(pretty)).not.toBe(expected.inputHash);
  expect(submission(expected, declared, audit).result?.taskId).toBe("task-1");
  expect(workerReceipt(turn, expected, declared, observation, audit).state).toBe("completed");
  expect(expected.workerInputHash).toBe(sent.inputHash);
  const operations = auditOperations(audit, [expected], false, [observation]);
  expect(operations).toMatchObject({
    inputIntegrity: true,
    guardedPath: true,
    safeCalls: true,
    noHiddenRetries: true,
    workerInputsObserved: true,
  });
  expect(
    auditOperations([catalog, sent, { ...audit[2]!, ok: false }], [expected], false).guardedPath,
  ).toBe(true);
  expect(
    auditOperations(audit, [expected], false, [{ ...observation, input: declared }]).inputIntegrity,
  ).toBe(false);
  expect(() =>
    workerReceipt(turn, expected, declared, { ...observation, input: declared }, audit),
  ).toThrow("Worker input changed");
  const policy = auditOperations(
    [catalog, { ...sent, blocking: undefined }, audit[2]!],
    [expected],
    false,
  );
  const scores = scoreOperations({
    connections: policy.connections,
    guardedPath: policy.guardedPath ? "pass" : "fail",
    parameterPolicy: policy.safeCalls ? "pass" : "fail",
    toolsDenied: "pass",
    boundedDeadlines: "pass",
    inputIntegrity: "pass",
    noHiddenRetries: "pass",
    noUncertainResends: "pass",
    cleanup: "pass",
  });
  expect(scores.checks.guardedPath).toBe("pass");
  expect(scores.checks.parameterPolicy).toBe("fail");
  expect(
    auditOperations(
      [catalog, { ...sent, taskIdOmitted: false, task: "guessed" }, audit[2]!],
      [expected],
      false,
    ).safeCalls,
  ).toBe(false);

  // Ten disclosed, fixed counterexamples: no historical vector table restored.
  const corruptions = [
    { ...value, instructions: value.instructions + " " },
    { ...value, marker: "changed" },
    { ...value, inputHashes: { prior: "0".repeat(64) } },
    { ...value, inbound: { prior: JSON.stringify(JSON.parse(inbound), null, 2) } },
    { ...value, privateFacts: [...WORKLOADS.V1.facts].reverse() },
    {
      ...value,
      privateFacts: [{ ...WORKLOADS.V1.facts[0], cost: 999 }, ...WORKLOADS.V1.facts.slice(1)],
    },
    { ...value, role: "changed" },
    { ...value, final: true },
    { ...value, roleInstructions: value.roleInstructions + " " },
    { ...value, stepId: "changed" },
  ];
  for (const corruption of corruptions) {
    const changed = JSON.stringify(corruption);
    const changedCall = {
      ...sent,
      inputHash: sha256(changed),
      inputEnvelope: envelopeMetadata(changed),
    };
    expect(() => submission(expected, declared, [catalog, changedCall, result])).toThrow(
      "submission-modified",
    );
    expect(auditOperations([catalog, changedCall, result], [expected], false)).toMatchObject({
      inputIntegrity: false,
      noHiddenRetries: true,
      noUncertainResends: "pass",
    });
  }
  expect(envelopeMetadata(JSON.stringify({ ...value, unexpected: "private-sentinel" })).kind).toBe(
    "invalid",
  );
  expect(
    envelopeMetadata(declared.replace('"final":false', '"final":true,"final":false')).kind,
  ).toBe("invalid");
  expect(envelopeMetadata("{malformed").kind).toBe("invalid");
  expect(envelopeMetadata("{:}").kind).toBe("invalid");
  expect(envelopeMetadata("[".repeat(9) + "0" + "]".repeat(9)).kind).toBe("invalid");
  expect(envelopeMetadata("[" + "0,".repeat(4096) + "0]").kind).toBe("invalid");
  expect(envelopeMetadata('{"marker":"' + "x".repeat(4 * 1024 * 1024) + '"}').kind).toBe("invalid");
});
