import { expect, test } from "bun:test";
import { scoreCorrectness } from "../../examples/agent-network/topology-verdicts.js";
import {
  ITEM_IDS,
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
  "N11-$id fixed oracle is the unique exhaustive optimum",
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
