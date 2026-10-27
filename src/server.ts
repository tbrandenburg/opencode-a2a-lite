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
import { createAgentExecutor, EXPLICIT_CONTEXT, type ExecutorOptions } from "./executor.js";
import { createRequestHandler } from "./request-handler.js";
import { parseOptions } from "./cli-options.js";
import { reportStartupError, StartupError } from "./startup-error.js";
import { validateIdentity, type WorkerIdentity } from "./identity.js";

type AcpBridge = ReturnType<typeof createAcpBridge>;
export interface ServerOptions {
  workspace: string;
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
            } catch {
              finish(new Error("HTTP force-close failed"));
            }
          }, 1_000);
        };
        void bridge.close().then(grace, grace);
        // Bun close() loses the handle needed to force-close incomplete HTTP headers.
        // Keep the listener through the drain; closing middleware rejects new work.
        if (process.versions.bun) {
          server.once("close", finish);
          return;
        }
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
            extensions: [],
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
  const gateway = createGateway(options);
  const stop = () => {
    void gateway.close().catch(() => {
      console.error("Gateway shutdown failed");
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const ready = await gateway.start();
    console.log(JSON.stringify({ ready: true, url: ready.url }));
  } catch (error) {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await gateway.close();
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
