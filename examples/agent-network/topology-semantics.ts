import type { ExperimentCase, Step } from "./topology-cases.js";
import { parseTurn } from "./topology-evidence.js";
import { checked, score, type Score } from "./topology-scores.js";
import { ITEM_IDS, isRecord, WORKLOADS, type ItemId } from "./topology-workloads.js";

export const HYPOTHESES: readonly (readonly ItemId[])[] = [["A", "B", "C", "F"], ["D", "E"], ["D"]];
export const REFINE_SEED: readonly ItemId[] = ["B", "E"];
export const CONFLICT_SEEDS: readonly (readonly ItemId[])[] = [
  ["B", "E"],
  ["A", "D"],
];
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const selection = (value: unknown): value is ItemId[] =>
  Array.isArray(value) &&
  value.every((item) => ITEM_IDS.includes(item)) &&
  new Set(value).size === value.length &&
  same(value, [...value].sort());

// Facts, not recommendations or vote counts, are authoritative. No optimization oracle here.
export function assessCandidate(test: ExperimentCase, selected: readonly ItemId[]) {
  const facts = WORKLOADS[test.variant].facts;
  const items = facts
    .filter((fact) => fact.kind === "item")
    .filter((fact) => selected.includes(fact.item));
  const cost = items.reduce((total, item) => total + item.cost, 0);
  const value = items.reduce((total, item) => total + item.value, 0);
  const violations = facts
    .flatMap((fact) => {
      if (fact.kind === "bounds")
        return cost > fact.capacity || cost < fact.minCost ? [fact.id] : [];
      if (fact.kind === "dependency")
        return selected.includes(fact.item) && !selected.includes(fact.requires) ? [fact.id] : [];
      if (fact.kind === "incompatibility")
        return selected.includes(fact.left) && selected.includes(fact.right) ? [fact.id] : [];
      return [];
    })
    .sort();
  return { selected, cost, value, feasible: violations.length === 0, violations };
}

export function roleInstructions(turn: Step) {
  const common = `evaluation is null unless specified below. Otherwise it has exactly candidate,assessments,revisedFrom,resolution. candidate/revisedFrom are sorted item arrays or null; assessments contains {selected,cost,value,feasible,violations}, with violations sorted authoritative fact IDs. resolution is null or "authoritative-facts". Hypotheses are NOT facts. Assess independently, never vote. Feasibility precedes value; ties use lower cost then lexical selected. Partial knowledge permits a provisional hypothesis, not invented facts.`;
  if (turn.id === "propose")
    return `${common} Preserve seeded provisional hypothesis ${JSON.stringify(REFINE_SEED)} as candidate, assessments:[], revisedFrom:null,resolution:null. It is intentionally attractive but unverified; critic supplies missing facts.`;
  if (turn.id === "critique")
    return `${common} Evaluate inbound candidate against the now-complete facts. assessments must contain that candidate with exact totals and violations. candidate must propose a feasible correction maximizing value; revisedFrom is the inbound candidate; resolution:"authoritative-facts".`;
  if (turn.id === "refine")
    return `${common} Read critic assessments, independently verify them in assessments, and change the infeasible proposal to the critic's feasible correction. candidate equals final selected; revisedFrom is original proposal; resolution:"authoritative-facts".`;
  if (["a", "b", "c", "judge"].includes(turn.id)) {
    const assigned = HYPOTHESES[["a", "b", "c"].indexOf(turn.id)];
    return `${common} Independently evaluate EACH of these three competing hypotheses: ${JSON.stringify(HYPOTHESES)}. Put three complete assessments in that order. ${assigned ? `Your assigned competing candidate is ${JSON.stringify(assigned)}; preserve it as candidate even when infeasible.` : "Judge must verify inbound assessments and choose the feasible highest-value hypothesis (cost then lexical tie-break), not majority voting; final selected equals candidate."} revisedFrom:null,resolution:"authoritative-facts".`;
  }
  if (["reviewA", "reviewB"].includes(turn.id)) {
    const seed = CONFLICT_SEEDS[turn.id === "reviewA" ? 0 : 1];
    return `${common} Deliberately conflicting recommendation hypothesis: ${JSON.stringify(seed)}. Keep it as candidate even when invalid; assess it honestly against the complete facts. revisedFrom:null,resolution:"authoritative-facts". Integrator must reject unsupported recommendations.`;
  }
  if (turn.id === "integrate")
    return `${common} Resolve conflicting inbound recommendations using authoritative workload facts over either recommendation. Independently assess both ${JSON.stringify(CONFLICT_SEEDS)} in that order. candidate equals final selected and must reject both infeasible hypotheses; revisedFrom:null,resolution:"authoritative-facts".`;
  return common;
}

export function scoreSemantics(test: ExperimentCase, outputs: ReadonlyMap<string, string>): Score {
  const applicable = ["T3-diamond", "T4-refinement", "T5-judge"].includes(test.schedule.id);
  if (!applicable) return score({ roleBehavior: "pass" });
  const required = test.schedule.stages.flat().filter((turn) => turn.id !== "plan");
  return score(
    Object.fromEntries(
      required.map((turn) => {
        const raw = outputs.get(turn.id);
        if (raw === undefined) return [turn.id, "unknown"];
        try {
          const output = parseTurn(raw);
          const evaluation = output.evaluation;
          if (
            !isRecord(evaluation) ||
            Object.keys(evaluation).sort().join() !==
              "assessments,candidate,resolution,revisedFrom" ||
            !selection(evaluation.candidate)
          )
            return [turn.id, "fail"];
          const candidate = evaluation.candidate;
          const expectedSeeds =
            test.schedule.id === "T5-judge"
              ? HYPOTHESES
              : turn.id === "integrate"
                ? CONFLICT_SEEDS
                : turn.id === "reviewA"
                  ? [CONFLICT_SEEDS[0]!]
                  : turn.id === "reviewB"
                    ? [CONFLICT_SEEDS[1]!]
                    : [REFINE_SEED];
          if (turn.id === "propose")
            return [
              turn.id,
              checked(
                same(candidate, REFINE_SEED) &&
                  same(evaluation.assessments, []) &&
                  evaluation.revisedFrom === null &&
                  evaluation.resolution === null &&
                  output.answer === null,
              ),
            ];
          const assessments = expectedSeeds.map((seed) => assessCandidate(test, seed));
          // Compare structured values, not JSON object property ordering.
          const validAssessments =
            Array.isArray(evaluation.assessments) &&
            evaluation.assessments.length === assessments.length &&
            evaluation.assessments.every((entry, index) => {
              const expected = assessments[index]!;
              return (
                isRecord(entry) &&
                Object.keys(entry).sort().join() === "cost,feasible,selected,value,violations" &&
                same(entry.selected, expected.selected) &&
                entry.cost === expected.cost &&
                entry.value === expected.value &&
                entry.feasible === expected.feasible &&
                same(entry.violations, expected.violations)
              );
            });
          const correction = assessCandidate(test, candidate).feasible;
          const final = turn.id === test.schedule.final;
          const finalMatches = !final || same(output.answer?.selected, candidate);
          const revising = ["critique", "refine"].includes(turn.id);
          const revision =
            !revising ||
            (same(evaluation.revisedFrom, REFINE_SEED) &&
              !same(candidate, REFINE_SEED) &&
              correction);
          const critique = outputs.get("critique");
          const followsReview =
            turn.id !== "refine" ||
            (critique !== undefined &&
              same(
                candidate,
                (parseTurn(critique).evaluation as Record<string, unknown> | undefined)?.candidate,
              ));
          const best = [...assessments]
            .filter((entry) => entry.feasible)
            .sort(
              (a, b) =>
                b.value - a.value ||
                a.cost - b.cost ||
                a.selected.join().localeCompare(b.selected.join()),
            )[0];
          const competing = ["a", "b", "c"].indexOf(turn.id);
          const recommendation =
            competing >= 0
              ? same(candidate, HYPOTHESES[competing])
              : turn.id === "reviewA" || turn.id === "reviewB"
                ? same(candidate, expectedSeeds[0])
                : test.schedule.id === "T5-judge"
                  ? same(candidate, best?.selected)
                  : correction;
          return [
            turn.id,
            checked(
              validAssessments &&
                evaluation.resolution === "authoritative-facts" &&
                (revising || evaluation.revisedFrom === null) &&
                revision &&
                followsReview &&
                recommendation &&
                finalMatches,
            ),
          ];
        } catch {
          return [turn.id, "fail"];
        }
      }),
    ),
  );
}
