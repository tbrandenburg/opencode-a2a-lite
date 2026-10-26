import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";

export async function cleanup(root: string) {
  // The private server may outlive its ACP lease holder briefly while shutting down.
  for (let attempt = 0; attempt < 100; attempt++) {
    const active = readdirSync("/proc").some((pid) => {
      if (!/^\d+$/.test(pid)) return false;
      try {
        const cwd = readlinkSync(`/proc/${pid}/cwd`);
        return cwd === root || cwd.startsWith(root + path.sep);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          ["ENOENT", "EACCES", "ESRCH"].includes(String(error.code))
        )
          return false;
        throw error;
      }
    });
    if (!active) {
      rmSync(root, { recursive: true, force: true });
      assert(!existsSync(root), "Temporary workspace cleanup failed");
      console.log(JSON.stringify({ cleanup: true, processesStopped: true }));
      return;
    }
    await setTimeout(50);
  }
  throw new Error("Owned workspace processes did not stop before cleanup");
}

// Pinned source: packages/util/src/global-roots.ts and core/src/config/discovery.ts
// at anomalyco/opencode v2.0.28. HOME also isolates .agents and .claude discovery.
export async function prepare() {
  assert.equal(process.platform, "linux", "This isolation probe is Linux-only");
  assert(!existsSync("/etc/opencode"), "Managed configuration requires separate review");
  assert(process.env.OPENAI_API_KEY, "OPENAI_API_KEY must be present (never printed)");
  const base = "/tmp/opencode/opencode-a2a-lite-acp-smoke";
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const root = mkdtempSync(path.join(base, "run-"));
  try {
    return { ...configure(root), root };
  } catch (error) {
    await cleanup(root);
    throw error;
  }
}

function configure(root: string) {
  const cwd = path.join(root, "workspace");
  const home = path.join(root, "home");
  mkdirSync(cwd);
  mkdirSync(home);
  const deny = [{ action: "*", resource: "*", effect: "deny" }];
  const config = {
    model: { providerID: "openai", model: "gpt-6-luna" },
    default_agent: "smoke",
    permissions: deny,
    agents: {
      smoke: {
        mode: "primary",
        description: "Isolated ACP continuity probe",
        system: "You are a short-answer ACP test assistant. Never delegate. Tool access is denied.",
        permissions: deny,
      },
    },
    plugins: [],
    skills: [],
    instructions: [],
    snapshots: false,
    warming: false,
  };
  const file = path.join(cwd, "opencode.json");
  writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  // Deliberately do not inherit OPENCODE_*, provider base URLs, or other config overrides.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local/share"),
    XDG_STATE_HOME: path.join(home, ".local/state"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  const executable = process.env.ACP_SMOKE_OPENCODE ?? "opencode";
  const command = (args: string[]) => {
    const result = spawnSync(executable, args, {
      cwd,
      env,
      encoding: "utf8",
      timeout: 45_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    // Do not print raw diagnostics, which may include inherited/provider credentials.
    assert(!result.error, `OpenCode ${args.join(" ")} failed to execute`);
    assert.equal(result.status, 0, `OpenCode ${args.join(" ")} exited unsuccessfully`);
    return result.stdout;
  };
  assert.equal(
    command(["--version"]).trim(),
    "opencode v2.0.28",
    "Review isolation for a different pin",
  );
  // server-connection.ts: disabled=true selects a leased standalone server on port 0.
  command(["service", "set", "disabled", "true"]);
  {
    const entries: unknown = JSON.parse(command(["debug", "config"]));
    assert(Array.isArray(entries), "Expected ordered config source entries, not merged config");
    const documents: unknown[] = [];
    for (const entry of entries) {
      assert(entry && typeof entry === "object");
      const source = entry as Record<string, unknown>;
      assert.equal(typeof source.path, "string", "Unexpected virtual/remote source");
      const sourcepath = String(source.path);
      assert(sourcepath.startsWith(root + path.sep), "Unexpected external configuration source");
      if (source.type === "document") {
        assert.equal(sourcepath, file, "Unexpected configuration document");
        documents.push(source.info);
        continue;
      }
      assert.equal(source.type, "directory", "Unexpected discovery source type");
    }
    assert.equal(documents.length, 1, "Expected exactly one config document");
    assert(
      isDeepStrictEqual(documents[0], config),
      "Normalized configuration changed the restrictions",
    );
    console.log(JSON.stringify({ configVerified: true }));
  }
  return { cwd, env, executable };
}
