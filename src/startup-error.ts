const messages = {
  arguments: "Invalid arguments. Use --help for the supported flags.",
  access: "Invalid --access value: use read, edit or danger-full-access.",
  enable: "Invalid --enable value: use activity, approve or resume, each at most once.",
  workspace:
    "Invalid workspace: A2A_WORKSPACE must be an absolute directory; otherwise pass --workspace <path> or start in the trusted directory.",
  replaced: "A removed flag was used; use --help for the current flags.",
  accessConflict:
    "--access danger-full-access cannot combine with --enable approve: nothing is left to approve.",
  directory:
    "Workspace must be an existing directory; select a trusted directory with --workspace or A2A_WORKSPACE.",
  port: "Invalid port: use an integer from 0 through 65535 with --port or A2A_PORT.",
  promptTimeout:
    "Invalid prompt timeout: use an integer with ms, s, m or h (30 to 2147483647ms), or unlimited.",
  identity:
    "Invalid worker identity: use nonblank strings without control characters; name <=128, description <=1024, and up to 16 tags of <=64 characters (A2A_TAGS is comma-separated).",
  occupied: "Port is in use; choose another --port or A2A_PORT (0 selects a free port).",
  executable:
    "ACP startup failed: OpenCode is unavailable; install a stable OpenCode 2.2.7 or newer executable on PATH.",
  version:
    "ACP startup failed: Unsupported OpenCode version; PATH must provide stable opencode v2.2.7 or newer.",
  passEnv: "Invalid, duplicate, reserved or missing --pass-env variable; use --help for details.",
  passEnvConflict: "Cannot combine --pass-env with a caller-supplied ACP environment.",
  runtime: "Private runtime preflight failed; review trusted workspace and OpenCode configuration.",
  overloaded:
    "Private runtime preflight failed: the capability policy was never reported and the probes were slow; the host appears overloaded, so start fewer gateways at once and retry (on an idle host, review the workspace configuration: it may have dropped or weakened the policy).",
  policy:
    "Private runtime preflight failed: the capability policy was dropped, overridden or weakened by configuration; review trusted workspace and OpenCode configuration.",
  policyAcknowledgement:
    "Library option policy full-access requires dangerouslySkipPermissions, and that option is accepted only with policy full-access.",
  policyConflict:
    "Library option policy full-access cannot combine with permissions ask or a caller-supplied ACP environment.",
  policyFile:
    "--policy-file rejected: it must be an absolute, non-symlinked JSON file outside the workspace, owned by you and not group/world-writable, with only reviewed exact version 1 allow statements (see docs/operator-policy-state.md).",
  policyFileBase:
    "--policy-file base must equal the --access level (read = read-only); a policy file never selects or upgrades a profile.",
  stateDir:
    "--state-dir rejected: it must be an absolute private directory (mode 0700, owned by you, no symlinks, no shared write access in its parents, outside the workspace), bound to this workspace only, and free of stored credentials.",
  stateBusy:
    "--state-dir is in use by another gateway or has an unreadable lock; stop the other gateway or inspect the lock before removing it.",
  privateOptions:
    "--policy-file and --state-dir apply to the CLI private runtime only and cannot combine with a caller-supplied ACP environment.",
  runtimePlatform:
    "Private runtime preflight failed: CLI private runtime is Linux-only for now; library callers can supply acp.env and manage isolation.",
} as const;

export class StartupError extends Error {
  constructor(code: keyof typeof messages, detail?: string) {
    super(detail ?? messages[code]);
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
