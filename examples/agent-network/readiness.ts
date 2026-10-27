import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tools, record, type Profile } from "./profiles.js";

export const expectedTools = tools.map((tool) => `network_${tool}`).sort();
export function auditPath(profile: Profile, kind: string, run: string) {
  return join(
    profile.cwd,
    "network-audit",
    `${kind}-${run}.${kind === "snapshots" ? "jsonl" : "json"}`,
  );
}

export function registered(profile: Profile, run: string) {
  assert(!existsSync(auditPath(profile, "failure", run)), "Runtime readiness observer failed");
  const file = auditPath(profile, "ready", run);
  if (!existsSync(file)) return undefined;
  const ready = record(JSON.parse(readFileSync(file, "utf8")));
  assert.equal(ready.run, run);
  assert.deepEqual(ready.tools, expectedTools);
  return ready;
}

export function snapshots(profile: Profile, run: string, session: string) {
  assert(!existsSync(auditPath(profile, "failure", run)), "Actual request tool set mismatch");
  const file = auditPath(profile, "snapshots", run);
  assert(existsSync(file), "Missing actual request tool snapshot");
  const values = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => record(JSON.parse(line)));
  assert(values.length > 0);
  for (const value of values) {
    assert.equal(value.run, run);
    assert.equal(value.session, session);
    assert.equal(value.matched, true);
    assert.deepEqual(value.tools, expectedTools);
  }
  return values;
}

export function auditEvidence(profile: Profile) {
  const directory = join(profile.cwd, "network-audit");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => /^(ready|snapshots|failure)-[0-9a-f-]+\.jsonl?$/.test(name))
    .flatMap((name) =>
      readFileSync(join(directory, name), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => record(JSON.parse(line))),
    );
}
