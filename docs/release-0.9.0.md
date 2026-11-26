# v0.9.0 release notes (breaking, issue #103)

v0.9.0 shrinks the CLI to three common inputs (workspace, port, access level), passes well-known
provider keys automatically and makes launches reliable when several gateways start on one host.
There are no deprecation aliases: each removed flag fails with one sentence naming its replacement.

```text
opencode-a2a-lite [--workspace DIR] [--port N] [--access read|edit|danger-full-access]
                  [--pass-env NAME]... [--no-env] [--enable activity|approve|resume]...
```

## Old to new

| 0.8                                                         | 0.9                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--workspace` required                                      | defaults to the current directory; `--workspace` and absolute `A2A_WORKSPACE` still work                                                                                                                                                                                                                                      |
| `--policy read-only`                                        | `--access read` (default)                                                                                                                                                                                                                                                                                                     |
| `--policy edit`                                             | `--access edit`                                                                                                                                                                                                                                                                                                               |
| `--policy full-access --dangerously-skip-permissions`       | `--access danger-full-access` (the value is the acknowledgement; the startup `WARNING` stays)                                                                                                                                                                                                                                 |
| `--policy supervised`                                       | removed (was already rejected)                                                                                                                                                                                                                                                                                                |
| `--permissions ask`                                         | `--enable approve` (rejected with `danger-full-access`)                                                                                                                                                                                                                                                                       |
| `--publish-activity`                                        | `--enable activity`                                                                                                                                                                                                                                                                                                           |
| `--allow-resume`                                            | `--enable resume`                                                                                                                                                                                                                                                                                                             |
| `--pass-env OPENAI_API_KEY` always required                 | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY` pass automatically when set (names printed, never values); `--pass-env NAME` adds more; `--no-env` or `--pass-env ""` drops the automatic ones; nothing is automatic under `danger-full-access` |
| `--policy-file`, `--state-dir`, `A2A_NAME/DESCRIPTION/TAGS` | unchanged, moved to the [advanced page](operator-policy-state.md)                                                                                                                                                                                                                                                             |

Remaining coupling errors: `danger-full-access` with `--enable approve`, and an invalid or reserved
`--pass-env` name. The removed-flag messages are deleted in the following release.

## Launch reliability

- Gateways of the same user serialize their startup checks with a per-user lock file
  (`/tmp/opencode-a2a-launch-<uid>.lock`, pid and start-time owner record, a dead owner never blocks,
  no signal is ever sent to another pid). Waiting is bounded (5 minutes) and logged; after that the launch
  continues unlocked and says so.
- When the agent probe is slow and never reports the private policy, startup now fails with attempts,
  elapsed time, last probe duration and "host appears overloaded; start fewer gateways at once"
  instead of the misleading "weakened by configuration" text. A fast, deterministic policy
  mismatch still fails closed with the policy error. Probe timeouts are logged the same way.
- All four OpenCode probes (`--version`, `debug paths`, `debug config`, `debug agents`) are kept: on
  OpenCode 2.4.1 `debug agents` reports only agent permissions, not configuration sources or runtime
  paths, so it cannot replace the others.
