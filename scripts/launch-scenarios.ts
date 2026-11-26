// Explicit provider-free timing and ease-of-use scenarios with the real OpenCode executable.
// Launches the built CLI (run `make build` first); every process is owned and stopped by pid.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "dist", "src", "cli.js");
const CANARY = "sk-launch-scenarios-canary-0000";
const READY_CEILING_MS = 120_000;
const FAST_ERROR_MS = 3_000;
const SHUTDOWN_CEILING_MS = 20_000;

type Gateway = {
  child: ReturnType<typeof spawn>;
  out: () => string;
  err: () => string;
  exited: Promise<number | null>;
  ready: Promise<{ url: string; ms: number }>;
};

type Row = { scenario: string; metric: string; ms: number; ceiling: number };
const rows: Row[] = [];
const failures: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) failures.push(message);
};
const record = (scenario: string, metric: string, ms: number, ceiling: number) => {
  rows.push({ scenario, metric, ms: Math.round(ms), ceiling });
  check(ms <= ceiling, `${scenario}: ${metric} ${Math.round(ms)} ms exceeds ${ceiling} ms`);
};

const workspace = () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), "launch-scenarios-"));
  mkdirSync(join(dir, "ws"));
  return { root: dir, cwd: join(dir, "ws") };
};

function launch(cwd: string, args: string[], env: Record<string, string> = {}): Gateway {
  const start = performance.now();
  const base = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env };
  const child = spawn("bun", [CLI, "--port", "0", ...args], { cwd, env: base });
  let out = "";
  let err = "";
  child.stdout?.on("data", (chunk: Buffer) => (out += chunk));
  child.stderr?.on("data", (chunk: Buffer) => (err += chunk));
  const exited = new Promise<number | null>((resolve) =>
    child.once("exit", (code) => resolve(code)),
  );
  const ready = new Promise<{ url: string; ms: number }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("not ready in time")), READY_CEILING_MS);
    const poll = setInterval(() => {
      const match = /"ready":true,"url":"([^"]+)"/.exec(out);
      if (!match) return;
      clearInterval(poll);
      clearTimeout(timer);
      resolve({ url: match[1]!, ms: performance.now() - start });
    }, 50);
    void exited.then(() => {
      clearInterval(poll);
      clearTimeout(timer);
      reject(new Error("exited before ready"));
    });
  });
  ready.catch(() => undefined);
  return { child, out: () => out, err: () => err, exited, ready };
}

async function stop(gateway: Gateway) {
  const start = performance.now();
  gateway.child.kill("SIGTERM");
  const timer = setTimeout(() => gateway.child.kill("SIGKILL"), SHUTDOWN_CEILING_MS);
  await gateway.exited;
  clearTimeout(timer);
  return performance.now() - start;
}

async function startup(name: string, args: string[], expect: RegExp[], count = 1) {
  const dirs = Array.from({ length: count }, workspace);
  const started = performance.now();
  const gateways = dirs.map((dir) => launch(dir.cwd, args, { OPENAI_API_KEY: CANARY }));
  try {
    const ready = await Promise.all(gateways.map((gateway) => gateway.ready));
    record(
      name,
      "slowest ready",
      Math.max(...ready.map((r) => r.ms)),
      READY_CEILING_MS * Math.min(count, 2),
    );
    const card = await fetch(new URL(".well-known/agent-card.json", ready[0]!.url));
    check(card.status === 200, `${name}: agent card status ${card.status}`);
    const text = await card.text();
    for (const pattern of expect)
      check(pattern.test(gateways[0]!.err() + text), `${name}: missing ${pattern}`);
    for (const gateway of gateways) {
      check(!(gateway.out() + gateway.err()).includes(CANARY), `${name}: credential value leaked`);
      check(
        !/weakened|overloaded/i.test(gateway.err()),
        `${name}: unexpected policy/overload text`,
      );
    }
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    const times = await Promise.all(gateways.map(stop));
    record(name, "slowest shutdown", Math.max(...times), SHUTDOWN_CEILING_MS);
    for (const dir of dirs) rmSync(dir.root, { recursive: true, force: true });
  }
}

async function rejected(name: string, args: string[], message: RegExp) {
  const dir = workspace();
  const gateway = launch(dir.cwd, args);
  const start = performance.now();
  await gateway.exited;
  record(name, "error shown", performance.now() - start, FAST_ERROR_MS);
  const lines = gateway.err().trim().split("\n").filter(Boolean);
  check(gateway.child.exitCode !== 0, `${name}: exit code was 0`);
  check(
    message.test(gateway.err()),
    `${name}: message ${message} not shown: ${gateway.err().trim()}`,
  );
  check(lines.length <= 2, `${name}: ${lines.length} error lines, expected one sentence`);
  check(!gateway.out().includes('"ready"'), `${name}: gateway became ready`);
  rmSync(dir.root, { recursive: true, force: true });
}

if (process.platform !== "linux") {
  console.error("launch scenarios are Linux-only");
  process.exit(1);
}

await rejected("removed --policy", ["--policy", "edit"], /--policy was replaced by --access/);
await rejected(
  "removed --dangerously-skip-permissions",
  ["--dangerously-skip-permissions"],
  /--access/,
);
await rejected("removed --permissions", ["--permissions", "ask"], /--enable approve/);
await rejected("removed --publish-activity", ["--publish-activity"], /--enable activity/);
await rejected("removed --allow-resume", ["--allow-resume"], /--enable resume/);
await rejected("unknown access value", ["--access", "full-access"], /Invalid --access value/);
await rejected("unknown enable value", ["--enable", "teleport"], /Invalid --enable value/);
await rejected(
  "danger-full-access with approve",
  ["--access", "danger-full-access", "--enable", "approve"],
  /approve/,
);
await rejected("reserved --pass-env", ["--pass-env", "PATH"], /--pass-env/);

await startup("no arguments (read)", [], [/read/i, /OPENAI_API_KEY/]);
await startup("--access edit", ["--access", "edit"], [/edit/i]);
await startup(
  "all --enable extras",
  ["--enable", "activity", "--enable", "approve", "--enable", "resume"],
  [/activity|approve|resume/i],
);
await startup("--no-env", ["--no-env"], [/no provider variables/i]);
await startup("3 gateways at once", [], [], 3);
await startup("6 gateways at once", [], [], 6);

console.table(rows);
if (failures.length > 0) {
  console.error(`${failures.length} scenario check(s) failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(JSON.stringify({ launchScenarios: true, checks: rows.length }));
