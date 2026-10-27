import type { runTopologyCase } from "./topology-run.js";
import { CASE_MATRIX, steps } from "./topology-cases.js";
import {
  createResultMetadata,
  matchesSubmitted,
  pairedResult,
  sha256,
  submittedIdentifier,
  type Audit,
} from "./topology-evidence.js";
import type { Score } from "./topology-scores.js";
import { envelopeFields, inputDifference } from "./topology-envelope.js";
import { isRecord } from "./topology-workloads.js";

type Result = Awaited<ReturnType<typeof runTopologyCase>>;
type Evidence = Pick<
  Result,
  | "id"
  | "audit"
  | "expectations"
  | "receipts"
  | "coordinatorTurns"
  | "extractionFailures"
  | "heartbeatFailures"
>;
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
const stepIds = (result: Pick<Result, "id">) => {
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
      "parameterPolicy",
      "toolsDenied",
      "boundedDeadlines",
      "inputIntegrity",
      "noHiddenRetries",
      "noUncertainResends",
      "cleanup",
    ]),
  };
}

export function detailEvidence(result: Evidence) {
  const handles = createResultMetadata();
  const audit = result.audit.map((entry) =>
    entry.event === "result"
      ? handles.capture(
          entry,
          result.audit.find(
            (call) => call.event === "call" && pairedResult(call, result.audit) === entry,
          ),
        )
      : entry,
  );
  const submitted = (value: string | null | undefined, peer: string | null) => {
    const filtered = handles.project({ contextId: value ?? null }, peer);
    return Object.hasOwn(filtered, "contextId")
      ? { submittedContextId: filtered.contextId }
      : { submittedContextHash: filtered.contextHash, submittedContextUntrusted: true };
  };
  const hashes = (entry: Audit) =>
    Object.fromEntries(
      ["context", "task"].flatMap((field) => {
        const digest = entry[`${field}Hash`];
        return typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest)
          ? [
              [`${field}Hash`, digest],
              ...(entry[`${field}Untrusted`] === true ? [[`${field}Untrusted`, true]] : []),
            ]
          : [];
      }),
    );
  const ids = stepIds(result);
  const map = (values: Readonly<Record<string, string>>, hash = false) =>
    Object.fromEntries(
      ids
        .filter((id) => Object.hasOwn(values, id))
        .map((id) => [id, hash ? sha256(values[id]!) : values[id]!]),
    );
  const comparison = (entry: Result["expectations"][number]) => {
    const calls = result.audit.filter(
      (call) =>
        call.event === "call" &&
        call.tool === "a2a_send_message" &&
        call.peer === entry.peerUrl &&
        matchesSubmitted(call, "context", entry.submittedContextId ?? null),
    );
    return entry.inputEnvelope && calls.length === 1
      ? inputDifference(entry.inputEnvelope, calls[0]!.inputHash, calls[0]!.inputEnvelope)
      : null;
  };
  return {
    expectations: result.expectations.map((entry) => ({
      stepId: entry.stepId,
      peerUrl: entry.peerUrl,
      markerHash: sha256(entry.marker),
      inputHash: entry.inputHash ?? null,
      workerInputHash: entry.workerInputHash ?? null,
      inputComparison: comparison(entry),
      ...(entry.inputEnvelope ? { inputEnvelope: metadata(entry.inputEnvelope) } : {}),
      ...submitted(entry.submittedContextId, entry.peerUrl),
    })),
    receipts: result.receipts.map((entry) => ({
      stepId: entry.stepId,
      peerUrl: entry.peerUrl,
      ...handles.project({ contextId: entry.contextId, taskId: entry.taskId }, entry.peerUrl),
      ...submitted(entry.submittedContextId, entry.peerUrl),
      taskIdOmitted: entry.taskIdOmitted,
      state: entry.state,
      started: entry.started,
      ended: entry.ended,
      inputHashes: map(entry.inputHashes),
      outputHash: entry.outputHash,
      proofHashes: map(entry.proof, true),
    })),
    audit: audit.map((entry) => ({
      ...scalars(entry, auditFields),
      ...hashes(entry),
      ...(entry.event === "call"
        ? Object.fromEntries(
            (["context", "task"] as const).flatMap((field) => {
              const identifier = submittedIdentifier(entry, field);
              return [
                [`${field}Present`, identifier.present],
                ...(identifier.hash ? [[`${field}Hash`, identifier.hash]] : []),
              ];
            }),
          )
        : {}),
      ...(isRecord(entry.inputEnvelope) ? { inputEnvelope: metadata(entry.inputEnvelope) } : {}),
      ...(Array.isArray(entry.tools)
        ? {
            tools: entry.tools.filter(
              (tool: unknown) => typeof tool === "string" && catalogTools.includes(tool),
            ),
          }
        : {}),
    })),
    handles: audit
      .filter((entry) => entry.event === "result" && typeof entry.taskId === "string")
      .map((entry) => ({
        ...scalars(entry, ["connection", "taskId", "contextId", "state"]),
        ...hashes(entry),
      })),
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

function metadata(value: object) {
  const entry = value as Record<string, unknown>;
  const digest = (value: unknown) =>
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
  return {
    kind: ["known", "invalid", "text"].includes(String(entry.kind)) ? entry.kind : "invalid",
    rawHash: digest(entry.rawHash),
    contract: entry.contract === "topology-envelope-v1" ? entry.contract : null,
    digest: digest(entry.digest),
    fields: Object.fromEntries(
      envelopeFields.flatMap((key) =>
        isRecord(entry.fields) && digest(entry.fields[key]) ? [[key, entry.fields[key]]] : [],
      ),
    ),
  };
}
