import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import manifest from "../package.json" with { type: "json" };
import { A2A_PROTOCOL_VERSION, AGENT_CARD_PATH, type AgentCard } from "@a2a-js/sdk";
import type { AgentExecutor } from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler, UserBuilder } from "@a2a-js/sdk/server/express";
import { createAcpBridge, type AcpBridgeOptions } from "./acp-client.js";
import {
  ACTIVITY_EXTENSION,
  createAgentExecutor,
  EXPLICIT_CONTEXT,
  PERMISSIONS_EXTENSION,
  RESUME_EXTENSION,
  type ExecutorOptions,
} from "./executor.js";
import { createRequestHandler } from "./request-handler.js";
import { parseOptions } from "./cli-options.js";
import { reportStartupError, StartupError } from "./startup-error.js";
import { validateIdentity, type WorkerIdentity } from "./identity.js";
import { formatStatus, supportsTerminalColor } from "./terminal-output.js";
import { acquireLaunchLock } from "./launch-lock.js";
import { createRuntimeEnvironment } from "./runtime-environment.js";
import { ProbeCleanupError, resolveOpenCode, verifyRuntime } from "./runtime-probes.js";
import { removeUnusedRuntime } from "./runtime-processes.js";
import { exceptionNames, loadPolicyFile } from "./policy-file.js";
import { acquireState } from "./state-dir.js";
import {
  FULL_ACCESS_WARNING,
  policySummary,
  validatePolicyFlags,
  type PolicyProfile,
} from "./runtime-policy.js";

type AcpBridge = ReturnType<typeof createAcpBridge>;
export interface ServerOptions {
  workspace: string;
  passEnv?: readonly string[];
  policy?: PolicyProfile;
  dangerouslySkipPermissions?: boolean;
  policyFile?: string;
  stateDir?: string;
  host?: string;
  port?: number;
  identity?: WorkerIdentity;
  acp?: Omit<AcpBridgeOptions, "cwd">;
  executor?: ExecutorOptions;
  createExecutor?: (bridge: AcpBridge) => AgentExecutor;
}

export function createGateway(options: ServerOptions) {
  const identity = validateIdentity(options.identity);
  if (!isAbsolute(options.workspace)) throw new StartupError("workspace");
  const host = options.host ?? "127.0.0.1";
  if (!["127.0.0.1", "::1"].includes(host)) throw new Error("Only loopback hosts are supported");
  const port = options.port ?? 41241;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new StartupError("port");
  const bridge = createAcpBridge({ ...options.acp, cwd: options.workspace });
  const app = express();
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    if (closing) return response.status(503).end();
    next();
  });
  const server = createServer(app);
  let starting: Promise<{ url: string; card: AgentCard }> | undefined;
  let closing: Promise<void> | undefined;

  function close(): Promise<void> {
    if (closing) return closing;
    closing = Promise.resolve().then(async () => {
      const http = new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let ended = false;
        const finish = (error?: Error) => {
          ended = true;
          clearTimeout(timer);
          server.removeListener("close", finish);
          if (error) return reject(new Error("HTTP shutdown failed"));
          resolve();
        };
        const grace = () => {
          if (ended) return;
          timer = setTimeout(() => {
            try {
              server.closeAllConnections();
              if (process.versions.bun) server.close(finish);
            } catch {
              finish(new Error("HTTP force-close failed"));
            }
          }, 1_000);
        };
        void bridge.close().then(grace, grace);
        // Bun close() loses the handle needed to force-close incomplete HTTP headers.
        // Keep the listener through the drain, then explicitly close it.
        // closeAllConnections() only drains clients; closing middleware rejects new work.
        if (process.versions.bun) return;
        server.close(finish);
      });
      const results = await Promise.allSettled([http, bridge.close()]);
      if (results.some((result) => result.status === "rejected"))
        throw new Error("Gateway owned shutdown failed");
    });
    return closing;
  }

  function start() {
    if (closing) return Promise.reject(new Error("Gateway closed"));
    if (starting) return starting;
    starting = Promise.resolve().then(async () => {
      try {
        const workspace = await stat(options.workspace).catch(() => undefined);
        if (!workspace?.isDirectory()) throw new StartupError("directory");
        await bridge.start();
        if (closing) throw new Error("Gateway closed");
        const executor =
          options.createExecutor?.(bridge) ?? createAgentExecutor(bridge, options.executor);
        const card: AgentCard = {
          name: identity.name ?? "OpenCode A2A Lite",
          description:
            identity.description ??
            "OpenCode ACP gateway for contextual plain text prompts and streamed responses.",
          supportedInterfaces: [],
          provider: undefined,
          version: manifest.version,
          capabilities: {
            streaming: true,
            pushNotifications: false,
            extendedAgentCard: false,
            extensions: [
              ...(options.executor?.activity
                ? [
                    {
                      uri: ACTIVITY_EXTENSION,
                      description:
                        "Adds an optional 'activity' artifact of tool call ids, titles, kinds, statuses and reasoning text.",
                      required: false,
                      params: undefined,
                    },
                  ]
                : []),
              ...(options.executor?.resume
                ? [
                    {
                      uri: RESUME_EXTENSION,
                      description:
                        "A first message with metadata opencode.sessionId continues that existing OpenCode session of this workspace.",
                      required: false,
                      params: undefined,
                    },
                  ]
                : []),
              ...(options.executor?.permissions === "ask"
                ? [
                    {
                      uri: PERMISSIONS_EXTENSION,
                      description:
                        "A permission request pauses the task as input-required; answer on the same task with 'allow' or 'reject', or a data part {permissionResponse:{requestId,optionId}}.",
                      required: false,
                      params: undefined,
                    },
                  ]
                : []),
            ],
          },
          securitySchemes: {},
          securityRequirements: [],
          defaultInputModes: ["text/plain"],
          defaultOutputModes: ["text/plain"],
          skills: [
            {
              id: "text-prompt",
              name: "Text prompt",
              description: "Run a plain text prompt or context follow-up in the trusted workspace.",
              tags: [...new Set(["text", ...(identity.tags ?? [])])],
              examples: ["Reply with a short greeting."],
              inputModes: ["text/plain"],
              outputModes: ["text/plain"],
              securityRequirements: [],
            },
          ],
          signatures: [],
        };
        const handler = createRequestHandler(
          card,
          executor,
          (options.acp?.cancelTimeoutMs ?? 5_000) + 1_000,
        );
        // Preserve caller intent before the SDK fills in missing context IDs.
        // SDK 1.3 has no public RequestContextBuilder; routing remains SDK-owned.
        const send = handler.sendMessage.bind(handler);
        handler.sendMessage = (request, context) => {
          context.state.set(EXPLICIT_CONTEXT, Boolean(request.message?.contextId));
          return send(request, context);
        };
        const stream = handler.sendMessageStream.bind(handler);
        handler.sendMessageStream = (request, context) => {
          context.state.set(EXPLICIT_CONTEXT, Boolean(request.message?.contextId));
          return stream(request, context);
        };
        app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: handler }));
        app.use(
          "/",
          jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }),
        );
        await new Promise<void>((resolve, reject) => {
          const onError = (error: NodeJS.ErrnoException) =>
            reject(error.code === "EADDRINUSE" ? new StartupError("occupied") : error);
          server.once("error", onError);
          server.listen(port, host, () => {
            server.removeListener("error", onError);
            resolve();
          });
        });
        if (closing) throw new Error("Gateway closed");
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("HTTP listener unavailable");
        const url = `http://${host === "::1" ? "[::1]" : host}:${address.port}/`;
        card.supportedInterfaces.push({
          url,
          protocolBinding: "JSONRPC",
          tenant: "",
          protocolVersion: A2A_PROTOCOL_VERSION,
        });
        return { url, card };
      } catch (error) {
        await close();
        throw error;
      }
    });
    return starting;
  }
  return { start, close };
}

export async function launchGateway(options: ServerOptions) {
  if (options.acp?.env && options.passEnv?.length) throw new StartupError("passEnvConflict");
  if (options.acp?.env && options.policy) throw new StartupError("policyConflict");
  const policy = options.policy ?? "read-only";
  const approvals = options.executor?.permissions ?? "reject";
  validatePolicyFlags(policy, options.dangerouslySkipPermissions === true, approvals);
  const workspace = await stat(options.workspace).catch(() => undefined);
  if (!workspace?.isDirectory()) throw new StartupError("directory");
  validateIdentity(options.identity);
  if (options.acp?.env && (options.policyFile || options.stateDir))
    throw new StartupError("privateOptions");
  const file = options.policyFile
    ? loadPolicyFile(options.policyFile, options.workspace, policy)
    : undefined;
  if (!options.acp?.env && process.platform !== "linux") throw new StartupError("runtimePlatform");
  const state = options.stateDir ? acquireState(options.stateDir, options.workspace) : undefined;
  const runtime = (() => {
    if (options.acp?.env) return undefined;
    try {
      return createRuntimeEnvironment(options.passEnv ?? [], process.env, policy, {
        ...(file ? { exceptions: file.exceptions } : {}),
        ...(state ? { data: state.data } : {}),
      });
    } catch (error) {
      state?.release();
      throw error;
    }
  })();
  if (runtime && state) state.record(runtime.root, runtime.env.A2A_LITE_RUNTIME_ID!);
  const probeEnv = runtime ? { ...runtime.env } : undefined;
  if (probeEnv) for (const name of options.passEnv ?? []) delete probeEnv[name];
  let gateway: ReturnType<typeof createGateway>;
  let executable: string | undefined;
  try {
    executable = runtime
      ? resolveOpenCode(runtime.env.PATH!, options.acp?.executable, options.workspace)
      : undefined;
    gateway = createGateway({
      ...options,
      ...(runtime && executable && probeEnv
        ? { acp: { ...options.acp, env: runtime.env, versionEnv: probeEnv, executable } }
        : {}),
    });
  } catch (error) {
    runtime?.remove();
    state?.release();
    throw error;
  }
  const abort = new AbortController();
  let preparation: Promise<void> = Promise.resolve();
  let cleanup: Promise<void> | undefined;
  let release = () => {};
  const close = () => {
    if (cleanup) return cleanup;
    abort.abort();
    cleanup = (async () => {
      const result = await preparation.then(
        () => undefined,
        (error: unknown) => error,
      );
      try {
        release();
        await gateway.close();
        if (result instanceof ProbeCleanupError) throw result;
        if (runtime) await removeUnusedRuntime(runtime);
        state?.release();
      } catch (error) {
        if (!runtime) throw error;
        console.error(`Private runtime cleanup unconfirmed; retained ${runtime.root}`);
        throw new ProbeCleanupError("Private runtime cleanup unconfirmed");
      }
    })();
    return cleanup;
  };
  const status = (label: string, detail: string) =>
    console.error(formatStatus(label, detail, supportsTerminalColor(process.stderr, process.env)));
  let signalled = false;
  const stop = () => {
    signalled = true;
    status("stopping", "gateway · draining active work and closing the listener");
    void close()
      .then(() => status("stopped", "gateway · listener closed and OpenCode process released"))
      .catch(() => {
        status("error", "gateway shutdown failed · inspect the process before restarting");
        process.exitCode = 1;
      });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("SIGHUP", stop);
  try {
    if (runtime && executable) {
      release = await acquireLaunchLock({ signal: abort.signal });
      preparation = verifyRuntime({
        executable,
        cwd: options.workspace,
        env: probeEnv!,
        root: runtime.root,
        policy,
        ...(file ? { exceptions: file.exceptions } : {}),
        ...(state ? { data: state.data } : {}),
        signal: abort.signal,
      });
      await preparation;
    }
    if (abort.signal.aborted) throw new Error("Gateway closed");
    if (runtime) {
      if (policy === "full-access") status("WARNING", FULL_ACCESS_WARNING);
      for (const line of policySummary(policy, approvals)) status("policy", line);
      status(
        "env",
        options.passEnv?.length
          ? `passing ${options.passEnv.join(", ")} to OpenCode (names only)`
          : "no provider variables passed to OpenCode",
      );
      if (file)
        status(
          "policy",
          `operator exceptions: ${exceptionNames(file.exceptions).join(", ") || "none"} · allowlisting is not code sandboxing`,
        );
      if (state)
        status(
          "state",
          "persistent private state · approvals, accounts and automations cleared each launch · session history kept",
        );
    }
    const ready = await gateway.start();
    release();
    console.log(JSON.stringify({ ready: true, url: ready.url }));
    const cardUrl = new URL(".well-known/agent-card.json", ready.url).href;
    status("ready", `gateway · ${ready.url}`);
    status("workspace", options.workspace);
    if (runtime)
      status(
        "trust",
        "workspace instructions are trusted; the policy limits tools but this is not a sandbox",
      );
    if (options.executor?.resume)
      status("resume", "enabled · clients can continue existing sessions of this workspace");
    if (options.executor?.permissions === "ask")
      status("permissions", "ask · any client that can reach this port can approve tool runs");
    if (options.executor?.activity)
      status(
        "activity",
        "tool calls and reasoning text are published; they may reveal paths, commands or workspace data",
      );
    status("agent card", cardUrl);
    status("connect", `a2a send -a ${ready.url} "Reply with a short greeting." --stream`);
    status("stop", "press Ctrl-C to stop the gateway");
  } catch (error) {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGHUP", stop);
    try {
      await close();
    } catch (cleanupError) {
      if (signalled) throw cleanupError;
      if (!runtime) console.error("Gateway owned shutdown failed during startup cleanup");
    }
    if (signalled) return;
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void Promise.resolve()
    .then(() => parseOptions([], process.env))
    .then((options) => {
      if (options.action === "run") return launchGateway(options.server);
    })
    .catch(reportStartupError);
}
