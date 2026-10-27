import { createLifecycle } from "./lifecycle.js";
import type { WorkerObservation } from "./workers.js";
import { steps, type ExperimentCase } from "./topology-cases.js";
import type { StepExpectation, StepReceipt } from "./topology-receipts.js";
import { auditOperations, submission, workerReceipt, type Audit } from "./topology-evidence.js";
import { topologySession, type CoordinatorTurn } from "./topology-session.js";
import {
  createTopologyRuntime,
  validateControls,
  validateCase,
  type TopologyControls,
} from "./topology-runtime.js";
import { executeStages } from "./topology-stages.js";
import { checked, completionStatus, scoreOperations } from "./topology-scores.js";
import { scoreCorrectness, scoreTopology, scoreTransport } from "./topology-verdicts.js";
import { sanitizedFailure } from "./topology-failures.js";
import { scoreSemantics } from "./topology-semantics.js";

export { validateControls, validateCase, type TopologyControls } from "./topology-runtime.js";

// Every call declares an independent case/connection. No automatic retries.
export async function runTopologyCase(test: ExperimentCase, controls: TopologyControls) {
  const limits = validateControls(controls);
  validateCase(test);
  const lifecycle = createLifecycle();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const deadline = started + limits.caseMs;
  const timeout = AbortSignal.timeout(limits.caseMs);
  const signal = AbortSignal.any([
    lifecycle.signal,
    timeout,
    ...(controls.signal ? [controls.signal] : []),
  ]);
  const network = test.schedule.id !== "B0-coordinator";
  const observations: WorkerObservation[] = [];
  const expectations: StepExpectation[] = [];
  const stepReceipts: StepReceipt[] = [];
  const inputs = new Map<string, string>();
  const outputs = new Map<string, string>();
  const evidence: { audit: Audit[] } = { audit: [] };
  let readiness = false;
  let configDenied = false;
  let coordinatorTurns: readonly CoordinatorTurn[] = [];
  let extractionFailures = 0;
  let answer: unknown;
  let phase = "prerequisites";
  let failure: ({ phase: string } & ReturnType<typeof sanitizedFailure>) | undefined;
  let heartbeatErrors: readonly string[] = [];
  try {
    const runtime = await createTopologyRuntime(
      test,
      signal,
      lifecycle.releases,
      observations,
      evidence,
      (value) => {
        phase = value;
      },
    );
    const profile = runtime.profile;
    const readAudit = runtime.readAudit;
    heartbeatErrors = runtime.heartbeatErrors;
    expectations.push(...runtime.expectations);
    configDenied = runtime.configDenied;
    const session = await topologySession(profile, {
      ...limits,
      deadline,
      signal,
      network,
      ...(controls.transformPrompt ? { transformPrompt: controls.transformPrompt } : {}),
    });
    lifecycle.releases.push(async () => {
      try {
        await session.close();
      } finally {
        readiness = session.readinessVerified;
        coordinatorTurns = session.evidence;
      }
    });
    phase = "stages";
    try {
      answer = await executeStages({
        test,
        expectations,
        observations,
        session,
        audit: readAudit,
        signal,
        deadline,
        inputs,
        outputs,
        receipts: stepReceipts,
      });
    } finally {
      evidence.audit = readAudit();
      // Retain genuine pending/uncertain handles when a stage did not finish.
      for (const turn of steps(test.schedule)) {
        if (turn.actor === "coordinator" || stepReceipts.some((entry) => entry.stepId === turn.id))
          continue;
        const text = inputs.get(turn.id);
        const expected = expectations.find((entry) => entry.stepId === turn.id);
        if (!text || !expected) continue;
        try {
          const sent = submission(expected, text, evidence.audit);
          const observation = observations.find((entry) => entry.taskId === sent.result?.taskId);
          stepReceipts.push(workerReceipt(turn, expected, text, observation, evidence.audit));
        } catch {
          // Keep the gap visible; missing/malformed evidence is never synthesized.
          extractionFailures++;
        }
      }
    }
  } catch (error) {
    failure = { phase, ...sanitizedFailure(error) };
  }
  const cleanupErrors = await lifecycle.drain();
  const audit = evidence.audit;
  const operations = auditOperations(
    audit,
    expectations.filter((entry) => entry.peerUrl !== null && entry.inputHash !== undefined),
    !network,
  );
  const scores = {
    transport: scoreTransport(test.schedule, stepReceipts),
    topology: scoreTopology(test.schedule, expectations, stepReceipts, answer),
    correctness: scoreCorrectness(test.variant, answer),
    semantics: scoreSemantics(test, outputs),
    operations: scoreOperations(
      {
        connections: operations.connections,
        guardedPath: checked(operations.guardedPath && operations.safeCalls),
        toolsDenied: !configDenied ? "fail" : readiness ? "pass" : "unknown",
        boundedDeadlines:
          coordinatorTurns.length === 0
            ? "unknown"
            : checked(
                coordinatorTurns.every(
                  (turn) =>
                    turn.deadline <= deadline &&
                    turn.started < turn.deadline &&
                    turn.ended >= turn.started &&
                    (turn.ended <= turn.deadline || (turn.aborted && !turn.completed)),
                ),
              ),
        noHiddenRetries: checked(operations.noHiddenRetries),
        inputIntegrity: checked(operations.inputIntegrity),
        noUncertainResends: operations.noUncertainResends,
        cleanup: checked(cleanupErrors.length === 0 && heartbeatErrors.length === 0),
      },
      network ? "network" : "baseline",
    ),
  };
  const handles = audit
    .filter((entry) => entry.event === "result" && typeof entry.taskId === "string")
    .map((entry) => ({
      connection: entry.connection,
      taskId: entry.taskId,
      contextId: entry.contextId,
      state: entry.state,
    }));
  observations.length = 0;
  inputs.clear();
  outputs.clear();
  return {
    id: test.id,
    startedAt,
    finishedAt: new Date().toISOString(),
    fixedSchedule: true,
    modelIssuedMcp:
      network &&
      audit.some((entry) => entry.event === "call" && entry.tool === "a2a_send_message") &&
      operations.guardedPath,
    mocked: false,
    status: completionStatus(scores, {
      failed: failure !== undefined,
      ...(failure ? { failureCriterion: failure.criterion } : {}),
      aborted: signal.aborted,
      turns: coordinatorTurns,
      states: stepReceipts.map((receipt) => receipt.state),
    }),
    scores,
    expectations,
    receipts: stepReceipts,
    audit,
    handles,
    coordinatorTurns,
    failure,
    cleanup: { passed: cleanupErrors.length === 0, failures: cleanupErrors.length },
    extractionFailures,
    heartbeatFailures: heartbeatErrors.length,
    deadlineExpired: timeout.aborted,
    interrupted: lifecycle.signal.aborted || controls.signal?.aborted === true,
    elapsedMs: performance.now() - started,
  };
}

export async function runTopologyCases(
  tests: readonly ExperimentCase[],
  controls: TopologyControls,
) {
  validateControls(controls);
  tests.forEach(validateCase);
  const results: Awaited<ReturnType<typeof runTopologyCase>>[] = [];
  for (const test of tests) {
    if (controls.signal?.aborted) break;
    const result = await runTopologyCase(test, controls);
    results.push(result);
    await controls.onCase?.(result);
    if (result.interrupted || !result.cleanup.passed) break;
  }
  return results;
}
