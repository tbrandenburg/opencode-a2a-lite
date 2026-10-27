import { describe, expect, test } from "bun:test";
import { taskMetadata } from "../../examples/agent-network/guard-task.js";
import {
  auditOperations,
  observedState,
  pairedResult,
  parseTurn,
  sha256,
  submission,
  verifyContributions,
  workerReceipt,
  type Audit,
} from "../../examples/agent-network/topology-evidence.js";
import {
  validateControls,
  validateCase,
  runTopologyCases,
} from "../../examples/agent-network/topology-run.js";
import { CASE_MATRIX, BASELINE } from "../../examples/agent-network/topology-cases.js";
import { verifyReleased } from "../../examples/agent-network/topology-resources.js";
import { turnText } from "../../examples/agent-network/topology-prompts.js";
import { WORKLOADS } from "../../examples/agent-network/topology-workloads.js";
import type { WorkerObservation } from "../../examples/agent-network/workers.js";
import { createServer } from "node:net";
import { sanitizedFailure } from "../../examples/agent-network/topology-failures.js";

const expectation = {
  stepId: "p1",
  peerUrl: "http://127.0.0.1:4123/",
  marker: "fresh-host-marker",
};
const turn = { id: "p1", actor: "W1", role: "solver", inbound: [] } as const;
const text = "exact model worker input";
const expectedInput = [{ peerUrl: expectation.peerUrl, inputHash: sha256(text) }];
const raw = JSON.stringify({
  facts: [],
  inputHashes: {},
  proof: { p1: expectation.marker },
  answer: null,
});
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
const completed: Audit = {
  event: "result",
  connection: "connection",
  id: "2",
  tool: "a2a_get_task",
  ok: true,
  taskId: "task-1",
  contextId: "context-1",
  state: "TASK_STATE_COMPLETED",
  artifactHash: sha256(raw),
};
const observation: WorkerObservation = {
  role: "W1",
  session: "session-1",
  taskId: "task-1",
  contextId: "context-1",
  input: text,
  output: raw,
  started: 100,
  ended: 200,
  stopReason: "end_turn",
};

describe("topology runtime evidence", () => {
  test("extracts bounded sanitized A2A 1.0 task metadata, without raw content", () => {
    const metadata = taskMetadata({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            task: {
              id: "task-1",
              contextId: "context-1",
              status: { state: "TASK_STATE_COMPLETED", message: "private diagnostic" },
              artifacts: [{ parts: [{ text: "hello" }] }],
              history: ["private input"],
            },
          }),
        },
      ],
    });
    expect(metadata).toEqual({
      taskId: "task-1",
      contextId: "context-1",
      state: "TASK_STATE_COMPLETED",
      artifactHash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    });
    expect(JSON.stringify(metadata)).not.toMatch(/hello|private/);
    expect(taskMetadata({ isError: true, content: [] })).toEqual({});
    expect(taskMetadata({ content: [{ type: "text", text: "broken-json" }] })).toEqual({});
  });

  test("does not reinterpret malformed states, handles or errors as completed", () => {
    for (const task of [
      { id: "t", contextId: "c", status: { state: "completed" } },
      {
        id: "private content with spaces",
        contextId: "c",
        status: { state: "TASK_STATE_COMPLETED" },
      },
      { id: "t", status: { state: "TASK_STATE_COMPLETED" } },
    ])
      expect(taskMetadata({ content: [{ type: "text", text: JSON.stringify(task) }] })).toEqual({});
    expect(observedState("TASK_STATE_REJECTED")).toBe("rejected");
    expect(observedState("TASK_STATE_WORKING")).toBe("pending");
    expect(observedState("completed")).toBe("unknown");
  });

  test("cross-checks actual worker execution and model-observed artifact/handles", () => {
    const receipt = workerReceipt(turn, expectation, text, observation, [call, result, completed]);
    expect(receipt).toMatchObject({
      state: "completed",
      taskId: "task-1",
      contextId: "context-1",
      taskIdOmitted: true,
      started: 100,
      ended: 200,
      proof: { p1: "fresh-host-marker" },
    });
    expect(receipt.outputHash).toBe(sha256(raw));
    expect(() =>
      workerReceipt(turn, expectation, text, { ...observation, contextId: "guessed" }, [
        call,
        result,
        completed,
      ]),
    ).toThrow("Context handle mismatch");
    expect(() =>
      workerReceipt(turn, expectation, text, observation, [
        call,
        result,
        { ...completed, artifactHash: "wrong" },
      ]),
    ).toThrow("Observed artifact mismatch");
  });

  test("retains pending and uncertain observations without invented execution times", () => {
    const pending = workerReceipt(turn, expectation, text, undefined, [call, result]);
    const uncertain = workerReceipt(turn, expectation, text, undefined, [call]);
    expect(pending).toMatchObject({
      taskId: "task-1",
      contextId: "context-1",
      state: "pending",
      started: 0,
      ended: 0,
    });
    expect(uncertain).toMatchObject({
      taskId: null,
      contextId: null,
      state: "uncertain",
      started: 0,
      ended: 0,
    });
    expect(pending.outputHash).toBe("");
    expect(uncertain.proof).toEqual({});
    expect(
      workerReceipt(turn, expectation, text, undefined, [
        call,
        { ...result, taskId: undefined, contextId: undefined },
      ]).state,
    ).toBe("uncertain");
  });

  test("requires exact request/result pairing and no repeated model submission", () => {
    expect(pairedResult(call, [result])).toBe(result);
    expect(pairedResult(call, [result, { ...result }])).toBeUndefined();
    expect(pairedResult(call, [{ ...result, connection: "different" }])).toBeUndefined();
    expect(() => submission(expectation, text, [call, { ...call, id: "other" }])).toThrow(
      "submission-repeated",
    );
    expect(() => submission(expectation, "changed input", [call])).toThrow("submission-modified");
    expect(() => submission(expectation, text, [])).toThrow("submission-missing");
  });

  test("computes operational violations from receipts rather than declared success", () => {
    const catalog: Audit = { event: "catalog", connection: "connection" };
    const valid = auditOperations([catalog, call, result], expectedInput, false);
    expect(valid.guardedPath).toBe(true);
    expect(valid.connections).toEqual([{ calls: 1, interventionCalls: 0 }]);
    const invalid = auditOperations(
      [
        catalog,
        call,
        result,
        { ...call, id: "retry" },
        { event: "rejected", connection: "connection", reason: "budget" },
      ],
      expectedInput,
      false,
    );
    expect(invalid.noUncertainResends).toBe("pass");
    expect(invalid.noHiddenRetries).toBe(false);
    expect(invalid.guardedPath).toBe(false);
    expect(invalid.connections[0]?.calls).toBe(3);
    expect(
      auditOperations([catalog, { ...call, blocking: true }, result], expectedInput, false)
        .safeCalls,
    ).toBe(false);
    expect(
      auditOperations([catalog, { ...call, blocking: undefined }, result], expectedInput, false)
        .safeCalls,
    ).toBe(false);
    expect(auditOperations([], [], true)).toMatchObject({
      guardedPath: true,
      safeCalls: true,
      connections: [],
    });
  });

  test("strict envelopes never downgrade missing/conflicting contributions", () => {
    const facts = WORKLOADS.V1.facts.slice(0, 2);
    const envelope = JSON.stringify({ ...parseTurn(raw), facts });
    expect(() => verifyContributions(envelope, [facts, facts])).not.toThrow();
    expect(() => verifyContributions(raw, [facts])).toThrow("Missing or conflicting");
    expect(() =>
      verifyContributions(envelope, [facts, [{ ...facts[0]!, id: facts[1]!.id }]]),
    ).toThrow("Conflicting inbound");
    expect(() => parseTurn('{"proof":{}}')).toThrow();
    expect(() =>
      parseTurn(JSON.stringify({ ...parseTurn(raw), inputHashes: { p0: "invented" } })),
    ).toThrow();
  });

  test("a single modified send is an integrity failure, not evidence of retry or uncertain resend", () => {
    const catalog: Audit = { event: "catalog", connection: "connection" };
    const changed = { ...call, inputHash: sha256("modified worker input") };
    const evidence = auditOperations([catalog, changed, result], expectedInput, false);
    expect(evidence.inputIntegrity).toBe(false);
    expect(evidence.noHiddenRetries).toBe(true);
    expect(evidence.noUncertainResends).toBe("pass");
    try {
      submission(expectation, text, [changed, result]);
      throw new Error("Expected modified submission rejection");
    } catch (error) {
      expect(sanitizedFailure(error)).toMatchObject({
        kind: "SubmissionError",
        criterion: "submission-modified",
      });
    }
    expect(pairedResult(changed, [result])?.taskId).toBe("task-1");
    expect(pairedResult(changed, [result])?.contextId).toBe("context-1");
    const extra = auditOperations(
      [catalog, call, result, { ...changed, id: "extra" }],
      expectedInput,
      false,
    );
    expect(extra.noHiddenRetries).toBe(false);
    expect(extra.inputIntegrity).toBe(false);
    expect(extra.noUncertainResends).toBe("pass");
    const uncertain = auditOperations(
      [catalog, call, { ...call, id: "retry" }],
      expectedInput,
      false,
    );
    expect(uncertain.noUncertainResends).toBe("fail");
    expect(uncertain.noHiddenRetries).toBe(false);
    expect(
      auditOperations([catalog, call, { ...call, id: "retry" }, result], expectedInput, false)
        .noUncertainResends,
    ).toBe("fail");
    const unexpected = auditOperations(
      [catalog, { ...call, peer: "http://127.0.0.1:4999/" }, result],
      expectedInput,
      false,
    );
    expect(unexpected.noHiddenRetries).toBe(false);
    expect(unexpected.inputIntegrity).toBe(false);
    expect(auditOperations([call], expectedInput, false).noUncertainResends).toBe("unknown");
    expect(auditOperations([], [], true)).toMatchObject({
      inputIntegrity: true,
      noHiddenRetries: true,
      noUncertainResends: "pass",
    });
  });

  test("submission diagnostics distinguish missing, repeated and modified without raw values", () => {
    for (const entry of [
      { audit: [], criterion: "submission-missing" },
      { audit: [call, { ...call, id: "retry" }], criterion: "submission-repeated" },
      {
        audit: [{ ...call, inputHash: sha256("private-modification") }],
        criterion: "submission-modified",
      },
    ]) {
      try {
        submission(expectation, text, entry.audit);
        throw new Error("Expected submission rejection");
      } catch (error) {
        const failure = sanitizedFailure(error);
        expect(failure.criterion).toBe(entry.criterion);
        expect(JSON.stringify(failure)).not.toMatch(
          /private-modification|exact model worker input/,
        );
      }
    }
    const continued = { ...expectation, submittedContextId: "context-1" };
    expect(() => submission(continued, text, [call])).toThrow("submission-missing");
    expect(
      submission(continued, text, [call, { ...call, id: "continuation", context: "context-1" }])
        .call.id,
    ).toBe("continuation");
  });

  test("stage inputs carry exact raw predecessor output and host-calculated hashes", () => {
    const encoded = turnText(
      turn,
      expectation,
      { prior: { output: raw, hash: "a".repeat(64) } },
      true,
    );
    const value = JSON.parse(encoded);
    expect(value.inbound.prior).toBe(raw);
    expect(value.inputHashes).toEqual({ prior: "a".repeat(64) });
    expect(value.marker).toBe("fresh-host-marker");
    expect(value.final).toBe(true);
  });

  test("rejects unsafe opt-in and deadline controls before launching resources", () => {
    expect(validateControls({ optIn: true })).toEqual({ caseMs: 900000, turnMs: 180000 });
    expect(validateControls({ optIn: true, caseMs: 1000, turnMs: 30 })).toEqual({
      caseMs: 1000,
      turnMs: 30,
    });
    for (const caseMs of [NaN, Infinity, 999, 3600001, 1000.5])
      expect(() => validateControls({ optIn: true, caseMs, turnMs: 30 })).toThrow();
    expect(() => validateControls({ optIn: true, caseMs: 1000, turnMs: 1001 })).toThrow();
    expect(() => validateControls(JSON.parse('{"optIn":false}'))).toThrow("optIn:true");
  });

  test("rejects undeclared schedules and an invalid empty suite before resource creation", async () => {
    expect(() => validateCase(CASE_MATRIX[0]!)).not.toThrow();
    expect(() => validateCase({ id: "fake", variant: "V1", schedule: BASELINE })).toThrow(
      "declared matrix case",
    );
    const declared = CASE_MATRIX.find((entry) => entry.schedule.id === "B0-coordinator")!;
    expect(() =>
      validateCase({ ...declared, schedule: { ...BASELINE, stages: [[turn]] } }),
    ).toThrow("declared matrix case");
    await expect(runTopologyCases([], { optIn: true, turnMs: 0 })).rejects.toThrow(
      "Invalid turn deadline",
    );
  });

  test("port-release evidence rejects occupied listeners then proves the same port rebinds", async () => {
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing fixture port");
    const url = `http://127.0.0.1:${address.port}/`;
    try {
      await expect(verifyReleased(url)).rejects.toThrow();
    } finally {
      await new Promise<void>((done, fail) =>
        server.close((error) => (error ? fail(error) : done())),
      );
    }
    await expect(verifyReleased(url)).resolves.toBeUndefined();
    expect(server.listening).toBe(false);
  });
});
