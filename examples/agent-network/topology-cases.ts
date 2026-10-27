export type WorkerId = "W1" | "W2" | "W3" | "W4" | "W5" | "W6";
export type Actor = WorkerId | "coordinator";
export type TopologyId =
  | "T1-pipeline"
  | "T2-fanout"
  | "T3-diamond"
  | "T4-refinement"
  | "T5-judge"
  | "T6-ring";
export type ScheduleId = TopologyId | "B0-coordinator";
export type VariantId = "V1" | "V2" | "V3";
export interface Step {
  readonly id: string;
  readonly actor: Actor;
  readonly role: string;
  readonly inbound: readonly string[];
  readonly sameContextAs?: string;
}
export interface Schedule {
  readonly id: ScheduleId;
  // Stages are barriers. Multi-turn stages require measured, common overlap.
  readonly stages: readonly (readonly Step[])[];
  readonly final: string;
}
const workers: readonly WorkerId[] = ["W1", "W2", "W3", "W4", "W5", "W6"];
const step = (id: string, actor: Actor, role: string, inbound: readonly string[] = []): Step => ({
  id,
  actor,
  role,
  inbound,
});
const pipeline = workers.map((actor, index) => [
  step(`p${index + 1}`, actor, "relay-solver", index ? [`p${index}`] : []),
]);
export const TOPOLOGIES: readonly Schedule[] = [
  { id: "T1-pipeline", stages: pipeline, final: "p6" },
  {
    id: "T2-fanout",
    stages: [
      workers.map((actor, index) => step(`f${index + 1}`, actor, "analyst")),
      [
        step(
          "synthesize",
          "coordinator",
          "synthesizer",
          workers.map((_, i) => `f${i + 1}`),
        ),
      ],
    ],
    final: "synthesize",
  },
  {
    id: "T3-diamond",
    stages: [
      [step("plan", "W1", "planner")],
      [step("reviewA", "W2", "reviewer", ["plan"]), step("reviewB", "W3", "reviewer", ["plan"])],
      [step("integrate", "W4", "integrator", ["reviewA", "reviewB"])],
    ],
    final: "integrate",
  },
  {
    id: "T4-refinement",
    stages: [
      [step("propose", "W1", "proposer")],
      [step("critique", "W2", "critic", ["propose"])],
      [{ ...step("refine", "W1", "proposer", ["critique"]), sameContextAs: "propose" }],
    ],
    final: "refine",
  },
  {
    id: "T5-judge",
    stages: [
      [step("a", "W1", "proposer"), step("b", "W2", "proposer"), step("c", "W3", "proposer")],
      [step("judge", "W4", "judge", ["a", "b", "c"])],
    ],
    final: "judge",
  },
  {
    id: "T6-ring",
    stages: [
      ...pipeline,
      [{ ...step("revisit", "W1", "ring-closer", ["p6"]), sameContextAs: "p1" }],
    ],
    final: "revisit",
  },
];
export const BASELINE: Schedule = {
  id: "B0-coordinator",
  stages: [[step("baseline", "coordinator", "full-fact-solver")]],
  final: "baseline",
};
export interface ExperimentCase {
  readonly id: string;
  readonly variant: VariantId;
  readonly schedule: Schedule;
}
// Rotate the baseline too, rather than always putting it first or last.
export const CASE_MATRIX: readonly ExperimentCase[] = (["V1", "V2", "V3"] as const).flatMap(
  (variant, rotation) => {
    const schedules = [...TOPOLOGIES, BASELINE];
    return [...schedules.slice(rotation), ...schedules.slice(0, rotation)].map((schedule) => ({
      id: `${variant}/${schedule.id}`,
      variant,
      schedule,
    }));
  },
);

export function steps(schedule: Schedule): readonly Step[] {
  return schedule.stages.flat();
}

export function agentCount(schedule: Schedule): number {
  return new Set<Actor>(["coordinator", ...steps(schedule).map((turn) => turn.actor)]).size;
}
