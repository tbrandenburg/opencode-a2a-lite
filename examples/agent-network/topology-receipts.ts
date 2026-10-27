import { steps, type Schedule, type Step } from "./topology-cases.js";
import { checked, score, type Check, type Score } from "./topology-scores.js";
import { isFinalAnswer } from "./topology-workloads.js";

export type ObservedState =
  | "completed"
  | "failed"
  | "rejected"
  | "canceled"
  | "pending"
  | "unknown"
  | "uncertain";
// Expectations originate at the host before submission; receipts come from the
// actual worker outputs/returned task handles, not coordinator assertions.
export interface StepExpectation {
  readonly stepId: string;
  readonly peerUrl: string | null;
  readonly marker: string;
  inputHash?: string;
  inputEnvelope?: import("./topology-envelope.js").EnvelopeMetadata;
  workerInputHash?: string;
  submittedContextId?: string | null;
}
export interface StepReceipt {
  readonly stepId: string;
  readonly peerUrl: string | null;
  readonly contextId: string | null;
  readonly taskId: string | null;
  readonly submittedContextId: string | null;
  readonly taskIdOmitted: boolean;
  readonly state: ObservedState;
  // Comparable monotonic execution intervals, not submit-to-final-poll spans.
  readonly started: number;
  readonly ended: number;
  readonly inputHashes: Readonly<Record<string, string>>;
  readonly outputHash: string;
  readonly proof: Readonly<Record<string, string>>;
}
const hash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const nonempty = (value: string | null): value is string =>
  typeof value === "string" && value.length > 0;
const keysEqual = (value: object, keys: readonly string[]) =>
  Object.keys(value).sort().join() === [...keys].sort().join();
const receiptFor = (receipts: readonly StepReceipt[], id: string) =>
  receipts.find((receipt) => receipt.stepId === id);

export function scoreTransport(schedule: Schedule, receipts: readonly StepReceipt[]) {
  const turns = steps(schedule);
  const states: Record<string, Check> = Object.fromEntries(
    turns.map((turn) => {
      const state = receiptFor(receipts, turn.id)?.state;
      return [
        turn.id,
        state === "completed"
          ? "pass"
          : state === "pending"
            ? "pending"
            : !state || state === "unknown" || state === "uncertain"
              ? "unknown"
              : "fail",
      ];
    }),
  );
  return score({
    ...states,
    inventory: checked(
      receipts.length <= turns.length &&
        new Set(receipts.map((receipt) => receipt.stepId)).size === receipts.length &&
        receipts.every((receipt) => turns.some((turn) => turn.id === receipt.stepId)),
    ),
  });
}

function ancestors(turn: Step, turns: readonly Step[]): readonly string[] {
  const inherited = turn.inbound.flatMap((id) =>
    ancestors(
      turns.find((prior) => prior.id === id)!,
      turns,
    ),
  );
  return [...new Set([turn.id, ...inherited])];
}

export type TopologyCheck =
  | "inventory"
  | "markers"
  | "handles"
  | "timing"
  | "overlap"
  | "edges"
  | "proof"
  | "finalProof";
export function scoreTopology(
  schedule: Schedule,
  expectations: readonly StepExpectation[],
  receipts: readonly StepReceipt[],
  answer: unknown,
): Score<TopologyCheck> {
  const turns = steps(schedule);
  const unavailable = {
    inventory: "unknown",
    markers: "unknown",
    handles: "unknown",
    timing: "unknown",
    overlap: "unknown",
    edges: "unknown",
    proof: "unknown",
    finalProof: "unknown",
  } as const;
  const ids = turns.map((turn) => turn.id);
  const valid =
    expectations.length <= turns.length &&
    receipts.length <= turns.length &&
    new Set(expectations.map((entry) => entry.stepId)).size === expectations.length &&
    new Set(receipts.map((entry) => entry.stepId)).size === receipts.length &&
    expectations.every((entry) => ids.includes(entry.stepId)) &&
    receipts.every((entry) => ids.includes(entry.stepId));
  if (!valid) return score({ ...unavailable, inventory: "fail" });
  if (expectations.length < turns.length || receipts.length < turns.length)
    return score(unavailable);
  if (receipts.some((entry) => entry.state !== "completed"))
    return score({
      ...unavailable,
      inventory: "pass",
      proof: receipts.some((entry) => entry.state === "pending") ? "pending" : "unknown",
    });
  const expectation = (id: string) => expectations.find((entry) => entry.stepId === id)!;
  const receipt = (id: string) => receiptFor(receipts, id)!;
  const markers = expectations.map((entry) => entry.marker);
  const peers = turns
    .filter((turn) => turn.actor !== "coordinator" && !turn.sameContextAs)
    .map((turn) => expectation(turn.id).peerUrl);
  const taskKeys = turns
    .filter((turn) => turn.actor !== "coordinator")
    .map((turn) => JSON.stringify([receipt(turn.id).peerUrl, receipt(turn.id).taskId]));
  const handles = turns.every((turn) => {
    const current = receipt(turn.id);
    if (current.peerUrl !== expectation(turn.id).peerUrl || !current.taskIdOmitted) return false;
    if (turn.actor === "coordinator")
      return (
        current.peerUrl === null &&
        current.contextId === null &&
        current.taskId === null &&
        current.submittedContextId === null
      );
    if (!nonempty(current.peerUrl) || !nonempty(current.contextId) || !nonempty(current.taskId))
      return false;
    if (!turn.sameContextAs) return current.submittedContextId === null;
    const prior = receipt(turn.sameContextAs);
    return (
      current.peerUrl === prior.peerUrl &&
      current.contextId === prior.contextId &&
      current.submittedContextId === prior.contextId &&
      current.taskId !== prior.taskId
    );
  });
  const proofMatches = (proof: Readonly<Record<string, string>>, required: readonly string[]) =>
    keysEqual(proof, required) && required.every((id) => proof[id] === expectation(id).marker);
  return score({
    inventory: "pass",
    markers: checked(markers.every(nonempty) && new Set(markers).size === markers.length),
    handles: checked(
      handles && new Set(peers).size === peers.length && new Set(taskKeys).size === taskKeys.length,
    ),
    timing: checked(
      receipts.every(
        (entry) =>
          Number.isFinite(entry.started) &&
          Number.isFinite(entry.ended) &&
          entry.started >= 0 &&
          entry.ended > entry.started,
      ) &&
        schedule.stages.every(
          (stage, index) =>
            index === 0 ||
            Math.min(...stage.map((turn) => receipt(turn.id).started)) >=
              Math.max(...schedule.stages[index - 1]!.map((turn) => receipt(turn.id).ended)),
        ),
    ),
    overlap: checked(
      schedule.stages.every(
        (stage) =>
          stage.length < 2 ||
          Math.max(...stage.map((turn) => receipt(turn.id).started)) <
            Math.min(...stage.map((turn) => receipt(turn.id).ended)),
      ),
    ),
    edges: checked(
      turns.every(
        (turn) =>
          keysEqual(receipt(turn.id).inputHashes, turn.inbound) &&
          turn.inbound.every((id) => receipt(turn.id).inputHashes[id] === receipt(id).outputHash) &&
          hash(receipt(turn.id).outputHash),
      ),
    ),
    proof: checked(
      turns.every((turn) => proofMatches(receipt(turn.id).proof, ancestors(turn, turns))),
    ),
    finalProof:
      answer === undefined
        ? "unknown"
        : checked(isFinalAnswer(answer) && proofMatches(answer.proof, ids)),
  });
}
