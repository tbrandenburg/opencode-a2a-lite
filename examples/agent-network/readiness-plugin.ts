import { appendFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface ContextEvent {
  agent: string;
  sessionID: string;
  tools: Record<string, unknown>;
}
interface AuditContext {
  tool: { list(): Promise<readonly { id: string }[]> };
  session: {
    hook(
      kind: "context",
      callback: (event: ContextEvent) => void,
    ): Promise<{ dispose(): Promise<void> }>;
  };
}

// Narrow public-plugin contract verified against OpenCode 2.0.28; no runtime package import.
export default {
  id: "local.network-readiness-audit",
  async setup(context: AuditContext) {
    const run = process.env.NETWORK_AUDIT_RUN;
    if (!run) return;
    if (!/^[0-9a-f-]{36}$/.test(run)) throw new Error("Invalid audit identifier");
    const expected = JSON.parse(process.env.NETWORK_AUDIT_TOOLS ?? "[]") as string[];
    if (expected.length !== 6 || !expected.every((name) => /^network_a2a_[a-z_]+$/.test(name)))
      throw new Error("Invalid audit tool set");
    expected.sort();
    const directory = dirname(fileURLToPath(import.meta.url));
    const failure = join(directory, `failure-${run}.json`);
    const same = (names: string[]) =>
      names.length === expected.length && names.every((name, index) => name === expected[index]);
    const metadata = (event: string, names: string[]) => ({
      run,
      pid: process.pid,
      event,
      at: new Date().toISOString(),
      tools: names,
    });
    const fail = (reason: string) => {
      try {
        writeFileSync(failure, JSON.stringify({ run, event: "failure", reason }), {
          mode: 0o600,
          flag: "wx",
        });
      } catch {
        console.error("Network audit failure receipt could not be written");
      }
    };
    const registration = await context.session.hook("context", (event) => {
      if (event.agent !== "coordinator") return;
      const names = Object.keys(event.tools).sort();
      const matched = same(names);
      appendFileSync(
        join(directory, `snapshots-${run}.jsonl`),
        JSON.stringify({
          ...metadata("context", names),
          session: event.sessionID,
          agent: event.agent,
          matched,
        }) + "\n",
        { mode: 0o600 },
      );
      if (!matched) {
        fail("unexpected-request-tool-set");
        throw new Error("Network coordinator tool snapshot mismatch");
      }
    });
    const deadline = Date.now() + 45_000;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const registered = await context.tool.list();
        if (stopped) return;
        const names = registered
          .map((tool) => tool.id)
          .filter((name) => name.startsWith("network_"))
          .sort();
        if (same(names)) {
          writeFileSync(
            join(directory, `ready-${run}.json`),
            JSON.stringify(metadata("registered", names)),
            { mode: 0o600, flag: "wx" },
          );
          return;
        }
        if (Date.now() >= deadline) return fail("registry-readiness-timeout");
        timer = setTimeout(() => void poll(), 100);
      } catch {
        fail("registry-readiness-probe-failed");
      }
    };
    // Setup returns before waiting for MCP startup, avoiding a plugin-startup deadlock.
    timer = setTimeout(() => void poll(), 0);
    return async () => {
      stopped = true;
      clearTimeout(timer);
      await registration.dispose();
    };
  },
};
