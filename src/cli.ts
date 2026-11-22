#!/usr/bin/env bun
import manifest from "../package.json" with { type: "json" };
import { parseOptions } from "./cli-options.js";
import { reportStartupError } from "./startup-error.js";

async function main() {
  const options = parseOptions(process.argv.slice(2), process.env);
  if (options.action === "help") {
    console.log(`Usage: opencode-a2a-lite --workspace <path> [--port <0..65535>] [--publish-activity]
                         [--permissions <reject|ask>] [--allow-resume]

Start the foreground, unauthenticated A2A gateway.
Linux or macOS (experimental), Bun 1.4.4, stable OpenCode 2.2.7 or newer on PATH, and configured provider required.

  --workspace <path>  Explicitly trust this directory; relative paths are resolved.
  --port <0..65535>   Port (default 41241; 0 selects a free port).
  --publish-activity  Also publish an "activity" artifact with tool call ids, titles, kinds and
                      statuses (no inputs or outputs) and the model's reasoning text.
                      May reveal paths, commands or workspace data.
  --permissions <reject|ask>
                      reject (default) rejects every OpenCode permission request. ask pauses the
                      task as input-required until a client answers allow or reject; anyone who
                      can reach this unauthenticated port can then approve tool runs.
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
No implicit current-directory trust. OpenCode configuration is inherited;
review tools/plugins/MCP and provider configuration. This is not a sandbox.
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
