import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { Task, TaskState } from "@a2a-js/sdk";
import { createGateway } from "../src/server.js";
import { createAgentExecutor } from "../src/executor.js";
import { cleanup, prepare } from "../scripts/acp-smoke-config.js";

const exec = promisify(execFile);

async function main() {
  const workspace = await prepare();
  const sessions: string[] = [];
  const prompts: string[] = [];
  const gateway = createGateway({
    workspace: workspace.cwd,
    port: 0,
    acp: { executable: workspace.executable, env: workspace.env },
    createExecutor(bridge) {
      return createAgentExecutor({
        async newSession() {
          const session = await bridge.newSession();
          sessions.push(session.sessionId);
          return session;
        },
        prompt(session, text, onText) {
          prompts.push(session);
          return bridge.prompt(session, text, onText);
        },
        cancel: (session) => bridge.cancel(session),
      });
    },
  });
  try {
    const ready = await gateway.start();
    async function send(text: string, contextId?: string) {
      const result = await exec(
        "a2a",
        [
          "send",
          "-a",
          ready.url,
          "-o",
          "json",
          "--timeout",
          "120s",
          ...(contextId ? ["--context-id", contextId] : []),
          text,
        ],
        {
          cwd: workspace.cwd,
          env: { PATH: workspace.env.PATH, HOME: workspace.env.HOME },
          timeout: 130_000,
          maxBuffer: 2 * 1024 * 1024,
        },
      );
      const response = JSON.parse(result.stdout);
      const task = Task.fromJSON(response.task);
      assert.equal(task.status?.state, TaskState.TASK_STATE_COMPLETED);
      assert(task.contextId, "CLI response must include the actual context ID");
      return task;
    }
    function answer(task: Task) {
      return task.artifacts
        .flatMap((artifact) => artifact.parts)
        .map((part) => (part.content?.$case === "text" ? part.content.value : ""))
        .join("")
        .trim();
    }
    const alpha = `alpha-${randomUUID()}`;
    const beta = `beta-${randomUUID()}`;
    const first = await send(
      `Remember this marker for later: ${alpha}. Reply with only the exact marker. Do not use tools.`,
    );
    assert.equal(answer(first), alpha);
    const second = await send(
      `Remember this marker for later: ${beta}. Reply with only the exact marker. Do not use tools.`,
    );
    assert.equal(answer(second), beta);
    assert.notEqual(first.contextId, second.contextId);
    const followup =
      "What marker did I ask you to remember? Reply with only the exact marker. Do not use tools.";
    const third = await send(followup, first.contextId);
    const fourth = await send(followup, second.contextId);
    assert.equal(answer(third), alpha);
    assert.equal(answer(fourth), beta);
    assert.equal(third.contextId, first.contextId);
    assert.equal(fourth.contextId, second.contextId);
    assert.equal(new Set(sessions).size, 2);
    assert.deepEqual(prompts, [sessions[0], sessions[1], sessions[0], sessions[1]]);
    console.log(
      JSON.stringify({
        liveContext: true,
        cliTurns: 4,
        contexts: 2,
        sessions: 2,
        rememberedMarkers: true,
        isolatedConversations: true,
      }),
    );
  } finally {
    try {
      await gateway.close();
    } finally {
      await cleanup(workspace.root);
    }
  }
}

try {
  await main();
} catch {
  // Never publish raw CLI/provider errors, which may contain credentials.
  console.error(JSON.stringify({ liveContext: false }));
  process.exitCode = 1;
}
