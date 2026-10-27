import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { auditPath, registered, snapshots } from "../../examples/agent-network/readiness.js";
import observer, { coordinatorRole } from "../../examples/agent-network/readiness-plugin.js";
import { until } from "../../examples/agent-network/transport.js";
import { pathToFileURL } from "node:url";

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
  const root = mkdtempSync(join(tmpdir(), "network-readiness-"));
  roots.push(root);
  mkdirSync(join(root, "network-audit"));
  return { root, cwd: root, executable: process.execPath, env: {} };
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

test("N08 bundled readiness observer audits the configured role and rejects extra tools", async () => {
  const profile = fixture();
  const directory = join(profile.cwd, "network-audit");
  const built = await Bun.build({
    entrypoints: [
      new URL("../../examples/agent-network/readiness-plugin.ts", import.meta.url).pathname,
    ],
    target: "bun",
    outdir: directory,
    naming: "index.js",
  });
  expect(built.success).toBe(true);
  const bundled = (await import(pathToFileURL(join(directory, "index.js")).href)) as {
    default: typeof observer;
  };
  type Callback = Parameters<Parameters<typeof observer.setup>[0]["session"]["hook"]>[1];
  let context: Callback | undefined;
  let disposed = false;
  let dispose: Awaited<ReturnType<typeof observer.setup>>;
  const previous = { run: process.env.NETWORK_AUDIT_RUN, tools: process.env.NETWORK_AUDIT_TOOLS };
  process.env.NETWORK_AUDIT_RUN = run;
  process.env.NETWORK_AUDIT_TOOLS = JSON.stringify(names);
  try {
    dispose = await bundled.default.setup({
      tool: { list: async () => names.map((id) => ({ id })) },
      session: {
        hook: async (kind, callback) => {
          expect(kind).toBe("context");
          context = callback;
          return {
            dispose: async () => {
              disposed = true;
            },
          };
        },
      },
    });
    await until(async () => registered(profile, run), "bundled observer registration", 5_000);
    if (!context) throw new Error("Observer context hook missing");
    const tools = Object.fromEntries(names.map((name) => [name, {}]));
    context({ agent: "topology-coordinator", sessionID: "session", tools });
    expect(existsSync(auditPath(profile, "snapshots", run))).toBe(false);
    context({ agent: coordinatorRole, sessionID: "session", tools });
    expect(snapshots(profile, run, "session")).toHaveLength(1);
    expect(snapshots(profile, run, "session")[0]?.agent).toBe(coordinatorRole);
    expect(() => snapshots(profile, run, "another-session")).toThrow();
    expect(() =>
      context!({ agent: coordinatorRole, sessionID: "session", tools: { ...tools, shell: {} } }),
    ).toThrow("tool snapshot mismatch");
    expect(() => snapshots(profile, run, "session")).toThrow("tool set mismatch");
  } finally {
    await dispose?.();
    if (previous.run === undefined) delete process.env.NETWORK_AUDIT_RUN;
    else process.env.NETWORK_AUDIT_RUN = previous.run;
    if (previous.tools === undefined) delete process.env.NETWORK_AUDIT_TOOLS;
    else process.env.NETWORK_AUDIT_TOOLS = previous.tools;
  }
  expect(disposed).toBe(true);
});
