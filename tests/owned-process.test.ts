import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { setTimeout } from "node:timers/promises";
import * as acp from "@agentclientprotocol/sdk";
import { expect, test } from "bun:test";
import { diagnostics, withCleanup } from "./e2e-support.js";
import { spawnOwnedProcess } from "./owned-process.js";

const fixture = join(import.meta.dir, "fixtures/acceptance-stalled.ts");
const grace = { eof: 100, term: 100, kill: 2_000 };

async function listening(marker: string) {
  const deadline = performance.now() + 3_000;
  while (!existsSync(marker) && performance.now() < deadline) await setTimeout(10);
  const value: unknown = JSON.parse(readFileSync(marker, "utf8"));
  assert(value && typeof value === "object" && "pid" in value && "port" in value);
  assert(typeof value.pid === "number" && typeof value.port === "number");
  return { pid: value.pid, port: value.port };
}

async function reclaimed(port: number) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

["parent", "descendant"].forEach((stopped) => {
  test(`raw ACP initialize failure cleans a stopped ${stopped}, its owned listener and leaves a sentinel alive`, async () => {
    const root = mkdtempSync("/tmp/opencode/issue-61-stalled-");
    const options = { cwd: root, env: { PATH: "/usr/bin:/bin", HOME: root } };
    const sentinel = spawnOwnedProcess(
      process.execPath,
      [fixture, join(root, "sentinel"), "sentinel"],
      options,
      { ...grace, eof: 3_000 },
    );
    const owner = spawnOwnedProcess(
      process.execPath,
      [fixture, join(root, "leased"), "parent"],
      options,
      grace,
    );
    owner.child.stderr.resume();
    sentinel.child.stderr.resume();
    sentinel.child.stdout.resume();
    let connection: acp.ClientConnection | undefined;
    try {
      const unrelated = await listening(join(root, "sentinel"));
      const leased = await listening(join(root, "leased"));
      process.kill(stopped === "parent" ? owner.child.pid! : leased.pid, "SIGSTOP");
      const primary = new Error("Injected initialize deadline");
      const result = withCleanup(
        async () => {
          const client = acp.client({ name: "stalled-initialize" });
          connection = client.connect(
            acp.ndJsonStream(
              Writable.toWeb(owner.child.stdin),
              Readable.toWeb(owner.child.stdout) as unknown as ReadableStream<Uint8Array>,
            ),
          );
          await Promise.race([
            connection.agent.request(acp.methods.agent.initialize, {
              protocolVersion: 1,
              clientCapabilities: {},
            }),
            setTimeout(100).then(() => {
              throw primary;
            }),
          ]);
        },
        async () => {
          try {
            assert.deepEqual(
              await owner.close(),
              { code: 0, forced: false },
              "Forced ACP exit is not EOF acceptance",
            );
          } finally {
            connection?.close();
          }
        },
      );
      await expect(result).rejects.toBe(primary);
      expect(diagnostics(primary)).toHaveProperty("cleanupErrorCategory", "cleanup");
      expect(() => process.kill(owner.child.pid!, 0)).toThrow("No such process");
      expect(() => process.kill(leased.pid, 0)).toThrow("No such process");
      await reclaimed(leased.port);
      expect(process.kill(unrelated.pid, 0)).toBe(true);
      await expect(reclaimed(unrelated.port)).rejects.toHaveProperty("code", "EADDRINUSE");
      expect(await sentinel.close()).toEqual({ code: 0, forced: false });
      await reclaimed(unrelated.port);
    } finally {
      connection?.close();
      await Promise.all([owner.close(), sentinel.close()]);
      rmSync(root, { recursive: true, force: true });
    }
  }, 10_000);
});

test("owned process cleanup is registered even when spawn fails before initialization", async () => {
  const owner = spawnOwnedProcess(
    "/missing/acceptance-executable",
    [],
    {
      cwd: "/tmp/opencode",
      env: {},
    },
    grace,
  );
  expect(await owner.close()).toEqual({ code: null, forced: false });
  expect(await owner.close()).toEqual({ code: null, forced: false });
});
