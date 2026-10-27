import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  NEGATIVE_CASES,
  type createInvestigationReport,
  type NegativeId,
} from "./topology-report.js";
import { isRecord } from "./topology-workloads.js";

type Report = ReturnType<typeof createInvestigationReport>;
export function faultVerdict(id: NegativeId, receipt: unknown, exited: boolean, aborted: boolean) {
  const evidence =
    isRecord(receipt) && Array.isArray(receipt.subcases)
      ? receipt.subcases.find((entry: unknown) => isRecord(entry) && entry.id === id)
      : undefined;
  const cleanup =
    isRecord(receipt) && typeof receipt.cleanup === "boolean" ? receipt.cleanup : null;
  const failedStage = isRecord(receipt) ? receipt.failedStage : null;
  const stages: Partial<Record<NegativeId, readonly string[]>> = {
    "N1-busy-fallback": ["busy-and-explicit-fallback", "independent-fallback"],
    "N2-local-deadline": ["local-deadlines-and-explicit-cancel"],
    "N3-uncertain-submission": ["submission-uncertainty", "receipts-and-budget"],
    "N4-context": ["failures-and-cancel-races"],
    "N5-contributions": ["missing-and-conflicting-contributions"],
  };
  const failed =
    !aborted &&
    (isRecord(evidence) ||
      (typeof failedStage === "string" && stages[id]?.includes(failedStage)) ||
      (isRecord(receipt) && receipt.cleanup === false));
  const stageFailed = typeof failedStage === "string" && stages[id]?.includes(failedStage);
  const passed =
    isRecord(evidence) &&
    evidence.passed === true &&
    cleanup === true &&
    !stageFailed &&
    isRecord(receipt) &&
    ((exited && receipt.failed === false) ||
      (!exited && receipt.failed === true && typeof failedStage === "string"));
  return {
    status: passed ? ("WORKING" as const) : failed ? ("BROKEN" as const) : ("INCOMPLETE" as const),
    cleanup,
    attempts:
      isRecord(evidence) && typeof evidence.attemptedCalls === "number"
        ? evidence.attemptedCalls
        : null,
  };
}
// These are controlled real-bridge fixtures, never live-model delegation.
export async function runFaultExperiments(report: Report, signal: AbortSignal) {
  const interop = join(report.root, "controlled-interop.json");
  const lifecycle = join(report.root, "controlled-lifecycle.jsonl");
  const run = async (args: string[], extra: Record<string, string>, interruptible = true) => {
    const child = Bun.spawn([process.execPath, ...args], {
      env: { PATH: process.env.PATH, A2ABRIDGE_BIN: process.env.A2ABRIDGE_BIN, ...extra },
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
      ...(interruptible ? { signal } : {}),
      timeout: 180_000,
    });
    return (await child.exited) === 0;
  };
  const read = (file: string): unknown =>
    existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
  try {
    signal.throwIfAborted();
    const exited = await run(["tests/agent-network/interop.ts"], { A2A_INTEROP_REPORT: interop });
    const receipt = read(interop);
    for (const id of NEGATIVE_CASES.slice(0, 5)) {
      report.negative({
        id,
        evidenceClass: "provider-free-controlled-ACP",
        ...faultVerdict(id, receipt, exited, signal.aborted),
        criteria: [criteria[id]],
      });
    }
    if (signal.aborted) return;
    const clean = await run(
      [
        "test",
        "tests/agent-network/lifecycle.test.ts",
        "--test-name-pattern",
        "drains owned TCP and child resources despite evidence failure",
      ],
      { A2A_LIFECYCLE_REPORT: lifecycle },
      false,
    );
    const records: unknown[] = existsSync(lifecycle)
      ? readFileSync(lifecycle, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
    const verified =
      clean &&
      ["SIGINT", "SIGTERM"].every((signal) =>
        records.some(
          (entry) =>
            isRecord(entry) &&
            entry.signal === signal &&
            entry.ownedPidExited === true &&
            entry.ownedPortReleased === true &&
            entry.evidenceFailureRetained === true &&
            entry.partialReportRetained === true,
        ),
      );
    report.negative({
      id: "N6-interruption-cleanup",
      evidenceClass: "provider-free-controlled-ACP",
      status: verified ? "WORKING" : signal.aborted ? "INCOMPLETE" : "BROKEN",
      criteria: [criteria["N6-interruption-cleanup"]],
      cleanup: verified ? true : null,
      attempts: null,
    });
  } finally {
    // Keep sanitized assertion receipts for independent inspection. No fixture prompts or logs.
    report.persist();
  }
}
const criteria: Record<NegativeId, string> = {
  "N1-busy-fallback":
    "Busy gateway fails without ACP execution; explicit other-peer fallback completes while original stays pending.",
  "N2-local-deadline":
    "Local deadline returns pending with unchanged handle within bounded scheduling headroom; no implicit remote cancel.",
  "N3-uncertain-submission":
    "Paused owned bridge causes uncertain submission without handle; guarded receipt proves exactly one submission and no resend.",
  "N4-context":
    "Wrong-peer handle rejected without call; stale remote context fails without silent replacement.",
  "N5-contributions":
    "Real controlled ACP missing and altered facts are each rejected by production experiment contribution validator (expected BROKEN topology).",
  "N6-interruption-cleanup":
    "SIGINT and SIGTERM fixtures verify owned PID exit, exact port release, retained evidence-write failure and incomplete progressive report.",
};
