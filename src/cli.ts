#!/usr/bin/env bun
import manifest from "../package.json" with { type: "json" };
import { parseOptions } from "./cli-options.js";
import { reportStartupError } from "./startup-error.js";

async function main() {
  const options = parseOptions(process.argv.slice(2), process.env);
  if (options.action === "help") {
    console.log(`Usage: opencode-a2a-lite --workspace <path> [--port <0..65535>] [--publish-activity]
                         [--permissions <reject|ask>] [--policy <read-only|edit|full-access>]
                         [--dangerously-skip-permissions] [--policy-file <absolute path>]
                         [--state-dir <absolute path>] [--allow-resume] [--pass-env NAME]...

Start the foreground, unauthenticated A2A gateway.
Linux, Bun 1.4.4, stable OpenCode 2.2.7 or newer on PATH, and configured provider required.
The private CLI runtime currently fails closed on macOS.

  --workspace <path>  Explicitly trust this directory; relative paths are resolved.
  --port <0..65535>   Port (default 41241; 0 selects a free port).
  --pass-env NAME     Pass one named provider variable to OpenCode; repeat as needed.
                      Reserved runtime/configuration variables and missing values are rejected.
  --publish-activity  Also publish an "activity" artifact with tool call ids, titles, kinds and
                      statuses (no inputs or outputs) and the model's reasoning text.
                      May reveal paths, commands or workspace data.
  --permissions <reject|ask>
                      reject (default) rejects every OpenCode permission request. ask pauses the
                      task as input-required until a client answers allow or reject; anyone who
                      can reach this unauthenticated port can then approve tool runs.
  --policy <read-only|edit|full-access>
                      Startup-only capability profile, never request-scoped. read-only (default)
                      reads and searches; edit also edits project files; neither runs shell, web
                      tools, MCP, plugins, skills or subagents. full-access auto-approves shell,
                      edits and web tools with host-user authority, needs
                      --dangerously-skip-permissions and cannot combine with --permissions ask.
                      supervised is not available. There is no OS isolation in any profile.
  --dangerously-skip-permissions
                      Acknowledge full-access; rejected with any other policy.
  --policy-file <absolute path>
                      Operator JSON {version:1, base, policies:[{action, resource, effect:"allow"}]}
                      adding exact mcp.use, skill.use, plugin.use or MCP tool.use (<server>_<tool>:*)
                      exceptions to the selected profile; base must equal --policy. The file must be
                      outside the workspace, owned by you, not a symlink or group/world-writable.
                      Allowlisted MCP servers and plugins run code with host-user authority.
  --state-dir <absolute path>
                      Keep OpenCode session history in this private directory (mode 0700, bound to
                      this workspace, one gateway at a time) across restarts. Saved approvals,
                      accounts and automations are cleared every launch; history may contain
                      sensitive content. Restoring a session still needs --allow-resume.
  --allow-resume      Let clients continue an existing OpenCode session of this workspace by sending
                      message metadata opencode.sessionId; add opencode.replay: true to also receive the
                      earlier messages. Sessions hold earlier conversation
                      content, which any client that can reach this unauthenticated port can then read.
  --help, -h         Show help without starting OpenCode.
  --version, -v      Print package version without starting OpenCode.

Flags override A2A_WORKSPACE (absolute only) and A2A_PORT.
Optional identity: A2A_NAME (128 characters), A2A_DESCRIPTION (1024),
and A2A_TAGS (up to 16 comma-separated tags, 64 characters each; no escaping).
Values are trimmed, nonblank and control-free; tags deduplicate after text.
Identity describes the worker, not authentication or permissions.
No implicit current-directory trust. Private ephemeral HOME/XDG does not use saved logins;
pass provider credentials explicitly. Workspace configuration, instructions, tools, plugins
and MCP are trusted. This is not a sandbox.
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
