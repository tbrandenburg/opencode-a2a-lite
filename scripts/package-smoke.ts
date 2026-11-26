import assert from "node:assert/strict";
import { createServer } from "node:net";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
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
  // npm 12 keys the result by package name; earlier versions return an array.
  const pack = (Array.isArray(packs) ? packs[0] : Object.values(packs)[0]) as {
    filename: string;
    files: { path: string; mode: number }[];
  };
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
  assert.deepEqual(manifest.os, ["linux", "darwin"]);
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
  // npm 12 echoes the exec command line as a notice; keep stderr to the gateway's own output.
  const isolated = {
    ...env,
    PATH: bin,
    A2A_PORT: "invalid",
    A2A_WORKSPACE: "relative",
    npm_config_loglevel: "silent",
  };
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
  const invalidIdentity = { A2A_NAME: "private-identity\n", A2A_DESCRIPTION: "", A2A_TAGS: "," };
  const help = exec(["--help"], invalidIdentity);
  assert.equal(help.status, 0, "installed npm exec --help failed");
  assert.match(help.stdout, /Usage: opencode-a2a-lite/);
  assert.match(help.stdout, /A2A_NAME/);
  assert.equal(exec(["-h"]).status, 0);
  const installs = readdirSync(join(temp, "cache", "_npx"));
  assert.equal(installs.length, 1);
  const modules = join(temp, "cache", "_npx", installs[0]!, "node_modules");
  assert.equal(
    readdirSync(modules).some((name) => ["typescript", "oxlint", "oxfmt"].includes(name)),
    false,
  );
  for (const flag of ["--version", "-v"]) {
    const result = exec([flag], invalidIdentity);
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
      /PRIVATE_PEER_DIAGNOSTIC|unknown-private-input|private-identity|Error:|\n\s+at /,
    );
  };
  reject([], /A2A_WORKSPACE must be an absolute directory/, { A2A_WORKSPACE: "" });
  reject([], /A2A_WORKSPACE must be an absolute directory/);
  reject(["--unknown-private-input"], /Use --help/);
  reject(["--unknown-private-input", "--help"], /Use --help/);
  reject(
    ["--workspace", ".", "--port", "0", "--policy", "full-access"],
    /--policy was replaced by --access/,
  );
  reject(
    ["--workspace", ".", "--port", "0", "--dangerously-skip-permissions"],
    /--access danger-full-access is the acknowledgement/,
  );
  reject(
    ["--workspace", ".", "--port", "0", "--access", "danger-full-access", "--enable", "approve"],
    /nothing is left to approve/,
  );
  reject(["--workspace", ".", "--port", "0", "--access", "supervised"], /Use --help/);
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
  if (process.platform === "linux")
    reject(["--workspace", ".", "--port", "0"], /OpenCode is unavailable/);

  const built = await Bun.build({
    entrypoints: [join(root, "tests/fixtures/acp-peer.ts")],
    target: "bun",
    outdir: temp,
  });
  assert.equal(built.success, true);
  const record = join(temp, "peer.json");
  const environment = join(temp, "peer-env.jsonl");
  const probeMode = join(temp, "probe-mode");
  const peer = join(bin, "opencode");
  writeFileSync(
    peer,
    `#!${process.execPath}
import { appendFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";
const probeMode = existsSync(${JSON.stringify(probeMode)}) ? readFileSync(${JSON.stringify(probeMode)}, "utf8") : "";
console.error("PRIVATE_PEER_DIAGNOSTIC");
if (process.argv[2] === "--version" || process.argv[2] === "acp")
  appendFileSync(${JSON.stringify(environment)}, JSON.stringify({
    phase:process.argv[2],
    home:process.env.HOME,
    approved:process.env.FAKE_API_KEY === "approved-sentinel",
    clean:!process.env.UNRELATED_TOKEN && !process.env.OPENCODE_CONFIG_CONTENT && !process.env.HTTPS_PROXY
  }) + "\\n");
if (process.argv[2] === "debug" && process.argv[3] === "paths") {
  for (const name of ["home", "data", "cache", "config", "state", "tmp", "db"])
    console.log(name + " " + process.env.HOME + "/" + name);
  process.exit(0);
}
if (process.argv[2] === "--standalone" && process.argv[3] === "debug" && process.argv[4] === "config") {
  const file = process.env.HOME + "/.config/opencode/opencode.json";
  const document = existsSync(file) ? [{type:"document",path:file,info:JSON.parse(readFileSync(file, "utf8"))}] : [];
  console.log(JSON.stringify(probeMode === "bad-config"
    ? [{type:"remote",path:"https://example.invalid"}]
    : [...document,{type:"directory",path:process.env.HOME}]));
  process.exit(0);
}
if (process.argv[2] === "--standalone" && process.argv[3] === "debug" && process.argv[4] === "agents") {
  const file = process.env.HOME + "/.config/opencode/opencode.json";
  const rules = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).permissions : [];
  console.log(JSON.stringify([{id:"build",permissions:[{action:"*",resource:"*",effect:"allow"},...rules]}]));
  process.exit(0);
}
if (process.argv[2] !== "--version") {
  writeFileSync(${JSON.stringify(record)}, JSON.stringify({pid:process.pid,parent:process.ppid,cwd:process.cwd()}));
}
process.argv = [process.argv[0], process.argv[1], probeMode || process.env.PEER_MODE || "normal", ...process.argv.slice(2)];
await import(${JSON.stringify(join(temp, "acp-peer.js"))});
`,
  );
  chmodSync(peer, 0o755);
  for (const metadata of [invalidIdentity, { A2A_TAGS: "text,,review" }]) {
    reject(["--workspace", ".", "--port", "0"], /Invalid worker identity/, metadata);
    assert.equal(existsSync(record), false, "invalid identity must not start ACP");
  }
  assert.equal(existsSync(record), false, "rejected policy flags must not start ACP");
  const direct = join(modules, manifest.name, "dist/src/server.js");
  const invalidDirect = run([process.execPath, direct], consumer, {
    ...isolated,
    A2A_WORKSPACE: consumer,
    A2A_PORT: "0",
    ...invalidIdentity,
  });
  assert.equal(invalidDirect.status, 1);
  assert.equal(invalidDirect.stdout, "");
  assert.match(invalidDirect.stderr, /Invalid worker identity/);
  assert.doesNotMatch(invalidDirect.stderr, /private-identity|Error:|\n\s+at /);
  assert.equal(existsSync(record), false);
  if (process.platform === "darwin") {
    const runtimeParent = realpathSync("/tmp");
    const roots = () =>
      new Set(
        readdirSync(runtimeParent).filter((name) => name.startsWith("opencode-a2a-runtime-")),
      );
    const before = roots();
    reject(
      ["--workspace", ".", "--port", "0"],
      /CLI private runtime is Linux-only for now; library callers can supply acp\.env/,
    );
    assert.deepEqual(
      [...roots()].filter((name) => !before.has(name)),
      [],
    );
    assert.equal(existsSync(record), false, "unsupported platform must not start ACP");
  }
  if (process.platform === "linux") {
    writeFileSync(probeMode, "executable-version");
    reject(["--workspace", ".", "--port", "0"], /stable opencode v2.2.7 or newer/);
    const versionSnapshot = JSON.parse(
      readFileSync(environment, "utf8").trim().split("\n").at(-1)!,
    );
    assert.equal(existsSync(versionSnapshot.home), false, "version failure must clean runtime");
    writeFileSync(probeMode, "bad-config");
    reject(["--workspace", ".", "--port", "0"], /Private runtime preflight failed/);
    rmSync(probeMode);
    const preflightSnapshot = JSON.parse(
      readFileSync(environment, "utf8").trim().split("\n").at(-1)!,
    );
    assert.equal(existsSync(preflightSnapshot.home), false, "preflight failure must clean runtime");
    reject(
      ["--workspace", ".", "--port", "0", "--pass-env", "PEER_MODE"],
      /Gateway startup failed/,
      {
        PEER_MODE: "startup-exit",
      },
    );
    assert.equal(alive(peerRecord(record)!.pid), false);

    const occupied = createServer();
    await new Promise<void>((done) => occupied.listen(0, "127.0.0.1", done));
    try {
      const address = occupied.address();
      assert.ok(address && typeof address !== "string");
      reject(["--workspace", ".", "--port", String(address.port)], /port is in use/i);
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
        args: ["--workspace", ".", "--port", "0", "--pass-env", "FAKE_API_KEY"],
        env: {
          ...isolated,
          FAKE_API_KEY: "approved-sentinel",
          UNRELATED_TOKEN: "hidden-sentinel",
          OPENCODE_CONFIG_CONTENT: "hidden-sentinel",
          HTTPS_PROXY: "hidden-sentinel",
        },
        port: undefined,
      },
      {
        termination: "SIGTERM",
        args: [],
        env: {
          ...isolated,
          A2A_WORKSPACE: consumer,
          A2A_PORT: "0",
          A2A_NAME: " planner ",
          A2A_DESCRIPTION: " Plans work ",
          A2A_TAGS: "planning,text,planning",
        },
        port: undefined,
      },
      {
        termination: "SIGTERM",
        args: ["--workspace", consumer, "--port", "0"],
        env: { ...isolated, A2A_PORT: undefined },
        port: undefined,
      },
      {
        termination: "SIGTERM",
        args: [],
        env: {
          ...isolated,
          A2A_WORKSPACE: consumer,
          A2A_PORT: "0",
          A2A_NAME: " reviewer ",
          A2A_TAGS: "review,text,review",
        },
        port: undefined,
        entry: join(modules, manifest.name, "dist/src/server.js"),
      },
    ] as const;
    for (const scenario of scenarios) {
      const metadata: NodeJS.ProcessEnv = scenario.env;
      const probe = createServer();
      await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
      await new Promise<void>((done, fail) =>
        probe.close((error) => (error ? fail(error) : done())),
      );
      rmSync(record, { force: true });
      rmSync(environment, { force: true });
      const invocation =
        "entry" in scenario ? [process.execPath, scenario.entry] : [...command, ...scenario.args];
      const child = launch(invocation, consumer, scenario.env);
      let privateHome: string | undefined;
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
        assert.equal(card.name, metadata.A2A_NAME?.trim() ?? "OpenCode A2A Lite");
        assert.equal(
          card.description,
          metadata.A2A_DESCRIPTION?.trim() ??
            "OpenCode ACP gateway for contextual plain text prompts and streamed responses.",
        );
        assert.deepEqual(
          card.skills[0].tags,
          "entry" in scenario
            ? ["text", "review"]
            : metadata.A2A_NAME
              ? ["text", "planning"]
              : ["text"],
        );
        assert.equal(card.supportedInterfaces[0].url, ready.url);
        const owned = peerRecord(record)!;
        if (scenario.termination === "SIGINT") {
          const snapshots = readFileSync(environment, "utf8")
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
          assert.deepEqual(
            snapshots.map((snapshot) => snapshot.phase),
            ["--version", "--version", "acp"],
          );
          assert.deepEqual(
            snapshots.map((snapshot) => snapshot.approved),
            [false, false, true],
          );
          assert(snapshots.every((snapshot) => snapshot.clean));
          assert.equal(new Set(snapshots.map((snapshot) => snapshot.home)).size, 1);
          privateHome = snapshots[0].home;
        }
        assert.equal(owned.cwd, realpathSync(consumer));
        // Signal the installed gateway, not npm's wrapper; OpenCode has its own group.
        process.kill(owned.parent, scenario.termination);
        await until(
          () => (!alive(owned.pid) && !alive(owned.parent) ? true : undefined),
          "owned-process shutdown",
        );
        assert.equal(await child.exited, 0);
        if (privateHome) assert.equal(existsSync(privateHome), false);
        await assert.rejects(fetch(ready.url, { signal: AbortSignal.timeout(2_000) }));
        const status = child.output.stderr.replace(/(?:\r?\n)+$/, "").split("\n");
        const summary = status.splice(0, 5);
        assert(summary.every((line) => line.startsWith("  policy ")));
        assert.match(summary.join("\n"), /read-only[\s\S]*shell: denied[\s\S]*OS isolation: none/);
        assert.match(
          status.shift() ?? "",
          /^ {2}env +(passing FAKE_API_KEY to OpenCode \(names only\)|no provider variables passed to OpenCode)$/,
        );
        assert.equal(status[0], `  ready      gateway · ${ready.url}`);
        assert.match(status[1]!, /^  workspace  \//);
        assert.ok(status[1]!.endsWith("consumer workspace"));
        assert.equal(
          status[2],
          "  trust      workspace instructions are trusted; the policy limits tools but this is not a sandbox",
        );
        assert.equal(
          status[3],
          `  agent card ${new URL(".well-known/agent-card.json", ready.url).href}`,
        );
        assert.equal(
          status[4],
          `  connect    a2a send -a ${ready.url} "Reply with a short greeting." --stream`,
        );
        assert.equal(status[5], "  stop       press Ctrl-C to stop the gateway");
        assert.equal(
          status[6],
          "  stopping   gateway · draining active work and closing the listener",
        );
        assert.equal(
          status[7],
          "  stopped    gateway · listener closed and OpenCode process released",
        );
        assert.equal(status.length, 8);
        assert.equal(status.join("\n").includes("\u001b["), false);
      } finally {
        const owned = peerRecord(record);
        if (owned && alive(owned.parent)) process.kill(owned.parent, "SIGTERM");
        signal(child.child, "SIGTERM");
        if (owned) await until(() => (!alive(owned.pid) ? true : undefined), "peer cleanup");
      }
    }
  }
  assert.deepEqual(readdirSync(consumer), []);
  console.log(
    process.platform === "linux"
      ? `Package smoke passed: ${pack.files.length} allowlisted files; installed npm exec CLI and direct server, failures, card readiness, SIGINT/SIGTERM and owned-process cleanup.`
      : `Package smoke passed: ${pack.files.length} allowlisted files; installed CLI validation and unsupported private runtime, direct server validation.`,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
