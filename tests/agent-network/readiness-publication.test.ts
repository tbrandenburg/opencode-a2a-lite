import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { registered, auditPath, expectedTools } from "../../examples/agent-network/readiness.js";
import { stop, until } from "../../examples/agent-network/transport.js";

test("N09 paused atomic writer never exposes a partial readiness document to the reader", async () => {
  const root = mkdtempSync(join(tmpdir(), "readiness-publication-"));
  mkdirSync(join(root, "network-audit"));
  const profile = { root, cwd: root, executable: process.execPath, env: {} };
  const run = "11111111-1111-4111-8111-111111111111";
  const file = auditPath(profile, "ready", run);
  const value = JSON.stringify({ run, tools: expectedTools });
  const script = `
    import { writeFileSync, appendFileSync, readSync } from 'node:fs';
    import { publishAtomic } from ${JSON.stringify(resolve("examples/agent-network/atomic-publication.ts"))};
    publishAtomic(${JSON.stringify(file)}, file => {
      writeFileSync(file, ${JSON.stringify(value.slice(0, 10))}, { mode: 0o600, flag: 'wx' });
      console.log('partial-written');
      readSync(0, Buffer.alloc(1), 0, 1, null);
      appendFileSync(file, ${JSON.stringify(value.slice(10))});
    });
  `;
  const child = spawn(process.execPath, ["-e", script], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { PATH: process.env.PATH },
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.resume();
  const ended = new Promise<number | null>((done, fail) => {
    child.once("exit", done);
    child.once("error", fail);
  });
  try {
    await until(
      async () => (output.includes("partial-written") ? true : undefined),
      "paused partial producer",
      10_000,
    );
    expect(registered(profile, run)).toBeUndefined();
    expect(readdirSync(join(root, "network-audit")).some((name) => name.includes(".tmp-"))).toBe(
      true,
    );
    child.stdin.end("x");
    await until(
      async () => (child.exitCode !== null ? true : undefined),
      "publication child exit",
      10_000,
    );
    expect(await ended).toBe(0);
    expect(registered(profile, run)?.tools).toEqual(expectedTools);
    expect(readdirSync(join(root, "network-audit"))).toEqual([`ready-${run}.json`]);
  } finally {
    await stop(child);
    rmSync(root, { recursive: true, force: true });
  }
}, 25_000);
