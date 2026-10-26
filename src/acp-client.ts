import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isAbsolute } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import manifest from "../package.json" with { type: "json" };
import { StartupError } from "./startup-error.js";

export interface AcpBridgeOptions {
  cwd: string;
  executable?: string;
  args?: readonly string[];
  versionArgs?: readonly string[];
  env?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  promptTimeoutMs?: number;
  cancelTimeoutMs?: number;
  closeTimeoutMs?: number;
}

export function createAcpBridge(options: AcpBridgeOptions) {
  if (!isAbsolute(options.cwd)) throw new Error("ACP workspace must be absolute");
  const cwd = options.cwd;
  const executable = options.executable ?? "opencode";
  const args = [...(options.args ?? ["acp"])];
  const env = { ...(options.env ?? process.env) };
  const startup = options.startupTimeoutMs ?? 30_000;
  const promptTimeout = options.promptTimeoutMs ?? 120_000;
  const cancelTimeout = options.cancelTimeoutMs ?? 5_000;
  const closeTimeout = options.closeTimeoutMs ?? 5_000;
  if (
    [startup, promptTimeout, cancelTimeout, closeTimeout].some(
      (ms) => !Number.isSafeInteger(ms) || ms < 30 || ms > 2_147_483_647,
    )
  )
    throw new Error("ACP timeouts must be integers between 30 and 2147483647ms");
  if (process.platform === "win32") throw new Error("ACP process ownership requires POSIX");
  const failure = new AbortController();
  const sessions = new Set<string>();
  let child: ChildProcessWithoutNullStreams | undefined;
  let connection: acp.ClientConnection | undefined;
  let starting: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let ready = false;
  let stopping = false;
  let turn:
    | {
        sessionId: string;
        onText: (text: string) => void;
        cancelled: boolean;
        settled: boolean;
        cancellation: Promise<void> | undefined;
        completion: Promise<acp.PromptResponse> | undefined;
      }
    | undefined;

  function fail(message: string | StartupError) {
    if (failure.signal.aborted) return;
    failure.abort(message instanceof StartupError ? message : new Error(message));
    ready = false;
    connection?.close();
    // Retain the cleanup result for close(); request errors never contain peer diagnostics.
    void close().catch(() => undefined);
  }

  function bounded<T>(operation: () => Promise<T>, ms: number, label: string): Promise<T> {
    if (failure.signal.aborted) return Promise.reject(failure.signal.reason);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => fail(`ACP ${label} timed out`), ms);
      const cleanup = () => {
        clearTimeout(timer);
        failure.signal.removeEventListener("abort", abort);
      };
      const abort = () => {
        cleanup();
        reject(failure.signal.reason);
      };
      failure.signal.addEventListener("abort", abort, { once: true });
      Promise.resolve()
        .then(() => {
          if (failure.signal.aborted) throw failure.signal.reason;
          return operation();
        })
        .then(
          (result) => {
            cleanup();
            resolve(result);
          },
          (error: unknown) => {
            cleanup();
            fail(error instanceof StartupError ? error : `ACP ${label} failed`);
            reject(failure.signal.reason);
          },
        );
    });
  }

  function requireConnection(sessionId?: string) {
    if (!ready || !connection || failure.signal.aborted || stopping)
      throw new Error("ACP bridge unavailable");
    if (sessionId !== undefined && !sessions.has(sessionId)) throw new Error("Unknown ACP session");
    return connection;
  }

  function start(): Promise<void> {
    if (failure.signal.aborted || stopping)
      return Promise.reject(new Error("ACP bridge unavailable"));
    if (starting) return starting;
    starting = bounded(
      async () => {
        // Probe the executable itself, not configuration or the ACP protocol version.
        child = spawn(executable, [...(options.versionArgs ?? ["--version"])], {
          cwd,
          env,
          detached: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const probe = child;
        probe.stderr.resume();
        probe.stdin.end();
        const version = await new Promise<string>((resolve, reject) => {
          let output = "";
          probe.stdout.on("data", (data: Buffer) => {
            if (output.length + data.length > 256) {
              fail("ACP executable version invalid");
              return;
            }
            output += data.toString();
          });
          probe.once("error", () => reject(new StartupError("executable")));
          probe.once("close", (code) =>
            code === 0 ? resolve(output.trim()) : reject(new StartupError("executable")),
          );
        });
        if (version !== "opencode v2.0.28") throw new StartupError("version");
        if (failure.signal.aborted || stopping) throw new Error("ACP bridge closed");
        if (signalGroup(0)) throw new Error("ACP executable left owned descendants");
        child = spawn(executable, args, {
          cwd,
          env,
          detached: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
        child.once("error", () => fail("ACP process failed"));
        child.once("exit", () => fail("ACP process exited"));
        child.stderr.resume();
        const client = acp.client({ name: "opencode-a2a-lite" });
        client.onRequest(acp.methods.client.session.requestPermission, async (request) => {
          if (
            stopping ||
            failure.signal.aborted ||
            !turn ||
            turn.settled ||
            turn.cancelled ||
            request.params.sessionId !== turn.sessionId
          )
            return { outcome: { outcome: "cancelled" } };
          const reject = request.params.options.find(
            (option) => option.kind === "reject_once" || option.kind === "reject_always",
          );
          return {
            outcome: reject
              ? { outcome: "selected", optionId: reject.optionId }
              : { outcome: "cancelled" },
          };
        });
        client.onNotification(acp.methods.client.session.update, (notification) => {
          const update = notification.params.update;
          if (
            !turn ||
            turn.settled ||
            failure.signal.aborted ||
            notification.params.sessionId !== turn.sessionId
          )
            return;
          if (
            notification.params._meta?.["opencode/child-session"] !== undefined ||
            update._meta?.["opencode/child-session"] !== undefined
          )
            return;
          if (update.sessionUpdate !== "agent_message_chunk" || update.content.type !== "text")
            return;
          if (update.content._meta?.["opencode/child-session"] !== undefined) return;
          try {
            turn.onText(update.content.text);
          } catch {
            fail("ACP text callback failed");
          }
        });
        connection = client.connect(
          acp.ndJsonStream(
            Writable.toWeb(child.stdin),
            Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
          ),
        );
        connection.signal.addEventListener("abort", () => fail("ACP connection closed"), {
          once: true,
        });
        void connection.closed.then(() => fail("ACP connection closed"));
        const response = await connection.agent.request(acp.methods.agent.initialize, {
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "opencode-a2a-lite", version: manifest.version },
        });
        if (response.protocolVersion !== 1) throw new Error("Unsupported ACP version");
        ready = true;
      },
      startup,
      "startup",
    );
    return starting;
  }

  async function newSession(): Promise<acp.NewSessionResponse> {
    const current = requireConnection();
    const response = await bounded(
      () => current.agent.request(acp.methods.agent.session.new, { cwd, mcpServers: [] }),
      startup,
      "session creation",
    );
    if (
      typeof response.sessionId !== "string" ||
      !response.sessionId ||
      sessions.has(response.sessionId)
    ) {
      fail("ACP invalid session");
      throw failure.signal.reason;
    }
    sessions.add(response.sessionId);
    return response;
  }

  async function prompt(
    sessionId: string,
    text: string,
    onText: (text: string) => void,
  ): Promise<acp.PromptResponse> {
    const current = requireConnection(sessionId);
    if (turn) throw new Error("ACP prompt in progress");
    const active = {
      sessionId,
      onText,
      cancelled: false,
      settled: false,
      cancellation: undefined as Promise<void> | undefined,
      completion: undefined as Promise<acp.PromptResponse> | undefined,
    };
    turn = active;
    active.completion = bounded(
      () =>
        current.agent.request(acp.methods.agent.session.prompt, {
          sessionId,
          prompt: [{ type: "text", text }],
        }),
      promptTimeout,
      "prompt",
    );
    try {
      return await active.completion;
    } finally {
      active.settled = true;
      // A late cancel write must settle before another prompt can acquire this session.
      await active.cancellation;
      if (turn === active) turn = undefined;
    }
  }

  async function cancel(sessionId: string): Promise<void> {
    if (!sessions.has(sessionId)) throw new Error("Unknown ACP session");
    if (!connection || !ready || failure.signal.aborted) throw new Error("ACP bridge unavailable");
    if (!turn || turn.settled || turn.sessionId !== sessionId) return;
    const current = connection;
    const active = turn;
    if (active.cancellation) return active.cancellation;
    active.cancelled = true;
    active.cancellation = bounded(
      async () => {
        await current.agent.notify(acp.methods.agent.session.cancel, { sessionId });
        await active.completion;
      },
      cancelTimeout,
      "cancel",
    );
    return active.cancellation;
  }

  function signalGroup(signal: NodeJS.Signals | 0): boolean {
    if (!child?.pid) return false;
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return false;
      throw new Error("ACP owned process cleanup failed");
    }
  }

  async function stopped(ms: number) {
    const deadline = Date.now() + ms;
    while (signalGroup(0)) {
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, Math.min(10, deadline - Date.now())));
    }
    return true;
  }

  function close(): Promise<void> {
    if (closing) return closing;
    stopping = true;
    closing = Promise.resolve().then(async () => {
      if (!failure.signal.aborted && turn && !turn.settled) {
        // cancel() is bounded and retires the bridge on failure; cleanup still follows.
        await cancel(turn.sessionId).catch(() => undefined);
      }
      if (!failure.signal.aborted) failure.abort(new Error("ACP bridge closed"));
      ready = false;
      // OpenCode owns a private server lease. EOF releases it; do not tear down
      // the SDK transport before giving the process its stdin-EOF grace period.
      child?.stdin.end();
      const slice = Math.floor(closeTimeout / 3);
      try {
        if (await stopped(slice)) return;
        signalGroup("SIGTERM");
        if (await stopped(slice)) return;
        signalGroup("SIGKILL");
        if (!(await stopped(slice))) throw new Error("ACP owned process did not stop");
      } finally {
        connection?.close();
      }
    });
    return closing;
  }

  return { start, newSession, prompt, cancel, close };
}
