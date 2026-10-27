import assert from "node:assert/strict";
import type { ExperimentCase } from "./topology-cases.js";
import type { StepExpectation, StepReceipt } from "./topology-receipts.js";
import { allocateFacts, WORKLOADS } from "./topology-workloads.js";
import {
  parseTurn,
  sha256,
  submission,
  workerReceipt,
  verifyContributions,
  observedState,
  type Audit,
} from "./topology-evidence.js";
import { turnText } from "./topology-prompts.js";
import type { topologySession } from "./topology-session.js";
import type { WorkerObservation } from "./workers.js";
import { until } from "./transport.js";
import { envelopeMetadata } from "./topology-envelope.js";

export interface StageContext {
  test: ExperimentCase;
  expectations: StepExpectation[];
  observations: WorkerObservation[];
  session: Awaited<ReturnType<typeof topologySession>>;
  audit: () => Audit[];
  signal: AbortSignal;
  deadline: number;
  inputs: Map<string, string>;
  outputs: Map<string, string>;
  receipts: StepReceipt[];
}
export async function executeStages(context: StageContext) {
  const allocation = allocateFacts(context.test.schedule, WORKLOADS[context.test.variant]);
  const expectations = context.expectations;
  if (expectations.some((entry) => entry.peerUrl)) {
    await context.session.prompt(
      "discover",
      `Discover the configured worker cards now with network_a2a_list_agents. Exact approved peers: ${JSON.stringify(expectations.map((entry) => entry.peerUrl).filter(Boolean))}. Do not submit work yet.`,
    );
    assert(
      context.audit().some((entry) => entry.event === "call" && entry.tool === "a2a_list_agents"),
      "No model discovery call",
    );
  }
  for (const stage of context.test.schedule.stages) {
    context.signal.throwIfAborted();
    const jobs = stage.map((turn) => {
      const expectation = expectations.find((entry) => entry.stepId === turn.id)!;
      const inbound = Object.fromEntries(
        turn.inbound.map((id) => {
          const output = context.outputs.get(id);
          assert(output !== undefined, "Missing inbound contribution");
          return [id, { hash: sha256(output), output }];
        }),
      );
      const text = turnText(
        turn,
        expectation,
        inbound,
        turn.id === context.test.schedule.final,
        turn.actor === "coordinator" ? allocation[turn.id] : undefined,
      );
      context.inputs.set(turn.id, text);
      const prior = context.receipts.find((entry) => entry.stepId === turn.sameContextAs);
      assert(!turn.sameContextAs || prior?.contextId, "Missing continuation handle");
      expectation.inputHash = sha256(text);
      expectation.inputEnvelope = envelopeMetadata(text);
      expectation.submittedContextId = prior?.contextId ?? null;
      return { turn, expectation, text, contextId: prior?.contextId };
    });
    if (stage[0]?.actor === "coordinator") {
      assert.equal(jobs.length, 1);
      const job = jobs[0]!;
      const prompt = `Do not contact workers. Perform this coordinator step, returning only its envelope: ${job.text}`;
      job.expectation.inputHash = sha256(prompt);
      job.expectation.inputEnvelope = envelopeMetadata(prompt);
      const result = await context.session.prompt("solve", prompt);
      assert.equal(result.inputHash, sha256(prompt), "Coordinator inbound prompt changed");
      const output = parseTurn(result.output);
      verifyContributions(result.output, [
        allocation[job.turn.id] ?? [],
        ...job.turn.inbound.map((id) => parseTurn(context.outputs.get(id)!).facts),
      ]);
      context.outputs.set(job.turn.id, result.output);
      context.receipts.push({
        stepId: job.turn.id,
        peerUrl: null,
        contextId: null,
        taskId: null,
        submittedContextId: null,
        taskIdOmitted: true,
        state: "completed",
        started: result.started,
        ended: result.ended,
        inputHashes: output.inputHashes,
        outputHash: sha256(result.output),
        proof: output.proof,
      });
      continue;
    }
    const attempts = () =>
      context.audit().filter((entry) => ["call", "rejected"].includes(String(entry.event))).length;
    assert(attempts() + jobs.length * 2 <= 32, "Insufficient ordinary model call budget");
    await context.session.prompt(
      "submit",
      `Fixed schedule: submit precisely these ${jobs.length} independent tasks together using network_a2a_send_message, blocking:false, omit task_id. Copy text verbatim. Use context_id ONLY where supplied; do not make replacements or retry. Return after submissions, no polling yet. Remaining ordinary calls: ${32 - attempts()}. Absolute turn remaining ms: ${Math.max(0, context.deadline - performance.now())}. Jobs: ${JSON.stringify(jobs.map((job) => ({ peer_url: job.expectation.peerUrl, text: job.text, ...(job.contextId ? { context_id: job.contextId } : {}) })))}`,
    );
    const handles = jobs.map((job) => {
      const sent = submission(job.expectation, job.text, context.audit());
      assert(
        typeof sent.result?.taskId === "string" && typeof sent.result.contextId === "string",
        "Uncertain submission: stop without resend",
      );
      assert(
        !["failed", "rejected", "canceled"].includes(observedState(sent.result.state)),
        "Remote submission terminated without completion",
      );
      return {
        peer_url: job.expectation.peerUrl,
        task_id: sent.result.taskId,
        contextId: sent.result.contextId,
      };
    });
    await until(
      async () => {
        context.signal.throwIfAborted();
        return handles.every((handle) =>
          context.observations.some(
            (entry) => entry.taskId === handle.task_id && entry.contextId === handle.contextId,
          ),
        )
          ? true
          : undefined;
      },
      "in-memory worker execution",
      Math.max(1, context.deadline - performance.now()),
    );
    assert(attempts() + jobs.length <= 32, "Model exhausted intervention reserve");
    await context.session.prompt(
      "observe",
      `Host observed worker execution end, not remote task completion. Call network_a2a_get_task exactly once for each actual returned handle below. Inspect terminal state and artifacts. If pending/failed/unknown, report INCOMPLETE; never resend or cancel. Remaining ordinary calls ${32 - attempts()}. Handles: ${JSON.stringify(handles)}`,
    );
    for (const job of jobs) {
      const handle = handles.find((entry) => entry.peer_url === job.expectation.peerUrl)!;
      const observation = context.observations.find((entry) => entry.taskId === handle.task_id)!;
      const receipt = workerReceipt(
        job.turn,
        job.expectation,
        job.text,
        observation,
        context.audit(),
      );
      context.receipts.push(receipt);
      assert.equal(receipt.state, "completed", "Remote task not observed completed");
      assert.equal(observation.stopReason, "end_turn");
      const inherited = job.turn.sameContextAs
        ? parseTurn(context.outputs.get(job.turn.sameContextAs)!).facts
        : [];
      verifyContributions(observation.output, [
        allocation[job.turn.id] ?? [],
        inherited,
        ...job.turn.inbound.map((id) => parseTurn(context.outputs.get(id)!).facts),
      ]);
      context.outputs.set(job.turn.id, observation.output);
    }
  }
  const final = context.outputs.get(context.test.schedule.final);
  return final === undefined ? undefined : parseTurn(final).answer;
}
