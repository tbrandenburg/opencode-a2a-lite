import { afterEach, expect, test as bunTest } from "bun:test";
import { fileURLToPath } from "node:url";
import { createAcpBridge, type AcpBridgeOptions } from "../src/acp-client.js";
import { fixtureStartupMs, fixtureTestMs } from "./fixtures/acp-test-timeouts.js";

const bridges: ReturnType<typeof createAcpBridge>[] = [];
const fixture = fileURLToPath(new URL("./fixtures/acp-peer.ts", import.meta.url));
const test = (name: string, run: () => Promise<void>) => bunTest(name, run, fixtureTestMs);
function bridge(mode: string, agent = "architect") {
  const options: AcpBridgeOptions = {
    cwd: process.cwd(),
    executable: process.execPath,
    args: [fixture, mode],
    versionArgs: [fixture, mode, "--version"],
    env: { PATH: process.env.PATH },
    startupTimeoutMs: fixtureStartupMs,
    promptTimeoutMs: 2_000,
    closeTimeoutMs: 600,
    agent,
  };
  const instance = createAcpBridge(options);
  bridges.push(instance);
  return { instance, options };
}
afterEach(async () => {
  await Promise.all(bridges.splice(0).map((instance) => instance.close()));
});

test("native roles select each fresh ACP session and retain selection for continuations", async () => {
  const instance = bridge("role-ok").instance;
  await instance.start();
  const first = await instance.newSession();
  const chunks: string[] = [];
  await instance.prompt(first.sessionId, "exact task", (text) => chunks.push(text));
  for (const command of ["/switch-role task", " \n/compact", "/absolute/path"]) {
    await expect(
      instance.prompt(first.sessionId, command, (text) => chunks.push(text)),
    ).rejects.toThrow("slash commands");
  }
  await instance.prompt(first.sessionId, "follow up", (text) => chunks.push(text));
  const second = await instance.newSession();
  await instance.prompt(second.sessionId, "new task", (text) => chunks.push(text));
  expect(chunks).toEqual(["turn-1:", "exact task", "turn-2:", "follow up", "turn-3:", "new task"]);
  expect(first.sessionId).not.toBe(second.sessionId);
  await expect(instance.resumeSession("ses_existing")).rejects.toThrow("resume");
  await expect(instance.loadSession("ses_existing")).rejects.toThrow("resume");
});

test("native role selection is a validated startup snapshot, not a mutable request override", async () => {
  expect(() => bridge("role-ok", "")).toThrow("Native role");
  const owned = bridge("role-ok");
  owned.options.agent = "missing";
  await owned.instance.start();
  const session = await owned.instance.newSession();
  const chunks: string[] = [];
  await owned.instance.prompt(session.sessionId, "task", (text) => chunks.push(text));
  expect(chunks).toEqual(["turn-1:", "task"]);
});

test("native role readiness fails closed for missing catalogs, unknown roles, errors and fallback", async () => {
  for (const mode of ["normal", "role-error", "role-fallback"]) {
    const instance = bridge(mode).instance;
    await expect(instance.start()).rejects.toThrow(/Native role|session creation failed/);
    await expect(instance.newSession()).rejects.toThrow("unavailable");
    await instance.close();
  }
  const unknown = bridge("role-ok", "missing").instance;
  await expect(unknown.start()).rejects.toThrow("Native role");
  await expect(unknown.newSession()).rejects.toThrow("unavailable");
});

test("a later fresh session selection failure retires the bridge without a fallback task", async () => {
  const instance = bridge("role-new-session-failure").instance;
  await instance.start();
  await expect(instance.newSession()).rejects.toThrow("Native role");
  await expect(instance.prompt("session-2", "must not send", () => undefined)).rejects.toThrow(
    "unavailable",
  );
});

test("an owned ACP session reporting a changed role retires instead of accepting fallback output", async () => {
  const instance = bridge("role-drift").instance;
  await instance.start();
  const session = await instance.newSession();
  const chunks: string[] = [];
  await expect(
    instance.prompt(session.sessionId, "exact task", (text) => chunks.push(text)),
  ).rejects.toThrow("Native role");
  expect(chunks).toEqual([]);
  await expect(instance.newSession()).rejects.toThrow("unavailable");
});
