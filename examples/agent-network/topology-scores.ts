export type Check = "pass" | "fail" | "pending" | "unknown";
export interface Score<K extends string = string> {
  readonly status: Check;
  readonly checks: Readonly<Record<K, Check>>;
  readonly mismatches: Readonly<Record<K, boolean | null>>;
}
export function score<K extends string>(checks: Readonly<Record<K, Check>>): Score<K> {
  const states = Object.values(checks);
  const status = states.includes("fail")
    ? "fail"
    : states.includes("pending")
      ? "pending"
      : states.includes("unknown") || states.length === 0
        ? "unknown"
        : "pass";
  return {
    status,
    checks,
    mismatches: Object.fromEntries(
      Object.entries(checks).map(([key, state]) => [
        key,
        state === "fail" ? true : state === "pass" ? false : null,
      ]),
    ) as Record<K, boolean | null>,
  };
}
export const checked = (condition: boolean): Check => (condition ? "pass" : "fail");

export interface OperationsEvidence {
  readonly connections: readonly { readonly calls: number; readonly interventionCalls: number }[];
  readonly guardedPath: Check;
  readonly toolsDenied: Check;
  readonly boundedDeadlines: Check;
  readonly inputIntegrity: Check;
  readonly noHiddenRetries: Check;
  readonly noUncertainResends: Check;
  readonly cleanup: Check;
}
export type OperationCheck =
  | "budget"
  | "guardedPath"
  | "toolsDenied"
  | "boundedDeadlines"
  | "inputIntegrity"
  | "noHiddenRetries"
  | "noUncertainResends"
  | "cleanup";
export function scoreOperations(
  evidence?: OperationsEvidence,
  mode: "network" | "baseline" = "network",
): Score<OperationCheck> {
  if (!evidence)
    return score({
      budget: "unknown",
      guardedPath: "unknown",
      toolsDenied: "unknown",
      boundedDeadlines: "unknown",
      inputIntegrity: "unknown",
      noHiddenRetries: "unknown",
      noUncertainResends: "unknown",
      cleanup: "unknown",
    });
  return score({
    budget: checked(
      (mode === "baseline" ? evidence.connections.length === 0 : evidence.connections.length > 0) &&
        evidence.connections.every(
          (connection) =>
            Number.isSafeInteger(connection.calls) &&
            connection.calls >= 0 &&
            connection.calls <= 40 &&
            Number.isSafeInteger(connection.interventionCalls) &&
            connection.interventionCalls >= 0 &&
            connection.interventionCalls <= connection.calls &&
            connection.calls - connection.interventionCalls <= 32,
        ),
    ),
    guardedPath: evidence.guardedPath,
    toolsDenied: evidence.toolsDenied,
    boundedDeadlines: evidence.boundedDeadlines,
    inputIntegrity: evidence.inputIntegrity,
    noHiddenRetries: evidence.noHiddenRetries,
    noUncertainResends: evidence.noUncertainResends,
    cleanup: evidence.cleanup,
  });
}

export interface CaseScores {
  readonly transport: Score;
  readonly topology: Score;
  readonly correctness: Score;
  readonly operations: Score;
  readonly semantics?: Score;
}
export function overall(scores: Partial<CaseScores>): "WORKING" | "BROKEN" | "INCOMPLETE" {
  const dimensions = [scores.transport, scores.topology, scores.correctness, scores.operations];
  if (scores.semantics) dimensions.push(scores.semantics);
  if (dimensions.some((result) => result?.status === "fail")) return "BROKEN";
  return dimensions.every((result) => result?.status === "pass") ? "WORKING" : "INCOMPLETE";
}

export function completionStatus(
  scores: Partial<CaseScores>,
  evidence: {
    failed: boolean;
    failureCriterion?: string;
    aborted: boolean;
    turns: readonly { aborted: boolean; completed: boolean }[];
    states: readonly string[];
  },
) {
  const scored = overall(scores);
  if (scored === "BROKEN") return scored;
  const locallyAborted =
    evidence.aborted || evidence.turns.some((turn) => turn.aborted && !turn.completed);
  if (evidence.failed && evidence.failureCriterion === "runtime-error" && !locallyAborted)
    return "BROKEN";
  const incomplete =
    locallyAborted ||
    evidence.states.some((state) => ["pending", "uncertain", "unknown"].includes(state));
  return evidence.failed ? (incomplete ? "INCOMPLETE" : "BROKEN") : scored;
}
