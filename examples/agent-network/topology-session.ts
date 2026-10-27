import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createAcpBridge } from "../../src/acp-client.js";
import type { Profile } from "./profiles.js";
import { receipts } from "./collaborate.js";
import { expectedTools, registered, snapshots } from "./readiness.js";
import { freePort, until } from "./transport.js";
import { interrupted, owned } from "./lifecycle.js";
import { sha256 } from "./topology-evidence.js";

export type PromptKind = "discover" | "submit" | "observe" | "solve";
export interface CoordinatorTurn {
  kind: PromptKind;
  started: number;
  deadline: number;
  ended: number;
  completed: boolean;
  aborted: boolean;
  inputHash: string;
}
export interface SessionControls {
  turnMs: number;
  deadline: number;
  signal: AbortSignal;
  network: boolean;
  transformPrompt?: (kind: PromptKind, text: string) => string;
}
export async function topologySession(profile: Profile, controls: SessionControls) {
  const run = randomUUID();
  const bridge = createAcpBridge({
    cwd: profile.cwd,
    executable: profile.executable,
    env: {
      ...profile.env,
      ...(controls.network
        ? { NETWORK_AUDIT_RUN: run, NETWORK_AUDIT_TOOLS: JSON.stringify(expectedTools) }
        : {}),
    },
    startupTimeoutMs: 45_000,
    promptTimeoutMs: controls.turnMs,
  });
  const close = owned(() => bridge.close(), controls.signal);
  try {
    await freePort();
    await interrupted(bridge.start(), controls.signal);
    const session = await interrupted(bridge.newSession(), controls.signal);
    if (controls.network)
      await until(
        async () => {
          controls.signal.throwIfAborted();
          return receipts(profile).some((entry) => entry.event === "catalog") &&
            registered(profile, run)
            ? true
            : undefined;
        },
        "topology model catalog readiness",
        Math.min(45_000, controls.deadline - performance.now()),
      );
    let turns = 0;
    let verified = 0;
    const evidence: CoordinatorTurn[] = [];
    return {
      close,
      evidence,
      get readinessVerified() {
        return !controls.network || (verified === turns && turns > 0);
      },
      async prompt(kind: PromptKind, text: string) {
        controls.signal.throwIfAborted();
        const turnDeadline = Math.min(performance.now() + controls.turnMs, controls.deadline);
        const remaining = Math.ceil(turnDeadline - performance.now());
        assert(remaining > 0, "Case deadline expired");
        const bounded = AbortSignal.any([controls.signal, AbortSignal.timeout(remaining)]);
        const stop = () => {
          void close().catch(() => undefined);
        };
        bounded.addEventListener("abort", stop, { once: true });
        const started = performance.now();
        const prompt = controls.transformPrompt?.(kind, text) ?? text;
        const receipt: CoordinatorTurn = {
          kind,
          started,
          deadline: turnDeadline,
          ended: started,
          completed: false,
          aborted: false,
          inputHash: sha256(prompt),
        };
        evidence.push(receipt);
        let output = "";
        turns++;
        try {
          const result = await interrupted(
            bridge.prompt(session.sessionId, prompt, (chunk) => {
              output += chunk;
            }),
            bounded,
          );
          assert.equal(result.stopReason, "end_turn", "Coordinator turn incomplete");
          if (controls.network) snapshots(profile, run, session.sessionId);
          verified++;
          receipt.completed = true;
          return { output, started, ended: performance.now(), inputHash: receipt.inputHash };
        } finally {
          receipt.ended = performance.now();
          receipt.aborted = bounded.aborted;
          bounded.removeEventListener("abort", stop);
        }
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
