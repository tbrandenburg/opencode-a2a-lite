import assert from "node:assert/strict";
import { accessSync, constants, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { cleanup } from "../../scripts/acp-smoke-config.js";
import definition from "./network.json" with { type: "json" };
import { sha256 } from "./topology-evidence.js";
import { createProfile } from "./profiles.js";
import { directory } from "./transport.js";
import { owned, type Release } from "./lifecycle.js";
import type { Worker } from "./workers.js";

export function topologyPrerequisites(network: boolean) {
  assert.equal(process.platform, "linux");
  assert.equal(Bun.version, "1.3.9");
  assert(process.env.OPENAI_API_KEY, "OPENAI_API_KEY required (never printed)");
  if (!network) return undefined;
  assert(process.env.A2ABRIDGE_BIN, "A2ABRIDGE_BIN required");
  const binary = resolve(process.env.A2ABRIDGE_BIN);
  accessSync(binary, constants.X_OK);
  assert.equal(
    sha256(readFileSync(binary)),
    definition.bridgeBinarySha256,
    "Unexpected bridge digest",
  );
  return binary;
}

// Rebind the actual released port, not an unrelated ephemeral port.
export async function verifyReleased(url: string) {
  const server = createServer();
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(Number(new URL(url).port), "127.0.0.1", done);
  });
  await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
}

export async function topologyDirectory(
  binary: string,
  workers: readonly Worker[],
  releases: Release[],
  signal: AbortSignal,
) {
  const profile = await createProfile("directory", "No model requests.");
  releases.push(() => cleanup(profile.root));
  // Keep the directory alive for unregister even after execution is interrupted.
  const registry = await directory(binary, profile, signal, true);
  releases.push(async () => {
    await registry.close();
    await verifyReleased(registry.url);
  });
  const registered: Worker[] = [];
  const failures: string[] = [];
  const post = async (path: string, worker: Worker, active = true) => {
    const response = await fetch(registry.url + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: worker.url }),
      signal: active
        ? AbortSignal.any([signal, AbortSignal.timeout(3_000)])
        : AbortSignal.timeout(3_000),
    });
    assert.equal(response.status, 204, "Directory membership update failed");
  };
  let pending = Promise.resolve();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const close = owned(async () => {
    clearInterval(heartbeat);
    await pending;
    const results = await Promise.allSettled(
      registered.map((worker) => post("/unregister", worker, false)),
    );
    assert(
      results.every((result) => result.status === "fulfilled"),
      "Directory unregister failed",
    );
  });
  releases.push(close);
  for (const worker of workers) {
    await post("/register", worker);
    registered.push(worker);
  }
  heartbeat = setInterval(() => {
    pending = pending
      .then(async () => {
        if (signal.aborted) return;
        for (const worker of registered) await post("/heartbeat", worker, false);
      })
      .catch(() => {
        failures.push("heartbeat failed");
      });
  }, 20_000);
  return { url: registry.url, failures };
}
