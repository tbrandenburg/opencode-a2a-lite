import { expect, test } from "bun:test";
import { CASE_MATRIX } from "../../examples/agent-network/topology-cases.js";
import {
  scoreSemantics,
  assessCandidate,
} from "../../examples/agent-network/topology-semantics.js";

const testCase = (id: string) => CASE_MATRIX.find((entry) => entry.id === `V1/${id}`)!;
const optimum = ["A", "B", "C", "F"];
const good = { selected: optimum, cost: 9, value: 19, feasible: true, violations: [] };
const seed = {
  selected: ["B", "E"],
  cost: 8,
  value: 18,
  feasible: false,
  violations: ["excludes-B-E"],
};
const conflict = {
  selected: ["A", "D"],
  cost: 4,
  value: 8,
  feasible: false,
  violations: ["excludes-A-D"],
};
const alternatives = [
  good,
  { selected: ["D", "E"], cost: 7, value: 17, feasible: true, violations: [] },
  { selected: ["D"], cost: 2, value: 5, feasible: true, violations: [] },
];
const evaluation = (
  candidate: string[],
  assessments: object[],
  revisedFrom: string[] | null = null,
) => ({ candidate, assessments, revisedFrom, resolution: "authoritative-facts" });
const envelope = (evaluation: unknown, final = false) =>
  JSON.stringify({
    facts: [],
    inputHashes: {},
    proof: {},
    evaluation,
    answer: final ? { selected: optimum, cost: 9, value: 19, proof: {} } : null,
  });

test("refinement requires an actual infeasible proposal, honest critique and changed correction", () => {
  const outputs = new Map([
    [
      "propose",
      envelope({ candidate: ["B", "E"], assessments: [], revisedFrom: null, resolution: null }),
    ],
    ["critique", envelope(evaluation(optimum, [seed], ["B", "E"]))],
    ["refine", envelope(evaluation(optimum, [seed], ["B", "E"]), true)],
  ]);
  const run = () => scoreSemantics(testCase("T4-refinement"), outputs);
  expect(run().status).toBe("pass");
  outputs.set("critique", envelope(evaluation(optimum, [{ ...seed, feasible: true }], ["B", "E"])));
  expect(run().checks.critique).toBe("fail");
  outputs.set("critique", envelope(evaluation(["D", "E"], [seed], ["B", "E"])));
  expect(run().checks.refine).toBe("fail");
  outputs.set("refine", envelope(evaluation(["B", "E"], [seed], ["B", "E"]), true));
  expect(run().checks.refine).toBe("fail");
  outputs.set("critique", envelope(null));
  expect(run().checks.critique).toBe("fail");
  outputs.delete("refine");
  expect(run().checks.refine).toBe("unknown");
});

test("judge validates three independent competing assessments rather than votes or role labels", () => {
  const outputs = new Map([
    ["a", envelope(evaluation(optimum, alternatives))],
    ["b", envelope(evaluation(["D", "E"], alternatives))],
    ["c", envelope(evaluation(["D"], alternatives))],
    ["judge", envelope(evaluation(optimum, alternatives), true)],
  ]);
  const run = () => scoreSemantics(testCase("T5-judge"), outputs);
  expect(run().status).toBe("pass");
  outputs.set("judge", envelope(evaluation(["D", "E"], alternatives), true));
  expect(run().checks.judge).toBe("fail");
  outputs.set("judge", envelope(evaluation(optimum, alternatives.slice(1)), true));
  expect(run().checks.judge).toBe("fail");
  outputs.set(
    "b",
    envelope(evaluation(["D", "E"], [good, { ...alternatives[1], value: 999 }, alternatives[2]!])),
  );
  expect(run().checks.b).toBe("fail");
  outputs.set("c", envelope(evaluation(optimum, alternatives)));
  expect(run().checks.c).toBe("fail");
});

test("diamond resolves deliberately conflicting recommendations using authoritative facts", () => {
  const outputs = new Map([
    ["reviewA", envelope(evaluation(["B", "E"], [seed]))],
    ["reviewB", envelope(evaluation(["A", "D"], [conflict]))],
    ["integrate", envelope(evaluation(optimum, [seed, conflict]), true)],
  ]);
  const run = () => scoreSemantics(testCase("T3-diamond"), outputs);
  expect(run().status).toBe("pass");
  outputs.set(
    "integrate",
    envelope({ ...evaluation(optimum, [seed, conflict]), resolution: "majority" }, true),
  );
  expect(run().checks.integrate).toBe("fail");
  outputs.set("reviewB", envelope(evaluation(["A", "D"], [{ ...conflict, violations: [] }])));
  expect(run().checks.reviewB).toBe("fail");
});

test("candidate assessor checks zero capacity, dependency and incompatibility facts independently", () => {
  const zero = CASE_MATRIX.find((entry) => entry.variant === "V3")!;
  expect(assessCandidate(zero, ["A", "F"])).toEqual({
    selected: ["A", "F"],
    cost: 0,
    value: 5,
    feasible: true,
    violations: [],
  });
  expect(assessCandidate(zero, ["B", "E"])).toEqual({
    selected: ["B", "E"],
    cost: 6,
    value: 15,
    feasible: false,
    violations: ["bounds", "excludes-B-E"],
  });
  expect(assessCandidate(zero, ["F"])).toEqual({
    selected: ["F"],
    cost: 0,
    value: 2,
    feasible: false,
    violations: ["requires-F-A"],
  });
});
