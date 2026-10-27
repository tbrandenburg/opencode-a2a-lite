import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInvestigationReport } from "../../examples/agent-network/topology-report.js";
import {
  completionStatus,
  overall,
  score,
  scoreOperations,
} from "../../examples/agent-network/topology-scores.js";
import type { runTopologyCase } from "../../examples/agent-network/topology-run.js";
import { verifyContributions } from "../../examples/agent-network/topology-evidence.js";
import { sanitizedFailure } from "../../examples/agent-network/topology-failures.js";

const passed = score({ checked: "pass" });
function result(): Awaited<ReturnType<typeof runTopologyCase>> {
  return {
    id: "V1/T4-refinement",
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    fixedSchedule: true,
    modelIssuedMcp: true,
    mocked: false,
    status: "BROKEN",
    scores: {
      transport: score({ inventory: "pass" }),
      topology: score({
        inventory: "pass",
        markers: "pass",
        handles: "pass",
        timing: "pass",
        overlap: "pass",
        edges: "pass",
        proof: "pass",
        finalProof: "pass",
      }),
      semantics: passed,
      correctness: score({
        schema: "pass",
        totals: "pass",
        bounds: "pass",
        dependencies: "pass",
        incompatibilities: "pass",
        optimum: "pass",
      }),
      operations: score({
        budget: "pass",
        guardedPath: "fail",
        parameterPolicy: "pass",
        toolsDenied: "pass",
        boundedDeadlines: "pass",
        inputIntegrity: "pass",
        noHiddenRetries: "pass",
        noUncertainResends: "pass",
        cleanup: "pass",
      }),
    },
    expectations: [],
    receipts: [],
    audit: [],
    handles: [],
    coordinatorTurns: [],
    failure: undefined,
    cleanup: { passed: true, failures: 0 },
    extractionFailures: 0,
    heartbeatFailures: 0,
    deadlineExpired: false,
    interrupted: false,
    elapsedMs: 200,
  };
}

test("N17 persisted reports retain independent scores and handle provenance, never missing-evidence success or private content", () => {
  const root = mkdtempSync(join(tmpdir(), "topology-report-test-"));
  const secret = "provider-private-sentinel";
  const marker = "host-marker-not-for-serialization";
  const sample = result();
  try {
    verifyContributions(
      JSON.stringify({
        facts: [{ id: secret, kind: "bounds", minCost: 0, capacity: 999 }],
        inputHashes: {},
        proof: {},
        answer: null,
      }),
      [[{ id: "bounds", kind: "bounds", minCost: 0, capacity: 9 }]],
    );
  } catch (error) {
    sample.failure = { phase: "stages", ...sanitizedFailure(error) };
  }
  const enriched = {
    ...sample,
    privatePayload: secret,
    expectations: [
      { stepId: "propose", peerUrl: "http://127.0.0.1:4101/", marker, inputHash: "a".repeat(64) },
    ],
    receipts: [
      {
        stepId: "propose",
        peerUrl: "http://127.0.0.1:4101/",
        contextId: "context-1",
        taskId: "task-1",
        submittedContextId: null,
        taskIdOmitted: true,
        state: "completed" as const,
        started: 100,
        ended: 200,
        inputHashes: {},
        outputHash: "b".repeat(64),
        proof: { propose: marker },
        providerDiagnostics: secret,
      },
    ],
    audit: [
      {
        event: "call",
        connection: "connection-1",
        id: "send-1",
        tool: "a2a_send_message",
        peer: "http://127.0.0.1:4101/",
        inputHash: "a".repeat(64),
        inputEnvelope: {
          kind: "known",
          rawHash: "a".repeat(64),
          digest: "b".repeat(64),
          privatePayload: secret,
          fields: { instructions: "c".repeat(64), marker: secret, [secret]: secret },
        },
        blocking: false,
        taskIdOmitted: true,
        text: secret,
      },
      {
        event: "result",
        connection: "connection-1",
        id: "send-1",
        tool: "a2a_send_message",
        taskId: "task-1",
        contextId: "context-1",
        state: "TASK_STATE_COMPLETED",
        artifactHash: "b".repeat(64),
        ok: true,
        rawAnswer: secret,
      },
    ],
    handles: [
      {
        connection: "connection-1",
        taskId: "task-1",
        contextId: "context-1",
        state: "TASK_STATE_COMPLETED",
        privatePayload: secret,
      },
    ],
  };
  try {
    const report = createInvestigationReport(root);
    report.record(enriched);
    report.finish();
    const text = readFileSync(join(report.root, "V1-T4-refinement.json"), "utf8");
    const summaryText = readFileSync(join(report.root, "summary.json"), "utf8");
    const findings = readFileSync(join(report.root, "findings.md"), "utf8");
    expect(text + summaryText + findings).not.toContain(secret);
    expect(text + summaryText + findings).not.toContain(marker);
    expect(text).not.toMatch(/privatePayload|providerDiagnostics|rawAnswer/);
    const saved = JSON.parse(text);
    expect(saved.failure).toMatchObject({
      criterion: "contribution-mismatch",
      contributions: { missing: 1, extra: 1, changed: 0, repeated: 0 },
    });
    expect(saved.failure.contributions.identifiers).toHaveLength(2);
    expect(saved.failure.contributions.identifiers[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.evidence.receipts[0].taskId).toBe(saved.evidence.audit[1].taskId);
    expect(saved.evidence.handles[0].contextId).toBe(saved.evidence.audit[1].contextId);
    expect(saved.evidence.receipts[0].outputHash).toBe(saved.evidence.audit[1].artifactHash);
    expect(saved.evidence.expectations[0].markerHash).toMatch(/^[a-f0-9]{64}$/);
    expect(saved.evidence.audit[0].inputEnvelope.fields).toEqual({ instructions: "c".repeat(64) });
    expect(statSync(report.root).mode & 0o777).toBe(0o700);
    expect(statSync(join(report.root, "summary.json")).mode & 0o777).toBe(0o600);
    const summary = JSON.parse(summaryText);
    expect(summary).toMatchObject({ status: "BROKEN", complete: false, observed: 1 });
    expect(summary.missing).toHaveLength(26);
    expect(summary.rows.find((row: { id: string }) => row.id === "T4-refinement")).toMatchObject({
      scored: 1,
      correct: 1,
      working: 0,
      dimensions: { correctness: { pass: 1 }, operations: { fail: 1 } },
    });
    expect(summary.cases[0]).not.toHaveProperty("evidence");
    expect(findings).toContain("Independent dimension counts");
    const dimensions = {
      transport: passed,
      topology: passed,
      correctness: passed,
      operations: scoreOperations(),
    };
    expect(overall(dimensions)).toBe("INCOMPLETE");
    expect(overall({ ...dimensions, operations: score({ cleanup: "pending" }) })).toBe(
      "INCOMPLETE",
    );
    expect(
      completionStatus(dimensions, {
        failed: true,
        aborted: false,
        turns: [{ aborted: true, completed: false }],
        states: ["pending"],
      }),
    ).toBe("INCOMPLETE");
    expect(
      completionStatus(dimensions, {
        failed: true,
        aborted: false,
        turns: [{ aborted: false, completed: false }],
        states: [],
      }),
    ).toBe("BROKEN");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
