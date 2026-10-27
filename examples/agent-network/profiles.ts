import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { prepare, cleanup } from "../../scripts/acp-smoke-config.js";
import { tools } from "./bridge-proxy.js";
import definition from "./network.json" with { type: "json" };

export { tools };
export type Profile = Awaited<ReturnType<typeof prepare>>;
export type NetworkConnection = { binary: string; directory: string; peers: string[] };

export function record(value: unknown): Record<string, unknown> {
  assert(value && typeof value === "object" && !Array.isArray(value), "Expected object");
  return value as Record<string, unknown>;
}

export function proxyArgs(profile: Profile, connection: NetworkConnection) {
  return [
    join(import.meta.dir, "bridge-proxy.ts"),
    connection.binary,
    connection.directory,
    join(profile.root, "mcp-receipts.jsonl"),
    JSON.stringify(connection.peers),
  ];
}

export function verifyProfile(profile: Profile, expected: Record<string, unknown>) {
  const result = spawnSync(profile.executable, ["debug", "config"], {
    cwd: profile.cwd,
    env: profile.env,
    encoding: "utf8",
    timeout: 45_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert(!result.error && result.status === 0, "Isolated configuration inspection failed");
  const sources: unknown = JSON.parse(result.stdout);
  assert(Array.isArray(sources), "Expected configuration sources, not merged config");
  const documents = sources.filter((source: unknown) => {
    const entry = record(source);
    assert(typeof entry.path === "string" && entry.path.startsWith(profile.root + "/"));
    assert(entry.type === "document" || entry.type === "directory");
    if (entry.type !== "document") return false;
    assert.equal(entry.path, join(profile.cwd, "opencode.json"));
    assert(isDeepStrictEqual(entry.info, expected), "Unexpected role configuration");
    return true;
  });
  assert.equal(documents.length, 1);
}

export async function createProfile(
  role: string,
  system: string,
  connection?: NetworkConnection,
): Promise<Profile> {
  const profile = await prepare();
  try {
    const baseline = record(JSON.parse(readFileSync(join(profile.cwd, "opencode.json"), "utf8")));
    const deny = { action: "*", resource: "*", effect: "deny" };
    const permissions = [
      deny,
      ...(connection
        ? tools.map((tool) => ({ action: `network_${tool}`, resource: "*", effect: "allow" }))
        : []),
    ];
    if (connection) {
      const directory = join(profile.cwd, "network-audit");
      mkdirSync(directory, { mode: 0o700 });
      const built = await Bun.build({
        entrypoints: [join(import.meta.dir, "readiness-plugin.ts")],
        target: "bun",
        outdir: directory,
        naming: "index.js",
      });
      assert.equal(built.success, true, "Could not build local readiness observer");
      chmodSync(join(directory, "index.js"), 0o600);
    }
    const config = {
      ...baseline,
      model: {
        providerID: definition.model.slice(0, definition.model.indexOf("/")),
        model: definition.model.slice(definition.model.indexOf("/") + 1),
      },
      default_agent: role,
      permissions: [deny],
      agents: { [role]: { mode: "primary", description: role, system, permissions } },
      plugins: connection ? ["./network-audit"] : [],
      ...(connection
        ? {
            mcp: {
              servers: {
                network: {
                  type: "local",
                  command: [process.execPath, ...proxyArgs(profile, connection)],
                  cwd: profile.cwd,
                  codemode: false,
                  timeout: { startup: 30_000, catalog: 30_000, execution: 150_000 },
                },
              },
            },
          }
        : {}),
    };
    writeFileSync(join(profile.cwd, "opencode.json"), JSON.stringify(config), { mode: 0o600 });
    verifyProfile(profile, config);
    console.log(
      JSON.stringify({ role, isolatedConfigVerified: true, mcpServers: Number(!!connection) }),
    );
    return profile;
  } catch (error) {
    await cleanup(profile.root);
    throw error;
  }
}
