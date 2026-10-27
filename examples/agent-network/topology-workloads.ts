import { steps, type Schedule, type VariantId } from "./topology-cases.js";

export const ITEM_IDS = ["A", "B", "C", "D", "E", "F"] as const;
export type ItemId = (typeof ITEM_IDS)[number];
export type Fact =
  | {
      readonly id: string;
      readonly kind: "item";
      readonly item: ItemId;
      readonly cost: number;
      readonly value: number;
    }
  | { readonly id: string; readonly kind: "bounds"; readonly minCost: 0; readonly capacity: number }
  | {
      readonly id: string;
      readonly kind: "dependency";
      readonly item: ItemId;
      readonly requires: ItemId;
    }
  | {
      readonly id: string;
      readonly kind: "incompatibility";
      readonly left: ItemId;
      readonly right: ItemId;
    };
export interface Workload {
  readonly id: VariantId;
  readonly facts: readonly Fact[];
}

function workload(
  id: VariantId,
  capacity: number,
  items: readonly (readonly [number, number])[],
): Workload {
  return {
    id,
    facts: [
      ...items.map((pair, index): Fact => ({
        id: `item-${ITEM_IDS[index]!}`,
        kind: "item",
        item: ITEM_IDS[index]!,
        cost: pair[0],
        value: pair[1],
      })),
      { id: "bounds", kind: "bounds", minCost: 0, capacity },
      { id: "requires-C-A", kind: "dependency", item: "C", requires: "A" },
      { id: "requires-F-A", kind: "dependency", item: "F", requires: "A" },
      { id: "excludes-B-E", kind: "incompatibility", left: "B", right: "E" },
      { id: "excludes-A-D", kind: "incompatibility", left: "A", right: "D" },
    ],
  };
}

// Public problem data only. Keep oracle answers out of worker inputs.
export const WORKLOADS: Readonly<Record<VariantId, Workload>> = {
  V1: workload("V1", 9, [
    [2, 3],
    [3, 6],
    [4, 9],
    [2, 5],
    [5, 12],
    [0, 1],
  ]),
  V2: workload("V2", 10, [
    [3, 5],
    [2, 4],
    [5, 11],
    [4, 8],
    [6, 15],
    [0, 2],
  ]),
  V3: workload("V3", 0, [
    [0, 3],
    [2, 5],
    [3, 7],
    [0, 6],
    [4, 10],
    [0, 2],
  ]),
};

// Assign private facts only on an actor's first turn; revisits inherit context.
// S2 must relay facts AND cumulative proof maps along each declared inbound edge.
export function allocateFacts(
  schedule: Schedule,
  problem: Workload,
): Readonly<Record<string, readonly Fact[]>> {
  const turns = steps(schedule);
  const owners = turns.filter(
    (turn, index) =>
      (schedule.id === "B0-coordinator" || turn.actor !== "coordinator") &&
      !turns.slice(0, index).some((prior) => prior.actor === turn.actor),
  );
  return Object.fromEntries(
    turns.map((turn) => [
      turn.id,
      owners.includes(turn)
        ? schedule.id === "T5-judge" || (schedule.id === "T3-diamond" && turn.role === "reviewer")
          ? problem.facts
          : problem.facts.filter((_, index) => owners[index % owners.length]?.id === turn.id)
        : [],
    ]),
  );
}

export interface FinalAnswer {
  readonly selected: readonly ItemId[];
  readonly cost: number;
  readonly value: number;
  readonly proof: Readonly<Record<string, string>>;
}

// Worker envelope: relay cumulative facts/proofs and acknowledge inbound hashes.
// Pass only the final turn's nested answer to the correctness scorer.
export interface TurnOutput {
  readonly facts: readonly Fact[];
  readonly inputHashes: Readonly<Record<string, string>>;
  readonly proof: Readonly<Record<string, string>>;
  readonly answer: FinalAnswer | null;
  readonly evaluation?: unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isProof(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string" && entry.length > 0)
  );
}

export function isFinalAnswer(value: unknown): value is FinalAnswer {
  if (!isRecord(value) || Object.keys(value).sort().join() !== "cost,proof,selected,value")
    return false;
  return (
    Array.isArray(value.selected) &&
    Array.from(value.selected).every(
      (item: unknown) => typeof item === "string" && ITEM_IDS.some((id) => id === item),
    ) &&
    new Set(value.selected).size === value.selected.length &&
    typeof value.cost === "number" &&
    Number.isSafeInteger(value.cost) &&
    value.cost >= 0 &&
    typeof value.value === "number" &&
    Number.isSafeInteger(value.value) &&
    value.value >= 0 &&
    isProof(value.proof)
  );
}
