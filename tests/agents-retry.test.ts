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
function fake(weakCalls: number) {
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
  *--version*) echo "opencode v2.3.2" ;;
  *"debug paths"*) cat "$d/paths.txt" ;;
  *"debug config"*) cat "$d/config.json" ;;
  *"debug agents"*)
    n=$(cat "$d/count" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$d/count"
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
      signal: new AbortController().signal,
    });
  const calls = () => Number(readFileSync(join(dir, "count"), "utf8"));
  return { verify, calls, done: () => runtime.remove() };
}

linux("a transiently weakened debug agents answer is retried and noted", async () => {
  const note = spyOn(console, "error").mockImplementation(() => undefined);
  const probe = fake(1);
  try {
    await probe.verify();
    expect(probe.calls()).toBe(2);
    expect(note).toHaveBeenCalledWith(expect.stringMatching(/passed on attempt 2 of 3/));
  } finally {
    note.mockRestore();
    probe.done();
  }
});

linux("a permanently weakened answer fails closed after exactly three attempts", async () => {
  const probe = fake(99);
  try {
    await expect(probe.verify()).rejects.toThrow(/capability policy was dropped/);
    expect(probe.calls()).toBe(3);
  } finally {
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
