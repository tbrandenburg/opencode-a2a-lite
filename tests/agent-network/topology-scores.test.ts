import { expect, test } from "bun:test";
import {
  overall,
  score,
  scoreOperations,
  completionStatus,
  type OperationsEvidence,
} from "../../examples/agent-network/topology-scores.js";

const operations: OperationsEvidence = {
  connections: [{ calls: 40, interventionCalls: 8 }],
  guardedPath: "pass",
  toolsDenied: "pass",
  boundedDeadlines: "pass",
  inputIntegrity: "pass",
  noHiddenRetries: "pass",
  noUncertainResends: "pass",
  cleanup: "pass",
};

test("budget reserves eight of forty calls per connection and never pools spare capacity", () => {
  expect(scoreOperations(operations).status).toBe("pass");
  expect(
    scoreOperations({ ...operations, connections: [{ calls: 32, interventionCalls: 0 }] }).status,
  ).toBe("pass");
  for (const connection of [
    { calls: 33, interventionCalls: 0 },
    { calls: 41, interventionCalls: 9 },
    { calls: -1, interventionCalls: 0 },
    { calls: NaN, interventionCalls: 0 },
    { calls: 1.5, interventionCalls: 0 },
    { calls: 0, interventionCalls: 1 },
    { calls: 32, interventionCalls: -1 },
    { calls: 32, interventionCalls: 0.5 },
  ]) {
    const result = scoreOperations({
      ...operations,
      connections: [connection, { calls: 0, interventionCalls: 0 }],
    });
    expect(result.status).toBe("fail");
    expect(result.mismatches.budget).toBe(true);
  }
  expect(scoreOperations({ ...operations, connections: [] }).status).toBe("fail");
  expect(scoreOperations({ ...operations, connections: [] }, "baseline").status).toBe("pass");
  expect(scoreOperations(operations, "baseline").status).toBe("fail");
});

test("unknown operations and pending cleanup cannot produce WORKING", () => {
  const passed = score({ complete: "pass" });
  const dimensions = {
    transport: passed,
    topology: passed,
    correctness: passed,
    operations: scoreOperations(operations),
  };
  expect(overall(dimensions)).toBe("WORKING");
  expect(overall({ ...dimensions, operations: scoreOperations() })).toBe("INCOMPLETE");
  expect(
    overall({ ...dimensions, operations: scoreOperations({ ...operations, cleanup: "pending" }) }),
  ).toBe("INCOMPLETE");
  expect(overall({ transport: passed, topology: passed, correctness: passed })).toBe("INCOMPLETE");
  expect(overall({})).toBe("INCOMPLETE");
  for (const key of [
    "guardedPath",
    "toolsDenied",
    "boundedDeadlines",
    "inputIntegrity",
    "noHiddenRetries",
    "noUncertainResends",
    "cleanup",
  ] as const) {
    const result = scoreOperations({ ...operations, [key]: "fail" });
    expect(result.status).toBe("fail");
    expect(overall({ ...dimensions, operations: result })).toBe("BROKEN");
  }
});

test("sanitized mismatch flags preserve unknown versus pending and failure wins", () => {
  const result = score({
    transport: "pass",
    topology: "pending",
    correctness: "unknown",
    operations: "fail",
  });
  expect(result.mismatches).toEqual({
    transport: false,
    topology: null,
    correctness: null,
    operations: true,
  });
  expect(result.status).toBe("fail");
  expect(result.checks.correctness).toBe("unknown");
  expect(result.checks.topology).toBe("pending");
  expect(score({}).status).toBe("unknown");
});

test("aborted local turn is incomplete without assuming remote cancellation; provider failure stays broken", () => {
  const passed = score({ checked: "pass" });
  const scores = {
    transport: passed,
    topology: score({ checked: "unknown" }),
    correctness: score({ checked: "unknown" }),
    operations: passed,
  };
  const handles = [{ taskId: "actual-task", contextId: "actual-context", state: "pending" }];
  const aborted = {
    failed: true,
    aborted: false,
    turns: [{ aborted: true, completed: false }],
    states: [],
  };
  expect(completionStatus(scores, aborted)).toBe("INCOMPLETE");
  expect(
    completionStatus(scores, { ...aborted, states: handles.map((entry) => entry.state) }),
  ).toBe("INCOMPLETE");
  expect(handles).toEqual([
    { taskId: "actual-task", contextId: "actual-context", state: "pending" },
  ]);
  expect(
    completionStatus(scores, { ...aborted, turns: [{ aborted: false, completed: false }] }),
  ).toBe("BROKEN");
  expect(
    completionStatus(scores, {
      ...aborted,
      failureCriterion: "runtime-error",
      turns: [{ aborted: false, completed: false }],
      states: ["pending"],
    }),
  ).toBe("BROKEN");
  expect(
    completionStatus(scores, {
      ...aborted,
      failureCriterion: "runtime-error",
      states: ["pending"],
    }),
  ).toBe("INCOMPLETE");
  expect(
    completionStatus({ ...scores, operations: score({ inputIntegrity: "fail" }) }, aborted),
  ).toBe("BROKEN");
  expect(completionStatus(scores, { ...aborted, turns: [], aborted: true })).toBe("INCOMPLETE");
});
