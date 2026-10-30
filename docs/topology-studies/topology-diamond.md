# Diamond traffic

**Disclosure status:** `RECOVERED-BOUNDED-DIAMOND`. Planner→two reviewers→integrator adapter traffic was observed; model quality remains unscored.

**Traffic pattern:** A task branches to multiple workers and later converges through a downstream worker/coordinator (historical T3; five agents including coordinator).

**Historical evidence (before the bounded assessment below):** Original T3 was WORKING in 0/3 cases and had 0/3 final answers scored. No later authorized diamond case was recorded in that historical matrix. Missing scoring is not proof of an adapter or topology failure. See [topology findings](https://github.com/tbrandenburg/opencode-a2a-lite/blob/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs/topology-investigation-findings.md) and [issue #40](https://github.com/tbrandenburg/opencode-a2a-lite/issues/40).

## Adapter lens

Exercise existing A2A boundaries for the actual branch/convergence calls: peer allowlisting, task/context isolation, status and artifact decoding, and owned cleanup. If MCP/OpenCode prevents a branch call, report that boundary separately; do not invent a host-driven diamond schedule.

## Recovered procedure and evidence

Use the [reviewed setup](/docs/manual-one-worker.md), then load the portable
[diamond instructions](/.opencode/skills/multi-a2a-agent/references/topology-diamond.md).
Relay the exact planner artifact to two isolated reviewer tasks; relay both exact
reviewer artifacts as separately attributed inputs to the integrator.

In [the bounded assessment](https://github.com/tbrandenburg/opencode-a2a-lite/blob/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs/authorized-live-acceptance.md#additional-bounded-adapter-assessments-2026-10-29),
four tasks completed in 5.853s, 12.548s, 10.327s and 6.641s with 22 paired calls.
Branch inputs and join artifacts matched worker sessions. The integrator artifact
contained the expected markers although the coordinator's final prose omitted them.
That presentation difference is not an adapter failure or an integration-quality score.
