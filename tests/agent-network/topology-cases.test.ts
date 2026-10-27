import { expect, test } from "bun:test";
import {
  agentCount,
  BASELINE,
  CASE_MATRIX,
  steps,
  TOPOLOGIES,
} from "../../examples/agent-network/topology-cases.js";
import { allocateFacts, WORKLOADS } from "../../examples/agent-network/topology-workloads.js";

const counts = {
  "T1-pipeline": [6, 6, 7],
  "T2-fanout": [7, 6, 7],
  "T3-diamond": [4, 4, 5],
  "T4-refinement": [3, 2, 3],
  "T5-judge": [4, 4, 5],
  "T6-ring": [7, 6, 7],
  "B0-coordinator": [1, 0, 1],
} as const;

test.each([...TOPOLOGIES, BASELINE])(
  "$id is a bounded staged DAG with reachable private facts",
  (schedule) => {
    const turns = steps(schedule);
    const workers = new Set(
      turns.filter((turn) => turn.actor !== "coordinator").map((turn) => turn.actor),
    );
    expect([turns.length, workers.size, agentCount(schedule)]).toEqual([...counts[schedule.id]]);
    expect(agentCount(schedule)).toBeLessThanOrEqual(7);
    expect(new Set(turns.map((turn) => turn.id)).size).toBe(turns.length);
    expect(turns.at(-1)?.id).toBe(schedule.final);
    const visited = new Map<string, Set<string>>();
    for (const stage of schedule.stages) {
      for (const turn of stage) {
        expect(turn.role.length).toBeGreaterThan(0);
        expect(turn.inbound.every((id) => visited.has(id))).toBe(true);
        if (turn.sameContextAs) {
          const prior = turns.find((entry) => entry.id === turn.sameContextAs)!;
          expect(prior.actor).toBe(turn.actor);
          expect(visited.has(prior.id)).toBe(true);
        }
      }
      stage.forEach((turn) =>
        visited.set(
          turn.id,
          new Set([turn.id, ...turn.inbound.flatMap((id) => [...visited.get(id)!])]),
        ),
      );
    }
    for (const problem of Object.values(WORKLOADS)) {
      const allocation = allocateFacts(schedule, problem);
      const facts = Object.values(allocation).flat();
      expect([...new Set(facts.map((fact) => fact.id))].sort()).toEqual(
        problem.facts.map((fact) => fact.id).sort(),
      );
      expect(new Set(facts.map((fact) => fact.id)).size).toBe(problem.facts.length);
      const received = [...visited.get(schedule.final)!].flatMap((id) => allocation[id]!);
      expect([...new Set(received.map((fact) => fact.id))].sort()).toEqual(
        problem.facts.map((fact) => fact.id).sort(),
      );
      turns
        .filter((turn) => turn.sameContextAs)
        .forEach((turn) => expect(allocation[turn.id]).toEqual([]));
      if (schedule !== BASELINE && !["T3-diamond", "T5-judge"].includes(schedule.id)) {
        expect(
          Object.values(allocation).every(
            (privateFacts) => privateFacts.length < problem.facts.length,
          ),
        ).toBe(true);
      }
      if (schedule.id === "T2-fanout") {
        expect(allocation.synthesize).toEqual([]);
        expect(schedule.stages[0]!.every((turn) => allocation[turn.id]!.length > 0)).toBe(true);
      }
    }
  },
);

test("matrix has exactly three variants of six topologies and the full-fact baseline", () => {
  expect(CASE_MATRIX).toHaveLength(21);
  expect(new Set(CASE_MATRIX.map((entry) => entry.id)).size).toBe(21);
  expect([
    CASE_MATRIX[0]?.schedule.id,
    CASE_MATRIX[7]?.schedule.id,
    CASE_MATRIX[14]?.schedule.id,
  ]).toEqual(["T1-pipeline", "T2-fanout", "T3-diamond"]);
  for (const variant of ["V1", "V2", "V3"] as const) {
    const cases = CASE_MATRIX.filter((entry) => entry.variant === variant);
    expect(cases).toHaveLength(7);
    expect(new Set(cases.map((entry) => entry.schedule.id)).size).toBe(7);
    const allocation = allocateFacts(BASELINE, WORKLOADS[variant]);
    expect(allocation.baseline).toEqual(WORKLOADS[variant].facts);
    expect(Object.keys(allocation)).toEqual(["baseline"]);
  }
});

test("fanout has six concurrent workers; refinement and ring revisit only the original context", () => {
  expect(TOPOLOGIES[1]?.stages[0]?.map((turn) => turn.actor)).toEqual([
    "W1",
    "W2",
    "W3",
    "W4",
    "W5",
    "W6",
  ]);
  expect(TOPOLOGIES[1]?.stages[1]?.[0]?.inbound).toEqual(["f1", "f2", "f3", "f4", "f5", "f6"]);
  expect(steps(TOPOLOGIES[3]!)[2]).toMatchObject({
    actor: "W1",
    sameContextAs: "propose",
    inbound: ["critique"],
  });
  expect(steps(TOPOLOGIES[5]!)[6]).toMatchObject({
    actor: "W1",
    sameContextAs: "p1",
    inbound: ["p6"],
  });
  expect(TOPOLOGIES.flatMap(steps).filter((turn) => turn.sameContextAs)).toHaveLength(2);
});
