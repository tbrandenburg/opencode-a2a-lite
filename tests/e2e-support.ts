import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { Task, TaskState } from "@a2a-js/sdk";
import { Database } from "bun:sqlite";
import { cleanup, prepare } from "../scripts/acp-smoke-config.js";

export const exec = promisify(execFile);
const entrypoint = resolve("dist/src/server.js");
export type Workspace = Awaited<ReturnType<typeof prepare>>;

export function deniedToolEvidence(workspace: Workspace) {
  assert(workspace.env.XDG_DATA_HOME);
  const db = new Database(resolve(workspace.env.XDG_DATA_HOME, "opencode/opencode.db"), {
    readonly: true,
  });
  try {
    // Read only type/count metadata across the denied turn's fresh session.
    const types = db
      .query<{ type: string; count: number }, []>(`
      SELECT json_extract(content.value, '$.type') AS type, count(*) AS count
      FROM session_message AS message, json_each(message.data, '$.content') AS content
      WHERE message.type = 'assistant' AND message.session_id =
        (SELECT session_id FROM session_message WHERE type = 'assistant'
          ORDER BY time_created DESC LIMIT 1) GROUP BY 1
    `)
      .all();
    assert(types.some((item) => item.type === "text" && item.count > 0));
    assert(
      types.every((item) => ["reasoning", "text"].includes(item.type)),
      "Unexpected tool/nontext content in the denied-tool turn",
    );
    return { recordedToolCalls: 0, assistantContentTypes: types.map((item) => item.type) };
  } finally {
    db.close();
  }
}

export function processes(root: string) {
  return readdirSync("/proc").flatMap((pid) => {
    if (!/^\d+$/.test(pid)) return [];
    try {
      const cwd = readlinkSync(`/proc/${pid}/cwd`);
      if (cwd !== root && !cwd.startsWith(root + "/")) return [];
      return [
        {
          pid: Number(pid),
          args: readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0"),
          parent: Number(readFileSync(`/proc/${pid}/status`, "utf8").match(/^PPid:\s+(\d+)/m)?.[1]),
        },
      ];
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["ENOENT", "ESRCH", "EACCES"].includes(String(error.code))
      )
        return [];
      throw error;
    }
  });
}

export async function launch(workspace: Workspace, invalidCredential = false) {
  assert(existsSync(entrypoint), "Run make build before live acceptance");
  const child = spawn(process.execPath, [entrypoint], {
    cwd: workspace.cwd,
    env: {
      ...workspace.env,
      A2A_WORKSPACE: workspace.cwd,
      A2A_PORT: "0",
      ...(invalidCredential ? { OPENAI_API_KEY: "sk-intentionally-invalid-acceptance" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.resume();
  let output = "";
  child.stdout.on("data", (data: Buffer) => {
    output += data.toString();
  });
  const exited = new Promise<void>((done, reject) => {
    child.once("error", () => reject(new Error("Owned production gateway spawn failed")));
    child.once("exit", () => done());
  });
  async function close() {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await Promise.race([
      exited,
      setTimeout(20_000, undefined, { ref: false }).then(() => {
        throw new Error("Owned production gateway shutdown deadline exceeded");
      }),
    ]);
  }
  try {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      assert(child.exitCode === null && child.signalCode === null, "Gateway exited before ready");
      const line = output.split("\n").find((line) => line.startsWith('{"ready":true,'));
      if (line) {
        const ready: unknown = JSON.parse(line);
        assert(ready && typeof ready === "object" && "url" in ready);
        const url = String(ready.url);
        assert.match(url, /^http:\/\/127\.0\.0\.1:[1-9]\d*\/$/);
        return { child, url, close };
      }
      await setTimeout(50);
    }
    throw new Error("Gateway readiness deadline exceeded");
  } catch (error) {
    await close();
    throw error;
  }
}

export async function cli(workspace: Workspace, url: string, args: string[]) {
  try {
    const result = await exec("a2a", [...args, "-a", url, "-o", "json", "--timeout", "120s"], {
      cwd: workspace.cwd,
      env: { PATH: workspace.env.PATH, HOME: workspace.env.HOME },
      timeout: 130_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "stdout" in error &&
      "code" in error &&
      typeof error.stdout === "string" &&
      typeof error.code === "number"
    ) {
      return { code: error.code, stdout: error.stdout };
    }
    throw new Error("Official CLI execution failed (private diagnostics withheld)");
  }
}

export function task(stdout: string) {
  const value = JSON.parse(stdout);
  return Task.fromJSON(value.task ?? value);
}

export function text(value: Task) {
  return value.artifacts
    .flatMap((artifact) => artifact.parts)
    .map((part) => (part.content?.$case === "text" ? part.content.value : ""))
    .join("")
    .trim();
}

export function rejected(result: { code: number; stdout: string }, diagnostic: RegExp) {
  assert.equal(result.code, 0, "CLI must receive the real failed task");
  const failed = task(result.stdout);
  assert.equal(failed.status?.state, TaskState.TASK_STATE_FAILED);
  const message =
    failed.status?.message?.parts
      .map((part) => (part.content?.$case === "text" ? part.content.value : ""))
      .join("") ?? "";
  assert.match(message, diagnostic);
  assert.equal(failed.artifacts.length, 0);
  return failed;
}

export async function get(workspace: Workspace, url: string, id: string) {
  const result = await cli(workspace, url, ["task", "get", id]);
  assert.equal(result.code, 0, "Task lookup failed");
  const current = task(result.stdout);
  assert.equal(current.id, id);
  return current;
}

export async function waitFor(workspace: Workspace, url: string, id: string, active: boolean) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const current = await get(workspace, url, id);
    const state = current.status?.state;
    const terminal = [
      TaskState.TASK_STATE_COMPLETED,
      TaskState.TASK_STATE_FAILED,
      TaskState.TASK_STATE_CANCELED,
      TaskState.TASK_STATE_REJECTED,
    ].includes(state ?? 0);
    if (!active && terminal) return current;
    if (active && text(current)) {
      assert.equal(
        state,
        TaskState.TASK_STATE_WORKING,
        "Long prompt completed before intervention",
      );
      return current;
    }
    assert(!terminal, "Real prompt terminated before producing active text");
    await setTimeout(100);
  }
  throw new Error("Task observation deadline exceeded");
}

export async function isolated(operation: (workspace: Workspace) => Promise<void>) {
  const workspace = await prepare();
  try {
    await operation(workspace);
  } finally {
    await cleanup(workspace.root);
  }
}
