import { expect, test } from "bun:test";
import { CASE_MATRIX } from "../../examples/agent-network/topology-cases.js";
import { scoreSemantics } from "../../examples/agent-network/topology-semantics.js";

test("N16 judge needs independent competing assessments, not votes or role labels", () => {
  const testCase = CASE_MATRIX.find((entry) => entry.id === "V1/T5-judge")!;
  const optimum = ["A", "B", "C", "F"];
  const alternatives = [
    { selected: optimum, cost: 9, value: 19, feasible: true, violations: [] },
    { selected: ["D", "E"], cost: 7, value: 17, feasible: true, violations: [] },
    { selected: ["D"], cost: 2, value: 5, feasible: true, violations: [] },
  ];
  const envelope = (candidate: string[], assessments: object[], final = false) =>
    JSON.stringify({
      facts: [],
      inputHashes: {},
      proof: {},
      evaluation: { candidate, assessments, revisedFrom: null, resolution: "authoritative-facts" },
      answer: final ? { selected: optimum, cost: 9, value: 19, proof: {} } : null,
    });
  const outputs = new Map([
    ["a", envelope(optimum, alternatives)],
    ["b", envelope(["D", "E"], alternatives)],
    ["c", envelope(["D"], alternatives)],
    ["judge", envelope(optimum, alternatives, true)],
  ]);
  const run = () => scoreSemantics(testCase, outputs);
  expect(run().status).toBe("pass");
  outputs.set("judge", envelope(["D", "E"], alternatives, true));
  expect(run().checks.judge).toBe("fail");
  outputs.set("judge", envelope(optimum, alternatives.slice(1), true));
  expect(run().checks.judge).toBe("fail");
  outputs.set(
    "b",
    envelope(["D", "E"], [alternatives[0]!, { ...alternatives[1], value: 999 }, alternatives[2]!]),
  );
  expect(run().checks.b).toBe("fail");
  outputs.set("c", envelope(optimum, alternatives));
  expect(run().checks.c).toBe("fail");
});
