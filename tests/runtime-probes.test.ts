import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createRuntimeEnvironment } from "../src/runtime-environment.js";
import { verifyRuntime } from "../src/runtime-probes.js";

test("an interrupted preflight kills its owned process before returning", async () => {
  const workspace = mkdtempSync(join(realpathSync("/tmp"), "runtime-probe-test-"));
  const runtime = createRuntimeEnvironment([], { PATH: "/usr/bin:/bin" });
  const executable = join(workspace, "opencode");
  writeFileSync(executable, '#!/bin/sh\nprintf "%s" "$$" > "$HOME/pid"\nexec /bin/sleep 30\n', {
    mode: 0o700,
  });
  const controller = new AbortController();
  try {
    if (process.platform !== "linux" || existsSync("/etc/opencode")) {
      await expect(
        verifyRuntime({
          executable,
          cwd: workspace,
          env: runtime.env,
          root: runtime.root,
          signal: controller.signal,
        }),
      ).rejects.toThrow();
      expect(existsSync(join(runtime.env.HOME!, "pid"))).toBe(false);
      return;
    }
    const operation = verifyRuntime({
      executable,
      cwd: workspace,
      env: runtime.env,
      root: runtime.root,
      signal: controller.signal,
    });
    const file = join(runtime.env.HOME!, "pid");
    const deadline = Date.now() + 5_000;
    while (!existsSync(file) && Date.now() < deadline) await Bun.sleep(10);
    expect(existsSync(file)).toBe(true);
    const pid = Number(readFileSync(file, "utf8"));
    controller.abort();
    await expect(operation).rejects.toThrow();
    expect(() => process.kill(pid, 0)).toThrow();
  } finally {
    runtime.remove();
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("ancestor configuration fails before launching an executable", async () => {
  const parent = mkdtempSync(join(realpathSync("/tmp"), "runtime-ancestor-test-"));
  const workspace = join(parent, "workspace");
  mkdirSync(workspace);
  writeFileSync(join(parent, "opencode.json"), "{}");
  const runtime = createRuntimeEnvironment([], { PATH: "/usr/bin:/bin" });
  try {
    await expect(
      verifyRuntime({
        executable: "/does-not-exist",
        cwd: workspace,
        env: runtime.env,
        root: runtime.root,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("Private runtime preflight failed");
    expect(existsSync(join(runtime.env.HOME!, ".config"))).toBe(false);
  } finally {
    runtime.remove();
    rmSync(parent, { recursive: true, force: true });
  }
});
