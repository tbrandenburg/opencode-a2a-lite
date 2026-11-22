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
import { createServer } from "node:net";
import { createRuntimeEnvironment } from "../src/runtime-environment.js";
import { verifyRuntime } from "../src/runtime-probes.js";
import { launchGateway } from "../src/server.js";

test("launchGateway preflights the caller-selected executable without an explicit env", async () => {
  const workspace = mkdtempSync(join(realpathSync("/tmp"), "runtime-selected-test-"));
  const executable = join(workspace, "selected");
  const marker = join(workspace, "selected-ran");
  writeFileSync(executable, '#!/bin/sh\nprintf "%s" "$HOME" > selected-ran\nprintf "1.0.0\\n"\n', {
    mode: 0o700,
  });
  try {
    if (process.platform !== "linux" || existsSync("/etc/opencode")) return;
    await expect(launchGateway({ workspace, acp: { executable } })).rejects.toThrow();
    const home = readFileSync(marker, "utf8");
    expect(home.endsWith("/home")).toBe(true);
    expect(existsSync(executable)).toBe(true);
    // This fixture is a shell with no descendants; its owned root is safe to remove.
    rmSync(join(home, ".."), { recursive: true });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("unconfirmed detached descendant retains the private runtime", async () => {
  if (process.platform !== "linux" || existsSync("/etc/opencode")) return;
  const workspace = mkdtempSync(join(realpathSync("/tmp"), "runtime-detached-test-"));
  const executable = join(workspace, "selected");
  const marker = join(workspace, "detached");
  const program =
    'const fs=require("node:fs");const net=require("node:net");' +
    'const file=fs.openSync(process.env.HOME+"/held","w");' +
    'net.createServer().listen(0,"127.0.0.1",()=>fs.writeFileSync("detached",process.env.HOME+"\\n"+process.pid+"\\n"+file));';
  writeFileSync(
    executable,
    `#!/bin/sh\nsetsid "${process.execPath}" -e '${program}' </dev/null >/dev/null 2>&1 &\nwhile [ ! -f detached ]; do sleep 0.02; done\nprintf '1.0.0\\n'\n`,
    { mode: 0o700 },
  );
  let pid = 0;
  let root = "";
  const unrelated = createServer();
  await new Promise<void>((resolve) => unrelated.listen(0, "127.0.0.1", resolve));
  try {
    await expect(launchGateway({ workspace, acp: { executable } })).rejects.toThrow(
      "Unsupported OpenCode version",
    );
    const [home, child] = readFileSync(marker, "utf8").split("\n");
    root = join(home!, "..");
    pid = Number(child);
    expect(existsSync(join(home!, "held"))).toBe(true);
    expect(() => process.kill(pid, 0)).not.toThrow();
    expect(unrelated.listening).toBe(true);
  } finally {
    if (!pid && existsSync(marker)) {
      const [home, child] = readFileSync(marker, "utf8").split("\n");
      root = join(home!, "..");
      pid = Number(child);
    }
    if (pid > 0) {
      process.kill(pid, "SIGKILL");
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const stat = await Bun.file(`/proc/${pid}/stat`)
          .text()
          .catch(() => "");
        if (!stat || stat.split(" ")[2] === "Z") break;
        await Bun.sleep(10);
      }
    }
    if (root) rmSync(root, { recursive: true });
    await new Promise<void>((resolve, reject) =>
      unrelated.close((error) => (error ? reject(error) : resolve())),
    );
    rmSync(workspace, { recursive: true, force: true });
  }
});

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
