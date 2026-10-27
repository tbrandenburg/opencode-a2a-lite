import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { createLifecycle, interrupted, owned } from "../../examples/agent-network/lifecycle.js";
import { directory, stop } from "../../examples/agent-network/transport.js";

function killFixture(pid: number) {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`${signal} drains owned TCP and child resources despite evidence failure`, async () => {
    const reports = mkdtempSync(join(tmpdir(), "network-interruption-report-"));
    const reporting = resolve("examples/agent-network/topology-report.ts");
    const lifecycle = resolve("examples/agent-network/lifecycle.ts");
    const transport = resolve("examples/agent-network/transport.ts");
    const script = `
      import { createServer } from 'node:net';
      import { spawn } from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      import { createLifecycle, interrupted, owned } from ${JSON.stringify(lifecycle)};
      import { stop } from ${JSON.stringify(transport)};
      import { createInvestigationReport } from ${JSON.stringify(reporting)};
      const report = createInvestigationReport(${JSON.stringify(reports)});
      const lifecycle = createLifecycle();
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        detached: true, stdio: 'ignore', env: { PATH: process.env.PATH }
      });
      const server = createServer();
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const order = [];
      lifecycle.releases.push(owned(async () => { await stop(child); order.push('child'); }, lifecycle.signal));
      lifecycle.releases.push(owned(async () => {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        order.push('tcp');
      }, lifecycle.signal));
      lifecycle.releases.push(async () => { order.push('evidence'); writeFileSync('/dev/null/receipts', 'x'); });
      console.log(JSON.stringify({ pid: child.pid, port: server.address().port, report: report.root }));
      try { await interrupted(new Promise(() => {}), lifecycle.signal); }
      catch { process.exitCode = 1; }
      finally {
        const failures = await lifecycle.drain();
        report.persist();
        console.log(JSON.stringify({ failures: failures.length, aborted: lifecycle.signal.aborted, order }));
      }
    `;
    const child = spawn(process.execPath, ["-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH },
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.resume();
    const ended = new Promise<number | null>((done, fail) => {
      child.once("error", fail);
      child.once("exit", done);
    });
    let ownedPid: number | undefined;
    try {
      const deadline = AbortSignal.timeout(4_000);
      while (!output.includes("\n")) await setTimeout(10, undefined, { signal: deadline });
      const ready = JSON.parse(output.split("\n")[0]!) as {
        pid: number;
        port: number;
        report: string;
      };
      ownedPid = ready.pid;
      child.kill(signal);
      expect(await interrupted(ended, AbortSignal.timeout(4_000))).toBe(1);
      const result = JSON.parse(output.trim().split("\n").at(-1)!) as {
        failures: number;
        aborted: boolean;
        order: string[];
      };
      expect(result.failures).toBe(1);
      expect(result.aborted).toBe(true);
      expect(result.order).toContain("child");
      expect(result.order).toContain("tcp");
      expect(() => process.kill(ready.pid, 0)).toThrow();
      const connected = await new Promise<boolean>((done) => {
        const socket = createConnection({ port: ready.port, host: "127.0.0.1" });
        socket.once("connect", () => {
          socket.destroy();
          done(true);
        });
        socket.once("error", () => done(false));
      });
      expect(connected).toBe(false);
      const summary = JSON.parse(readFileSync(join(ready.report, "summary.json"), "utf8"));
      expect(summary.status).toBe("INCOMPLETE");
      expect(summary.missing).toHaveLength(27);
      if (process.env.A2A_LIFECYCLE_REPORT)
        appendFileSync(
          process.env.A2A_LIFECYCLE_REPORT,
          JSON.stringify({
            signal,
            ownedPidExited: true,
            ownedPortReleased: true,
            evidenceFailureRetained: true,
            partialReportRetained: true,
          }) + "\n",
          { mode: 0o600 },
        );
    } finally {
      await stop(child);
      if (ownedPid) killFixture(ownedPid);
      rmSync(reports, { recursive: true, force: true });
    }
  }, 10_000);
}

test("pre-aborted owned cleanup is idempotent and preserves its failure", async () => {
  const controller = new AbortController();
  controller.abort();
  let releases = 0;
  const close = owned(async () => {
    releases++;
    throw new Error("fixture failure");
  }, controller.signal);
  await expect(close()).rejects.toThrow("fixture failure");
  await expect(close()).rejects.toThrow("fixture failure");
  expect(releases).toBe(1);
});

test("drain retains LIFO order after a real evidence write failure", async () => {
  const lifecycle = createLifecycle();
  const order: string[] = [];
  lifecycle.releases.push(async () => {
    order.push("profile");
  });
  lifecycle.releases.push(async () => {
    order.push("worker");
  });
  lifecycle.releases.push(async () => {
    order.push("evidence");
    writeFileSync("/dev/null/receipts", "x");
  });
  expect(await lifecycle.drain()).toEqual(["Owned-resource cleanup failed"]);
  expect(order).toEqual(["evidence", "worker", "profile"]);
  expect(lifecycle.releases).toHaveLength(0);
});

test("directory interruption before readiness stops the spawned child", async () => {
  const root = mkdtempSync(join(tmpdir(), "network-interrupt-"));
  const binary = join(root, "bridge");
  const pidfile = join(root, "pid");
  writeFileSync(
    binary,
    `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(pidfile)}, String(process.pid));\nsetInterval(() => {}, 1000);`,
    { mode: 0o700 },
  );
  const profile = {
    root,
    cwd: root,
    executable: process.execPath,
    env: { PATH: "/usr/bin", HOME: root },
  };
  const controller = new AbortController();
  const starting = directory(binary, profile, controller.signal);
  // Observe rejection immediately while waiting for the real child's startup receipt.
  const outcome = starting.then(
    () => "ready",
    () => "interrupted",
  );
  try {
    const deadline = AbortSignal.timeout(4_000);
    while (!existsSync(pidfile)) await setTimeout(10, undefined, { signal: deadline });
    const pid = Number(readFileSync(pidfile, "utf8"));
    controller.abort();
    expect(await interrupted(outcome, AbortSignal.timeout(2_000))).toBe("interrupted");
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    controller.abort();
    await outcome;
    rmSync(root, { recursive: true, force: true });
  }
});

test("directory handles a nonexecutable binary without an unhandled spawn error", async () => {
  const root = mkdtempSync(join(tmpdir(), "network-directory-"));
  const binary = join(root, "bridge");
  writeFileSync(binary, "not executable", { mode: 0o600 });
  const profile = {
    root,
    cwd: root,
    executable: process.execPath,
    env: { PATH: "/usr/bin", HOME: root },
  };
  const started = Date.now();
  try {
    await expect(directory(binary, profile)).rejects.toThrow("Directory failed to execute");
    expect(Date.now() - started).toBeLessThan(2_000);
    const controller = new AbortController();
    controller.abort();
    await expect(directory(binary, profile, controller.signal)).rejects.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
