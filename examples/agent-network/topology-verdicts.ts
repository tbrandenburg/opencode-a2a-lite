import type { VariantId } from "./topology-cases.js";
import { checked, score, type Score } from "./topology-scores.js";
import { isFinalAnswer, WORKLOADS, type FinalAnswer } from "./topology-workloads.js";

// Fixed oracle, not a solver. Never include these values in a worker prompt.
const EXPECTED: Readonly<Record<VariantId, Omit<FinalAnswer, "proof">>> = {
  V1: { selected: ["A", "B", "C", "F"], cost: 9, value: 19 },
  V2: { selected: ["D", "E"], cost: 10, value: 23 },
  V3: { selected: ["D"], cost: 0, value: 6 },
};

export type CorrectnessCheck =
  | "schema"
  | "totals"
  | "bounds"
  | "dependencies"
  | "incompatibilities"
  | "optimum";
export function scoreCorrectness(variant: VariantId, answer: unknown): Score<CorrectnessCheck> {
  const unavailable = {
    schema: "unknown",
    totals: "unknown",
    bounds: "unknown",
    dependencies: "unknown",
    incompatibilities: "unknown",
    optimum: "unknown",
  } as const;
  if (answer === undefined) return score(unavailable);
  if (!isFinalAnswer(answer)) return score({ ...unavailable, schema: "fail" });
  const facts = WORKLOADS[variant].facts;
  const items = facts
    .filter((fact) => fact.kind === "item")
    .filter((fact) => answer.selected.includes(fact.item));
  const cost = items.reduce((total, item) => total + item.cost, 0);
  const value = items.reduce((total, item) => total + item.value, 0);
  const expected = EXPECTED[variant];
  return score({
    schema: "pass",
    totals: checked(answer.cost === cost && answer.value === value),
    bounds: checked(
      facts.every(
        (fact) => fact.kind !== "bounds" || (cost >= fact.minCost && cost <= fact.capacity),
      ),
    ),
    dependencies: checked(
      facts.every(
        (fact) =>
          fact.kind !== "dependency" ||
          !answer.selected.includes(fact.item) ||
          answer.selected.includes(fact.requires),
      ),
    ),
    incompatibilities: checked(
      facts.every(
        (fact) =>
          fact.kind !== "incompatibility" ||
          !answer.selected.includes(fact.left) ||
          !answer.selected.includes(fact.right),
      ),
    ),
    optimum: checked(
      [...answer.selected].sort().join() === [...expected.selected].sort().join() &&
        answer.cost === expected.cost &&
        answer.value === expected.value,
    ),
  });
}

export { overall, scoreOperations } from "./topology-scores.js";
export { scoreTopology, scoreTransport } from "./topology-receipts.js";
export type { Check, Score, OperationsEvidence, CaseScores } from "./topology-scores.js";
