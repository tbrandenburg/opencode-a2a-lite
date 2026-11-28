# Native startup roles

Issue [#110](https://github.com/tbrandenburg/opencode-a2a-lite/issues/110).

The gateway uses native V2 agent configuration (`agents.<id>.system`) and ACP
`session/set_config_option` with `configId: "mode"`. It never concatenates role instructions
into A2A task text. Role IDs and prompts are not Agent Card extensions or request options.
The standalone agent exists only in the gateway's private runtime, using the same policy
and credential restrictions as a launch without a role.

References consulted before implementation:

- [OpenCode native agents](https://opencode.ai/docs/agents): `system`, primary selection,
  hidden/disabled agents and configuration precedence.
- [OpenCode ACP](https://opencode.ai/docs/acp): mode choices, selection acknowledgement,
  and private process/session ownership.
- [Pinned 2.4.1 ACP selector source](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/cli/src/acp/config-option.ts).
- [Pinned 2.4.1 native agent loader](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/config/plugin/agent.ts).
- ACP's [config options reference](https://agentclientprotocol.com/protocol/session-config-options),
  including Context7 research on the response's full `configOptions` and `currentValue`.
  The installed SDK 2.0.2 uses string `value`; the proposed boolean-option discriminator
  is not part of this implementation.

## Reproduction and boundaries

Runtime evidence on **2026-11-28**: Linux, **Bun 1.4.4**, **OpenCode 2.4.1**,
with the repository-pinned ACP SDK **2.0.2**. The provider-free native role probe
reported `actualSystemVerified: true`, `unchangedUser: true`,
`sessionsAndContinuations: true` and `fallbackModelCalls: 0`. Earlier admitted
OpenCode versions were not tested for these new options; this evidence does not
extend the existing live-model or macOS acceptance claims.

Recorded local gates: `make check` passed with **295 passed, 1 existing platform skip,
0 failed across 39 files**; the focused ACP/native-role command below passed **41 tests**.
`make runtime-smoke` verified readiness, the card, port reclamation and cleanup.
`make policy-smoke` reported `policyProbes: true` and `stateProbes: true`, including the
existing hostile-project, operator-exception and state-downgrade controls. Lint retained
nonblocking warnings in existing large modules; the new role helpers and test files lint cleanly.
Independent coordinator `make e2e` passed **14 live-model scenarios, 0 failed**, covering
the production CLI's default behavior, context continuity, cancellation, permission denials,
runtime failure and owned cleanup. This suite does not exercise explicit roles; `role-smoke`
provides that real-runtime coverage with a scripted local provider.

```sh
make check
bun test ./tests/native-role.test.ts ./tests/acp-role.test.ts ./tests/acp-client.test.ts
make runtime-smoke
make policy-smoke
make role-smoke
```

`role-smoke` launches the production CLI twice against one disposable workspace, with
separate private runtimes and ephemeral loopback ports. One instance uses a prepared
native primary agent; the other reads a standalone prompt file. A local scripted provider
checks the actual outbound system and user messages for fresh contexts and continuations,
not the model's self-description. Task requests are identified independently of the expected
role before asserting their count and system content, so wrong-role requests cannot be filtered
out. Negative launches must make zero additional model calls.
Only synthetic fixture prompts are used; request payloads are kept in memory and withheld
from output.

Native roles are verified against startup configuration; post-launch workspace mutations
are outside the trust contract. ACP mode change notifications for owned selected sessions
are rejected if they no longer acknowledge the expected role. Arbitrary-session resume is
rejected because an earlier session's role/prompt cannot be reliably established here.
The readiness check creates an unused native session without sending a task.
Explicit roles also reject slash-prefixed task text before ACP dispatch. Native
commands can switch the selected agent and rewrite the user task
([2.4.1 command loader](https://github.com/anomalyco/opencode/blob/v2.4.1/packages/core/src/config/plugin/command.ts));
this conservative guard avoids a catalog-notification race without inventing a command registry.
Default launches retain their existing command behavior.

The role probe is provider-free protocol/configuration evidence, not live-model reasoning-quality
evidence. Release/publication remains a separate step after review and merge.
