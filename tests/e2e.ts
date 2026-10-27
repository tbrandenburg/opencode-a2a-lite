import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { TaskState } from "@a2a-js/sdk";
import {
  cli,
  cliSuccess,
  createDiagnostics,
  diagnostics,
  deniedToolEvidence,
  exec,
  get,
  isolated,
  launch,
  processes,
  rejected,
  task,
  text,
  waitFor,
  withCleanup,
} from "./e2e-support.js";

let stage = "prerequisites";
const passed: string[] = [];
function pass(id: string, evidence: Record<string, unknown> = {}) {
  passed.push(id);
  console.log(JSON.stringify({ scenario: id, passed: true, ...evidence }));
}
const long =
  "Write an original story of at least 8000 words. Start immediately and continue without questions. Do not use tools.";
async function main() {
  assert.equal(
    (await exec("a2a", ["--version"], { timeout: 10_000 })).stdout.trim(),
    "a2a version v0.3.1",
  );
  assert.equal(Bun.version, "1.3.9");
  await isolated(async (workspace) => {
    let gateway = await launch(workspace);
    await withCleanup(
      async () => {
        stage = "E2E01";
        const card = await cli(workspace, gateway.url, ["card", "get", gateway.url]);
        assert.equal(card.code, 0);
        const info = JSON.parse(card.stdout);
        assert.equal(info.capabilities.streaming, true);
        assert.deepEqual(
          info.supportedInterfaces.map(
            (item: { protocolVersion: string; protocolBinding: string }) => [
              item.protocolVersion,
              item.protocolBinding,
            ],
          ),
          [["1.0", "JSONRPC"]],
        );
        pass(stage, { productionEntrypoint: true, protocol: "1.0", ephemeralPort: true });
        const alpha = `alpha-${randomUUID()}`;
        const beta = `beta-${randomUUID()}`;
        const remember = (marker: string) =>
          `Remember this marker: ${marker}. Reply only with the exact marker. Do not use tools.`;
        const recall =
          "What marker did I ask you to remember? Reply only with the exact marker. Do not use tools.";
        stage = "E2E02";
        const exact = createDiagnostics();
        const first = await exact.run(async () => {
          exact.at("E2E02.cli");
          const firstResult = await cli(workspace, gateway.url, ["send", remember(alpha)]);
          cliSuccess(firstResult);
          exact.at("E2E02.decode");
          const first = task(firstResult.stdout);
          exact.observe(first);
          exact.at("E2E02.completed");
          assert.equal(first.status?.state, TaskState.TASK_STATE_COMPLETED);
          exact.at("E2E02.exact-text");
          assert.equal(text(first), alpha);
          exact.at("E2E02.handles");
          assert(first.id && first.contextId);
          return first;
        });
        pass(stage, { exactText: true, completed: true });
        stage = "E2E03";
        const stream = await cli(workspace, gateway.url, ["send", "--stream", remember(beta)]);
        assert.equal(stream.code, 0);
        // Feed the real CLI JSONL to the existing independent stream verifier.
        const verifier = Bun.spawn(
          ["jq", "-es", "--arg", "marker", beta, "-f", resolve("scripts/demo-stream.jq")],
          { stdin: new Blob([stream.stdout]), stdout: "pipe", stderr: "ignore" },
        );
        const verified = JSON.parse(await new Response(verifier.stdout).text());
        assert.equal(await verifier.exited, 0);
        assert(verified.contextId && verified.taskId && verified.chunks >= 2);
        const second = await get(workspace, gateway.url, verified.taskId);
        assert.equal(text(second), beta);
        pass(stage, { stableIdentityOrder: true, duplicateText: false, chunks: verified.chunks });
        stage = "E2E04";
        const followup = task(
          (await cli(workspace, gateway.url, ["send", "--context-id", first.contextId, recall]))
            .stdout,
        );
        assert.equal(text(followup), alpha);
        assert.equal(followup.contextId, first.contextId);
        assert.notEqual(followup.id, first.id);
        assert.equal(followup.status?.state, TaskState.TASK_STATE_COMPLETED);
        pass(stage, { rememberedMarker: true, newTask: true });
        stage = "E2E05";
        const other = task(
          (await cli(workspace, gateway.url, ["send", "--context-id", second.contextId, recall]))
            .stdout,
        );
        assert.equal(text(other), beta);
        assert.notEqual(first.contextId, second.contextId);
        assert.equal(other.contextId, second.contextId);
        assert.equal(other.status?.state, TaskState.TASK_STATE_COMPLETED);
        pass(stage, { separateContexts: 2, exactMarkers: true });
        stage = "E2E06";
        const admission = createDiagnostics();
        const active = await admission.run(async () => {
          admission.at("E2E06.async-cli");
          const submitted = await cli(workspace, gateway.url, ["send", "--async", long]);
          cliSuccess(submitted);
          admission.at("E2E06.decode");
          const active = task(submitted.stdout);
          admission.observe(active);
          admission.at("E2E06.handles");
          assert(active.id && active.contextId);
          admission.at("E2E06.first-text");
          await waitFor(workspace, gateway.url, active.id, true, admission.observe);
          admission.at("E2E06.busy-rejection");
          const busy = await cli(workspace, gateway.url, [
            "send",
            "Reply only BUSY-REQUEST-MUST-NOT-RUN",
          ]);
          rejected(busy, /Gateway busy/);
          admission.at("E2E06.original-working");
          const original = await get(workspace, gateway.url, active.id);
          admission.observe(original);
          assert.equal(original.status?.state, TaskState.TASK_STATE_WORKING);
          return active;
        });
        pass(stage, { realTextWhileWorking: true, concurrentRequestRejected: true });
        stage = "E2E07";
        const cancel = await cli(workspace, gateway.url, ["task", "cancel", active.id]);
        const final = await waitFor(workspace, gateway.url, active.id, false);
        assert(
          [TaskState.TASK_STATE_CANCELED, TaskState.TASK_STATE_COMPLETED].includes(
            final.status?.state ?? 0,
          ),
        );
        if (final.status?.state === TaskState.TASK_STATE_CANCELED) {
          assert.equal(cancel.code, 0);
          assert.equal(task(cancel.stdout).status?.state, TaskState.TASK_STATE_CANCELED);
        } else assert.notEqual(cancel.code, 0, "A losing cancellation must not claim cancellation");
        assert(text(final).length > 0);
        pass(stage, {
          outcome:
            final.status?.state === TaskState.TASK_STATE_CANCELED
              ? "true-cancel"
              : "honest-completion-race",
        });
        stage = "E2E08";
        const target = resolve(workspace.cwd, "must-not-exist.txt");
        assert(!existsSync(target));
        const denied = task(
          (
            await cli(workspace, gateway.url, [
              "send",
              `Use a file writing tool to create ${target} containing permission-probe. You must actually try the tool, not simulate it. If unavailable, briefly say so.`,
            ])
          ).stdout,
        );
        assert(!existsSync(target));
        assert.equal(denied.status?.state, TaskState.TASK_STATE_COMPLETED);
        assert(text(denied).length > 0);
        pass(stage, {
          fileAbsent: true,
          effectiveConfig: "deny-tools",
          ...deniedToolEvidence(workspace),
          liveCallback: "not established",
          limitation:
            "Deny config may remove tools; callback rejection is covered by deterministic ACP tests, not claimed live.",
        });
        stage = "E2E09";
        const bad = await cli(workspace, gateway.url, [
          "send",
          "--context-id",
          randomUUID(),
          "Reply only SHOULD-NOT-RUN",
        ]);
        rejected(bad, /Unknown or expired context/);
        const valid = task(
          (await cli(workspace, gateway.url, ["send", "Reply only READY. Do not use tools."]))
            .stdout,
        );
        assert.equal(text(valid), "READY");
        assert.equal(valid.status?.state, TaskState.TASK_STATE_COMPLETED);
        pass(stage, { unknownContextRejected: true, freshContextWorks: true });
        stage = "E2E10";
        const dying = task((await cli(workspace, gateway.url, ["send", "--async", long])).stdout);
        await waitFor(workspace, gateway.url, dying.id, true);
        const acp = processes(workspace.root).filter(
          (item) => item.parent === gateway.child.pid && item.args.includes("acp"),
        );
        assert.equal(acp.length, 1, "Identify exactly the gateway-owned ACP child");
        const child = acp[0];
        assert(child);
        process.kill(child.pid, "SIGKILL");
        const failed = await waitFor(workspace, gateway.url, dying.id, false);
        assert.equal(failed.status?.state, TaskState.TASK_STATE_FAILED);
        assert.equal(failed.id, dying.id);
        const retry = await cli(workspace, gateway.url, [
          "send",
          "--context-id",
          dying.contextId,
          "Do not resend",
        ]);
        rejected(retry, /Unknown or expired context/);
        assert.equal(
          processes(workspace.root).filter(
            (item) => item.parent === gateway.child.pid && item.args.includes("acp"),
          ).length,
          0,
        );
        pass(stage, {
          actualManagedChildKilled: true,
          failed: true,
          replacementChildren: 0,
          contextInvalidated: true,
        });
        stage = "E2E11";
        await gateway.close();
        gateway = await launch(workspace);
        const stale = await cli(workspace, gateway.url, [
          "send",
          "--context-id",
          first.contextId,
          recall,
        ]);
        rejected(stale, /Unknown or expired context/);
        const fresh = task(
          (await cli(workspace, gateway.url, ["send", "Reply only RESTARTED. Do not use tools."]))
            .stdout,
        );
        assert.equal(text(fresh), "RESTARTED");
        assert.equal(fresh.status?.state, TaskState.TASK_STATE_COMPLETED);
        assert.notEqual(fresh.contextId, first.contextId);
        pass(stage, { oldContextRejected: true, newContextWorks: true });
        stage = "E2E12";
        const malformed = await cli(workspace, gateway.url, [
          "send",
          "--data-part",
          '{"unsafe":true}',
        ]);
        rejected(malformed, /Only non-empty plain text/);
        const recovery = `recovery-${randomUUID()}`;
        const after = task(
          (await cli(workspace, gateway.url, ["send", remember(recovery)])).stdout,
        );
        assert.equal(text(after), recovery);
        assert.equal(after.status?.state, TaskState.TASK_STATE_COMPLETED);
        pass(stage, { dataRejected: true, textStillWorks: true });
      },
      () => gateway.close(),
    );
  });
  stage = "E2E13";
  await isolated(async (workspace) => {
    const gateway = await launch(workspace, true);
    try {
      const result = await cli(workspace, gateway.url, [
        "send",
        "--async",
        "Reply only IMPOSSIBLE. Do not use tools.",
      ]);
      assert.equal(result.code, 0);
      const submitted = task(result.stdout);
      const failed = await waitFor(workspace, gateway.url, submitted.id, false);
      assert.equal(failed.status?.state, TaskState.TASK_STATE_FAILED);
      assert.notEqual(failed.status?.state, TaskState.TASK_STATE_COMPLETED);
      assert(!text(failed).includes("sk-intentionally-invalid"));
      pass(stage, { invalidCredential: true, terminal: "failed", completed: false });
    } finally {
      await gateway.close();
    }
  });
  stage = "E2E14";
  await isolated(async (workspace) => {
    const gateway = await launch(workspace);
    try {
      const active = task((await cli(workspace, gateway.url, ["send", "--async", long])).stdout);
      await waitFor(workspace, gateway.url, active.id, true);
      await gateway.close();
      await assert.rejects(fetch(gateway.url, { signal: AbortSignal.timeout(2_000) }));
      assert.notEqual(gateway.child.exitCode, null);
    } finally {
      await gateway.close();
    }
  });
  pass(stage, {
    shutdown: "SIGTERM production entrypoint",
    exactRootProcChecks: true,
    temporaryRootsRemoved: true,
  });
  assert.equal(passed.length, 14);
  console.log(JSON.stringify({ liveAcceptance: true, passed: passed.length, failed: 0 }));
}
try {
  await main();
} catch (error) {
  console.error(
    JSON.stringify({
      liveAcceptance: false,
      stage,
      passed: passed.length,
      ...diagnostics(error),
      failure:
        error instanceof assert.AssertionError
          ? "Acceptance assertion failed (private values withheld)"
          : "Private diagnostics withheld",
    }),
  );
  process.exitCode = 1;
}
