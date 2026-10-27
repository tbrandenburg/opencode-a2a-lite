import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { createGateway } from "../../src/server.js";
import { createLifecycle, interrupted, owned } from "../../examples/agent-network/lifecycle.js";
import { record, tools, type Profile } from "../../examples/agent-network/profiles.js";
import {
  directory,
  freePort,
  mcp,
  payloadText,
  until,
} from "../../examples/agent-network/transport.js";
import { createTaskClient, type Submission } from "../../examples/agent-network/task-client.js";

const lifecycle = createLifecycle();
const binary = process.env.A2ABRIDGE_BIN ?? "";
assert(isAbsolute(binary), "A2ABRIDGE_BIN must name the verified absolute 4.0.2 executable");
assert.equal(
  createHash("sha256").update(readFileSync(binary)).digest("hex"),
  "bdfa1f6894f5547dfef539140139e162402ca6ab33bb7602d9335d125d414db2",
);
const root = mkdtempSync(join(tmpdir(), "a2a-context-interop-"));
const env = {
  PATH: `${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
  HOME: join(root, "home"),
};
mkdirSync(env.HOME);
const profile: Profile = { root, cwd: root, env, executable: process.execPath };
const limits = (ms = 10_000) => ({ deadline: performance.now() + ms, signal: lifecycle.signal });
const received = (value: Submission) => {
  assert(value.outcome !== "uncertain", "Submission uncertain; no automatic retry");
  return value;
};
const lines = (file: string) =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => record(JSON.parse(line)))
    : [];
let stage = "startup";
try {
  const registry = await directory(binary, profile, lifecycle.signal);
  lifecycle.releases.push(registry.close);
  const peers: string[] = [];
  for (const index of [0, 1]) {
    const workspace = join(root, `worker-${index}`);
    mkdirSync(workspace);
    const gateway = createGateway({
      workspace,
      port: await freePort(),
      acp: {
        executable: process.execPath,
        args: [
          resolve("tests/agent-network/acp-context-peer.ts"),
          join(root, `acp-${index}.jsonl`),
        ],
        versionArgs: [resolve("tests/agent-network/acp-context-peer.ts"), "--version"],
        env,
        startupTimeoutMs: 10_000,
        promptTimeoutMs: 30_000,
        closeTimeoutMs: 2_000,
      },
    });
    lifecycle.releases.push(owned(() => gateway.close(), lifecycle.signal));
    const ready = await interrupted(gateway.start(), lifecycle.signal);
    peers.push(ready.url);
    const registered = await fetch(registry.url + "/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: ready.url }),
      signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(3_000)]),
    });
    assert.equal(registered.status, 204);
  }
  const connection = await mcp(
    profile,
    { binary, directory: registry.url, peers },
    lifecycle.signal,
  );
  lifecycle.releases.push(connection.close);
  const first = createTaskClient(connection, peers[0]!);
  const second = createTaskClient(connection, peers[1]!);
  stage = "catalog-and-continuation";
  const catalog = await connection.client.listTools(
    {},
    { timeout: 5_000, signal: lifecycle.signal },
  );
  assert.deepEqual(catalog.tools.map((tool) => tool.name).sort(), [...tools].sort());
  const schema = catalog.tools.find((tool) => tool.name === "a2a_send_streaming")!.inputSchema;
  assert(!("context_id" in (schema.properties ?? {})), "Review changed upstream streaming schema");
  const discovered = await connection.call("a2a_list_agents", {}, false, limits());
  assert(Array.isArray(discovered));
  for (const peer of peers) assert(discovered.map(record).some((entry) => entry.url === peer));
  async function complete(
    client: typeof first,
    text: string,
    context?: Parameters<typeof first.submit>[2],
  ) {
    const options = limits();
    const result = await client.wait(received(await client.submit(text, options, context)), {
      ...options,
      intervalMs: 100,
      maxPolls: 4,
    });
    assert.equal(result.outcome, "completed");
    return result;
  }
  const a = await complete(first, "one");
  const b = await complete(second, "two");
  const continued = await complete(first, "again", a.handle);
  assert.equal(continued.handle.contextId, a.handle.contextId);
  assert.notEqual(continued.handle.taskId, a.handle.taskId);
  assert.notEqual(b.handle.contextId, a.handle.contextId);
  const receipts = lines(join(root, "acp-0.jsonl")).filter((entry) => entry.event === "prompt");
  assert.equal(receipts.length, 2);
  assert.equal(receipts[0]!.sessionId, receipts[1]!.sessionId);
  assert.equal(payloadText(continued.task), `${receipts[0]!.sessionId}:2:again`);
  assert.notEqual(lines(join(root, "acp-1.jsonl"))[0]!.sessionId, receipts[0]!.sessionId);
  const before = connection.remainingCalls;
  await assert.rejects(second.submit("wrong", limits(), a.handle), /Cross-peer/);
  await assert.rejects(first.submit("unsupported", limits(), a.handle, "streaming"), /4.0.2/);
  assert.equal(connection.remainingCalls, before);

  stage = "local-deadlines-and-explicit-cancel";
  const held = received(await first.submit("hold", limits()));
  const partial = await first.wait(held, {
    ...limits(),
    intervalMs: 100,
    maxPolls: 4,
    stopWhen: (value) => !!payloadText(value.task),
  });
  assert.equal(partial.outcome, "pending");
  assert.match(payloadText(partial.task), /:1:hold$/);
  const started = performance.now();
  const expired = await first.wait(partial, { ...limits(80), intervalMs: 10_000 });
  assert.equal(expired.reason, "deadline");
  assert(performance.now() - started < 600, "Local deadline exceeded scheduling headroom");
  assert.equal(expired.outcome, "pending");
  assert.deepEqual(expired.handle, held.handle);
  const controller = new AbortController();
  const waiting = first.wait(expired, {
    deadline: performance.now() + 10_000,
    signal: controller.signal,
    intervalMs: 10_000,
  });
  await setTimeout(40, undefined, { signal: lifecycle.signal });
  controller.abort();
  assert.equal((await waiting).reason, "aborted");
  assert.equal((await first.get(expired.handle, limits())).outcome, "pending");
  assert(!lines(join(root, "acp-0.jsonl")).some((entry) => entry.event === "cancel"));
  assert.equal((await first.cancel(expired.handle, limits())).outcome, "canceled");
  const canceled = await first.get(expired.handle, limits());
  assert.equal(canceled.outcome, "canceled");
  assert.equal(payloadText(canceled.task), payloadText(partial.task));
  assert(lines(join(root, "acp-0.jsonl")).some((entry) => entry.event === "cancel"));

  stage = "failures-and-cancel-races";
  const failed = received(await second.submit("fail", limits()));
  const failedStored = await second.wait(failed, { ...limits(), intervalMs: 100, maxPolls: 4 });
  assert.equal(failedStored.outcome, "failed");
  const stale = received(await second.submit("stale", limits(), failed.handle));
  assert.equal(
    (await second.wait(stale, { ...limits(), intervalMs: 100, maxPolls: 3 })).outcome,
    "failed",
  );
  await assert.rejects(
    first.get({ ...a.handle, taskId: "unknown-negative-test" }, limits()),
    /not found|not exist/i,
  );
  await assert.rejects(
    first.cancel(a.handle, limits()),
    /cancel|terminal|completed|no active ACP prompt/i,
  );
  const racing = received(await first.submit("hold-lose", limits()));
  const ready = await first.wait(racing, {
    ...limits(),
    intervalMs: 100,
    maxPolls: 4,
    stopWhen: (value) => !!payloadText(value.task),
  });
  assert(payloadText(ready.task));
  await assert.rejects(first.cancel(racing.handle, limits()), /did not cancel/i);
  assert.equal((await first.get(racing.handle, limits())).outcome, "completed");

  stage = "submission-uncertainty";
  // Pause only the exact child of our owned proxy. The guard still forwards the MCP call.
  const proxy = connection.proxyPid;
  assert(proxy);
  const children = readFileSync(`/proc/${proxy}/task/${proxy}/children`, "utf8")
    .trim()
    .split(/\s+/)
    .map(Number);
  assert.equal(children.length, 1);
  const bridge = children[0]!;
  assert.equal(readlinkSync(`/proc/${bridge}/exe`), realpathSync(binary));
  process.kill(bridge, "SIGSTOP");
  let uncertain: Submission;
  try {
    const stalledAt = performance.now();
    const stalled = await first.wait(expired, limits(80));
    assert.equal(stalled.reason, "deadline");
    assert.deepEqual(stalled.handle, expired.handle);
    assert.equal(stalled.outcome, "pending");
    assert(performance.now() - stalledAt < 600, "Hung MCP call exceeded local deadline");
    uncertain = await second.submit("uncertain", limits(80));
    assert.equal(uncertain.outcome, "uncertain");
    assert(!("handle" in uncertain));
  } finally {
    process.kill(bridge, "SIGCONT");
  }
  const uncertainHash = createHash("sha256").update("uncertain").digest("hex");
  await until(
    async () => {
      const audit = lines(join(root, "mcp-receipts.jsonl"));
      const call = audit.find(
        (entry) => entry.event === "call" && entry.inputHash === uncertainHash,
      );
      return call &&
        audit.some(
          (entry) =>
            entry.event === "result" &&
            entry.connection === call.connection &&
            entry.id === call.id,
        )
        ? true
        : undefined;
    },
    "stalled bridge drained actual guarded request",
    5_000,
  );

  stage = "receipts-and-budget";
  const audit = lines(join(root, "mcp-receipts.jsonl"));
  const calls = audit.filter((entry) => entry.event === "call");
  assert(calls.length <= 40);
  assert.equal(calls.length, 40 - connection.remainingCalls);
  const continuation = calls.find((entry) => entry.context === a.handle.contextId);
  assert(continuation && !("task" in continuation));
  assert.equal(
    calls.filter((entry) => entry.tool === "a2a_send_message" && entry.inputHash === uncertainHash)
      .length,
    1,
  );
  for (const call of calls) {
    assert(
      audit.some(
        (entry) =>
          entry.event === "result" && entry.connection === call.connection && entry.id === call.id,
      ),
    );
  }
  console.log(
    JSON.stringify({
      providerFreeContextInterop: true,
      attemptedCalls: calls.length,
      budget: 40,
      reserved: 8,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({ stage, error: error instanceof Error ? error.message : "Interop failed" }),
  );
  process.exitCode = 1;
} finally {
  const failures = await lifecycle.drain();
  if (failures.length) {
    console.error(JSON.stringify({ cleanupFailures: failures.length }));
    process.exitCode = 1;
  }
  if (!failures.length) rmSync(root, { recursive: true, force: true });
}
