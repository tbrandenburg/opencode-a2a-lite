# Diamond traffic

**Disclosure status:** `STUB`. No current executable manual procedure is defined here.

**Traffic pattern:** A task branches to multiple workers and later converges through a downstream worker/coordinator (historical T3; five agents including coordinator).

**Historical evidence:** Original T3 was WORKING in 0/3 cases and had 0/3 final answers scored. No later authorized diamond case is recorded. Missing scoring is not proof of an adapter or topology failure. See [topology findings](../../../../docs/topology-investigation-findings.md) and [issue #40](https://github.com/tbrandenburg/opencode-a2a-lite/issues/40).

## Adapter lens

Exercise existing A2A boundaries for the actual branch/convergence calls: peer allowlisting, task/context isolation, status and artifact decoding, and owned cleanup. If MCP/OpenCode prevents a branch call, report that boundary separately; do not invent a host-driven diamond schedule.

## Disclosed steps

None yet. Issue #40 is approved for a bounded, prompt-driven adapter investigation. Add validated steps incrementally; OpenCode remains the coordinator, with no host-side orchestrator or topology scorer.
