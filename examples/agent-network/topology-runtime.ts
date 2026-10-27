import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup } from "../../scripts/acp-smoke-config.js";
import { createProfile, record } from "./profiles.js";
import { receipts } from "./collaborate.js";
import { startWorker, type Worker, type WorkerObservation } from "./workers.js";
import { agentCount, steps, CASE_MATRIX, type ExperimentCase } from "./topology-cases.js";
import { allocateFacts, WORKLOADS } from "./topology-workloads.js";
import type { StepExpectation } from "./topology-receipts.js";
import type { Audit } from "./topology-evidence.js";
import { envelopeInstructions, topologySystem } from "./topology-prompts.js";
import { topologyPrerequisites, topologyDirectory, verifyReleased } from "./topology-resources.js";
import type { Release } from "./lifecycle.js";
import type { PromptKind } from "./topology-session.js";
import { coordinatorRole } from "./readiness-plugin.js";

export interface TopologyControls {
  optIn: true;
  caseMs?: number;
  turnMs?: number;
  signal?: AbortSignal;
  // S3 fault injection changes model instructions, never bypasses the guarded path.
  transformPrompt?: (kind: PromptKind, text: string) => string;
  onCase?: (
    result: Awaited<ReturnType<typeof import("./topology-run.js").runTopologyCase>>,
  ) => Promise<void>;
}
export function validateControls(controls: TopologyControls) {
  assert.equal(controls.optIn, true, "Billable topology runner requires optIn:true");
  const caseMs = controls.caseMs ?? 900_000;
  const turnMs = controls.turnMs ?? 180_000;
  assert(
    Number.isSafeInteger(caseMs) && caseMs >= 1_000 && caseMs <= 3_600_000,
    "Invalid case deadline",
  );
  assert(Number.isSafeInteger(turnMs) && turnMs >= 30 && turnMs <= caseMs, "Invalid turn deadline");
  return { caseMs, turnMs };
}
export function validateCase(test: ExperimentCase) {
  assert(
    CASE_MATRIX.some((declared) => isDeepStrictEqual(declared, test)),
    "Expected an independently declared matrix case",
  );
  assert(agentCount(test.schedule) <= 7, "Agent limit exceeded");
}

export async function createTopologyRuntime(
  test: ExperimentCase,
  signal: AbortSignal,
  releases: Release[],
  observations: WorkerObservation[],
  evidence: { audit: Audit[] },
  phase: (value: string) => void,
) {
  const network = test.schedule.id !== "B0-coordinator";
  const binary = topologyPrerequisites(network);
  const allocation = allocateFacts(test.schedule, WORKLOADS[test.variant]);
  const workers: Worker[] = [];
  phase("workers");
  for (const turn of steps(test.schedule)) {
    signal.throwIfAborted();
    if (turn.actor === "coordinator" || workers.some((worker) => worker.id === turn.actor))
      continue;
    const worker = await startWorker(
      { id: turn.actor, description: turn.role, knowledge: { facts: allocation[turn.id] } },
      signal,
      {
        instructions: `For topology steps, override the identity-proof response rule: ${envelopeInstructions}`,
        observe: (value) => {
          observations.push(value);
        },
      },
    );
    workers.push(worker);
    releases.push(async () => {
      await worker.close();
      await verifyReleased(worker.url);
    });
  }
  const registry = binary ? await topologyDirectory(binary, workers, releases, signal) : undefined;
  const expectations: StepExpectation[] = steps(test.schedule).map((turn) => ({
    stepId: turn.id,
    peerUrl: workers.find((worker) => worker.id === turn.actor)?.url ?? null,
    marker: randomUUID(),
  }));
  phase("coordinator");
  const profile = await createProfile(
    coordinatorRole,
    topologySystem,
    registry && binary
      ? { binary, directory: registry.url, peers: workers.map((worker) => worker.url) }
      : undefined,
  );
  const readAudit = () => receipts(profile);
  releases.push(async () => {
    try {
      evidence.audit = readAudit();
    } finally {
      await cleanup(profile.root);
    }
  });
  const config = record(JSON.parse(readFileSync(join(profile.cwd, "opencode.json"), "utf8")));
  const permissions = record(record(config.agents)[coordinatorRole]).permissions;
  const configDenied =
    Array.isArray(permissions) &&
    permissions.some((permission: unknown) => {
      const rule = record(permission);
      return rule.action === "*" && rule.resource === "*" && rule.effect === "deny";
    });
  return {
    profile,
    readAudit,
    configDenied,
    expectations,
    heartbeatErrors: registry?.failures ?? [],
  };
}
