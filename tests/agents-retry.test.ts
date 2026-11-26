import { afterAll, expect, spyOn, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntimeEnvironment } from "../src/runtime-environment.js";
import { policyConfig } from "../src/runtime-policy.js";
import { verifyRuntime } from "../src/runtime-probes.js";

const linux = process.platform === "linux" ? test : test.skip;
const base = realpathSync(mkdtempSync(join(tmpdir(), "agents-retry-")));
afterAll(() => rmSync(base, { recursive: true, force: true }));

// Fake `opencode`: valid preflight documents, but `debug agents` answers with the first N
// counted calls weakened (no private config applied), then correctly.
const fast = { deadlineMs: 5_000, maxAttempts: 10, delayMs: 1 };

function fake(weakCalls: number, agentRetry = fast, signal = new AbortController().signal) {
  const dir = mkdtempSync(join(base, "fx-"));
  const runtime = createRuntimeEnvironment([], process.env, "read-only");
  const workspace = join(dir, "ws");
  mkdirSync(workspace);
  const root = realpathSync(runtime.root);
  const config = [
    {
      type: "document",
      path: join(root, "home", ".config", "opencode", "opencode.json"),
      info: policyConfig("read-only"),
    },
    { type: "directory", path: join(root, "home", ".config", "opencode") },
  ];
  const rules = [
    ...policyConfig("read-only").permissions,
    { action: "execute", resource: "*", effect: "deny" },
    { action: "external_directory", resource: "*", effect: "deny" },
  ];
  const paths = ["home", "data", "cache", "config", "state", "tmp", "db"]
    .map((name) => `${name} ${join(root, name === "db" ? "data/db" : name)}`)
    .join("\n");
  writeFileSync(join(dir, "config.json"), JSON.stringify(config));
  writeFileSync(join(dir, "good.json"), JSON.stringify([{ name: "build", permissions: rules }]));
  writeFileSync(join(dir, "weak.json"), JSON.stringify([{ name: "build", permissions: [] }]));
  writeFileSync(join(dir, "paths.txt"), paths);
  const executable = join(dir, "opencode");
  writeFileSync(
    executable,
    `#!/bin/sh
d="${dir}"
case "$*" in
  *--version*) echo "opencode v2.4.1" ;;
  *"debug paths"*) cat "$d/paths.txt" ;;
  *"debug config"*) cat "$d/config.json" ;;
  *"debug agents"*)
    echo "$*" >> "$d/argv"
    n=$(cat "$d/count" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$d/count"
    if [ ${weakCalls} -lt 0 ]; then exit 1; fi
    if [ $n -le ${weakCalls} ]; then cat "$d/weak.json"; else cat "$d/good.json"; fi ;;
  *) exit 1 ;;
esac
`,
    { mode: 0o700 },
  );
  chmodSync(executable, 0o700);
  const verify = () =>
    verifyRuntime({
      executable,
      cwd: workspace,
      env: runtime.env,
      root: runtime.root,
      policy: "read-only",
      signal,
      agentRetry,
    });
  const calls = () => Number(readFileSync(join(dir, "count"), "utf8"));
  const argv = () => readFileSync(join(dir, "argv"), "utf8").trim().split("\n");
  return { verify, calls, argv, done: () => runtime.remove() };
}

linux("a transiently weakened answer passes after several failures within the budget", async () => {
  const note = spyOn(console, "error").mockImplementation(() => undefined);
  const probe = fake(4);
  try {
    await probe.verify();
    expect(probe.calls()).toBe(5);
    expect(probe.argv().every((line) => line === "--standalone debug agents")).toBe(true);
    expect(note).toHaveBeenCalledWith(expect.stringMatching(/passed on attempt 5$/));
  } finally {
    note.mockRestore();
    probe.done();
  }
});

linux("a permanently weakened answer fails closed and reports the attempt count", async () => {
  const note = spyOn(console, "error").mockImplementation(() => undefined);
  const probe = fake(99, { ...fast, maxAttempts: 4 });
  try {
    await expect(probe.verify()).rejects.toThrow(/capability policy was dropped/);
    expect(probe.calls()).toBe(4);
    expect(note).toHaveBeenCalledWith(
      expect.stringMatching(/known to be intermittent.*4 attempt\(s\).*none reported/),
    );
  } finally {
    note.mockRestore();
    probe.done();
  }
});

linux("the deadline stops retrying before the attempt cap", async () => {
  const note = spyOn(console, "error").mockImplementation(() => undefined);
  const probe = fake(99, { deadlineMs: 30, maxAttempts: 1000, delayMs: 10 });
  try {
    await expect(probe.verify()).rejects.toThrow(/capability policy was dropped/);
    expect(probe.calls()).toBeGreaterThan(1);
    expect(probe.calls()).toBeLessThan(1000);
    expect(probe.calls()).toBeLessThan(50);
    expect(note).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`known to be intermittent.*${probe.calls()} attempt\\(s\\)`),
      ),
    );
  } finally {
    note.mockRestore();
    probe.done();
  }
});

linux("aborting during the retry backoff stops the probe with a runtime error", async () => {
  const note = spyOn(console, "error").mockImplementation(() => undefined);
  const abort = new AbortController();
  const probe = fake(99, { deadlineMs: 60_000, maxAttempts: 10, delayMs: 60_000 }, abort.signal);
  try {
    const result = probe.verify();
    setTimeout(() => abort.abort(), 500);
    await expect(result).rejects.toThrow(/Private runtime preflight failed; review/);
    expect(probe.calls()).toBe(1);
  } finally {
    note.mockRestore();
    probe.done();
  }
});

linux("a non-policy probe failure is not retried", async () => {
  const note = spyOn(console, "error").mockImplementation(() => undefined);
  const probe = fake(-1);
  try {
    await expect(probe.verify()).rejects.toThrow(/Private runtime preflight failed; review/);
    expect(probe.calls()).toBe(1);
    expect(note).not.toHaveBeenCalled();
  } finally {
    note.mockRestore();
    probe.done();
  }
});

linux("a correct answer needs one attempt and prints no note", async () => {
  const note = spyOn(console, "error").mockImplementation(() => undefined);
  const probe = fake(0);
  try {
    await probe.verify();
    expect(probe.calls()).toBe(1);
    expect(note).not.toHaveBeenCalled();
  } finally {
    note.mockRestore();
    probe.done();
  }
});
