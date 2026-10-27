#!/usr/bin/env bun
import manifest from "../package.json" with { type: "json" };
import { parseOptions } from "./cli-options.js";
import { reportStartupError } from "./startup-error.js";

async function main() {
  const options = parseOptions(process.argv.slice(2), process.env);
  if (options.action === "help") {
    console.log(`Usage: opencode-a2a-lite --workspace <path> [--port <0..65535>]

Start the foreground, unauthenticated loopback A2A gateway.
Linux, Bun 1.3.9, exact OpenCode 2.0.28 on PATH, and configured provider required.

  --workspace <path>  Explicitly trust this directory; relative paths are resolved.
  --port <0..65535>   Loopback port (default 41241; 0 selects a free port).
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
