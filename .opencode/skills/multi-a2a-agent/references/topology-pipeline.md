# Pipeline traffic

**Disclosure status:** `STUB`. No current executable manual procedure is defined here.

**Traffic pattern:** Ordered stage-to-stage worker handoffs (historical T1; seven agents including coordinator).

**Historical evidence:** Original T1 was WORKING in 0/3 cases and had 0/3 final answers scored. A later authorized pipeline case completed p1–p3, then contribution validation found one changed fact; later stages/final answer were unobserved. This is not an A2A adapter verdict. See [topology findings](../../../../docs/topology-investigation-findings.md) and [issue #35](https://github.com/tbrandenburg/opencode-a2a-lite/issues/35).

## Adapter lens

Check only the existing guarded MCP/A2A path for each observed handoff: approved peer dispatch, nonblocking task submission, returned handle/context provenance, task-state/artifact decoding, and cleanup. If OpenCode never issues a tool call, classify its readiness/MCP boundary; do not report pipeline quality or adapter failure from absent evidence.

## Disclosed steps

None yet. Add validated steps incrementally through issue #35. Do not infer a host schedule, add a runner, or claim the retired topology harness is available.
