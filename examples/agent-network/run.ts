import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { accessSync, constants, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup } from "../../scripts/acp-smoke-config.js";
import definition from "./network.json" with { type: "json" };
import { createProfile } from "./profiles.js";
import { directory, mcp } from "./transport.js";
import { startWorker, type Worker } from "./workers.js";
import { interoperability, cancellation } from "./checks.js";
import { collaborate, coordinatorSystem, receipts } from "./collaborate.js";
import { createLifecycle } from "./lifecycle.js";
import { auditEvidence } from "./readiness.js";

const output = resolve(".test-results/agent-network");
const lifecycle = createLifecycle();
const releases = lifecycle.releases;
const workers: Worker[] = [];
const summary: Record<string, unknown> = {
  started: new Date().toISOString(),
  network: definition.name,
  bridgeVersion: definition.bridgeVersion,
  model: definition.model,
  mocked: false,
};
let stage = "prerequisites";

async function main() {
  assert.equal(process.platform, "linux");
  assert.equal(Bun.version, "1.3.9");
  const supplied = process.env.A2ABRIDGE_BIN;
  assert(supplied, "Set A2ABRIDGE_BIN to the verified Linux amd64 v4.0.2 executable");
  const binary = resolve(supplied);
  accessSync(binary, constants.X_OK);
  const digest = createHash("sha256").update(readFileSync(binary)).digest("hex");
  assert.equal(digest, definition.bridgeBinarySha256, "Unexpected bridge executable");
  summary.binarySha256 = digest;
  stage = "workers";
  for (const spec of definition.workers) {
    const worker = await startWorker(spec, lifecycle.signal);
    workers.push(worker);
    releases.push(worker.close);
  }
  for (const worker of workers) {
    worker.setPeerProofs(
      Object.fromEntries(
        workers.filter((peer) => peer !== worker).map((peer) => [peer.id, peer.proof]),
      ),
    );
  }
  const control = await createProfile("directory", "You are not used for model requests.");
  releases.push(() => cleanup(control.root));
  lifecycle.signal.throwIfAborted();
  const registry = await directory(binary, control, lifecycle.signal);
  releases.push(registry.close);
  const heartbeatErrors: string[] = [];
  async function register(path: string) {
    for (const worker of workers) {
      const response = await fetch(registry.url + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: worker.url }),
        signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(3_000)]),
      });
      assert.equal(response.status, 204, "Directory registration failed");
    }
  }
  await register("/register");
  const heartbeat = setInterval(() => {
    void register("/heartbeat").catch(() => heartbeatErrors.push("heartbeat failed"));
  }, 20_000);
  releases.push(async () => clearInterval(heartbeat));
  stage = "coordinator-configuration";
  const connection = {
    binary,
    directory: registry.url,
    peers: workers.map((worker) => worker.url),
  };
  const coordinator = await createProfile("coordinator", coordinatorSystem, connection);
  releases.push(async () => {
    try {
      writeFileSync(
        resolve(output, "mcp-receipts.json"),
        JSON.stringify(receipts(coordinator), null, 2),
        { mode: 0o600 },
      );
      writeFileSync(
        resolve(output, "runtime-readiness.json"),
        JSON.stringify(auditEvidence(coordinator), null, 2),
        { mode: 0o600 },
      );
    } finally {
      await cleanup(coordinator.root);
    }
  });
  lifecycle.signal.throwIfAborted();
  stage = "mcp-interoperability";
  const probe = await mcp(coordinator, connection, lifecycle.signal);
  try {
    summary.interoperability = await interoperability(probe, workers);
    stage = "lifecycle-checks";
    summary.lifecycle = await cancellation(probe, workers);
  } finally {
    await probe.close();
  }
  stage = "collaboration";
  summary.collaboration = await collaborate(coordinator, workers, lifecycle.signal, (value) => {
    summary.collaborationProgress = value;
  });
  lifecycle.signal.throwIfAborted();
  const evidence = receipts(coordinator);
  const rejected = evidence.filter((entry) => entry.event === "rejected");
  const calls = evidence.filter((entry) => entry.event === "call");
  const results = evidence.filter((entry) => entry.event === "result");
  for (const call of calls) {
    assert.equal(
      results.filter(
        (result) =>
          result.connection === call.connection &&
          result.id === call.id &&
          result.tool === call.tool,
      ).length,
      1,
      "Unpaired MCP request/result",
    );
  }
  const connections = new Set(
    evidence.filter((entry) => entry.event === "catalog").map((entry) => entry.connection),
  );
  assert.equal(
    connections.size,
    2,
    "Expected distinct preflight and real OpenCode MCP connections",
  );
  assert(!connections.has(undefined));
  assert(rejected.some((entry) => entry.reason === "peer"));
  assert(rejected.some((entry) => entry.reason === "tool"));
  assert.equal(heartbeatErrors.length, 0);
  summary.evidence = {
    catalogs: evidence.filter((entry) => entry.event === "catalog").length,
    calls: evidence.filter((entry) => entry.event === "call").length,
    results: evidence.filter((entry) => entry.event === "result").length,
    connections: connections.size,
    pairedCallResults: true,
    endpointGuardRejected: true,
    unlistedToolRejected: true,
    workerTurns: workers.map((worker) => ({ role: worker.id, turns: worker.receipts.length })),
    heartbeatErrors: 0,
  };
  summary.passed = true;
}

try {
  mkdirSync(output, { recursive: true, mode: 0o700 });
  for (const file of ["mcp-receipts.json", "worker-receipts.json", "runtime-readiness.json"]) {
    writeFileSync(resolve(output, file), "[]\n", { mode: 0o600 });
  }
  await main();
} catch (error) {
  summary.passed = false;
  summary.failedStage = stage;
  summary.failure = {
    kind: error instanceof Error ? error.name : "unknown",
    frame:
      error instanceof Error
        ? error.stack
            ?.split("\n")
            .slice(1)
            .find((line) => line.includes("examples/agent-network/"))
            ?.match(/examples\/agent-network\/[^:)]+:\d+/)?.[0]
        : undefined,
    operator: error instanceof assert.AssertionError ? error.operator : undefined,
  };
  console.error(JSON.stringify({ agentNetwork: false, stage, privateDiagnosticsWithheld: true }));
  process.exitCode = 1;
} finally {
  const errors = await lifecycle.drain();
  // Only metadata/hashes are retained, after final cancellation receipts have settled.
  try {
    writeFileSync(
      resolve(output, "worker-receipts.json"),
      JSON.stringify(
        workers.flatMap((worker) => worker.receipts),
        null,
        2,
      ),
      { mode: 0o600 },
    );
  } catch {
    errors.push("Evidence write failed");
  }
  summary.cleanup = { passed: errors.length === 0, failures: errors.length };
  if (errors.length || lifecycle.signal.aborted) {
    summary.passed = false;
    if (lifecycle.signal.aborted) summary.interrupted = true;
    process.exitCode = 1;
    console.error(
      JSON.stringify({ agentNetwork: false, stage: "cleanup", failures: errors.length }),
    );
  }
  summary.finished = new Date().toISOString();
  try {
    writeFileSync(resolve(output, "summary.json"), JSON.stringify(summary, null, 2), {
      mode: 0o600,
    });
  } catch {
    summary.passed = false;
    process.exitCode = 1;
    console.error("Agent network summary write failed; private diagnostics withheld");
  }
  console.log(
    JSON.stringify({
      agentNetwork: summary.passed,
      summary: ".test-results/agent-network/summary.json",
    }),
  );
}
