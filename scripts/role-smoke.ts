// Real OpenCode + production CLI/A2A + a scripted local provider. No credentials or paid calls.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { scriptedModel } from "../tests/fixtures/scripted-model.js";
import { STANDALONE_AGENT } from "../src/native-role.js";

if (process.platform !== "linux") throw new Error("Native role smoke requires Linux");
const root = mkdtempSync(join(tmpdir(), "a2a-role-smoke-"));
const workspace = join(root, "workspace");
const home = join(root, "home");
mkdirSync(workspace);
mkdirSync(home);
const receipts: unknown[] = [];
let stage = "startup";
const model = scriptedModel([], (body) => receipts.push(body));
const env = {
  PATH: process.env.PATH!,
  HOME: home,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_DATA_HOME: join(home, ".local", "share"),
  XDG_CACHE_HOME: join(home, ".cache"),
  XDG_STATE_HOME: join(home, ".local", "state"),
  A2A_NAME: "Fixture card identity",
  A2A_DESCRIPTION: "Descriptive metadata only",
};
const prompt = "Role fixture standalone. Answer without tools.";
const prepared = "Role fixture prepared. Answer without tools.";
const file = join(root, "role.md");
writeFileSync(file, prompt);
const base = {
  default_agent: "architect",
  commands: { switch_role: { agent: "build", template: "replacement task" } },
  model: "mock/m",
  providers: {
    mock: {
      package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: `${model.url}/v1`, apiKey: "synthetic" },
      models: { m: {} },
    },
  },
  agents: { architect: { mode: "primary", system: prepared } },
};
const configure = (extra: object = {}) =>
  writeFileSync(join(workspace, "opencode.json"), JSON.stringify({ ...base, ...extra }));
configure();

type Owned = ReturnType<typeof Bun.spawn>;
const children = new Map<Owned, ReturnType<typeof setTimeout>>();
async function launch(flags: string[], reject = false) {
  const child = Bun.spawn(
    [
      process.execPath,
      resolve("src/cli.ts"),
      "--workspace",
      workspace,
      "--port",
      "0",
      "--no-env",
      ...flags,
    ],
    { env, cwd: workspace, stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => child.kill("SIGTERM"), 300_000);
  children.set(child, timer);
  const stderr = new Response(child.stderr).text();
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  let output = "";
  const stop = async () => {
    child.kill("SIGTERM");
    const code = await child.exited;
    clearTimeout(timer);
    children.delete(child);
    const diagnostics = await stderr;
    assert(
      !diagnostics.includes(prompt) && !diagnostics.includes(prepared),
      "prompt leaked in stderr",
    );
    assert.equal(code, 0, "owned CLI shutdown failed");
  };
  try {
    for (;;) {
      const read = await reader.read();
      if (read.done) break;
      output += new TextDecoder().decode(read.value);
      const line = output.split("\n").find((line) => line.startsWith('{"ready":true'));
      if (line) {
        assert(!reject, "invalid role reached readiness");
        return { url: String(JSON.parse(line).url), stop };
      }
    }
    const code = await child.exited;
    const diagnostics = await stderr;
    clearTimeout(timer);
    children.delete(child);
    assert(
      !/cleanup unconfirmed|owned shutdown failed/i.test(diagnostics),
      "owned startup cleanup failed",
    );
    assert(reject && code !== 0, "valid role failed startup");
    assert(!output.includes(prompt) && !diagnostics.includes(prompt), "prompt leaked on rejection");
    assert(
      /Native role|resume|mutually exclusive|UTF-8|capability policy/.test(diagnostics),
      "unexpected startup rejection",
    );
    return undefined;
  } catch (error) {
    child.kill("SIGTERM");
    await child.exited;
    clearTimeout(timer);
    children.delete(child);
    throw error;
  }
}

async function send(
  url: string,
  text: string,
  contextId?: string,
  metadata?: object,
  expected = "TASK_STATE_COMPLETED",
) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "A2A-Version": "1.0" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "SendMessage",
      params: {
        message: {
          messageId: crypto.randomUUID(),
          role: "ROLE_USER",
          parts: [{ text }],
          ...(contextId ? { contextId } : {}),
          ...(metadata ? { metadata } : {}),
        },
        configuration: { returnImmediately: false },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await response.json();
  const task = body.result?.task;
  assert.equal(task?.status?.state, expected, "A2A role task outcome did not match");
  return {
    contextId: String(task.contextId),
    sessionId: String(task.metadata?.["opencode.sessionId"]),
  };
}

function verifyReceipt(expected: string, text: string, start: number) {
  const calls = receipts.slice(start) as { messages?: { role: string; content: unknown }[] }[];
  // Identify task requests independently of the expected role so a fallback cannot be filtered out.
  const taskCalls = calls.filter((body) => {
    const user = body.messages?.filter((message) => message.role === "user").at(-1);
    return (
      user?.content === text ||
      JSON.stringify(user?.content) === JSON.stringify([{ type: "text", text }])
    );
  });
  assert.equal(
    taskCalls.length,
    1,
    `expected exactly one role task request; captured=${calls.length}, matching=${taskCalls.length}`,
  );
  const messages = taskCalls[0]!.messages!;
  assert(
    messages.some(
      (message) => message.role === "system" && JSON.stringify(message.content).includes(expected),
    ),
    "native system prompt not observed",
  );
  const user = messages.filter((message) => message.role === "user").at(-1);
  assert(
    user?.content === text ||
      JSON.stringify(user?.content) === JSON.stringify([{ type: "text", text }]),
    "incoming user task changed",
  );
  assert(
    !JSON.stringify(messages.filter((message) => message.role === "system")).includes(
      expected === prompt ? prepared : prompt,
    ),
    "roles crossed runtime boundary",
  );
}

try {
  // Two live gateway instances, one workspace, separate private runtimes and different native roles.
  const standalone = (await launch(["--system-prompt-file", file]))!;
  stage = "prepared startup";
  const native = (await launch(["--agent", "architect"]))!;
  try {
    // Before any ordinary task can spawn asynchronous title/maintenance model requests.
    for (const gateway of [standalone, native]) {
      const start = receipts.length;
      await send(gateway.url, "/switch_role", undefined, undefined, "TASK_STATE_FAILED");
      assert.equal(receipts.length, start, "native command override reached the model");
    }
    for (const [gateway, system] of [
      [standalone, prompt],
      [native, prepared],
    ] as const) {
      stage = system === prompt ? "standalone task" : "prepared task";
      const card = await (
        await fetch(new URL(".well-known/agent-card.json", gateway.url), {
          signal: AbortSignal.timeout(5_000),
        })
      ).json();
      assert.equal(card.name, env.A2A_NAME, "card identity changed native selection");
      assert(
        !JSON.stringify(card).includes(prompt) && !JSON.stringify(card).includes(prepared),
        "prompt leaked into card",
      );
      let start = receipts.length;
      const first = await send(gateway.url, "task-one");
      verifyReceipt(system, "task-one", start);
      start = receipts.length;
      const continuation = await send(gateway.url, "task-two", first.contextId);
      verifyReceipt(system, "task-two", start);
      assert.equal(continuation.sessionId, first.sessionId, "continuation changed ACP session");
      start = receipts.length;
      const fresh = await send(gateway.url, "task-three", undefined, {
        "opencode.agent": "build",
        "opencode.systemPrompt": "request metadata is not a system prompt",
      });
      verifyReceipt(system, "task-three", start);
      assert.notEqual(fresh.sessionId, first.sessionId, "new context reused ACP session");
    }
    console.log(
      JSON.stringify({
        roles: true,
        sameWorkspace: true,
        actualSystemVerified: true,
        unchangedUser: true,
        sessionsAndContinuations: true,
      }),
    );
  } finally {
    await native.stop();
    await standalone.stop();
  }
  stage = "default-agent behavior";
  const defaultGateway = (await launch([]))!;
  try {
    const start = receipts.length;
    await send(defaultGateway.url, "default-task");
    verifyReceipt(prepared, "default-task", start);
  } finally {
    await defaultGateway.stop();
  }
  const count = receipts.length;
  stage = "negative startup checks";
  for (const agents of [
    {},
    { architect: { disabled: true } },
    { architect: { hidden: true } },
    { architect: { mode: "subagent" } },
  ]) {
    configure({ agents });
    await launch(["--agent", "architect"], true);
  }
  for (const definition of [{ system: "override" }, { system: prompt }, { disabled: true }]) {
    configure({ agents: { [STANDALONE_AGENT]: definition } });
    await launch(["--system-prompt-file", file], true);
  }
  configure();
  mkdirSync(join(workspace, ".opencode", "agents"), { recursive: true });
  const markdown = join(workspace, ".opencode", "agents", `${STANDALONE_AGENT}.md`);
  writeFileSync(markdown, `---\nmode: primary\n---\n${prompt}`);
  await launch(["--system-prompt-file", file], true);
  rmSync(markdown);
  configure({
    agents: { architect: { permissions: [{ action: "execute", resource: "*", effect: "allow" }] } },
  });
  await launch(["--agent", "architect"], true);
  configure();
  await launch(["--agent", "architect", "--enable", "resume"], true);
  await launch(["--agent", "architect", "--system-prompt-file", file], true);
  writeFileSync(file, Buffer.from([0xc3, 0x28]));
  await launch(["--system-prompt-file", file], true);
  for (const text of ["", " ".repeat(10), "x".repeat(65_537)]) {
    writeFileSync(file, text);
    await launch(["--system-prompt-file", file], true);
  }
  await launch(["--system-prompt-file", join(root, "missing")], true);
  assert.equal(receipts.length, count, "rejected launches made fallback model calls");
  const version = Bun.spawnSync(["opencode", "--version"], {
    env,
    stdout: "pipe",
    stderr: "ignore",
  });
  assert.equal(version.exitCode, 0);
  console.log(
    JSON.stringify({
      roleRejections: true,
      fallbackModelCalls: 0,
      bun: Bun.version,
      opencode: version.stdout.toString().trim(),
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      roleSmoke: false,
      stage,
      check:
        error instanceof Error && "code" in error && error.code === "ERR_ASSERTION"
          ? error.message.split("\n")[0]
          : "startup or transport",
      diagnostic: "assertion or startup failed; raw prompts and provider payloads withheld",
    }),
  );
  process.exitCode = 1;
} finally {
  for (const [child, timer] of children) {
    clearTimeout(timer);
    child.kill("SIGTERM");
    await child.exited;
  }
  model.stop();
  rmSync(root, { recursive: true, force: true });
}
