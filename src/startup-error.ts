const messages = {
  arguments: "Invalid arguments. Use --help for --workspace <path> and --port <0..65535>.",
  workspace:
    "A trusted absolute workspace is required: pass --workspace <path> or set A2A_WORKSPACE to an absolute directory.",
  directory:
    "Workspace must be an existing directory; select a trusted directory with --workspace or A2A_WORKSPACE.",
  port: "Invalid port: use an integer from 0 through 65535 with --port or A2A_PORT.",
  occupied: "Loopback port is in use; choose another --port or A2A_PORT (0 selects a free port).",
  executable:
    "ACP startup failed: OpenCode is unavailable; install the reviewed OpenCode 2.0.28 executable on PATH.",
  version:
    "ACP startup failed: Unsupported OpenCode version; PATH must provide exactly opencode v2.0.28.",
} as const;

export class StartupError extends Error {
  constructor(code: keyof typeof messages) {
    super(messages[code]);
    this.name = "StartupError";
  }
}

export function reportStartupError(error: unknown) {
  console.error(
    error instanceof StartupError
      ? error.message
      : "Gateway startup failed; check trusted workspace and isolated OpenCode/provider configuration.",
  );
  process.exitCode = 1;
}
