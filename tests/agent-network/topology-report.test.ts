import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  aggregate,
  caseRecord,
  createInvestigationReport,
  NEGATIVE_CASES,
} from "../../examples/agent-network/topology-report.js";
import { investigationOptions } from "../../examples/agent-network/topology-options.js";
import { score } from "../../examples/agent-network/topology-scores.js";
import type { runTopologyCase } from "../../examples/agent-network/topology-run.js";
import { faultVerdict } from "../../examples/agent-network/topology-faults.js";
import { CASE_MATRIX } from "../../examples/agent-network/topology-cases.js";

const passed = score({ checked: "pass" });
function result(id = "V1/T4-refinement"): Awaited<ReturnType<typeof runTopologyCase>> {
  return {
    id,
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
    audit: [{ event: "call", input: "private-prompt", answer: "private-answer" }],
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

test("aggregation separates correctness from overall operations and marks missing experiments incomplete", () => {
  const summary = aggregate([caseRecord(result())], []);
  expect(summary.status).toBe("BROKEN");
  expect(summary.complete).toBe(false);
  expect(summary.missing).toHaveLength(26);
  expect(summary.rows.find((row) => row.id === "T4-refinement")).toMatchObject({
    planned: 3,
    completed: 0,
    scored: 1,
    correct: 1,
    correctRatio: 1,
    working: 0,
    attempts: 1,
  });
  expect(summary.rows.find((row) => row.id === "B0-coordinator")?.correctRatio).toBeNull();
  expect(summary.rows.find((row) => row.id === "T4-refinement")?.dimensions).toEqual({
    transport: { pass: 1, fail: 0, pending: 0, unknown: 0 },
    topology: { pass: 1, fail: 0, pending: 0, unknown: 0 },
    semantics: { pass: 1, fail: 0, pending: 0, unknown: 0 },
    correctness: { pass: 1, fail: 0, pending: 0, unknown: 0 },
    operations: { pass: 0, fail: 1, pending: 0, unknown: 0 },
  });
  expect(aggregate([], []).status).toBe("INCOMPLETE");
});

test("private progressive files retain broken and subsequent case results without raw content", () => {
  const root = mkdtempSync(join(tmpdir(), "topology-report-test-"));
  try {
    const report = createInvestigationReport(root);
    report.record(result());
    report.record({ ...result("V2/T4-refinement"), cleanup: { passed: false, failures: 1 } });
    const summary = readFileSync(join(report.root, "summary.json"), "utf8");
    expect(JSON.parse(summary).observed).toBe(2);
    expect(summary).not.toMatch(/private-prompt|private-answer/);
    expect(
      JSON.parse(summary).rows.find((row: { id: string }) => row.id === "T4-refinement")
        .cleanupFailures,
    ).toBe(1);
    expect(statSync(report.root).mode & 0o777).toBe(0o700);
    expect(statSync(join(report.root, "summary.json")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(report.root, "findings.md"), "utf8")).toContain(
      "Token usage and cost: unmeasured",
    );
    expect(() => report.record(result())).toThrow("Duplicate");
    expect(report.summary().missing).toContain(NEGATIVE_CASES[0]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("only a fully observed and scored 27-case plan can have a complete working verdict", () => {
  const cases = CASE_MATRIX.map((test) => ({
    ...caseRecord(result(test.id)),
    status: "WORKING" as const,
    completed: true,
    scores: {
      ...result(test.id).scores,
      operations: score({
        budget: "pass",
        guardedPath: "pass",
        toolsDenied: "pass",
        boundedDeadlines: "pass",
        inputIntegrity: "pass",
        noHiddenRetries: "pass",
        noUncertainResends: "pass",
        cleanup: "pass",
      }),
    },
  }));
  const negatives = NEGATIVE_CASES.map((id) => ({
    id,
    evidenceClass: "provider-free-controlled-ACP" as const,
    status: "WORKING" as const,
    cleanup: true,
    criteria: ["checked fixture"],
    attempts: null,
  }));
  expect(aggregate(cases, negatives)).toMatchObject({
    status: "WORKING",
    complete: true,
    observed: 27,
    missing: [],
  });
  expect(
    aggregate(cases, negatives).rows.every((row) => row.completed === 3 && row.correct === 3),
  ).toBe(true);
  const unavailable = {
    ...cases[0]!,
    status: "INCOMPLETE" as const,
    scores: {
      ...cases[0]!.scores,
      correctness: score({
        schema: "unknown",
        totals: "unknown",
        bounds: "unknown",
        dependencies: "unknown",
        incompatibilities: "unknown",
        optimum: "unknown",
      }),
    },
  };
  expect(aggregate([unavailable, ...cases.slice(1)], negatives).complete).toBe(false);
  expect(aggregate([unavailable, ...cases.slice(1)], negatives).rows[0]?.scored).toBe(2);
  expect(
    aggregate(
      [{ ...cases[0]!, cleanup: { passed: false, failures: 1 } }, ...cases.slice(1)],
      negatives,
    ).status,
  ).toBe("BROKEN");
});

test("per-case provenance survives projection with measured overlap, hash correlation and no unknown sensitive fields", () => {
  const root = mkdtempSync(join(tmpdir(), "topology-provenance-test-"));
  const secret = "provider-private-sentinel";
  const marker = "host-marker-not-for-serialization";
  const hash = createHash("sha256").update(marker).digest("hex");
  const sample = result("V1/T3-diamond");
  const receipts = ["reviewA", "reviewB"].map((stepId, index) => ({
    stepId,
    peerUrl: `http://127.0.0.1:${4101 + index}/`,
    contextId: `context-${index}`,
    taskId: `task-${index}`,
    submittedContextId: null,
    taskIdOmitted: true,
    state: "completed" as const,
    started: 100 + index * 10,
    ended: 200 + index * 10,
    inputHashes: { plan: "a".repeat(64), privateInput: secret },
    outputHash: "b".repeat(64),
    proof: { plan: marker, [stepId]: marker, privateProof: secret },
    providerDiagnostics: { raw: secret },
    text: secret,
  }));
  const enriched = {
    ...sample,
    privatePayload: { raw: secret },
    receipts,
    cleanup: { passed: true, failures: 0, privatePayload: secret },
    scores: {
      ...sample.scores,
      correctness: {
        ...sample.scores.correctness,
        privatePayload: secret,
        checks: { ...sample.scores.correctness.checks, privatePayload: secret },
      },
    },
    expectations: [
      {
        stepId: "reviewA",
        peerUrl: receipts[0]!.peerUrl,
        marker,
        inputHash: "d".repeat(64),
        privatePayload: secret,
      },
    ],
    audit: [
      {
        event: "catalog",
        connection: "connection-1",
        tools: ["a2a_send_message", { text: secret }, secret],
        raw: secret,
      },
      {
        event: "call",
        connection: "connection-1",
        id: "send-1",
        tool: "a2a_send_message",
        peer: receipts[0]!.peerUrl,
        context: "context-0",
        taskIdOmitted: true,
        blocking: false,
        inputHash: "a".repeat(64),
        at: sample.startedAt,
        params: { text: secret },
        text: secret,
        error: secret,
      },
      {
        event: "result",
        connection: "connection-1",
        id: "send-1",
        tool: "a2a_send_message",
        taskId: "task-0",
        contextId: "context-0",
        state: "TASK_STATE_COMPLETED",
        artifactHash: "b".repeat(64),
        ok: true,
        at: sample.finishedAt,
        rawAnswer: secret,
      },
    ],
    handles: [
      {
        connection: "connection-1",
        taskId: "task-0",
        contextId: "context-0",
        state: "TASK_STATE_COMPLETED",
        privatePayload: secret,
      },
    ],
    coordinatorTurns: [
      {
        kind: "submit" as const,
        started: 90,
        ended: 99,
        deadline: 300,
        completed: true,
        aborted: false,
        inputHash: "c".repeat(64),
        rawPrompt: secret,
      },
    ],
    extractionFailures: 1,
    heartbeatFailures: 2,
  };
  try {
    const report = createInvestigationReport(root);
    report.record(enriched);
    report.finish();
    const text = readFileSync(join(report.root, "V1-T3-diamond.json"), "utf8");
    const summaryText = readFileSync(join(report.root, "summary.json"), "utf8");
    expect(text + summaryText).not.toContain(secret);
    expect(text).not.toContain(marker);
    expect(text).not.toMatch(
      /privatePayload|providerDiagnostics|rawPrompt|rawAnswer|privateInput|privateProof/,
    );
    const saved = JSON.parse(text);
    expect(saved.evidence.expectations[0]).toEqual({
      stepId: "reviewA",
      peerUrl: receipts[0]!.peerUrl,
      markerHash: hash,
      inputHash: "d".repeat(64),
      submittedContextId: null,
    });
    expect(saved.evidence.receipts[0].proofHashes.reviewA).toBe(hash);
    expect(saved.evidence.receipts[0].inputHashes).toEqual({ plan: "a".repeat(64) });
    expect(saved.evidence.receipts[0].taskId).toBe(saved.evidence.audit[2].taskId);
    expect(saved.evidence.expectations[0].inputHash).not.toBe(saved.evidence.audit[1].inputHash);
    expect(saved.evidence.handles[0].taskId).toBe(saved.evidence.audit[2].taskId);
    expect(saved.evidence.receipts[0].outputHash).toBe(saved.evidence.audit[2].artifactHash);
    expect(saved.evidence.audit[0].tools).toEqual(["a2a_send_message"]);
    expect(
      Math.max(...saved.evidence.receipts.map((entry: { started: number }) => entry.started)),
    ).toBe(110);
    expect(
      Math.min(...saved.evidence.receipts.map((entry: { ended: number }) => entry.ended)),
    ).toBe(200);
    expect(saved.evidence.handles[0].contextId).toBe("context-0");
    expect(saved.evidence.coordinatorTurns[0]).toEqual({
      kind: "submit",
      started: 90,
      ended: 99,
      deadline: 300,
      completed: true,
      aborted: false,
      inputHash: "c".repeat(64),
    });
    expect(saved.evidence).toMatchObject({ extractionFailures: 1, heartbeatFailures: 2 });
    expect(saved.finishedAt).toBe(sample.finishedAt);
    expect(Number.isFinite(Date.parse(saved.recordedAt))).toBe(true);
    const summary = JSON.parse(summaryText);
    expect(summary.cases[0]).not.toHaveProperty("evidence");
    expect(Date.parse(summary.metadata.finishedAt)).toBeGreaterThanOrEqual(
      Date.parse(saved.recordedAt),
    );
    expect(
      summary.rows.find((row: { id: string }) => row.id === "T3-diamond").dimensions.operations
        .fail,
    ).toBe(1);
    expect(readFileSync(join(report.root, "findings.md"), "utf8")).toContain(
      "Independent dimension counts",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI validates opt-in and exact selections before any provider invocation", () => {
  for (const args of [
    [],
    ["--live=false"],
    ["--faults"],
    ["--live", "--case", "fake"],
    ["--live", "--variant", "V4"],
    ["--live", "--turn-ms", "0"],
    ["--live", "--case", "V1/T4-refinement", "--variant", "V2"],
    ["--live", "--case-ms", "1.5"],
    ["--live", "--live"],
  ]) {
    expect(() => investigationOptions(args)).toThrow();
  }
  expect(investigationOptions(["--list"]).selected).toHaveLength(21);
  expect(investigationOptions(["--live", "--variant", "V1"]).selected).toHaveLength(7);
  expect(
    investigationOptions(["--live", "--case", "V1/T4-refinement"]).selected.map((test) => test.id),
  ).toEqual(["V1/T4-refinement"]);
  const cli = spawnSync(
    process.execPath,
    ["examples/agent-network/topology-investigation.ts", "--list"],
    {
      env: { PATH: process.env.PATH },
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  expect(cli.status).toBe(0);
  expect(cli.stdout.trim().split("\n")).toHaveLength(27);
  expect(cli.stdout).toContain("baseline (not MCP evidence)");
  const denied = spawnSync(process.execPath, ["examples/agent-network/topology-investigation.ts"], {
    env: { PATH: process.env.PATH },
    encoding: "utf8",
    timeout: 10_000,
  });
  expect(denied.status).toBe(1);
  expect(denied.stdout).not.toContain("Investigation artifacts:");
});

test("controlled negatives require structured assertion receipts, retain missing evidence and cleanup failure", () => {
  const receipt = {
    subcases: [{ id: "N1-busy-fallback", passed: true, attemptedCalls: 7 }],
    cleanup: true,
    failed: false,
  };
  expect(faultVerdict("N1-busy-fallback", receipt, true, false)).toEqual({
    status: "WORKING",
    cleanup: true,
    attempts: 7,
  });
  expect(faultVerdict("N5-contributions", receipt, true, false)).toEqual({
    status: "INCOMPLETE",
    cleanup: true,
    attempts: null,
  });
  expect(faultVerdict("N1-busy-fallback", { ...receipt, cleanup: false }, true, false).status).toBe(
    "BROKEN",
  );
  expect(
    faultVerdict(
      "N5-contributions",
      { ...receipt, failed: true, failedStage: "missing-and-conflicting-contributions" },
      false,
      false,
    ).status,
  ).toBe("BROKEN");
  expect(faultVerdict("N1-busy-fallback", undefined, false, true)).toEqual({
    status: "INCOMPLETE",
    cleanup: null,
    attempts: null,
  });
  expect(faultVerdict("N1-busy-fallback", { ...receipt, failed: true }, false, false).status).toBe(
    "BROKEN",
  );
  expect(
    faultVerdict(
      "N1-busy-fallback",
      { ...receipt, failed: true, failedStage: "missing-and-conflicting-contributions" },
      false,
      false,
    ).status,
  ).toBe("WORKING");
});
