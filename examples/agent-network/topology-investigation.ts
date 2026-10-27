import { CASE_MATRIX } from "./topology-cases.js";
import { investigationOptions } from "./topology-options.js";
import { createInvestigationReport, NEGATIVE_CASES } from "./topology-report.js";
import { runTopologyCases } from "./topology-run.js";
import { runFaultExperiments } from "./topology-faults.js";

export async function investigation(args: readonly string[]) {
  const options = investigationOptions(args);
  if (options.list) {
    console.log(
      [
        ...CASE_MATRIX.map(
          (test) =>
            `${test.id} live-model${test.schedule.id === "B0-coordinator" ? " baseline (not MCP evidence)" : " guarded MCP"}`,
        ),
        ...NEGATIVE_CASES.map((id) => `${id} provider-free-controlled-ACP`),
      ].join("\n"),
    );
    return 0;
  }
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const report = createInvestigationReport(undefined, {
    live: options.live,
    faults: options.faults,
    caseMs: options.caseMs,
    turnMs: options.turnMs,
    selected: options.live ? options.selected.map((test) => test.id) : [],
  });
  console.log(`Investigation artifacts: ${report.root}`);
  try {
    if (options.live)
      await runTopologyCases(options.selected, {
        optIn: true,
        caseMs: options.caseMs,
        turnMs: options.turnMs,
        signal: controller.signal,
        onCase: async (result) => {
          report.record(result);
        },
      });
    if (options.faults && !controller.signal.aborted)
      await runFaultExperiments(report, controller.signal);
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    report.finish();
  }
  const summary = report.summary();
  console.log(
    `${summary.status}: ${summary.observed}/27 observations; complete=${summary.complete}`,
  );
  return summary.status === "WORKING" ? 0 : 1;
}
if (import.meta.main) {
  try {
    process.exitCode = await investigation(process.argv.slice(2));
  } catch {
    console.error("Investigation failed; inspect retained sanitized summary. No automatic retry.");
    process.exitCode = 1;
  }
}
