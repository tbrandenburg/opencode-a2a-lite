import { expect, test } from "bun:test";
import { scoreCorrectness } from "../../examples/agent-network/topology-verdicts.js";
import {
  ITEM_IDS,
  isFinalAnswer,
  WORKLOADS,
  type FinalAnswer,
} from "../../examples/agent-network/topology-workloads.js";

// Test-owned fixed answers, independently checked against all 64 subsets below.
const expected = {
  V1: { selected: ["A", "B", "C", "F"], cost: 9, value: 19, proof: {} },
  V2: { selected: ["D", "E"], cost: 10, value: 23, proof: {} },
  V3: { selected: ["D"], cost: 0, value: 6, proof: {} },
} satisfies Record<string, FinalAnswer>;

test.each(Object.values(WORKLOADS))(
  "$id fixed oracle is the unique exhaustive optimum",
  (problem) => {
    const candidates = Array.from({ length: 64 }, (_, mask) => {
      const selected = ITEM_IDS.filter((_, bit) => (mask & (1 << bit)) !== 0);
      const selectedItems = problem.facts
        .filter((fact) => fact.kind === "item")
        .filter((fact) => selected.includes(fact.item));
      const cost = selectedItems.reduce((sum, item) => sum + item.cost, 0);
      const value = selectedItems.reduce((sum, item) => sum + item.value, 0);
      const bounds = problem.facts.find((fact) => fact.kind === "bounds")!;
      const affordable = cost >= 0 && cost <= bounds.capacity;
      const dependencies = problem.facts
        .filter((fact) => fact.kind === "dependency")
        .every((rule) => !selected.includes(rule.item) || selected.includes(rule.requires));
      const compatible = problem.facts
        .filter((fact) => fact.kind === "incompatibility")
        .every((rule) => !(selected.includes(rule.left) && selected.includes(rule.right)));
      const answer = { selected, cost, value, proof: {} };
      const result = scoreCorrectness(problem.id, answer);
      expect(result.checks.bounds).toBe(affordable ? "pass" : "fail");
      expect(result.checks.dependencies).toBe(dependencies ? "pass" : "fail");
      expect(result.checks.incompatibilities).toBe(compatible ? "pass" : "fail");
      expect(result.status).toBe(
        selected.join() === expected[problem.id].selected.join() ? "pass" : "fail",
      );
      return { answer, feasible: affordable && dependencies && compatible };
    });
    const feasible = candidates.filter((candidate) => candidate.feasible);
    const maximum = Math.max(...feasible.map((candidate) => candidate.answer.value));
    const optima = feasible.filter((candidate) => candidate.answer.value === maximum);
    expect(candidates).toHaveLength(64);
    expect(optima.map((candidate) => candidate.answer)).toEqual([expected[problem.id]]);
    expect(feasible.some((candidate) => candidate.answer.selected.length === 0)).toBe(true);
    expect(problem.facts).toHaveLength(11);
    expect(JSON.stringify(problem)).not.toContain('"selected"');
  },
);

const valid = expected.V1;
test.each(
  [
    null,
    "not-json",
    [],
    {},
    { ...valid, extra: true },
    { ...valid, selected: ["A", "A", "B", "C", "F"] },
    { ...valid, selected: ["G"] },
    { ...valid, selected: [0] },
    { ...valid, selected: Array(1) },
    { ...valid, selected: "ABCF" },
    { ...valid, cost: NaN },
    { ...valid, cost: Infinity },
    { ...valid, cost: -1 },
    { ...valid, cost: 9.5 },
    { ...valid, cost: "9" },
    { ...valid, value: NaN },
    { ...valid, value: -1 },
    { ...valid, value: 19.5 },
    { ...valid, value: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, proof: null },
    { ...valid, proof: [] },
    { ...valid, proof: new Map() },
    { ...valid, proof: { p1: 123 } },
    { ...valid, proof: { p1: "" } },
  ].map((answer) => ({ answer })),
)("malformed answer %# cannot pass schema or correctness", (input) => {
  const answer = input.answer;
  expect(isFinalAnswer(answer)).toBe(false);
  expect(scoreCorrectness("V1", answer).status).toBe("fail");
  expect(scoreCorrectness("V1", answer).mismatches.schema).toBe(true);
});

test("wrong totals, constraints, and suboptimal feasible answers have independent mismatch flags", () => {
  const wrongTotals = scoreCorrectness("V1", { ...valid, cost: 8, value: 18 });
  expect(wrongTotals.checks.totals).toBe("fail");
  expect(wrongTotals.checks.dependencies).toBe("pass");
  expect(
    scoreCorrectness("V1", { selected: ["C"], cost: 4, value: 9, proof: {} }).checks.dependencies,
  ).toBe("fail");
  expect(
    scoreCorrectness("V1", { selected: ["B", "E"], cost: 8, value: 18, proof: {} }).checks
      .incompatibilities,
  ).toBe("fail");
  const suboptimal = scoreCorrectness("V1", { selected: [], cost: 0, value: 0, proof: {} });
  expect(suboptimal.checks.totals).toBe("pass");
  expect(suboptimal.checks.optimum).toBe("fail");
  expect(scoreCorrectness("V1", { ...valid, selected: ["F", "C", "B", "A"] }).status).toBe("pass");
  expect(scoreCorrectness("V1", undefined)).toMatchObject({
    status: "unknown",
    mismatches: { schema: null },
  });
});
