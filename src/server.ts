import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import { A2A_PROTOCOL_VERSION, AGENT_CARD_PATH, type AgentCard } from "@a2a-js/sdk";
import type { AgentExecutor } from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler, UserBuilder } from "@a2a-js/sdk/server/express";
import { createAcpBridge, type AcpBridgeOptions } from "./acp-client.js";
import { createAgentExecutor, EXPLICIT_CONTEXT, type ExecutorOptions } from "./executor.js";
import { createRequestHandler } from "./request-handler.js";

type AcpBridge = ReturnType<typeof createAcpBridge>;
export interface ServerOptions {
  workspace: string;
  host?: string;
  port?: number;
  acp?: Omit<AcpBridgeOptions, "cwd">;
  executor?: ExecutorOptions;
  createExecutor?: (bridge: AcpBridge) => AgentExecutor;
}

export function createGateway(options: ServerOptions) {
  if (!isAbsolute(options.workspace)) throw new Error("A trusted absolute workspace is required");
  const host = options.host ?? "127.0.0.1";
  if (!["127.0.0.1", "::1"].includes(host)) throw new Error("Only loopback hosts are supported");
  const port = options.port ?? 41241;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port");
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
        const grace = () => {
          if (!ended) timer = setTimeout(() => server.closeAllConnections(), 1_000);
        };
        void bridge.close().then(grace, grace);
        server.close((error) => {
          ended = true;
          clearTimeout(timer);
          if (error) return reject(new Error("HTTP shutdown failed"));
          resolve();
        });
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
        if (!workspace?.isDirectory()) throw new Error("Workspace must be an existing directory");
        await bridge.start();
        if (closing) throw new Error("Gateway closed");
        const executor =
          options.createExecutor?.(bridge) ?? createAgentExecutor(bridge, options.executor);
        const card: AgentCard = {
          name: "OpenCode A2A Lite",
          description:
            "OpenCode ACP gateway for contextual plain text prompts and streamed responses.",
          supportedInterfaces: [],
          provider: undefined,
          version: "0.1.0",
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
              tags: ["text"],
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
          server.once("error", reject);
          server.listen(port, host, () => {
            server.removeListener("error", reject);
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

async function main() {
  const workspace = process.env.A2A_WORKSPACE ?? "";
  const gateway = createGateway({
    workspace,
    ...(process.env.A2A_PORT !== undefined ? { port: Number(process.env.A2A_PORT) } : {}),
  });
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
  } catch {
    console.error("Gateway startup failed; check trusted workspace and isolated ACP configuration");
    process.exitCode = 1;
    await gateway.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main().catch(() => {
    console.error("Gateway failed");
    process.exitCode = 1;
  });
}
