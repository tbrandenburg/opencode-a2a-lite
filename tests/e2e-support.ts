import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { isDeepStrictEqual, promisify } from "node:util";
import { Task, TaskState } from "@a2a-js/sdk";
import { Database } from "bun:sqlite";
import { cleanup, prepare } from "../scripts/acp-smoke-config.js";

export const exec = promisify(execFile);
const entrypoint = resolve("dist/src/server.js");
export type Workspace = Awaited<ReturnType<typeof prepare>>;

const criteria = [
  "E2E02.cli",
  "E2E02.decode",
  "E2E02.completed",
  "E2E02.exact-text",
  "E2E02.handles",
  "E2E06.async-cli",
  "E2E06.decode",
  "E2E06.handles",
  "E2E06.first-text",
  "E2E06.busy-rejection",
  "E2E06.original-working",
] as const;
type Category =
  | "assertion"
  | "cli-exit"
  | "cli-timeout"
  | "decode"
  | "observation-deadline"
  | "cleanup"
  | "unknown";
const categories = new WeakMap<object, Category>();
const evidence = new WeakMap<
  object,
  ReturnType<ReturnType<typeof createDiagnostics>["snapshot"]>
>();
const cleanupFailures = new WeakSet<object>();
const taskStates = new Map<TaskState, string>([
  [TaskState.TASK_STATE_SUBMITTED, "submitted"],
  [TaskState.TASK_STATE_WORKING, "working"],
  [TaskState.TASK_STATE_COMPLETED, "completed"],
  [TaskState.TASK_STATE_FAILED, "failed"],
  [TaskState.TASK_STATE_CANCELED, "canceled"],
  [TaskState.TASK_STATE_INPUT_REQUIRED, "input-required"],
  [TaskState.TASK_STATE_REJECTED, "rejected"],
  [TaskState.TASK_STATE_AUTH_REQUIRED, "auth-required"],
]);

function failure(category: Category) {
  const error = new Error("Private diagnostics withheld");
  categories.set(error, category);
  return error;
}

export function errorCategory(error: unknown): Category {
  if (!error || typeof error !== "object") return "unknown";
  return (
    categories.get(error) ?? (error instanceof assert.AssertionError ? "assertion" : "unknown")
  );
}

export function diagnostics(error: unknown) {
  if (!error || typeof error !== "object") return {};
  return {
    ...evidence.get(error),
    errorCategory: errorCategory(error),
    cleanupErrorCategory:
      cleanupFailures.has(error) || errorCategory(error) === "cleanup" ? "cleanup" : null,
  };
}

export function createDiagnostics(clock = () => performance.now()) {
  const started = clock();
  let criterion: (typeof criteria)[number] | null = null;
  let lastTaskState = "unknown";
  let taskPresent = false;
  let contextPresent = false;
  let textPresent = false;
  let firstObservedTextMs: number | null = null;
  const elapsed = () => {
    const value = clock() - started;
    return Number.isFinite(value) && value >= 0 ? value : 0;
  };
  function snapshot() {
    return {
      criterion,
      lastTaskState,
      taskPresent,
      contextPresent,
      textPresent,
      elapsedMs: elapsed(),
      firstObservedTextMs,
    };
  }
  return {
    snapshot,
    at(value: (typeof criteria)[number]) {
      assert(criteria.includes(value));
      criterion = value;
    },
    observe(value: Task) {
      const state = value.status?.state;
      lastTaskState = taskStates.get(state ?? TaskState.TASK_STATE_UNSPECIFIED) ?? "unknown";
      taskPresent = typeof value.id === "string" && value.id.length > 0;
      contextPresent = typeof value.contextId === "string" && value.contextId.length > 0;
      textPresent = text(value).length > 0;
      if (textPresent && firstObservedTextMs === null) firstObservedTextMs = elapsed();
    },
    async run<T>(operation: () => Promise<T>): Promise<T> {
      try {
        return await operation();
      } catch (error) {
        const safe = failure(errorCategory(error));
        evidence.set(safe, snapshot());
        throw safe;
      }
    },
  };
}

export async function withCleanup<T>(
  operation: () => Promise<T>,
  close: () => Promise<void>,
): Promise<T> {
  const result = await Promise.resolve()
    .then(operation)
    .then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
  try {
    await close();
  } catch {
    if (result.ok) throw failure("cleanup");
    const retained =
      result.error && typeof result.error === "object" ? result.error : failure("unknown");
    cleanupFailures.add(retained);
    throw retained;
  }
  if (!result.ok) throw result.error;
  return result.value;
}

export function deniedToolEvidence(workspace: Pick<Workspace, "env">) {
  assert(workspace.env.XDG_DATA_HOME);
  const db = new Database(resolve(workspace.env.XDG_DATA_HOME, "opencode/opencode.db"), {
    readonly: true,
  });
  try {
    // Read only type/count metadata across the denied turn's fresh session.
    const types = db
      .query<{ type: string; count: number }, []>(`
      WITH latest AS (
        SELECT session_id FROM session_message WHERE type = 'assistant'
        ORDER BY time_created DESC, id DESC LIMIT 1
      ), content AS (
        SELECT part.type FROM session_part AS part
        JOIN session_message AS message ON message.id = part.message_id
          AND message.session_id = part.session_id
        WHERE message.type = 'assistant' AND message.session_id = (SELECT session_id FROM latest)
        UNION ALL
        SELECT json_extract(inline.value, '$.type') AS type
        FROM session_message AS message, json_each(message.data, '$.content') AS inline
        WHERE message.type = 'assistant' AND message.session_id = (SELECT session_id FROM latest)
      ) SELECT type, count(*) AS count FROM content GROUP BY type ORDER BY type
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

function metadata(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object" && !Array.isArray(value), "Invalid runtime metadata");
  return value as Record<string, unknown>;
}

function catalog(value: unknown, cwd: string) {
  const result = metadata(value);
  assert(metadata(result.location).directory === cwd, "Wrong runtime catalog location");
  assert(Array.isArray(result.data), "Invalid runtime catalog");
  return result.data.map(metadata);
}

// V2 catalogs initialize asynchronously. Inspect the same ACP-owned server, never a new service.
export function runtimeCatalogReady(
  workspace: Pick<Workspace, "cwd" | "root" | "config">,
  values: { config: unknown; plugins: unknown; agents: unknown; model: unknown; mcp: unknown },
) {
  assert(Array.isArray(values.config), "Invalid runtime configuration sources");
  const documents = values.config.map(metadata).filter((entry) => {
    assert(
      typeof entry.path === "string" && entry.path.startsWith(workspace.root + "/"),
      "Unexpected runtime configuration source",
    );
    assert(["document", "directory"].includes(String(entry.type)), "Invalid config source type");
    return entry.type === "document";
  });
  assert(
    documents.length === 1 &&
      documents[0]?.path === resolve(workspace.cwd, "opencode.json") &&
      isDeepStrictEqual(documents[0].info, workspace.config),
    "Runtime configuration changed the restrictions",
  );
  const plugins = catalog(values.plugins, workspace.cwd);
  assert(
    plugins.every((plugin) => metadata(plugin.source).type === "builtin"),
    "Unexpected runtime plugin source",
  );
  assert(catalog(values.mcp, workspace.cwd).length === 0, "Unexpected runtime MCP server");
  const agents = catalog(values.agents, workspace.cwd);
  const agent = agents.find((entry) => entry.mode !== "subagent" && !entry.hidden);
  const model = metadata(values.model);
  assert(metadata(model.location).directory === workspace.cwd, "Wrong runtime model location");
  const selected = model.data === null ? {} : metadata(model.data);
  if (
    plugins.length === 0 ||
    !plugins.every((plugin) => metadata(plugin.state).status === "active") ||
    agent?.id !== workspace.config.default_agent ||
    selected.providerID !== workspace.config.model.providerID ||
    selected.id !== workspace.config.model.model
  )
    return false;
  assert(
    agent.mode === "primary" && agent.system === workspace.config.agents.smoke.system,
    "Unexpected runtime smoke agent",
  );
  assert(
    agent.model === undefined ||
      (metadata(agent.model).providerID === workspace.config.model.providerID &&
        metadata(agent.model).id === workspace.config.model.model),
    "Unexpected runtime agent model override",
  );
  assert(Array.isArray(agent.permissions), "Missing runtime agent permissions");
  const rules = agent.permissions.map(metadata);
  const denied = rules.reduce(
    (previous, rule, index) =>
      rule.action === "*" && rule.resource === "*" && rule.effect === "deny" ? index : previous,
    -1,
  );
  assert(
    denied >= 0 && rules.slice(denied).every((rule) => rule.effect === "deny"),
    "Runtime agent does not deny tool access",
  );
  return ["opencode.config.agent", "opencode.config.provider", "opencode.config.mcp"].every((id) =>
    plugins.some((plugin) => plugin.id === id),
  );
}

export async function verifyPrivateRuntime(
  workspace: Workspace,
  gateway: number,
  deadline: number,
) {
  try {
    const owned = processes(workspace.root);
    const adapters = owned.filter(
      (entry) => entry.parent === gateway && entry.args.includes("acp"),
    );
    assert(adapters.length === 1, "Expected one owned ACP adapter");
    const servers = owned.filter(
      (entry) => entry.parent === adapters[0]?.pid && entry.args.includes("serve"),
    );
    assert(servers.length === 1, "Expected one ACP-owned private server");
    const server = servers[0];
    assert(server);
    // Keep the private lease credential in memory only; never return it or raw API diagnostics.
    const password = readFileSync(`/proc/${server.pid}/environ`, "utf8")
      .split("\0")
      .find((entry) => entry.startsWith("OPENCODE_PASSWORD="))
      ?.slice("OPENCODE_PASSWORD=".length);
    assert(password, "Missing private lease credential");
    const sockets = readdirSync(`/proc/${server.pid}/fd`).map((fd) =>
      readlinkSync(`/proc/${server.pid}/fd/${fd}`),
    );
    const ports = ["tcp", "tcp6"].flatMap((table) =>
      readFileSync(`/proc/net/${table}`, "utf8")
        .trim()
        .split("\n")
        .slice(1)
        .map((line) => line.trim().split(/\s+/))
        .filter((fields) => fields[3] === "0A" && sockets.includes(`socket:[${fields[9]}]`))
        .map((fields) => Number.parseInt(fields[1]!.split(":")[1]!, 16)),
    );
    assert(ports.length === 1, "Expected one private HTTP listener");
    const signal = AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now())));
    const read = async (endpoint: string): Promise<unknown> => {
      const url = new URL(endpoint, `http://127.0.0.1:${ports[0]}`);
      url.searchParams.set("location[directory]", workspace.cwd);
      const response = await fetch(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
        },
        signal,
        redirect: "error",
        proxy: false,
      });
      assert(response.ok, "Private runtime metadata request failed");
      return response.json();
    };
    while (performance.now() < deadline) {
      const config = await read("/api/config");
      const plugins = await read("/api/plugin");
      const agents = await read("/api/agent");
      const model = await read("/api/model/default");
      const mcp = await read("/api/mcp");
      if (runtimeCatalogReady(workspace, { config, plugins, agents, model, mcp })) return;
      await setTimeout(100, undefined, { signal });
    }
    throw new Error("Private runtime catalog readiness deadline exceeded");
  } catch {
    throw new Error("Owned private runtime readiness verification failed; no prompt submitted");
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

export function candidateEnvironment(
  workspace: Pick<Workspace, "root" | "cwd" | "env" | "executable">,
) {
  const candidates = workspace.executable.includes("/")
    ? [resolve(workspace.cwd, workspace.executable)]
    : (workspace.env.PATH ?? "/usr/bin:/bin")
        .split(":")
        .map((directory) => resolve(workspace.cwd, directory, workspace.executable));
  const executable = candidates.find((candidate) => {
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        ["ENOENT", "ENOTDIR", "EACCES"].includes(String(error.code))
      )
        return false;
      throw error;
    }
  });
  assert(executable, "Verified OpenCode candidate is no longer executable");
  const directory = mkdtempSync(join(workspace.root, "gateway-bin-"));
  // The production entrypoint resolves `opencode`; alias this exact candidate,
  // including overrides whose filename is not `opencode`, without changing production.
  symlinkSync(realpathSync(executable), join(directory, "opencode"));
  return { ...workspace.env, PATH: `${directory}:${workspace.env.PATH ?? "/usr/bin:/bin"}` };
}

export async function launch(workspace: Workspace, invalidCredential = false) {
  assert(existsSync(entrypoint), "Run make build before live acceptance");
  const child = spawn(process.execPath, [entrypoint], {
    cwd: workspace.cwd,
    env: {
      ...candidateEnvironment(workspace),
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
    const deadline = performance.now() + 45_000;
    while (performance.now() < deadline) {
      assert(child.exitCode === null && child.signalCode === null, "Gateway exited before ready");
      const line = output.split("\n").find((line) => line.startsWith('{"ready":true,'));
      if (line) {
        const ready: unknown = JSON.parse(line);
        assert(ready && typeof ready === "object" && "url" in ready);
        const url = String(ready.url);
        assert.match(url, /^http:\/\/127\.0\.0\.1:[1-9]\d*\/$/);
        assert(child.pid);
        await verifyPrivateRuntime(workspace, child.pid, deadline);
        return { child, url, close };
      }
      await setTimeout(50);
    }
    throw new Error("Gateway readiness deadline exceeded");
  } catch (error) {
    return withCleanup(async () => {
      throw error;
    }, close);
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
      typeof error.code === "number" &&
      Number.isInteger(error.code) &&
      error.code !== 0
    ) {
      return { code: error.code, stdout: error.stdout };
    }
    throw cliFailure(error);
  }
}

export function task(stdout: string) {
  try {
    const value = JSON.parse(stdout);
    return Task.fromJSON(value.task ?? value);
  } catch {
    throw failure("decode");
  }
}

export function cliFailure(error: unknown) {
  if (!error || typeof error !== "object") return failure("unknown");
  if (
    "code" in error &&
    typeof error.code === "number" &&
    Number.isInteger(error.code) &&
    error.code !== 0
  )
    return failure("cli-exit");
  // Only the configured execFile timeout shape, not arbitrary killed/buffer errors.
  if (
    "code" in error &&
    error.code === null &&
    "killed" in error &&
    error.killed === true &&
    "signal" in error &&
    error.signal === "SIGTERM"
  )
    return failure("cli-timeout");
  return failure("unknown");
}

export function observationDeadline() {
  return failure("observation-deadline");
}

export function cliSuccess(result: { code: number }, message?: string) {
  try {
    assert.equal(result.code, 0, message);
  } catch (error) {
    if (error instanceof assert.AssertionError) categories.set(error, "cli-exit");
    throw error;
  }
}

export function text(value: Task) {
  return value.artifacts
    .flatMap((artifact) => artifact.parts)
    .map((part) => (part.content?.$case === "text" ? part.content.value : ""))
    .join("")
    .trim();
}

export function rejected(result: { code: number; stdout: string }, diagnostic: RegExp) {
  cliSuccess(result, "CLI must receive the real failed task");
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
  cliSuccess(result, "Task lookup failed");
  const current = task(result.stdout);
  assert.equal(current.id, id);
  return current;
}

export async function waitFor(
  workspace: Workspace,
  url: string,
  id: string,
  active: boolean,
  observe?: (value: Task) => void,
) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const current = await get(workspace, url, id);
    observe?.(current);
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
  throw observationDeadline();
}

export async function isolated(operation: (workspace: Workspace) => Promise<void>) {
  const workspace = await prepare();
  await withCleanup(
    () => operation(workspace),
    () => cleanup(workspace.root),
  );
}
