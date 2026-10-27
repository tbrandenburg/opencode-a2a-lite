import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditPath, registered, snapshots } from "../../examples/agent-network/readiness.js";

const roots: string[] = [];
const run = "11111111-1111-4111-8111-111111111111";
const names = [
  "network_a2a_cancel_task",
  "network_a2a_get_task",
  "network_a2a_list_agents",
  "network_a2a_send_message",
  "network_a2a_send_streaming",
  "network_a2a_whoami",
];
function fixture() {
  const root = mkdtempSync("/tmp/opencode/network-readiness-");
  roots.push(root);
  mkdirSync(join(root, "network-audit"));
  return { root, cwd: root, executable: process.execPath, env: {} };
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

test("registration requires the actual run and exact registered names", () => {
  const profile = fixture();
  expect(registered(profile, run)).toBeUndefined();
  const path = auditPath(profile, "ready", run);
  writeFileSync(path, JSON.stringify({ run, tools: names }));
  expect(registered(profile, run)?.tools).toEqual(names);
  writeFileSync(path, JSON.stringify({ run: "other-run", tools: names }));
  expect(() => registered(profile, run)).toThrow();
  writeFileSync(path, JSON.stringify({ run, tools: names.slice(1) }));
  expect(() => registered(profile, run)).toThrow();
});

test("observer failure blocks readiness and actual-snapshot acceptance", () => {
  const profile = fixture();
  writeFileSync(auditPath(profile, "failure", run), JSON.stringify({ run, reason: "fixture" }));
  expect(() => registered(profile, run)).toThrow("Runtime readiness observer failed");
  expect(() => snapshots(profile, run, "session")).toThrow("Actual request tool set mismatch");
});

test("actual snapshots must match the coordinator session and permission-filtered tool set", () => {
  const profile = fixture();
  const path = auditPath(profile, "snapshots", run);
  const entry = { run, session: "session", matched: true, tools: names };
  writeFileSync(path, JSON.stringify(entry) + "\n");
  expect(snapshots(profile, run, "session")).toEqual([entry]);
  expect(() => snapshots(profile, run, "another-session")).toThrow();
  writeFileSync(path, JSON.stringify({ ...entry, matched: false }) + "\n");
  expect(() => snapshots(profile, run, "session")).toThrow();
  writeFileSync(path, JSON.stringify({ ...entry, tools: [...names, "shell"] }) + "\n");
  expect(() => snapshots(profile, run, "session")).toThrow();
});
