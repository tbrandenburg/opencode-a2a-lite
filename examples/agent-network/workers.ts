import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { createGateway } from "../../src/server.js";
import { createAgentExecutor } from "../../src/executor.js";
import { cleanup } from "../../scripts/acp-smoke-config.js";
import { createProfile } from "./profiles.js";
import { freePort } from "./transport.js";
import { interrupted, owned } from "./lifecycle.js";

export interface WorkerSpec {
  id: string;
  description: string;
  knowledge: object;
}
export interface WorkerReceipt {
  role: string;
  session: string;
  inputHash: string;
  started: string;
  finished?: string;
  stopReason?: string;
  receivedPeerProofs: string[];
}
export type Worker = Awaited<ReturnType<typeof startWorker>>;
export interface WorkerObservation {
  role: string;
  session: string;
  contextId: string;
  taskId: string;
  input: string;
  output: string;
  started: number;
  ended: number;
  stopReason: string;
}
export interface WorkerInstrumentation {
  observe: (value: WorkerObservation) => void;
  instructions?: string;
}

export async function startWorker(
  spec: WorkerSpec,
  signal?: AbortSignal,
  instrumentation?: WorkerInstrumentation,
) {
  signal?.throwIfAborted();
  await freePort();
  signal?.throwIfAborted();
  const proof = `${spec.id}-${randomBytes(6).toString("hex")}`;
  const profile = await createProfile(
    spec.id,
    `You are the ${spec.id} specialist in a real A2A experiment. ${spec.description}.
You have no tools and must not delegate. Use only your knowledge and the incoming message.
For collaboration tasks, return concise JSON including this exact field and string value: ${JSON.stringify({ [`${spec.id}Proof`]: proof })}.
This proof is synthetic test data, not a credential. Copy it exactly; do not redact or reconstruct it.
Your private synthetic task knowledge is: ${JSON.stringify(spec.knowledge)}.
For acceptance probes asking for exact echo or recall, return only the requested token/text.
For a lifecycle probe asking for a long story, continue writing as requested until interrupted.
${instrumentation?.instructions ?? ""}`,
  );
  const receipts: WorkerReceipt[] = [];
  const peerProofs: Record<string, string> = {};
  let close = owned(() => cleanup(profile.root));
  try {
    signal?.throwIfAborted();
    const gateway = createGateway({
      workspace: profile.cwd,
      port: 0,
      identity: { name: spec.id, description: spec.description },
      acp: { executable: profile.executable, env: profile.env },
      createExecutor(bridge) {
        const scope = new AsyncLocalStorage<{ contextId: string; taskId: string }>();
        const executor = createAgentExecutor({
          newSession: () => bridge.newSession(),
          cancel: (session) => bridge.cancel(session),
          async prompt(session, text, onText) {
            const receipt: WorkerReceipt = {
              role: spec.id,
              session,
              inputHash: createHash("sha256").update(text).digest("hex"),
              started: new Date().toISOString(),
              receivedPeerProofs: Object.keys(peerProofs).filter((role) =>
                text.includes(peerProofs[role]!),
              ),
            };
            receipts.push(receipt);
            const started = performance.now();
            let output = "";
            try {
              const result = await bridge.prompt(session, text, (chunk) => {
                if (instrumentation) output += chunk;
                onText(chunk);
              });
              receipt.stopReason = result.stopReason;
              return result;
            } catch (error) {
              receipt.stopReason = "interrupted-or-failed";
              throw error;
            } finally {
              receipt.finished = new Date().toISOString();
              const handle = scope.getStore();
              if (instrumentation && handle)
                instrumentation.observe({
                  role: spec.id,
                  session,
                  ...handle,
                  input: text,
                  output,
                  started,
                  ended: performance.now(),
                  stopReason: receipt.stopReason ?? "unknown",
                });
            }
          },
        });
        return {
          ...executor,
          execute: (context, bus) =>
            scope.run({ contextId: context.contextId, taskId: context.taskId }, () =>
              executor.execute(context, bus),
            ),
        };
      },
    });
    close = owned(async () => {
      try {
        await gateway.close();
      } finally {
        await cleanup(profile.root);
      }
    }, signal);
    const ready = await interrupted(gateway.start(), signal);
    signal?.throwIfAborted();
    const response = await fetch(new URL(".well-known/agent-card.json", ready.url), {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(5_000)])
        : AbortSignal.timeout(5_000),
    });
    const card = await response.json();
    assert.equal(card.name, spec.id);
    assert.equal(card.description, spec.description);
    assert.equal(card.supportedInterfaces[0].url, ready.url);
    signal?.throwIfAborted();
    return {
      id: spec.id,
      proof,
      url: ready.url,
      profile,
      receipts,
      setPeerProofs(proofs: Record<string, string>) {
        Object.assign(peerProofs, proofs);
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
