import { afterEach, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createAcpBridge, type AcpBridgeOptions } from "../src/acp-client.js";

const bridges: ReturnType<typeof createAcpBridge>[] = [];
const fixture = fileURLToPath(new URL("./fixtures/acp-peer.ts", import.meta.url));
function bridge(mode = "normal", overrides: Partial<AcpBridgeOptions> = {}) {
  const instance = createAcpBridge({
    cwd: process.cwd(),
    executable: process.execPath,
    args: [fixture, mode],
    versionArgs: [fixture, mode, "--version"],
    env: { PATH: process.env.PATH },
    startupTimeoutMs: 2_000,
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

describe("persistent ACP bridge over owned subprocess transport", () => {
  test("initializes once, preserves ordered root text and actual responses across turns", async () => {
    const instance = bridge();
    await Promise.all([instance.start(), instance.start()]);
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
    const another = await instance.newSession(); // fixture emits a late chunk before replying
    expect(another.sessionId).not.toBe(session.sessionId);
    expect(chunks).toEqual(["turn-1:", "hello", "turn-2:", "limit"]);
    const third: string[] = [];
    await instance.prompt(another.sessionId, "other", (text) => third.push(text));
    expect(third).toEqual(["turn-3:", "other"]);
    expect(chunks).toHaveLength(4);
  });

  test.each(["permission-reject", "permission-cancel"])(
    "denies %s without selecting allow",
    async (input) => {
      const instance = bridge();
      await instance.start();
      const session = await instance.newSession();
      const chunks: string[] = [];
      const response = await instance.prompt(session.sessionId, input, (text) => chunks.push(text));
      expect(response.stopReason).toBe("refusal");
      expect(chunks).toEqual([
        input === "permission-reject"
          ? '{"outcome":"selected","optionId":"deny"}'
          : '{"outcome":"cancelled"}',
      ]);
    },
  );

  test("cancels active prompt, keeps pre-result chunks, and preserves cancelled response", async () => {
    const instance = bridge();
    await instance.start();
    const session = await instance.newSession();
    const chunks: string[] = [];
    let ready: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const prompt = instance.prompt(session.sessionId, "cancel", (text) => {
      chunks.push(text);
      ready();
    });
    await started;
    await expect(instance.prompt(session.sessionId, "overlap", () => undefined)).rejects.toThrow(
      "in progress",
    );
    await instance.cancel(session.sessionId);
    expect((await prompt).stopReason).toBe("cancelled");
    expect(chunks).toEqual(["ready", "late-before-stop", "late-cancelled"]);
    await instance.newSession();
    expect(chunks).toEqual(["ready", "late-before-stop", "late-cancelled"]);
  });

  test("rejects unknown sessions and calls before startup without damaging a ready bridge", async () => {
    const instance = bridge();
    await expect(instance.newSession()).rejects.toThrow("unavailable");
    await instance.start();
    await expect(instance.prompt("unknown", "text", () => undefined)).rejects.toThrow("Unknown");
    await expect(instance.cancel("unknown")).rejects.toThrow("Unknown");
    expect((await instance.newSession()).sessionId).toBe("session-1");
  });

  test.each(["cancel-loses", "cancel-permission"])(
    "%s retains final text and denies permissions during cancellation",
    async (mode) => {
      const instance = bridge(mode);
      await instance.start();
      const session = await instance.newSession();
      const other = await instance.newSession();
      const ready = Promise.withResolvers<void>();
      const chunks: string[] = [];
      const pending = instance.prompt(session.sessionId, "cancel", (text) => {
        chunks.push(text);
        ready.resolve();
      });
      await ready.promise;
      await instance.cancel(other.sessionId);
      expect(chunks).toEqual(["ready"]);
      await Promise.all([instance.cancel(session.sessionId), instance.cancel(session.sessionId)]);
      expect((await pending).stopReason).toBe(mode === "cancel-loses" ? "end_turn" : "cancelled");
      expect(chunks).toEqual([
        "ready",
        ...(mode === "cancel-permission" ? ['{"outcome":"cancelled"}'] : []),
        "late-before-stop",
        "late-cancelled",
      ]);
      const next: string[] = [];
      await instance.prompt(session.sessionId, "next", (text) => next.push(text));
      expect(next).toEqual(["turn-1:", "next"]);
    },
  );

  test("shutdown cancels active work before stdin EOF and stops new admission", async () => {
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
    const closed = instance.close();
    await expect(instance.newSession()).rejects.toThrow("unavailable");
    expect((await pending).stopReason).toBe("cancelled");
    await closed;
    expect(chunks).toEqual(["ready", "late-before-stop", "late-cancelled"]);
    await expect(instance.start()).rejects.toThrow("unavailable");
  });

  test.each([
    "version",
    "executable-version",
    "version-output",
    "version-hang",
    "startup-exit",
    "startup-hang",
  ])("fails closed on %s", async (mode) => {
    const instance = bridge(mode, { startupTimeoutMs: 1_000 });
    await expect(instance.start()).rejects.toThrow("ACP");
    await expect(instance.start()).rejects.toThrow("unavailable");
    await expect(instance.newSession()).rejects.toThrow("unavailable");
  });

  test.each(["exit", "transport", "auth", "hang"])(
    "rejects pending prompt and fails closed on %s",
    async (input) => {
      const instance = bridge("normal", { promptTimeoutMs: 200 });
      await instance.start();
      const session = await instance.newSession();
      await expect(instance.prompt(session.sessionId, input, () => undefined)).rejects.toThrow(
        "ACP",
      );
      await expect(instance.newSession()).rejects.toThrow("unavailable");
      await expect(instance.start()).rejects.toThrow("unavailable");
    },
  );

  test("bounds session creation and cancellation if peer never completes", async () => {
    const blocked = bridge("session-hang", { startupTimeoutMs: 1_000 });
    await blocked.start();
    await expect(blocked.newSession()).rejects.toThrow("timed out");
    await expect(blocked.newSession()).rejects.toThrow("unavailable");
    const instance = bridge("cancel-hang", { cancelTimeoutMs: 150 });
    await instance.start();
    const session = await instance.newSession();
    let ready: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const prompt = instance.prompt(session.sessionId, "cancel", ready);
    const rejected = prompt.catch((error: unknown) => error);
    await started;
    await expect(instance.cancel(session.sessionId)).rejects.toThrow("cancel timed out");
    expect(await rejected).toBeInstanceOf(Error);
    expect(String(await rejected)).toContain("cancel timed out");
    await expect(instance.newSession()).rejects.toThrow("unavailable");
  });

  test("close rejects pending work, escalates owned stubborn child, and is terminal/idempotent", async () => {
    const instance = bridge("stubborn", { cancelTimeoutMs: 100 });
    await instance.start();
    const session = await instance.newSession();
    const prompt = instance.prompt(session.sessionId, "hang", () => undefined);
    const rejected = prompt.catch((error: unknown) => error);
    await instance.close();
    expect(String(await rejected)).toContain("cancel timed out");
    await instance.close();
    await expect(instance.start()).rejects.toThrow("unavailable");
  });

  test("spawn errors and consumer callback failures terminate the bridge", async () => {
    const missing = bridge("normal", { executable: "/nonexistent/acp-bridge-test" });
    await expect(missing.start()).rejects.toThrow("ACP");
    await expect(missing.newSession()).rejects.toThrow("unavailable");
    const workspace = bridge("normal", { cwd: "/nonexistent/acp-workspace-test" });
    await expect(workspace.start()).rejects.toThrow("ACP");
    await expect(workspace.newSession()).rejects.toThrow("unavailable");
    const instance = bridge();
    await instance.start();
    const session = await instance.newSession();
    await expect(
      instance.prompt(session.sessionId, "hello", () => {
        throw new Error("private");
      }),
    ).rejects.toThrow("callback failed");
    await expect(instance.newSession()).rejects.toThrow("unavailable");
  });

  test("the production version probe cannot be skipped by custom ACP arguments", async () => {
    const instance = createAcpBridge({
      cwd: process.cwd(),
      executable: process.execPath,
      args: [fixture, "normal"],
      env: { PATH: process.env.PATH },
      startupTimeoutMs: 2_000,
      closeTimeoutMs: 600,
    });
    bridges.push(instance);
    await expect(instance.start()).rejects.toThrow("startup failed");
    await expect(instance.newSession()).rejects.toThrow("unavailable");
  });

  test("close terminates the owned process group including a descendant", async () => {
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
  });

  test("closing before start or during startup never permits restart", async () => {
    const unused = bridge();
    await unused.close();
    await expect(unused.start()).rejects.toThrow("unavailable");
    const starting = bridge("startup-hang");
    const pending = starting.start().catch((error: unknown) => error);
    await starting.close();
    expect(String(await pending)).toContain("closed");
    await expect(starting.newSession()).rejects.toThrow("unavailable");
  });

  test("validates fixed workspace and timeout configuration", () => {
    expect(() => createAcpBridge({ cwd: "relative" })).toThrow("absolute");
    expect(() => createAcpBridge({ cwd: process.cwd(), closeTimeoutMs: 0 })).toThrow("timeouts");
  });
});
