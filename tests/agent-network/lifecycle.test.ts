import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { interrupted } from "../../examples/agent-network/lifecycle.js";
import { stop } from "../../examples/agent-network/transport.js";

function killFixture(pid: number) {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error;
  }
}

test.each(["SIGINT", "SIGTERM"] as const)(
  "N10 %s drains owned TCP and child resources despite evidence failure and saves a partial report",
  async (signal) => {
    const reports = mkdtempSync(join(tmpdir(), "network-interruption-report-"));
    const script = `
    import { createServer } from 'node:net';
    import { spawn } from 'node:child_process';
    import { writeFileSync } from 'node:fs';
    import { createLifecycle, interrupted, owned } from ${JSON.stringify(resolve("examples/agent-network/lifecycle.ts"))};
    import { stop } from ${JSON.stringify(resolve("examples/agent-network/transport.ts"))};
    import { createInvestigationReport } from ${JSON.stringify(resolve("examples/agent-network/topology-report.ts"))};
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
      console.log(JSON.stringify({ failures, aborted: lifecycle.signal.aborted, order }));
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
      const progressive = JSON.parse(readFileSync(join(ready.report, "summary.json"), "utf8"));
      expect(progressive.status).toBe("INCOMPLETE");
      expect(progressive.metadata.finishedAt).toBeNull();
      child.kill(signal);
      expect(await interrupted(ended, AbortSignal.timeout(4_000))).toBe(1);
      const result = JSON.parse(output.trim().split("\n").at(-1)!) as {
        failures: string[];
        aborted: boolean;
        order: string[];
      };
      expect(result.failures).toEqual(["Owned-resource cleanup failed"]);
      expect(result.aborted).toBe(true);
      expect(result.order).toEqual(["evidence", "tcp", "child"]);
      expect(() => process.kill(ready.pid, 0)).toThrow();
      const rebound = createServer();
      try {
        await new Promise<void>((done, fail) => {
          rebound.once("error", fail);
          rebound.listen(ready.port, "127.0.0.1", done);
        });
        expect(rebound.address()).toMatchObject({ address: "127.0.0.1", port: ready.port });
      } finally {
        if (rebound.listening)
          await new Promise<void>((done, fail) =>
            rebound.close((error) => (error ? fail(error) : done())),
          );
      }
      const summary = JSON.parse(readFileSync(join(ready.report, "summary.json"), "utf8"));
      expect(summary.status).toBe("INCOMPLETE");
      expect(summary.missing).toHaveLength(27);
      expect(summary.metadata.finishedAt).toBeNull();
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
  },
  10_000,
);
