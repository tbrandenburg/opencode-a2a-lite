import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  BASELINE,
  steps,
  TOPOLOGIES,
  type Schedule,
} from "../../examples/agent-network/topology-cases.js";
import {
  scoreTopology,
  scoreTransport,
  type StepExpectation,
  type StepReceipt,
} from "../../examples/agent-network/topology-receipts.js";

// Synthetic inputs test pure scoring contracts, not transport or model E2E.
function fixture(schedule: Schedule) {
  const expectations: StepExpectation[] = steps(schedule).map((turn) => ({
    stepId: turn.id,
    peerUrl:
      turn.actor === "coordinator"
        ? null
        : `http://127.0.0.1:${1000 + Number(turn.actor.slice(1))}/`,
    marker: `private-challenge-${turn.id}`,
  }));
  const receipts: StepReceipt[] = [];
  schedule.stages.forEach((stage, index) =>
    stage.forEach((turn) => {
      const expected = expectations.find((entry) => entry.stepId === turn.id)!;
      const previous = receipts.find((entry) => entry.stepId === turn.sameContextAs);
      const inbound = turn.inbound.map((id) => receipts.find((entry) => entry.stepId === id)!);
      receipts.push({
        stepId: turn.id,
        peerUrl: expected.peerUrl,
        contextId:
          turn.actor === "coordinator" ? null : (previous?.contextId ?? `context-${turn.id}`),
        taskId: turn.actor === "coordinator" ? null : `task-${turn.id}`,
        submittedContextId: previous?.contextId ?? null,
        taskIdOmitted: true,
        state: "completed",
        started: index * 10,
        ended: index * 10 + 5,
        inputHashes: Object.fromEntries(inbound.map((entry) => [entry.stepId, entry.outputHash])),
        outputHash: createHash("sha256").update(turn.id).digest("hex"),
        proof: Object.fromEntries([
          ...inbound.flatMap((entry) => Object.entries(entry.proof)),
          [turn.id, expected.marker],
        ]),
      });
    }),
  );
  const answer = {
    selected: ["A", "B", "C", "F"],
    cost: 9,
    value: 19,
    proof: receipts.at(-1)!.proof,
  };
  const evaluate = (input = receipts, result: unknown = answer, expected = expectations) =>
    scoreTopology(schedule, expected, input, result);
  const replace = (id: string, patch: Partial<StepReceipt>) =>
    receipts.map((entry) => (entry.stepId === id ? { ...entry, ...patch } : entry));
  return { expectations, receipts, answer, evaluate, replace };
}

test.each([...TOPOLOGIES, BASELINE])(
  "$id accepts complete matching metadata without exposing handles or markers",
  (schedule) => {
    const f = fixture(schedule);
    const result = f.evaluate();
    expect(result.status).toBe("pass");
    expect(scoreTransport(schedule, f.receipts).status).toBe("pass");
    expect(Object.values(result.mismatches).every((flag) => flag === false)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("private-challenge");
    expect(JSON.stringify(result)).not.toContain("http://");
    expect(JSON.stringify(result)).not.toContain("context-");
  },
);

test("fanout serialized or zero-duration turns cannot satisfy actual overlap", () => {
  const f = fixture(TOPOLOGIES[1]!);
  const serial = f.receipts.map((entry, index) => ({
    ...entry,
    started: index * 10,
    ended: index * 10 + 5,
  }));
  expect(f.evaluate(serial).checks.overlap).toBe("fail");
  expect(f.evaluate(serial).status).toBe("fail");
  expect(f.evaluate(f.replace("f1", { ended: 0 })).checks.timing).toBe("fail");
  expect(f.evaluate(f.replace("f1", { started: NaN })).status).toBe("fail");
});

test("edges require exact upstream hashes, proof markers, and stage ordering", () => {
  const f = fixture(TOPOLOGIES[2]!);
  expect(f.evaluate(f.replace("reviewA", { inputHashes: {} })).checks.edges).toBe("fail");
  expect(
    f.evaluate(f.replace("reviewA", { inputHashes: { plan: "f".repeat(64) } })).checks.edges,
  ).toBe("fail");
  expect(
    f.evaluate(f.replace("reviewA", { proof: { reviewA: "private-challenge-reviewA" } })).checks
      .proof,
  ).toBe("fail");
  expect(
    f.evaluate(f.replace("reviewA", { proof: { ...f.receipts[1]!.proof, future: "leak" } })).checks
      .proof,
  ).toBe("fail");
  expect(f.evaluate(f.replace("reviewA", { started: 1 })).checks.timing).toBe("fail");
  expect(f.evaluate(f.replace("plan", { outputHash: "not-sha256" })).checks.edges).toBe("fail");
  expect(f.evaluate(f.receipts, { ...f.answer, proof: {} }).checks.finalProof).toBe("fail");
  expect(
    scoreTopology(TOPOLOGIES[2]!, f.expectations, f.receipts, undefined).checks.finalProof,
  ).toBe("unknown");
});

test.each([TOPOLOGIES[3]!, TOPOLOGIES[5]!])(
  "$id requires explicit same-peer same-context new-task continuation",
  (schedule) => {
    const f = fixture(schedule);
    const last = f.receipts.at(-1)!;
    const initial = f.receipts[0]!;
    for (const patch of [
      { peerUrl: "http://127.0.0.1:9999/" },
      { contextId: "invented" },
      { contextId: null },
      { taskId: initial.taskId },
      { submittedContextId: null },
      { submittedContextId: "invented" },
      { taskIdOmitted: false },
    ]) {
      const result = f.evaluate(f.replace(last.stepId, patch));
      expect(result.checks.handles).toBe("fail");
      expect(result.status).toBe("fail");
    }
    expect(
      f.evaluate(f.replace(initial.stepId, { submittedContextId: "stale" })).checks.handles,
    ).toBe("fail");
    expect(f.evaluate(f.replace(initial.stepId, { taskId: "" })).checks.handles).toBe("fail");
  },
);

test("inventory corruption fails; absent and pending evidence remains incomplete", () => {
  const schedule = TOPOLOGIES[0]!;
  const f = fixture(schedule);
  const missing = f.receipts.slice(1);
  expect(f.evaluate(missing).status).toBe("unknown");
  expect(scoreTransport(schedule, missing).status).toBe("unknown");
  expect(f.evaluate([...missing, missing[0]!]).checks.inventory).toBe("fail");
  expect(scoreTransport(schedule, [...missing, missing[0]!]).status).toBe("fail");
  expect(f.evaluate(f.replace("p1", { stepId: "unknown" })).status).toBe("fail");
  expect(scoreTransport(schedule, f.replace("p1", { stepId: "unknown" })).status).toBe("fail");
  expect(
    f.evaluate(
      f.receipts,
      f.answer,
      f.expectations.map((entry) => ({ ...entry, marker: "same" })),
    ).checks.markers,
  ).toBe("fail");
  for (const state of [
    "pending",
    "unknown",
    "uncertain",
    "failed",
    "rejected",
    "canceled",
  ] as const) {
    const receipts = f.replace("p1", { state });
    const result = scoreTransport(schedule, receipts);
    expect(result.status).toBe(
      state === "pending"
        ? "pending"
        : ["unknown", "uncertain"].includes(state)
          ? "unknown"
          : "fail",
    );
    expect(f.evaluate(receipts).status).toBe(state === "pending" ? "pending" : "unknown");
  }
});
