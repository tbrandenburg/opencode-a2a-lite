import assert from "node:assert/strict";
import { createServer } from "node:net";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import manifest from "../package.json" with { type: "json" };
import { alive, launch, peerRecord, run, signal, until } from "./package-smoke-support.js";

const root = resolve(import.meta.dir, "..");
const temp = mkdtempSync(join(tmpdir(), "a2a-package-"));
const consumer = join(temp, "consumer workspace");
const bin = join(temp, "bin");
mkdirSync(consumer);
mkdirSync(bin);
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: temp,
  NPM_CONFIG_CACHE: join(temp, "cache"),
  NPM_CONFIG_USERCONFIG: join(temp, "npm-user-config"),
  NPM_CONFIG_GLOBALCONFIG: join(temp, "npm-global-config"),
  NPM_CONFIG_FETCH_RETRIES: "0",
  NPM_CONFIG_FETCH_TIMEOUT: "30000",
};
try {
  // npm pack must rebuild missing JS and remove obsolete generated runtime files.
  const cli = join(root, manifest.bin["opencode-a2a-lite"]);
  const obsolete = join(root, "dist/src/obsolete-debug.js");
  mkdirSync(join(root, "dist/src"), { recursive: true });
  rmSync(cli, { force: true });
  writeFileSync(obsolete, "throw new Error('obsolete generated runtime');\n", { flag: "wx" });
  const packed = run(["npm", "pack", "--json", "--pack-destination", temp], root, env, 120_000);
  assert.equal(packed.status, 0, `npm pack failed: ${packed.stderr}`);
  assert.equal(existsSync(obsolete), false, "prepack must remove obsolete generated runtime");
  const packs = JSON.parse(packed.stdout);
  const pack = packs[0] as { filename: string; files: { path: string; mode: number }[] };
  assert.equal(
    pack.files.some((file) => file.path === "dist/src/obsolete-debug.js"),
    false,
  );
  const runtime = readdirSync(join(root, "src"))
    .filter((path) => path.endsWith(".ts"))
    .map((path) => `dist/src/${path.slice(0, -3)}.js`);
  assert.deepEqual(
    pack.files.map((file) => file.path).sort(),
    [...runtime, "dist/package.json", "package.json", "README.md", "LICENSE"].sort(),
  );
  assert.equal(Object.keys(manifest.bin).length, 1);
  assert.ok(
    pack.files.find((file) => file.path === manifest.bin["opencode-a2a-lite"])!.mode & 0o111,
  );
  assert.ok(readFileSync(cli, "utf8").startsWith("#!/usr/bin/env bun\n"));
  const tarball = join(temp, pack.filename);
  const npm = Bun.which("npm");
  const node = Bun.which("node");
  assert.ok(npm && node);
  symlinkSync(npm, join(bin, "npm"));
  symlinkSync(node, join(bin, "node"));
  symlinkSync(process.execPath, join(bin, "bun"));
  symlinkSync("/bin/sh", join(bin, "sh"));
  const isolated = { ...env, PATH: bin, A2A_PORT: "invalid", A2A_WORKSPACE: "relative" };
  const command = [
    join(bin, "npm"),
    "exec",
    "--yes",
    `--package=${tarball}`,
    "--",
    "opencode-a2a-lite",
  ];
  const exec = (args: string[], overrides: NodeJS.ProcessEnv = {}) =>
    run([...command, ...args], consumer, { ...isolated, ...overrides }, 120_000);
  const help = exec(["--help"]);
  assert.equal(help.status, 0, "installed npm exec --help failed");
  assert.match(help.stdout, /Usage: opencode-a2a-lite/);
  assert.equal(exec(["-h"]).status, 0);
  const installs = readdirSync(join(temp, "cache", "_npx"));
  assert.equal(installs.length, 1);
  const modules = join(temp, "cache", "_npx", installs[0]!, "node_modules");
  assert.equal(
    readdirSync(modules).some((name) => ["typescript", "oxlint", "oxfmt"].includes(name)),
    false,
  );
  for (const flag of ["--version", "-v"]) {
    const result = exec([flag]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), manifest.version);
  }
  const reject = (args: string[], phrase: RegExp, overrides: NodeJS.ProcessEnv = {}) => {
    const result = exec(args, overrides);
    assert.equal(result.status, 1, `expected clean failure: ${args[0] ?? "environment"}`);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, phrase);
    assert.doesNotMatch(
      result.stderr,
      /PRIVATE_PEER_DIAGNOSTIC|unknown-private-input|Error:|\n\s+at /,
    );
  };
  reject([], /trusted absolute workspace/, { A2A_WORKSPACE: "" });
  reject([], /trusted absolute workspace/);
  reject(["--unknown-private-input"], /Use --help/);
  reject(["--unknown-private-input", "--help"], /Use --help/);
  reject(["--workspace", "--version"], /Use --help/);
  reject(["--workspace"], /Use --help/);
  reject(["--workspace", ".", "--port"], /Use --help/);
  for (const port of ["", " ", "-1", "1.5", "65536", "1e3", "0x10", "Infinity"]) {
    reject(["--workspace", "."], /Invalid port/, { A2A_PORT: port });
  }
  reject(["--workspace", ".", "--port", "65536"], /Invalid port/);
  reject(["--workspace", ".", "--port", "-1"], /Invalid port/);
  reject(["--workspace", "missing", "--port", "0"], /existing directory/);
  reject(["--workspace", tarball, "--port", "0"], /existing directory/);
  reject(["--workspace", ".", "--port", "0"], /OpenCode is unavailable/);

  const built = await Bun.build({
    entrypoints: [join(root, "tests/fixtures/acp-peer.ts")],
    target: "bun",
    outdir: temp,
  });
  assert.equal(built.success, true);
  const record = join(temp, "peer.json");
  const peer = join(bin, "opencode");
  writeFileSync(
    peer,
    `#!${process.execPath}
import { writeFileSync } from "node:fs";
console.error("PRIVATE_PEER_DIAGNOSTIC");
if (process.argv[2] !== "--version") {
  writeFileSync(${JSON.stringify(record)}, JSON.stringify({pid:process.pid,parent:process.ppid,cwd:process.cwd()}));
}
process.argv = [process.argv[0], process.argv[1], process.env.PEER_MODE ?? "normal", ...process.argv.slice(2)];
await import(${JSON.stringify(join(temp, "acp-peer.js"))});
`,
  );
  chmodSync(peer, 0o755);
  reject(["--workspace", ".", "--port", "0"], /exactly opencode v2.0.28/, {
    PEER_MODE: "executable-version",
  });
  reject(["--workspace", ".", "--port", "0"], /Gateway startup failed/, {
    PEER_MODE: "startup-exit",
  });
  assert.equal(alive(peerRecord(record)!.pid), false);

  const occupied = createServer();
  await new Promise<void>((done) => occupied.listen(0, "127.0.0.1", done));
  try {
    const address = occupied.address();
    assert.ok(address && typeof address !== "string");
    reject(["--workspace", ".", "--port", String(address.port)], /port is in use/);
    assert.equal(occupied.listening, true);
    assert.equal(alive(peerRecord(record)!.pid), false);
  } finally {
    await new Promise<void>((done, fail) =>
      occupied.close((error) => (error ? fail(error) : done())),
    );
  }

  const scenarios = [
    {
      termination: "SIGINT",
      args: ["--workspace", ".", "--port", "0"],
      env: isolated,
      port: undefined,
    },
    {
      termination: "SIGTERM",
      args: [],
      env: { ...isolated, A2A_WORKSPACE: consumer, A2A_PORT: "0" },
      port: undefined,
    },
    {
      termination: "SIGTERM",
      args: ["--workspace", consumer],
      env: { ...isolated, A2A_PORT: undefined },
      port: "41241",
    },
    {
      termination: "SIGTERM",
      args: [],
      env: { ...isolated, A2A_WORKSPACE: consumer, A2A_PORT: "0" },
      port: undefined,
      entry: join(modules, manifest.name, "dist/src/server.js"),
    },
  ] as const;
  for (const scenario of scenarios) {
    rmSync(record, { force: true });
    const invocation =
      "entry" in scenario ? [process.execPath, scenario.entry] : [...command, ...scenario.args];
    const child = launch(invocation, consumer, scenario.env);
    try {
      const ready = await until(() => {
        const line = child.output.stdout.trim();
        return line ? (JSON.parse(line) as { ready: boolean; url: string }) : undefined;
      }, "installed gateway readiness");
      assert.equal(ready.ready, true);
      assert.match(ready.url, /^http:\/\/127\.0\.0\.1:[1-9]\d*\/$/);
      if (scenario.port) assert.equal(new URL(ready.url).port, scenario.port);
      const response = await fetch(new URL(".well-known/agent-card.json", ready.url), {
        signal: AbortSignal.timeout(5_000),
      });
      assert.equal(response.status, 200);
      const card = await response.json();
      assert.equal(card.version, manifest.version);
      assert.equal(card.supportedInterfaces[0].url, ready.url);
      const owned = peerRecord(record)!;
      assert.equal(owned.cwd, consumer);
      // Signal the installed gateway, not npm's wrapper; OpenCode has its own group.
      process.kill(owned.parent, scenario.termination);
      await until(
        () => (!alive(owned.pid) && !alive(owned.parent) ? true : undefined),
        "owned-process shutdown",
      );
      assert.equal(await child.exited, 0);
      await assert.rejects(fetch(ready.url, { signal: AbortSignal.timeout(2_000) }));
      assert.equal(child.output.stderr, "");
    } finally {
      const owned = peerRecord(record);
      if (owned && alive(owned.parent)) process.kill(owned.parent, "SIGTERM");
      signal(child.child, "SIGTERM");
      if (owned) await until(() => (!alive(owned.pid) ? true : undefined), "peer cleanup");
    }
  }
  assert.deepEqual(readdirSync(consumer), []);
  console.log(
    `Package smoke passed: ${pack.files.length} allowlisted files; installed npm exec CLI and direct server, failures, card readiness, SIGINT/SIGTERM and owned-process cleanup.`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
