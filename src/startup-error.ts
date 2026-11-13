const messages = {
  arguments: "Invalid arguments. Use --help for --workspace <path> and --port <0..65535>.",
  workspace:
    "A trusted absolute workspace is required: pass --workspace <path> or set A2A_WORKSPACE to an absolute directory.",
  directory:
    "Workspace must be an existing directory; select a trusted directory with --workspace or A2A_WORKSPACE.",
  port: "Invalid port: use an integer from 0 through 65535 with --port or A2A_PORT.",
  identity:
    "Invalid worker identity: use nonblank strings without control characters; name <=128, description <=1024, and up to 16 tags of <=64 characters (A2A_TAGS is comma-separated).",
  occupied: "Port is in use; choose another --port or A2A_PORT (0 selects a free port).",
  executable:
    "ACP startup failed: OpenCode is unavailable; install a stable OpenCode 2.2.7 or newer executable on PATH.",
  version:
    "ACP startup failed: Unsupported OpenCode version; PATH must provide stable opencode v2.2.7 or newer.",
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
