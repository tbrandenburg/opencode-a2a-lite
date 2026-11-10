// Explicit provider-free executable acceptance; intentionally outside bun test discovery.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { createServer } from "node:net";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { createAcpBridge } from "../src/acp-client.js";
import { cleanup, prepare } from "../scripts/acp-smoke-config.js";

const workspace = await prepare({ providerFree: true });
const bridge = createAcpBridge({
  cwd: workspace.cwd,
  executable: workspace.executable,
  env: workspace.env,
});

async function bounded<T>(pending: Promise<T>): Promise<T> {
  const deadline = AbortSignal.timeout(30_000);
  return Promise.race([
    pending,
    new Promise<never>((_resolve, reject) =>
      deadline.addEventListener("abort", () => reject(new Error("ACP acceptance deadline")), {
        once: true,
      }),
    ),
  ]);
}

try {
  await bridge.start();
  const first = await bridge.newSession();
  const second = await bridge.newSession();
  assert.notEqual(first.sessionId, second.sessionId);
  assert(first.sessionId.length > 0);
  await assert.rejects(
    bridge.prompt("unknown", "never submitted", () => undefined),
    /Unknown/,
  );
  await bridge.close();
  await assert.rejects(bridge.newSession(), /unavailable/);
  console.log(
    JSON.stringify({ productionBridge: true, separateSessions: true, staleRejected: true }),
  );

  const child = spawn(workspace.executable, ["acp"], {
    cwd: workspace.cwd,
    env: workspace.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  child.stderr.resume();
  const client = acp.client({ name: "provider-free-runtime-acceptance" });
  client.onRequest(acp.methods.client.session.requestPermission, async () => ({
    outcome: { outcome: "cancelled" },
  }));
  const connection = client.connect(
    acp.ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
    ),
  );
  const request = <T>(pending: Promise<T>) => bounded(pending);
  let owned: number[] = [];
  let ports: number[] = [];
  try {
    const initialized = await request(
      connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "provider-free-runtime-acceptance", version: "1" },
      }),
    );
    assert.equal(initialized.protocolVersion, 1);
    assert.equal(initialized.agentInfo?.version, "2.2.7");
    assert.equal(initialized.agentCapabilities?.loadSession, true);
    owned = readFileSync(`/proc/${child.pid}/task/${child.pid}/children`, "utf8")
      .trim()
      .split(/\s+/)
      .map(Number);
    assert.equal(owned.length, 1, "Expected one leased server child");
    const sockets = readdirSync(`/proc/${owned[0]}/fd`).map((fd) =>
      readlinkSync(`/proc/${owned[0]}/fd/${fd}`),
    );
    ports = ["tcp", "tcp6"].flatMap((table) =>
      readFileSync(`/proc/net/${table}`, "utf8")
        .trim()
        .split("\n")
        .slice(1)
        .map((line) => line.trim().split(/\s+/))
        .filter((fields) => fields[3] === "0A" && sockets.includes(`socket:[${fields[9]}]`))
        .map((fields) => Number.parseInt(fields[1]!.split(":")[1]!, 16)),
    );
    assert.equal(ports.length, 1, "Expected one private HTTP listener");
    await assert.rejects(
      request(
        connection.agent.request(acp.methods.agent.session.new, { cwd: ".", mcpServers: [] }),
      ),
      (error: unknown) => error instanceof acp.RequestError && error.code === -32602,
    );
    const session = await request(
      connection.agent.request(acp.methods.agent.session.new, {
        cwd: workspace.cwd,
        mcpServers: [],
      }),
    );
    const resumed = await request(
      connection.agent.request(acp.methods.agent.session.resume, {
        cwd: workspace.cwd,
        mcpServers: [],
        sessionId: session.sessionId,
      }),
    );
    assert(resumed.configOptions?.some((option) => option.id === "mode"));
    const active = await request(
      connection.agent.request(acp.methods.agent.session.list, { cwd: workspace.cwd }),
    );
    assert(active.sessions.some((entry) => entry.sessionId === session.sessionId));
    await assert.rejects(
      request(
        connection.agent.request(acp.methods.agent.session.resume, {
          cwd: workspace.root,
          mcpServers: [],
          sessionId: session.sessionId,
        }),
      ),
      (error: unknown) => error instanceof acp.RequestError && error.code === -32602,
    );
    await request(
      connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: session.sessionId }),
    );
    const closed = await request(
      connection.agent.request(acp.methods.agent.session.close, { sessionId: session.sessionId }),
    );
    assert.deepEqual(closed, {});
    const listed = await request(
      connection.agent.request(acp.methods.agent.session.list, { cwd: workspace.cwd }),
    );
    assert.equal(
      listed.sessions.some((entry) => entry.sessionId === session.sessionId),
      false,
    );
    console.log(
      JSON.stringify({
        protocolV1: true,
        absoluteCwd: true,
        resumeBinding: true,
        wrongCwdRejected: true,
        idleCancel: true,
        unusedSessionRemoved: true,
      }),
    );
  } finally {
    child.stdin.end();
    try {
      assert.equal(await bounded(exit), 0);
      for (const pid of owned) {
        const deadline = performance.now() + 10_000;
        while (readdirSync("/proc").includes(String(pid)) && performance.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 50));
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      }
      for (const port of ports) {
        const reclaimed = createServer();
        await new Promise<void>((resolve, reject) => {
          reclaimed.once("error", reject);
          reclaimed.listen(port, "127.0.0.1", resolve);
        });
        await new Promise<void>((resolve, reject) =>
          reclaimed.close((error) => (error ? reject(error) : resolve())),
        );
      }
      console.log(JSON.stringify({ stdinEofExit: true }));
      console.log(JSON.stringify({ leasedServerStopped: true, listenerReclaimed: true }));
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      connection.close();
    }
  }
} finally {
  await bridge.close();
  await cleanup(workspace.root);
}
