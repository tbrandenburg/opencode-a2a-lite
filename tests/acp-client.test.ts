import { afterEach, expect, test as bunTest } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createAcpBridge, type AcpBridgeOptions } from "../src/acp-client.js";
import {
  fixtureStartupMs,
  fixtureTestMs,
  slowInitializationMs,
} from "./fixtures/acp-test-timeouts.js";

const bridges: ReturnType<typeof createAcpBridge>[] = [];
const fixture = fileURLToPath(new URL("./fixtures/acp-peer.ts", import.meta.url));
const test = (name: string, run: () => Promise<void>) => bunTest(name, run, fixtureTestMs);
function bridge(mode = "normal", overrides: Partial<AcpBridgeOptions> = {}) {
  const instance = createAcpBridge({
    cwd: process.cwd(),
    executable: process.execPath,
    args: [fixture, mode],
    versionArgs: [fixture, mode, "--version"],
    env: { PATH: process.env.PATH },
    startupTimeoutMs: fixtureStartupMs,
    promptTimeoutMs: 2_000,
    cancelTimeoutMs: 500,
    closeTimeoutMs: 600,
    ...overrides,
  });
  bridges.push(instance);
  return instance;
}
afterEach(async () => {
  const owned = bridges.splice(0);
  await Promise.all(owned.map((instance) => instance.close()));
});

test("A1: persistent ACP filters exact root assistant text across sessions and late idle updates", async () => {
  const instance = bridge();
  await expect(instance.newSession()).rejects.toThrow("unavailable");
  await Promise.all([instance.start(), instance.start()]);
  await expect(instance.prompt("unknown", "text", () => undefined)).rejects.toThrow("Unknown");
  const session = await instance.newSession();
  const chunks: string[] = [];
  const first = await instance.prompt(session.sessionId, "hello", (text) => chunks.push(text));
  expect(chunks).toEqual(["turn-1:", "hello"]);
  expect(first.stopReason).toBe("end_turn");
  expect(first._meta?.initialized).toBe(1);
  const second = await instance.prompt(session.sessionId, "limit", (text) => chunks.push(text));
  expect(chunks).toEqual(["turn-1:", "hello", "turn-2:", "limit"]);
  expect(second.stopReason).toBe("max_tokens");
  expect(second._meta?.pid).toBe(first._meta?.pid);
  const another = await instance.newSession(); // Emits a late idle chunk before replying.
  expect(another.sessionId).not.toBe(session.sessionId);
  expect(chunks).toEqual(["turn-1:", "hello", "turn-2:", "limit"]);
  const third: string[] = [];
  await instance.prompt(another.sessionId, "other", (text) => third.push(text));
  expect(third).toEqual(["turn-3:", "other"]);
  expect(chunks).toHaveLength(4);
});

test("A2: permission denial selects reject when present and cancels when only allow exists", async () => {
  const instance = bridge();
  await instance.start();
  const session = await instance.newSession();
  const rejected: string[] = [];
  const rejection = await instance.prompt(session.sessionId, "permission-reject", (text) =>
    rejected.push(text),
  );
  expect(rejection.stopReason).toBe("refusal");
  expect(rejected).toEqual(['{"outcome":"selected","optionId":"deny"}']);
  const canceled: string[] = [];
  const cancellation = await instance.prompt(session.sessionId, "permission-cancel", (text) =>
    canceled.push(text),
  );
  expect(cancellation.stopReason).toBe("refusal");
  expect(canceled).toEqual(['{"outcome":"cancelled"}']);
});

test("A3: shutdown cancels active work before EOF, preserves final chunks and stops admission", async () => {
  const instance = bridge();
  await instance.start();
  const session = await instance.newSession();
  const ready = Promise.withResolvers<void>();
  const chunks: string[] = [];
  const pending = instance.prompt(session.sessionId, "cancel", (text) => {
    chunks.push(text);
    ready.resolve();
  });
  await ready.promise;
  await expect(instance.prompt(session.sessionId, "overlap", () => undefined)).rejects.toThrow(
    "in progress",
  );
  const closed = instance.close();
  await expect(instance.newSession()).rejects.toThrow("unavailable");
  expect((await pending).stopReason).toBe("cancelled");
  await closed;
  expect(chunks).toEqual(["ready", "late-before-stop", "late-cancelled"]);
  await instance.close();
  await expect(instance.start()).rejects.toThrow("unavailable");
});

for (const mode of ["executable-version", "version-old", "version-floor", "version-prerelease"]) {
  test(`A4: unreviewed executable ${mode} permanently fails closed`, async () => {
    const instance = bridge(mode);
    await expect(instance.start()).rejects.toThrow("stable opencode v2.2.7 or newer");
    await expect(instance.start()).rejects.toThrow("unavailable");
    await expect(instance.newSession()).rejects.toThrow("unavailable");
  });
}

test("A4b: a newer stable executable is admitted", async () => {
  const instance = bridge("version-newer");
  await instance.start();
  expect((await instance.newSession()).sessionId).toBeTruthy();
  await instance.close();
});

test("A5: subprocess death rejects pending work and permanently retires the bridge", async () => {
  const instance = bridge("normal", { promptTimeoutMs: 200 });
  await instance.start();
  const session = await instance.newSession();
  await expect(instance.prompt(session.sessionId, "exit", () => undefined)).rejects.toThrow("ACP");
  await expect(instance.newSession()).rejects.toThrow("unavailable");
  await expect(instance.start()).rejects.toThrow("unavailable");
});

test("A6: a prompt deadline rejects pending work and permanently retires the bridge", async () => {
  const instance = bridge("normal", { promptTimeoutMs: 200 });
  await instance.start();
  const session = await instance.newSession();
  const chunks: string[] = [];
  await expect(
    instance.prompt(session.sessionId, "hang", (text) => chunks.push(text)),
  ).rejects.toThrow("ACP prompt timed out");
  expect(chunks).toEqual(["ready"]);
  await expect(instance.newSession()).rejects.toThrow("unavailable");
  await expect(instance.start()).rejects.toThrow("unavailable");
});

async function cancellationProbe(
  mode: "cancel-hang" | "cancel-no-receipt" | "cancel-hang-slow-start",
) {
  const instance = bridge(mode, { cancelTimeoutMs: 150 });
  const started = performance.now();
  await instance.start();
  const startup = performance.now() - started;
  const session = await instance.newSession();
  const ready = Promise.withResolvers<string>();
  const receipt = Promise.withResolvers<string>();
  const prompt = instance.prompt(session.sessionId, "cancel", (text) => {
    if (text === "cancel-received") receipt.resolve(text);
    else ready.resolve(text);
  });
  const rejected = prompt.catch((error: unknown) => error);
  const readiness = Promise.race([
    ready.promise,
    prompt.then(
      () => {
        throw new Error("Prompt completed before readiness");
      },
      (error: unknown) => {
        throw error;
      },
    ),
  ]);
  expect(await readiness).toBe("ready");
  return { instance, session, startup, receipt: receipt.promise, rejected };
}

async function cancelAfterReceipt(cancellation: Promise<void>, receipt: Promise<string>) {
  const premature = cancellation.then(
    () => {
      throw new Error("Cancellation settled before peer receipt");
    },
    (error: unknown) => {
      throw new Error("Cancellation settled before peer receipt", { cause: error });
    },
  );
  expect(await Promise.race([receipt, premature])).toBe("cancel-received");
  await cancellation;
}

test("A7: cancellation has its own deadline and rejects the hanging prompt", async () => {
  const probe = await cancellationProbe("cancel-hang");
  await expect(
    cancelAfterReceipt(probe.instance.cancel(probe.session.sessionId), probe.receipt),
  ).rejects.toThrow("cancel timed out");
  expect(await probe.rejected).toBeInstanceOf(Error);
  expect(String(await probe.rejected)).toContain("cancel timed out");
  await expect(probe.instance.newSession()).rejects.toThrow("unavailable");
});

test("A7 slow initialization reaches the independent cancellation deadline", async () => {
  const started = performance.now();
  const probe = await cancellationProbe("cancel-hang-slow-start");
  expect(performance.now() - started).toBeGreaterThan(fixtureStartupMs);
  expect(probe.startup).toBeGreaterThanOrEqual(slowInitializationMs);
  expect(probe.startup).toBeLessThan(fixtureStartupMs);
  const cancelling = performance.now();
  await expect(
    cancelAfterReceipt(probe.instance.cancel(probe.session.sessionId), probe.receipt),
  ).rejects.toThrow("cancel timed out");
  const elapsed = performance.now() - cancelling;
  expect(elapsed).toBeGreaterThanOrEqual(100);
  expect(elapsed).toBeLessThan(1_200);
  expect(String(await probe.rejected)).toContain("cancel timed out");
  await expect(probe.instance.newSession()).rejects.toThrow("unavailable");
});

test("A7 receipt gate rejects a real cancellation timeout without peer receipt", async () => {
  const probe = await cancellationProbe("cancel-no-receipt");
  const outcome = await cancelAfterReceipt(
    probe.instance.cancel(probe.session.sessionId),
    probe.receipt,
  ).catch((error: unknown) => error);
  expect(outcome).toBeInstanceOf(Error);
  if (!(outcome instanceof Error)) throw new Error("Expected receipt failure");
  expect(outcome.message).toBe("Cancellation settled before peer receipt");
  expect(String(outcome.cause)).toContain("cancel timed out");
  expect(String(await probe.rejected)).toContain("cancel timed out");
  await expect(probe.instance.newSession()).rejects.toThrow("unavailable");
});

test("A8: close escalates only its owned group, including descendants", async () => {
  const sentinel = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    detached: true,
    stdio: "ignore",
  });
  const exited = once(sentinel, "exit");
  try {
    await once(sentinel, "spawn");
    const instance = bridge("descendant", { closeTimeoutMs: 1_500 });
    await instance.start();
    const session = await instance.newSession();
    const response = await instance.prompt(session.sessionId, "hello", () => undefined);
    const parent = response._meta?.pid;
    const descendant = response._meta?.descendant;
    expect(typeof parent).toBe("number");
    expect(typeof descendant).toBe("number");
    if (typeof parent !== "number" || typeof descendant !== "number")
      throw new Error("Missing owned PIDs");
    await instance.close();
    expect(() => process.kill(parent, 0)).toThrow("No such process");
    expect(() => process.kill(descendant, 0)).toThrow("No such process");
    const sentinelPid = sentinel.pid;
    expect(sentinelPid).toBeDefined();
    if (sentinelPid === undefined) throw new Error("Missing sentinel PID");
    expect(() => process.kill(sentinelPid, 0)).not.toThrow();
  } finally {
    sentinel.kill("SIGKILL");
    await exited;
  }
});
