import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { CASE_MATRIX, TOPOLOGIES, BASELINE } from "./topology-cases.js";
import type { runTopologyCase } from "./topology-run.js";
import definition from "./network.json" with { type: "json" };
import { detailEvidence, reportScores, DIMENSIONS } from "./topology-report-evidence.js";

export const NEGATIVE_CASES = [
  "N1-busy-fallback",
  "N2-local-deadline",
  "N3-uncertain-submission",
  "N4-context",
  "N5-contributions",
  "N6-interruption-cleanup",
] as const;
export type NegativeId = (typeof NEGATIVE_CASES)[number];
type Result = Awaited<ReturnType<typeof runTopologyCase>>;
// Persist an explicit projection. Never serialize raw observations, answers, prompts or diagnostics.
export function caseRecord(result: Result) {
  return {
    id: result.id,
    evidenceClass: "live-model" as const,
    status: result.status,
    scores: reportScores(result),
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    recordedAt: new Date().toISOString(),
    modelIssuedMcp: result.modelIssuedMcp,
    baseline: result.id.endsWith("/B0-coordinator"),
    elapsedMs: result.elapsedMs,
    attempts: result.audit.filter((entry) => ["call", "rejected"].includes(String(entry.event)))
      .length,
    completed:
      result.receipts.length ===
        CASE_MATRIX.find((test) => test.id === result.id)?.schedule.stages.flat().length &&
      result.receipts.every((receipt) => receipt.state === "completed"),
    cleanup: { passed: result.cleanup.passed, failures: result.cleanup.failures },
    deadlineExpired: result.deadlineExpired,
    interrupted: result.interrupted,
    failure: result.failure
      ? {
          phase: result.failure.phase,
          kind: result.failure.kind,
          frame: result.failure.frame,
          criterion: result.failure.criterion,
          ...(result.failure.mismatch ? { mismatch: result.failure.mismatch } : {}),
          ...(result.failure.contributions ? { contributions: result.failure.contributions } : {}),
        }
      : null,
  };
}
export type CaseRecord = ReturnType<typeof caseRecord>;
export interface NegativeRecord {
  id: NegativeId;
  evidenceClass: "provider-free-controlled-ACP";
  status: "WORKING" | "BROKEN" | "INCOMPLETE";
  criteria: readonly string[];
  cleanup: boolean | null;
  attempts: number | null;
}

export function aggregate(results: readonly CaseRecord[], negatives: readonly NegativeRecord[]) {
  const rows = [...TOPOLOGIES, BASELINE].map((schedule) => {
    const observed = results.filter((result) => result.id.endsWith(`/${schedule.id}`));
    const scored = observed.filter((result) =>
      ["pass", "fail"].includes(result.scores.correctness.status),
    );
    const correct = scored.filter((result) => result.scores.correctness.status === "pass").length;
    return {
      id: schedule.id,
      planned: 3,
      observed: observed.length,
      completed: observed.filter((result) => result.completed).length,
      scored: scored.length,
      correct,
      correctRatio: scored.length ? correct / scored.length : null,
      working: observed.filter((result) => result.status === "WORKING").length,
      latencyMs: observed.length
        ? [
            Math.min(...observed.map((result) => result.elapsedMs)),
            Math.max(...observed.map((result) => result.elapsedMs)),
          ]
        : null,
      attempts: observed.reduce((total, result) => total + result.attempts, 0),
      cleanupFailures: observed.filter((result) => !result.cleanup.passed).length,
      dimensions: Object.fromEntries(
        DIMENSIONS.map((dimension) => [
          dimension,
          Object.fromEntries(
            ["pass", "fail", "pending", "unknown"].map((state) => [
              state,
              observed.filter((result) => result.scores[dimension].status === state).length,
            ]),
          ),
        ]),
      ),
    };
  });
  const missing = [...CASE_MATRIX.map((test) => test.id), ...NEGATIVE_CASES].filter(
    (id) =>
      !results.some((result) => result.id === id) && !negatives.some((result) => result.id === id),
  );
  const broken =
    results.some(
      (result) =>
        result.status === "BROKEN" ||
        !result.cleanup.passed ||
        Object.values(result.scores).some((score) => score.status === "fail"),
    ) || negatives.some((result) => result.status === "BROKEN" || result.cleanup === false);
  const incomplete =
    missing.length > 0 ||
    results.some(
      (result) =>
        result.status === "INCOMPLETE" ||
        Object.values(result.scores).some((score) => !["pass", "fail"].includes(score.status)),
    ) ||
    negatives.some((result) => result.status === "INCOMPLETE");
  return {
    planned: 27,
    observed: results.length + negatives.length,
    missing,
    complete: !incomplete,
    status: broken ? "BROKEN" : incomplete ? "INCOMPLETE" : "WORKING",
    rows,
    tokenUsage: "unmeasured",
    cost: "unmeasured",
    recommendation: incomplete
      ? "Conditional only: missing or unscored cases prevent a comparative verdict."
      : broken
        ? "Conditional only: inspect independent correctness, role semantics and operational failures before adopting a topology. Prefer coordinator-only unless collaboration benefit outweighs measured overhead."
        : "These fixed schedules worked for these workloads; choose the smallest schedule meeting the task's information and review needs. This is not evidence of arbitrary graph orchestration.",
  };
}

export function createInvestigationReport(
  parent = ".test-results/topology-investigation",
  plan?: {
    live: boolean;
    faults: boolean;
    caseMs: number;
    turnMs: number;
    selected: readonly string[];
  },
) {
  const root = join(parent, randomUUID());
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const records: CaseRecord[] = [];
  const negatives: NegativeRecord[] = [];
  const metadata = {
    runId: root.split("/").at(-1),
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    versions: {
      bun: "1.3.9",
      opencode: "2.0.28",
      bridge: definition.bridgeVersion,
      bridgeBinarySha256: definition.bridgeBinarySha256,
      a2a: "1.0",
      model: definition.model,
    },
    rawContentRetained: false,
    tokenUsage: "unmeasured",
    cost: "unmeasured",
    plan: plan ?? null,
  };
  const write = (name: string, value: string) => {
    const target = join(root, name);
    writeFileSync(target + ".tmp", value, { mode: 0o600 });
    renameSync(target + ".tmp", target);
  };
  const persist = () => {
    const summary = aggregate(records, negatives);
    write(
      "summary.json",
      JSON.stringify(
        { metadata, recordedAt: new Date().toISOString(), ...summary, cases: records, negatives },
        null,
        2,
      ),
    );
    write(
      "findings.md",
      `# Topology investigation\n\nStatus: ${summary.status}; complete: ${summary.complete}. ${summary.observed}/27 observations.\n\n` +
        "Live-model and provider-free-controlled-ACP evidence are separate. Baselines are not MCP evidence. Token usage and cost: unmeasured.\n\n" +
        "| Schedule | Planned | Completed | Scored | Correct | Correct/scored | Working | Latency ms range | MCP attempts | Cleanup failures |\n|---|---:|---:|---:|---:|---:|---:|---|---:|---:|\n" +
        summary.rows
          .map(
            (row) =>
              `| ${row.id} | ${row.planned} | ${row.completed} | ${row.scored} | ${row.correct} | ${row.correctRatio ?? "unmeasured"} | ${row.working} | ${row.latencyMs?.map(Math.round).join("–") ?? "unmeasured"} | ${row.attempts} | ${row.cleanupFailures} |`,
          )
          .join("\n") +
        "\n\n## Independent dimension counts\n\n| Schedule | Dimension | Pass | Fail | Pending | Unknown |\n|---|---|---:|---:|---:|---:|\n" +
        summary.rows
          .flatMap((row) =>
            DIMENSIONS.map((dimension) => {
              const counts = row.dimensions[dimension]!;
              return `| ${row.id} | ${dimension} | ${counts.pass} | ${counts.fail} | ${counts.pending} | ${counts.unknown} |`;
            }),
          )
          .join("\n") +
        `\n\n## Conditional recommendation\n${summary.recommendation}\n\n## Missing cases\n${summary.missing.join(", ") || "None"}\n\n## Failure criteria\n` +
        records
          .filter((result) => result.status !== "WORKING")
          .map(
            (result) =>
              `- ${result.id}: ${result.status}; ${result.failure?.frame ?? "score checks"}; ${result.failure?.criterion ?? "dimension mismatch"}; failed checks: ${
                Object.entries(result.scores)
                  .flatMap(([dimension, score]) =>
                    Object.entries(score.checks)
                      .filter(([, state]) => state === "fail")
                      .map(([check]) => `${dimension}.${check}`),
                  )
                  .join(", ") || "none observed; incomplete evidence"
              }`,
          )
          .join("\n") +
        "\n\n## Controlled negative experiments\n" +
        negatives
          .map(
            (result) =>
              `- ${result.id}: ${result.status}; cleanup=${result.cleanup}; ${result.criteria.join("; ")}`,
          )
          .join("\n") +
        "\n",
    );
  };
  persist();
  return {
    root,
    persist,
    finish() {
      metadata.finishedAt = new Date().toISOString();
      persist();
    },
    summary: () => aggregate(records, negatives),
    record(result: Result) {
      if (!CASE_MATRIX.some((test) => test.id === result.id))
        throw new Error("Unknown case result");
      const record = caseRecord(result);
      if (records.some((entry) => entry.id === record.id)) throw new Error("Duplicate case result");
      records.push(record);
      write(
        `${record.id.replace("/", "-")}.json`,
        JSON.stringify({ ...record, evidence: detailEvidence(result) }, null, 2),
      );
      persist();
    },
    negative(result: NegativeRecord) {
      if (negatives.some((entry) => entry.id === result.id))
        throw new Error("Duplicate negative result");
      negatives.push(result);
      write(`${result.id}.json`, JSON.stringify(result, null, 2));
      persist();
    },
  };
}
