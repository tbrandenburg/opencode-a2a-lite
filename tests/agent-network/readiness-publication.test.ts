import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { registered, auditPath, expectedTools } from "../../examples/agent-network/readiness.js";
import { publishAtomic } from "../../examples/agent-network/atomic-publication.js";
import { stop, until } from "../../examples/agent-network/transport.js";

const run = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "readiness-publication-"));
  mkdirSync(join(root, "network-audit"));
  return { root, cwd: root, executable: process.execPath, env: {} };
}
test.each([false, true])(
  "split filesystem write atomic=%s exposes no partial ready document when published atomically",
  async (atomic) => {
    const profile = fixture();
    const file = auditPath(profile, "ready", run);
    const value = JSON.stringify({ run, tools: expectedTools });
    const script = `
    import { writeFileSync, appendFileSync, readSync } from 'node:fs';
    import { publishAtomic } from ${JSON.stringify(resolve("examples/agent-network/atomic-publication.ts"))};
    const write = file => {
      writeFileSync(file, ${JSON.stringify(value.slice(0, 10))}, { mode: 0o600, flag: 'wx' });
      console.log('partial-written');
      readSync(0, Buffer.alloc(1), 0, 1, null);
      appendFileSync(file, ${JSON.stringify(value.slice(10))});
    };
    ${atomic ? "publishAtomic" : "((file, write) => write(file))"}(${JSON.stringify(file)}, write);
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
      if (!atomic) expect(() => registered(profile, run)).toThrow(SyntaxError);
      if (atomic) expect(registered(profile, run)).toBeUndefined();
      expect(
        readdirSync(join(profile.cwd, "network-audit")).some((name) => name.includes(".tmp-")),
      ).toBe(atomic);
      child.stdin.end("x");
      await until(
        async () => (child.exitCode !== null ? true : undefined),
        "publication child exit",
        10_000,
      );
      expect(await ended).toBe(0);
      expect(registered(profile, run)?.tools).toEqual(expectedTools);
      expect(readdirSync(join(profile.cwd, "network-audit"))).toEqual([`ready-${run}.json`]);
    } finally {
      await stop(child);
      rmSync(profile.root, { recursive: true, force: true });
    }
  },
  25_000,
);

test("genuine bundled observer publishes strict readiness to a separate filesystem reader process", async () => {
  const profile = fixture();
  const directory = join(profile.cwd, "network-audit");
  const built = await Bun.build({
    entrypoints: [resolve("examples/agent-network/readiness-plugin.ts")],
    target: "bun",
    outdir: directory,
    naming: "index.js",
  });
  expect(built.success).toBe(true);
  const script = `
    import observer from ${JSON.stringify(join(directory, "index.js"))};
    const names = ${JSON.stringify(expectedTools)};
    const dispose = await observer.setup({
      tool: { list: async () => names.map(id => ({ id })) },
      session: { hook: async () => ({ dispose: async () => {} }) }
    });
    for await (const chunk of process.stdin) { if (chunk.length) break; }
    await dispose();
  `;
  const child = spawn(process.execPath, ["-e", script], {
    stdio: ["pipe", "ignore", "pipe"],
    env: {
      PATH: process.env.PATH,
      NETWORK_AUDIT_RUN: run,
      NETWORK_AUDIT_TOOLS: JSON.stringify(expectedTools),
    },
  });
  child.stderr.resume();
  const ended = new Promise<number | null>((done, fail) => {
    child.once("exit", done);
    child.once("error", fail);
  });
  try {
    const ready = await until(
      async () => registered(profile, run),
      "real observer atomic readiness",
      10_000,
    );
    expect(ready.tools).toEqual(expectedTools);
    expect(ready.pid).toBe(child.pid);
    child.stdin.end("stop");
    await until(
      async () => (child.exitCode !== null ? true : undefined),
      "observer dispose",
      10_000,
    );
    expect(await ended).toBe(0);
    writeFileSync(auditPath(profile, "ready", run), '{"run":');
    expect(() => registered(profile, run)).toThrow(SyntaxError);
    writeFileSync(
      auditPath(profile, "ready", run),
      JSON.stringify({ run, tools: [...expectedTools, "shell"] }),
    );
    expect(() => registered(profile, run)).toThrow();
  } finally {
    await stop(child);
    rmSync(profile.root, { recursive: true, force: true });
  }
}, 25_000);

test("failed atomic producer removes only its private temporary write and publishes nothing", () => {
  const profile = fixture();
  try {
    expect(() =>
      publishAtomic(auditPath(profile, "ready", run), (temporary) => {
        writeFileSync(temporary, "{", { mode: 0o600, flag: "wx" });
        throw new Error("controlled publication failure");
      }),
    ).toThrow("controlled publication failure");
    expect(registered(profile, run)).toBeUndefined();
    expect(readdirSync(join(profile.cwd, "network-audit"))).toEqual([]);
  } finally {
    rmSync(profile.root, { recursive: true, force: true });
  }
});
