import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isAbsolute } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import manifest from "../package.json" with { type: "json" };
import { activityOf, type Activity } from "./activity.js";
import { BridgeError } from "./bridge-error.js";
import { askOperator, decide, type PermissionRequest } from "./permission.js";
import { createReplayCollector, type Replay } from "./replay.js";
import { supportedOpenCode } from "./opencode-version.js";
import { StartupError } from "./startup-error.js";
import { selectNativeRole, verifyMode } from "./acp-role.js";
import { validateRoleOptions } from "./native-role.js";

export interface AcpBridgeOptions {
  /** Startup-only native primary agent; selected and verified for each fresh session. */
  agent?: string;
  cwd: string;
  executable?: string;
  args?: readonly string[];
  versionArgs?: readonly string[];
  env?: NodeJS.ProcessEnv;
  versionEnv?: NodeJS.ProcessEnv;
  startupTimeoutMs?: number;
  /** Whole prompt deadline; null explicitly disables it. */
  promptTimeoutMs?: number | null;
  cancelTimeoutMs?: number;
  closeTimeoutMs?: number;
}

const INVALID_PARAMS = -32602;

interface Hold {
  count: number;
  rearm?: () => void;
  disarm?: () => void;
}

export function createAcpBridge(options: AcpBridgeOptions) {
  if (!isAbsolute(options.cwd)) throw new Error("ACP workspace must be absolute");
  const agent = options.agent;
  validateRoleOptions(agent);
  const cwd = options.cwd;
  const executable = options.executable ?? "opencode";
  const args = [...(options.args ?? ["acp"])];
  const env = { ...(options.env ?? process.env) };
  const versionEnv = { ...(options.versionEnv ?? env) };
  const startup = options.startupTimeoutMs ?? 30_000;
  const promptTimeout = options.promptTimeoutMs === undefined ? 3_600_000 : options.promptTimeoutMs;
  const cancelTimeout = options.cancelTimeoutMs ?? 5_000;
  const closeTimeout = options.closeTimeoutMs ?? 5_000;
  if (
    [startup, cancelTimeout, closeTimeout, ...(promptTimeout === null ? [] : [promptTimeout])].some(
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
  let replaying: { sessionId: string; collect: (update: acp.SessionUpdate) => void } | undefined;
  let turn:
    | {
        sessionId: string;
        onText: (text: string) => void;
        onActivity: ((activity: Activity) => void) | undefined;
        onPermission: ((request: PermissionRequest) => Promise<string | undefined>) | undefined;
        hold: Hold;
        released: ReturnType<typeof Promise.withResolvers<undefined>>;
        denied: boolean;
        cancelled: boolean;
        settled: boolean;
        cancellation: Promise<void> | undefined;
        completion: Promise<acp.PromptResponse> | undefined;
      }
    | undefined;

  function fail(message: string | StartupError) {
    if (failure.signal.aborted) return;
    failure.abort(message instanceof StartupError ? message : new BridgeError(message));
    ready = false;
    connection?.close();
    // Retain the cleanup result for close(); request errors never contain peer diagnostics.
    void close().catch(() => undefined);
  }

  // While a human decision is pending (hold.count > 0) the deadline is suspended and restarts on release.
  function bounded<T>(
    operation: () => Promise<T>,
    ms: number | null,
    label: string,
    hold?: Hold,
    onTimeout?: () => void,
  ): Promise<T> {
    if (failure.signal.aborted) return Promise.reject(failure.signal.reason);
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let disarmed = false;
      const expire = () => {
        if (hold?.count) arm();
        else if (onTimeout) onTimeout();
        else fail(`ACP ${label} timed out`);
      };
      const arm = () => {
        clearTimeout(timer);
        if (!disarmed && ms !== null) timer = setTimeout(expire, ms);
      };
      const disarm = () => {
        disarmed = true;
        clearTimeout(timer);
      };
      arm();
      if (hold) {
        hold.rearm = arm;
        hold.disarm = disarm;
      }
      const cleanup = () => {
        disarm();
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
      throw new BridgeError("ACP bridge unavailable");
    if (sessionId !== undefined && !sessions.has(sessionId)) throw new Error("Unknown ACP session");
    return connection;
  }

  function start(): Promise<void> {
    if (failure.signal.aborted || stopping)
      return Promise.reject(new BridgeError("ACP bridge unavailable"));
    if (starting) return starting;
    starting = bounded(
      async () => {
        // Probe the executable itself, not configuration or the ACP protocol version.
        child = spawn(executable, [...(options.versionArgs ?? ["--version"])], {
          cwd,
          env: versionEnv,
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
        if (!supportedOpenCode(version)) throw new StartupError("version");
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
          const current = turn;
          const unusable = () =>
            stopping ||
            failure.signal.aborted ||
            !current ||
            current.settled ||
            current.cancelled ||
            request.params.sessionId !== current.sessionId;
          if (unusable() || !current) return { outcome: { outcome: "cancelled" } };
          const options = request.params.options;
          const chosen = await askOperator(current, request.params);
          if (current.onPermission && unusable()) return { outcome: { outcome: "cancelled" } };
          const decision = decide(options, chosen);
          if (decision.denied) current.denied = true;
          return {
            outcome:
              decision.outcome === "selected"
                ? { outcome: "selected", optionId: decision.optionId }
                : { outcome: "cancelled" },
          };
        });
        client.onNotification(acp.methods.client.session.update, (notification) => {
          const update = notification.params.update;
          if (
            agent !== undefined &&
            sessions.has(notification.params.sessionId) &&
            update.sessionUpdate === "config_option_update" &&
            notification.params._meta?.["opencode/child-session"] === undefined &&
            update._meta?.["opencode/child-session"] === undefined
          ) {
            try {
              verifyMode(update.configOptions, agent, true);
            } catch {
              fail(new StartupError("role"));
            }
          }
          if (replaying && notification.params.sessionId === replaying.sessionId) {
            replaying.collect(update);
            return;
          }
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
          const activity = activityOf(update);
          if (activity) {
            try {
              turn.onActivity?.(activity);
            } catch {
              fail("ACP activity callback failed");
            }
            return;
          }
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
        // Prove the actual ACP process accepts the role before advertising HTTP readiness.
        if (agent !== undefined) await newSession();
      },
      startup,
      "startup",
    );
    return starting;
  }

  async function newSession(): Promise<acp.NewSessionResponse> {
    const current = requireConnection();
    const response = await bounded(
      async () => {
        const created = await current.agent.request(acp.methods.agent.session.new, {
          cwd,
          mcpServers: [],
        });
        return agent === undefined ? created : selectNativeRole(current, created, agent);
      },
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

  // An id OpenCode refuses (unknown or another workspace) rejects only this request; it must
  // not retire the shared bridge, so only that exact JSON-RPC error is converted.
  async function attach(method: "resume" | "load", sessionId: string): Promise<void> {
    if (agent !== undefined) throw new StartupError("roleResume");
    const current = requireConnection();
    const accepted = await bounded(
      () =>
        current.agent
          .request(acp.methods.agent.session[method], { sessionId, cwd, mcpServers: [] })
          .then(
            () => true,
            (error: unknown) => {
              if (error instanceof acp.RequestError && error.code === INVALID_PARAMS) return false;
              throw error;
            },
          ),
      startup,
      `session ${method}`,
    );
    if (!accepted) throw new BridgeError(`ACP session ${method} rejected`);
    sessions.add(sessionId);
  }

  async function resumeSession(sessionId: string): Promise<string> {
    await attach("resume", sessionId);
    return sessionId;
  }

  // Like resume, but OpenCode also replays the earlier conversation, which is collected here.
  async function loadSession(sessionId: string): Promise<Replay> {
    const collector = createReplayCollector();
    replaying = { sessionId, collect: collector.collect };
    try {
      await attach("load", sessionId);
    } finally {
      replaying = undefined;
    }
    return collector.result();
  }

  async function prompt(
    sessionId: string,
    text: string,
    onText: (text: string) => void,
    onActivity?: (activity: Activity) => void,
    onPermission?: (request: PermissionRequest) => Promise<string | undefined>,
  ): Promise<acp.PromptResponse & { permissionDenied?: boolean }> {
    const current = requireConnection(sessionId);
    // Native slash commands can rewrite task text and switch agents before the model call.
    if (agent !== undefined && text.trimStart().startsWith("/"))
      throw new BridgeError(
        "Native slash commands are unavailable with an explicit startup role; send a plain-text task.",
      );
    if (turn) throw new Error("ACP prompt in progress");
    const active = {
      sessionId,
      onText,
      onActivity,
      onPermission,
      hold: { count: 0 },
      released: Promise.withResolvers<undefined>(),
      denied: false,
      cancelled: false,
      settled: false,
      cancellation: undefined as Promise<void> | undefined,
      completion: undefined as Promise<acp.PromptResponse> | undefined,
    };
    turn = active;
    let deadlineExpired = false;
    active.completion = bounded(
      () =>
        current.agent.request(acp.methods.agent.session.prompt, {
          sessionId,
          prompt: [{ type: "text", text }],
        }),
      promptTimeout,
      "prompt",
      active.hold,
      () => {
        deadlineExpired = true;
        // Request a cooperative stop first. cancel() has its own finite deadline,
        // even for an unlimited prompt. Never turn a deadline into a user cancel.
        void cancel(sessionId).catch(() => fail("ACP prompt timed out"));
      },
    );
    try {
      const response = await active.completion;
      active.settled = true;
      // A late cancel write must settle before another prompt can acquire this session.
      await active.cancellation;
      if (deadlineExpired) throw new BridgeError("ACP prompt timed out");
      return active.denied ? { ...response, permissionDenied: true } : response;
    } catch (error) {
      if (deadlineExpired) throw new BridgeError("ACP prompt timed out");
      throw error;
    } finally {
      active.settled = true;
      await active.cancellation?.catch(() => undefined);
      if (deadlineExpired) fail("ACP prompt timed out");
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
    // Once cancellation starts, only its own deadline governs the stop.
    active.hold.disarm?.();
    active.released.resolve(undefined);
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
      // On macOS an unreaped process group can briefly return EPERM after SIGKILL.
      // Treat an existence probe as inconclusive, never as proof of cleanup.
      if (signal === 0 && error instanceof Error && "code" in error && error.code === "EPERM")
        return true;
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

  return { start, newSession, resumeSession, loadSession, prompt, cancel, close };
}
