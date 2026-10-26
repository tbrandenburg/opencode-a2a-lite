import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Task, TaskState } from "@a2a-js/sdk";
import { createGateway } from "../src/server.js";
import { cleanup, prepare } from "../scripts/acp-smoke-config.js";

const exec = promisify(execFile);
let stage = "prepare";
async function main() {
  const workspace = await prepare();
  const gateway = createGateway({
    workspace: workspace.cwd,
    port: 0,
    acp: { executable: workspace.executable, env: workspace.env },
  });
  try {
    const ready = await gateway.start();
    stage = "submit";
    async function cli(args: string[]) {
      const result = await exec(
        "a2a",
        [...args, "-a", ready.url, "-o", "json", "--timeout", "20s"],
        {
          cwd: workspace.cwd,
          env: { PATH: workspace.env.PATH, HOME: workspace.env.HOME },
          timeout: 25_000,
          maxBuffer: 2 * 1024 * 1024,
        },
      );
      return JSON.parse(result.stdout);
    }
    const submitted = await cli([
      "send",
      "--async",
      "Write a very long original story of at least 8000 words, continuing without asking questions. Start the story immediately. Do not use tools.",
    ]);
    const task = Task.fromJSON(submitted.task);
    assert(task.id, "CLI must return the actual task ID");
    stage = "wait-for-text";
    const deadline = Date.now() + 60_000;
    let streamed = false;
    while (Date.now() < deadline) {
      const response = await cli(["task", "get", task.id]);
      const current = Task.fromJSON(response.task ?? response);
      if (
        current.artifacts.some((artifact) =>
          artifact.parts.some(
            (part) => part.content?.$case === "text" && part.content.value.length > 0,
          ),
        )
      ) {
        streamed = true;
        assert.equal(current.status?.state, TaskState.TASK_STATE_WORKING);
        break;
      }
      assert(
        ![TaskState.TASK_STATE_FAILED, TaskState.TASK_STATE_COMPLETED].includes(
          current.status?.state ?? 0,
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(streamed, "Wait for real root text before attempting cancellation");
    stage = "cancel";
    const result = await cli(["task", "cancel", task.id]);
    const canceled = Task.fromJSON(result.task ?? result);
    assert.equal(canceled.status?.state, TaskState.TASK_STATE_CANCELED);
    stage = "stored-terminal";
    const final = await cli(["task", "get", task.id]);
    const stored = Task.fromJSON(final.task ?? final);
    assert.equal(stored.status?.state, TaskState.TASK_STATE_CANCELED);
    assert.equal(stored.id, task.id);
    assert(stored.artifacts.length > 0);
    console.log(
      JSON.stringify({
        liveCancellation: true,
        rootTextBeforeCancel: true,
        terminal: "TASK_STATE_CANCELED",
        storedTerminal: true,
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
  console.error(JSON.stringify({ liveCancellation: false, stage }));
  process.exitCode = 1;
}
