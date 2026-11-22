import { afterEach, expect, spyOn, test as bunTest } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { BridgeError } from "../src/bridge-error.js";
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

test("A1b: activity exposes tool identifiers and root thoughts only, and only when requested", async () => {
  const instance = bridge();
  await instance.start();
  const session = await instance.newSession();
  const seen: unknown[] = [];
  const plain = await instance.prompt(
    session.sessionId,
    "hello",
    () => undefined,
    (entry) => seen.push(entry),
  );
  expect(plain.permissionDenied).toBeUndefined();
  expect(seen).toEqual([
    { thought: "private" },
    { toolCallId: "private-tool", title: "private tool" },
    { toolCallId: "private-tool", status: "completed" },
  ]);
  expect(JSON.stringify(seen)).not.toContain("secret-tool-output");
  expect(JSON.stringify(seen)).not.toContain("child-thought");
  await instance.prompt(session.sessionId, "again", () => undefined);
  expect(seen).toHaveLength(3);
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
  expect(rejection.permissionDenied).toBe(true);
  expect(rejected).toEqual(['{"outcome":"selected","optionId":"deny"}']);
  const canceled: string[] = [];
  const cancellation = await instance.prompt(session.sessionId, "permission-cancel", (text) =>
    canceled.push(text),
  );
  expect(cancellation.stopReason).toBe("refusal");
  expect(cancellation.permissionDenied).toBe(true);
  expect(canceled).toEqual(['{"outcome":"cancelled"}']);
});

test("A2b: an operator answer is honored for offered options only and never allow_always", async () => {
  const instance = bridge();
  await instance.start();
  const session = await instance.newSession();
  const run = async (prompt: string, choose: (offered: string[]) => string | undefined) => {
    const out: string[] = [];
    const offers: string[][] = [];
    const response = await instance.prompt(
      session.sessionId,
      prompt,
      (text) => out.push(text),
      undefined,
      async (asked) => {
        offers.push(asked.options.map((option) => option.optionId));
        expect(asked.title).toBe("Untrusted tool");
        return choose(offers.at(-1) ?? []);
      },
    );
    return { out, offers, response };
  };
  const allowed = await run("permission-reject", () => "allow");
  expect(allowed.offers).toEqual([["allow", "deny"]]);
  expect(allowed.out).toEqual(['{"outcome":"selected","optionId":"allow"}']);
  expect(allowed.response.permissionDenied).toBeUndefined();
  const denied = await run("permission-reject", () => "deny");
  expect(denied.out).toEqual(['{"outcome":"selected","optionId":"deny"}']);
  expect(denied.response.permissionDenied).toBe(true);
  const sneaky = await run("permission-reject", () => "always");
  expect(sneaky.out).toEqual(['{"outcome":"selected","optionId":"deny"}']);
  expect(sneaky.response.permissionDenied).toBe(true);
  const silent = await run("permission-cancel", () => undefined);
  expect(silent.offers).toEqual([["allow"]]);
  expect(silent.out).toEqual(['{"outcome":"cancelled"}']);
  expect(silent.response.permissionDenied).toBe(true);
});

test("A2c: waiting for a human does not trip the prompt deadline, but cancellation still ends it", async () => {
  const instance = bridge("normal", { promptTimeoutMs: 300 });
  await instance.start();
  const session = await instance.newSession();
  const out: string[] = [];
  const slow = await instance.prompt(
    session.sessionId,
    "permission-reject",
    (text) => out.push(text),
    undefined,
    async () => {
      await Bun.sleep(900);
      return "allow";
    },
  );
  expect(out).toEqual(['{"outcome":"selected","optionId":"allow"}']);
  expect(slow.stopReason).toBe("refusal");
  const pending = Promise.withResolvers<void>();
  const cancelled: string[] = [];
  const waiting = instance.prompt(
    session.sessionId,
    "permission-reject",
    (text) => cancelled.push(text),
    undefined,
    async () => {
      pending.resolve();
      return new Promise<string>(() => undefined);
    },
  );
  await pending.promise;
  await instance.cancel(session.sessionId);
  const response = await waiting;
  expect(cancelled[0]).toBe('{"outcome":"cancelled"}');
  expect(response.permissionDenied).toBeUndefined();
});

test("A2d: resuming binds an existing session, rejects bad ids without retiring the bridge", async () => {
  const instance = bridge();
  await instance.start();
  await expect(instance.resumeSession("ses_unknown0001")).rejects.toThrow("resume rejected");
  const failure = await instance.resumeSession("ses_unknown0001").catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(BridgeError);
  const out: string[] = [];
  await expect(instance.prompt("ses_resumed0001", "whoami", () => undefined)).rejects.toThrow(
    "Unknown",
  );
  expect(await instance.resumeSession("ses_resumed0001")).toBe("ses_resumed0001");
  await instance.prompt("ses_resumed0001", "whoami", (text) => out.push(text));
  expect(out).toEqual(["ses_resumed0001"]);
  expect((await instance.newSession()).sessionId).toBeTruthy();
});

test("A2f: loading replays only plain root text, newest bounded, and binds the session", async () => {
  const instance = bridge();
  await instance.start();
  const replay = await instance.loadSession("ses_replayed0001");
  expect(replay).toEqual({
    truncated: false,
    messages: [
      { role: "user", text: "remember KUMQUAT" },
      { role: "assistant", text: "noted" },
      { role: "user", text: "what was it?" },
      { role: "assistant", text: "KUMQUAT" },
    ],
  });
  expect(JSON.stringify(replay)).not.toMatch(/tool-input|tool-output|replayed-thought|child-reply/);
  const out: string[] = [];
  await instance.prompt("ses_replayed0001", "whoami", (text) => out.push(text));
  expect(out).toEqual(["ses_replayed0001"]);
  const long = await instance.loadSession("ses_longhistory1");
  expect(long.truncated).toBe(true);
  expect(long.messages).toHaveLength(100);
  expect(long.messages[0]).toEqual({ role: "user", text: "q6" });
  expect(long.messages.at(-1)?.text).toHaveLength(20_000);
  await expect(instance.loadSession("ses_unknown0002")).rejects.toThrow("load rejected");
  expect((await instance.newSession()).sessionId).toBeTruthy();
});

test("A2e: an unexpected resume failure is sanitized and retires the bridge", async () => {
  const instance = bridge("resume-internal-error");
  await instance.start();
  const failure = await instance.resumeSession("ses_resumed0002").catch((error: unknown) => error);
  expect((failure as Error).message).toBe("ACP session resume failed");
  expect((failure as Error).message).not.toContain("secret");
  await expect(instance.newSession()).rejects.toThrow("unavailable");
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

test("A4c: a rejected session allocation reports a sanitized phase and retires the bridge", async () => {
  const instance = bridge("session-unavailable");
  await instance.start();
  const failure = await instance.newSession().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(BridgeError);
  expect((failure as Error).message).toBe("ACP session creation failed");
  expect((failure as Error).message).not.toContain("secret");
  await expect(instance.newSession()).rejects.toThrow("unavailable");
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

for (const persistent of [false, true]) {
  test(`A9: ${persistent ? "persistent" : "transient"} EPERM during the post-kill probe remains inconclusive`, async () => {
    const instance = bridge("descendant", { closeTimeoutMs: 1_500 });
    // A deliberately failed close is already settled and must not fail afterEach again.
    if (persistent) bridges.splice(bridges.indexOf(instance), 1);
    let spy: ReturnType<typeof spyOn<typeof process, "kill">> | undefined;
    try {
      await instance.start();
      const session = await instance.newSession();
      const response = await instance.prompt(session.sessionId, "hello", () => undefined);
      const parent = response._meta?.pid;
      const descendant = response._meta?.descendant;
      if (typeof parent !== "number" || typeof descendant !== "number")
        throw new Error("Missing owned PIDs");
      const originalKill = process.kill.bind(process);
      let killed = false;
      let denied = 0;
      spy = spyOn(process, "kill").mockImplementation((pid, signal) => {
        if (pid === -parent && signal === "SIGKILL") killed = true;
        if (pid === -parent && signal === 0 && killed && (persistent || denied < 2)) {
          denied++;
          throw Object.assign(new Error("injected permission failure"), { code: "EPERM" });
        }
        return originalKill(pid, signal);
      });
      if (persistent) {
        await expect(instance.close()).rejects.toThrow("owned process did not stop");
        expect(denied).toBeGreaterThan(2);
      } else {
        await instance.close();
        expect(denied).toBe(2);
      }
      expect(killed).toBe(true);
      expect(() => originalKill(parent, 0)).toThrow();
      expect(() => originalKill(descendant, 0)).toThrow();
    } finally {
      spy?.mockRestore();
      await instance.close().catch(() => undefined);
    }
  });
}

test("A10: EPERM sending SIGKILL is not treated as an inconclusive probe", async () => {
  const instance = bridge("descendant", { closeTimeoutMs: 1_500 });
  bridges.splice(bridges.indexOf(instance), 1);
  let spy: ReturnType<typeof spyOn<typeof process, "kill">> | undefined;
  try {
    await instance.start();
    const session = await instance.newSession();
    const response = await instance.prompt(session.sessionId, "hello", () => undefined);
    const parent = response._meta?.pid;
    if (typeof parent !== "number") throw new Error("Missing owned PID");
    const originalKill = process.kill.bind(process);
    let injected = false;
    spy = spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (pid === -parent && signal === "SIGKILL") {
        // Actually stop the fixture before simulating a failed signal write.
        originalKill(pid, signal);
        injected = true;
        throw Object.assign(new Error("injected permission failure"), { code: "EPERM" });
      }
      return originalKill(pid, signal);
    });
    await expect(instance.close()).rejects.toThrow("owned process cleanup failed");
    expect(injected).toBe(true);
    spy.mockRestore();
    spy = undefined;
    const deadline = performance.now() + 3_000;
    for (;;) {
      try {
        originalKill(-parent, 0);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ESRCH") break;
        if (!(error instanceof Error && "code" in error && error.code === "EPERM")) throw error;
      }
      if (performance.now() >= deadline) throw new Error("Fixture group did not stop");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    spy?.mockRestore();
    await instance.close().catch(() => undefined);
  }
});
