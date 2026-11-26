#!/usr/bin/env bun
import manifest from "../package.json" with { type: "json" };
import { parseOptions, PROVIDER_ENV } from "./cli-options.js";
import { reportStartupError } from "./startup-error.js";

async function main() {
  const options = parseOptions(process.argv.slice(2), process.env);
  if (options.action === "help") {
    console.log(`Usage: opencode-a2a-lite [--workspace <path>] [--port <0..65535>]
                         [--access <read|edit|danger-full-access>]
                         [--pass-env NAME]... [--no-env] [--enable <activity|approve|resume>]...

Start the foreground, unauthenticated A2A gateway.
Linux, Bun 1.4.4, stable OpenCode 2.2.7 or newer on PATH, and configured provider required.
The private CLI runtime currently fails closed on macOS.

  --workspace <path>  Trusted directory (default: the current directory; or A2A_WORKSPACE, absolute).
  --port <0..65535>   Port (default 41241; 0 selects a free port).
  --access <read|edit|danger-full-access>
                      Startup-only capability level, never request-scoped. read (default) reads and
                      searches; edit also edits project files; neither runs shell, web tools, MCP,
                      plugins, skills or subagents. danger-full-access auto-approves shell, edits and
                      web tools with host-user authority and passes no provider keys unless named.
                      There is no OS isolation at any level.
  --pass-env NAME     Also pass this variable to OpenCode; repeat as needed. Provider keys
                      (${PROVIDER_ENV.join(", ")})
                      are passed automatically when set (names printed, never values), except under
                      danger-full-access. Reserved runtime/configuration variables are rejected.
  --no-env            Do not pass the automatic provider keys (same as --pass-env "").
  --enable <activity|approve|resume>
                      Opt-in extra, off by default; repeat for several.
                      activity: also publish tool call ids, titles, kinds and statuses (no inputs or
                      outputs) and the model's reasoning text; may reveal paths, commands or data.
                      approve: pause tasks as input-required until a client allows or rejects a
                      permission request; anyone who can reach this port can approve tool runs.
                      Not available with danger-full-access.
                      resume: let clients continue an existing OpenCode session of this workspace
                      (metadata opencode.sessionId; opencode.replay: true returns earlier messages);
                      anyone who can reach this port can read that conversation.
  --prompt-timeout <duration|unlimited>
                      Whole ACP prompt deadline (default 60m); integer ms, s, m or h,
                      30ms to 2147483647ms. unlimited disables only this deadline.
  --help, -h          Show help without starting OpenCode.
  --version, -v       Print package version without starting OpenCode.

Advanced (--policy-file, --state-dir, A2A_NAME/DESCRIPTION/TAGS, A2A_PORT): docs/operator-policy-state.md.
Private ephemeral HOME/XDG does not use saved logins. Workspace configuration, instructions,
tools, plugins and MCP are trusted. This is not a sandbox.
Never expose through a public proxy. Use the separate official a2a CLI as client.`);
    return;
  }
  if (options.action === "version") {
    console.log(manifest.version);
    return;
  }
  const { launchGateway } = await import("./server.js");
  await launchGateway(options.server);
}

void main().catch(reportStartupError);
