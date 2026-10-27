import type { runTopologyCase } from "./topology-run.js";
import { CASE_MATRIX, steps } from "./topology-cases.js";
import { sha256 } from "./topology-evidence.js";
import type { Score } from "./topology-scores.js";

type Result = Awaited<ReturnType<typeof runTopologyCase>>;
export const DIMENSIONS = [
  "transport",
  "topology",
  "semantics",
  "correctness",
  "operations",
] as const;
const auditFields = [
  "connection",
  "event",
  "id",
  "tool",
  "peer",
  "context",
  "task",
  "inputHash",
  "artifactHash",
  "taskId",
  "contextId",
  "state",
  "ok",
  "blocking",
  "taskIdOmitted",
  "reason",
  "at",
] as const;
const catalogTools = [
  "a2a_whoami",
  "a2a_list_agents",
  "a2a_send_message",
  "a2a_send_streaming",
  "a2a_get_task",
  "a2a_cancel_task",
];

// Copy named scalar fields only; even a known field cannot smuggle an object tree.
function scalars(value: Record<string, unknown>, fields: readonly string[]) {
  return Object.fromEntries(
    fields.flatMap((key) => {
      const entry = value[key];
      return typeof entry === "string" ||
        typeof entry === "boolean" ||
        (typeof entry === "number" && Number.isFinite(entry)) ||
        entry === null
        ? [[key, entry]]
        : [];
    }),
  );
}
const stepIds = (result: Result) => {
  const test = CASE_MATRIX.find((test) => test.id === result.id);
  return test ? steps(test.schedule).map((step) => step.id) : [];
};
function projectedScore(value: Score, keys: readonly string[]): Score {
  return {
    status: value.status,
    checks: Object.fromEntries(
      keys
        .filter((key) => Object.hasOwn(value.checks, key))
        .map((key) => [key, value.checks[key]!]),
    ),
    mismatches: Object.fromEntries(
      keys
        .filter((key) => Object.hasOwn(value.mismatches, key))
        .map((key) => [key, value.mismatches[key]!]),
    ),
  };
}
export function reportScores(result: Result) {
  const ids = stepIds(result);
  return {
    transport: projectedScore(result.scores.transport, [...ids, "inventory"]),
    topology: projectedScore(result.scores.topology, [
      "inventory",
      "markers",
      "handles",
      "timing",
      "overlap",
      "edges",
      "proof",
      "finalProof",
    ]),
    semantics: projectedScore(result.scores.semantics, [...ids, "roleBehavior"]),
    correctness: projectedScore(result.scores.correctness, [
      "schema",
      "totals",
      "bounds",
      "dependencies",
      "incompatibilities",
      "optimum",
    ]),
    operations: projectedScore(result.scores.operations, [
      "budget",
      "guardedPath",
      "toolsDenied",
      "boundedDeadlines",
      "inputIntegrity",
      "noHiddenRetries",
      "noUncertainResends",
      "cleanup",
    ]),
  };
}

export function detailEvidence(result: Result) {
  const ids = stepIds(result);
  const map = (values: Readonly<Record<string, string>>, hash = false) =>
    Object.fromEntries(
      ids
        .filter((id) => Object.hasOwn(values, id))
        .map((id) => [id, hash ? sha256(values[id]!) : values[id]!]),
    );
  return {
    expectations: result.expectations.map((entry) => ({
      stepId: entry.stepId,
      peerUrl: entry.peerUrl,
      markerHash: sha256(entry.marker),
      inputHash: entry.inputHash ?? null,
      submittedContextId: entry.submittedContextId ?? null,
    })),
    receipts: result.receipts.map((entry) => ({
      stepId: entry.stepId,
      peerUrl: entry.peerUrl,
      contextId: entry.contextId,
      taskId: entry.taskId,
      submittedContextId: entry.submittedContextId,
      taskIdOmitted: entry.taskIdOmitted,
      state: entry.state,
      started: entry.started,
      ended: entry.ended,
      inputHashes: map(entry.inputHashes),
      outputHash: entry.outputHash,
      proofHashes: map(entry.proof, true),
    })),
    audit: result.audit.map((entry) => ({
      ...scalars(entry, auditFields),
      ...(Array.isArray(entry.tools)
        ? {
            tools: entry.tools.filter(
              (tool: unknown) => typeof tool === "string" && catalogTools.includes(tool),
            ),
          }
        : {}),
    })),
    handles: result.handles.map((entry) =>
      scalars(entry, ["connection", "taskId", "contextId", "state"]),
    ),
    coordinatorTurns: result.coordinatorTurns.map((entry) => ({
      kind: entry.kind,
      started: entry.started,
      ended: entry.ended,
      deadline: entry.deadline,
      completed: entry.completed,
      aborted: entry.aborted,
      inputHash: entry.inputHash,
    })),
    extractionFailures: result.extractionFailures,
    heartbeatFailures: result.heartbeatFailures,
  };
}
