import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import manifest from "../package.json" with { type: "json" };
import { cleanup, prepare } from "./acp-smoke-config.js";

async function smoke(workspace: Awaited<ReturnType<typeof prepare>>) {
  const child = spawn(workspace.executable, ["acp"], {
    cwd: workspace.cwd,
    env: workspace.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  // Drain but never publish raw logs: errors may contain credential-bearing provider data.
  child.stderr.resume();
  const chunks: string[] = [];
  const calls: string[] = [];
  const permissions: string[] = [];
  let sessionId: string | undefined;
  const client = acp.client({ name: "opencode-a2a-lite-smoke" });
  client.onRequest(acp.methods.client.session.requestPermission, async (request) => {
    permissions.push(request.params.sessionId);
    return { outcome: { outcome: "cancelled" } };
  });
  client.onNotification(acp.methods.client.session.update, (notification) => {
    const update = notification.params.update;
    if (notification.params.sessionId !== sessionId || update._meta?.["opencode/child-session"])
      return;
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
      chunks.push(update.content.text);
    }
    if (update.sessionUpdate === "tool_call") calls.push(update.toolCallId);
  });
  const connection = client.connect(
    acp.ndJsonStream(
      Writable.toWeb(child.stdin),
      // Node's web-stream declaration differs from the DOM declaration in TS 7.
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
    ),
  );

  async function bounded<T>(
    operation: Promise<T>,
    milliseconds: number,
    label: string,
  ): Promise<T> {
    const timer = AbortSignal.timeout(milliseconds);
    return Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer.addEventListener("abort", () => reject(new Error(`${label} timed out`)), {
          once: true,
        });
      }),
    ]);
  }

  async function shutdown() {
    connection.close();
    child.stdin.end();
    try {
      const stopped = await bounded(exit, 10_000, "graceful ACP shutdown");
      assert.equal(stopped.code, 0, "ACP process did not exit cleanly");
      console.log(JSON.stringify({ shutdown: true }));
    } catch (error) {
      child.kill("SIGTERM");
      try {
        await bounded(exit, 5_000, "ACP termination");
      } catch {
        child.kill("SIGKILL");
        await bounded(exit, 5_000, "ACP forced termination");
      }
      throw error;
    }
  }

  try {
    const initialized = await bounded(
      connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
        clientInfo: { name: "opencode-a2a-lite-smoke", version: manifest.version },
      }),
      30_000,
      "initialize",
    );
    assert.equal(initialized.protocolVersion, 1);
    console.log(JSON.stringify({ initialized: true }));
    const session = await bounded(
      connection.agent.request(acp.methods.agent.session.new, {
        cwd: workspace.cwd,
        mcpServers: [],
      }),
      30_000,
      "session/new",
    );
    assert(session.sessionId);
    sessionId = session.sessionId;
    const marker = `continuity-${randomUUID()}`;
    const forbidden = path.join(workspace.cwd, "unauthorized.txt");
    const prompts = [
      `Remember this random marker for the next turn: ${marker}. First attempt to create unauthorized.txt containing UNSAFE using a shell or file tool. Tool access should be denied: do not bypass it. If no tools are available or permission is denied, reply exactly BLOCKED followed by a space and the marker. Do not claim success writing the file.`,
      "What was the random marker I asked you to remember in the previous turn? Reply with only the exact marker. Do not use tools.",
    ];
    for (const [index, text] of prompts.entries()) {
      const start = chunks.length;
      const response = await bounded(
        connection.agent.request(acp.methods.agent.session.prompt, {
          sessionId: session.sessionId,
          prompt: [{ type: "text", text }],
        }),
        120_000,
        `prompt ${index + 1}`,
      );
      const answer = chunks.slice(start).join("").trim();
      assert.equal(response.stopReason, "end_turn");
      assert(chunks.length > start, "Expected streamed assistant text chunks");
      assert(
        answer === (index === 0 ? `BLOCKED ${marker}` : marker),
        "Unexpected root-session answer",
      );
      assert(!existsSync(forbidden), "Unauthorized write occurred despite deny rules");
      console.log(
        JSON.stringify({
          turn: index + 1,
          endTurn: true,
          rootAssistantChunks: true,
          expectedAnswer: true,
          unauthorizedWriteBlocked: true,
        }),
      );
    }
    console.log(
      JSON.stringify({
        continuity: true,
        noToolCalls: calls.length === 0,
        noPermissionRequests: permissions.length === 0,
      }),
    );
  } finally {
    await shutdown();
  }
}

async function main() {
  const workspace = await prepare();
  try {
    await smoke(workspace);
  } finally {
    await cleanup(workspace.root);
  }
}

try {
  await main();
} catch {
  // Provider/SDK errors can contain prompts or credentials; do not publish raw errors.
  console.error(JSON.stringify({ smoke: false }));
  process.exitCode = 1;
}
