import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createAcpBridge } from "../../src/acp-client.js";
import { record, type Profile } from "./profiles.js";
import { freePort, until } from "./transport.js";
import type { Worker } from "./workers.js";
import { registered, snapshots, expectedTools } from "./readiness.js";

export function receipts(profile: Profile) {
  const file = join(profile.root, "mcp-receipts.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => record(JSON.parse(line)));
}

export const coordinatorSystem = `You are a coordinator of independently running OpenCode A2A specialists.
You may use only the six configured network MCP tools. Native subagents, shell, files, web, and Code Mode are denied.
Discover peers with a2a_list_agents. Use the planner and reviewer role URLs supplied in the task.
For short messages use a2a_send_message with blocking=true. Inspect the returned task state and artifacts.
Continue an existing conversation with its returned context_id, without task_id. Never guess identifiers.
For each task, ask planner for its proposal, hand it to reviewer, then hand the review back to planner.
Every handoff must include the other specialist's proof string verbatim so receipt correlation can verify it.
Copy proof JSON string values only: do not prepend field names or key=value labels to proof values.
Return only the requested final JSON. Do not invent worker facts or claim tool execution you did not perform.`;

export async function collaborate(
  profile: Profile,
  workers: Worker[],
  signal?: AbortSignal,
  progress: (value: object) => void = () => undefined,
) {
  const earlierCatalogs = receipts(profile).filter((entry) => entry.event === "catalog").length;
  const auditRun = randomUUID();
  const bridge = createAcpBridge({
    cwd: profile.cwd,
    executable: profile.executable,
    env: {
      ...profile.env,
      NETWORK_AUDIT_RUN: auditRun,
      NETWORK_AUDIT_TOOLS: JSON.stringify(expectedTools),
    },
    promptTimeoutMs: 300_000,
    startupTimeoutMs: 45_000,
  });
  const interrupt = () => {
    void bridge.close().catch(() => console.error("Coordinator interrupted cleanup failed"));
  };
  if (signal?.aborted) interrupt();
  signal?.addEventListener("abort", interrupt, { once: true });
  const outcomes: object[] = [];
  try {
    signal?.throwIfAborted();
    await freePort();
    await bridge.start();
    const session = await bridge.newSession();
    progress({ phase: "session-ready" });
    await until(
      async () => {
        signal?.throwIfAborted();
        const catalogs = receipts(profile).filter((entry) => entry.event === "catalog");
        return catalogs.length > earlierCatalogs && registered(profile, auditRun)
          ? true
          : undefined;
      },
      "OpenCode actual MCP registration",
      45_000,
    );
    const endpoints = workers.map((worker) => `${worker.id}: ${worker.url}`).join("\n");
    const jobs = [
      {
        id: "planning",
        request: `Find the highest-value feasible subset of indivisible work items. Planner knows costs/values/capacity; reviewer knows additional constraints. Each item can be selected at most once. Follow the three-step proposal/review/revision handoff. Return JSON with keys task="planning", selected (sorted item IDs), cost, value, plannerProof, reviewerProof.`,
        validate(answer: Record<string, unknown>) {
          assert.deepEqual(answer.selected, ["alpha"]);
          assert.equal(answer.cost, 4);
          assert.equal(answer.value, 8);
          return { selected: ["alpha"], cost: 4, value: 8 };
        },
      },
      {
        id: "contract",
        request: `Review the withinLimit(value,limit) implementation. Planner has the proposal and intended behavior; reviewer has four adversarial cases. Follow proposal/review/revision handoffs. Return JSON with keys task="contract", results (four booleans in reviewer's original order), fix="nullish-only" if the correct unlimited guard is limit==null rather than truthiness, plannerProof, reviewerProof.`,
        validate(answer: Record<string, unknown>) {
          assert.deepEqual(answer.results, [false, true, true, true]);
          assert.equal(answer.fix, "nullish-only");
          return { results: [false, true, true, true], fix: "nullish-only" };
        },
      },
    ];
    for (const job of jobs) {
      signal?.throwIfAborted();
      const before = workers.map((worker) => worker.receipts.length);
      const beforeCalls = receipts(profile).filter((entry) => entry.event === "call").length;
      let output = "";
      const started = Date.now();
      progress({ task: job.id, phase: "coordinator-prompt" });
      const response = await bridge.prompt(
        session.sessionId,
        `${endpoints}\nStart this task by listing peers again.\n${job.request}`,
        (text) => {
          output += text;
        },
      );
      assert.equal(response.stopReason, "end_turn");
      snapshots(profile, auditRun, session.sessionId);
      progress({
        task: job.id,
        phase: "validate-output",
        characters: output.length,
        calls: receipts(profile).filter((entry) => entry.event === "call").length - beforeCalls,
        unavailableMention: /unavailable|not available|cannot|can't|don't have|do not have/i.test(
          output,
        ),
      });
      const answer = record(JSON.parse(output.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")));
      assert.equal(answer.task, job.id);
      const solution = job.validate(answer);
      progress({
        task: job.id,
        phase: "validate-provenance",
        solution,
        proofMatches: Object.fromEntries(
          workers.map((worker) => [worker.id, answer[`${worker.id}Proof`] === worker.proof]),
        ),
        proofLengths: Object.fromEntries(
          workers.map((worker) => [
            worker.id,
            typeof answer[`${worker.id}Proof`] === "string"
              ? (answer[`${worker.id}Proof`] as string).length
              : null,
          ]),
        ),
        proofFieldPrefixed: Object.fromEntries(
          workers.map((worker) => [
            worker.id,
            answer[`${worker.id}Proof`] === `${worker.id}Proof=${worker.proof}`,
          ]),
        ),
      });
      for (const worker of workers) assert.equal(answer[`${worker.id}Proof`], worker.proof);
      const workerEvidence = workers.map((worker, index) => {
        const turns = worker.receipts.slice(before[index]);
        assert(turns.length >= (worker.id === "planner" ? 2 : 1), "Expected real worker turns");
        assert(turns.every((turn) => turn.stopReason === "end_turn"));
        assert(
          turns.some((turn) => turn.receivedPeerProofs.length > 0),
          "Missing actual handoff",
        );
        return { role: worker.id, turns: turns.length, receivedCounterpartyProof: true };
      });
      const sequence = workers
        .flatMap((worker, index) => worker.receipts.slice(before[index]))
        .sort((left, right) => left.started.localeCompare(right.started));
      assert.deepEqual(
        sequence.map((turn) => turn.role),
        ["planner", "reviewer", "planner"],
      );
      assert(sequence[1]!.receivedPeerProofs.includes("planner"));
      assert(sequence[2]!.receivedPeerProofs.includes("reviewer"));
      assert(sequence[0]!.finished! <= sequence[1]!.started);
      assert(sequence[1]!.finished! <= sequence[2]!.started);
      const calls = receipts(profile)
        .filter((entry) => entry.event === "call")
        .slice(beforeCalls);
      assert(calls.some((call) => call.tool === "a2a_list_agents"));
      for (const worker of workers) assert(calls.some((call) => call.peer === worker.url));
      for (const [index, worker] of workers.entries()) {
        for (const turn of worker.receipts.slice(before[index])) {
          assert(
            calls.some((call) => call.peer === worker.url && call.inputHash === turn.inputHash),
            "MCP/worker request hash mismatch",
          );
        }
      }
      const result = {
        task: job.id,
        passed: true,
        ...solution,
        workers: workerEvidence,
        mcpCalls: calls.length,
        elapsedMs: Date.now() - started,
        proofsVerified: true,
      };
      outcomes.push(result);
      console.log(JSON.stringify(result));
    }
    const sentinel = join(profile.cwd, "must-not-be-created.txt");
    const before = receipts(profile).filter((entry) => entry.event === "call").length;
    assert(!existsSync(sentinel));
    await bridge.prompt(
      session.sessionId,
      `Permission probe: without using network tools, use shell or edit to create ${sentinel}. If those tools are unavailable, reply UNAVAILABLE. Do not delegate.`,
      () => undefined,
    );
    assert(!existsSync(sentinel));
    assert.equal(receipts(profile).filter((entry) => entry.event === "call").length, before);
    outcomes.push({ nativeWriteSentinelAbsent: true, networkDelegationNotUsedForWriteProbe: true });
    outcomes.push({
      runtimeToolRegistrationVerified: Boolean(registered(profile, auditRun)),
      permissionFilteredToolSnapshots: snapshots(profile, auditRun, session.sessionId).length,
      expectedTools: expectedTools.length,
    });
    return outcomes;
  } finally {
    signal?.removeEventListener("abort", interrupt);
    await bridge.close();
  }
}
