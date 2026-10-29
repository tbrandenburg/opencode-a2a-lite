# Pipeline traffic

**Disclosure status:** `RECOVERED-BOUNDED-PREFIX`. A two-worker handoff was observed; the full six-worker pipeline remains unverified.

**Traffic pattern:** Ordered stage-to-stage worker handoffs (historical T1; seven agents including coordinator).

**Historical evidence:** Original T1 was WORKING in 0/3 cases and had 0/3 final answers scored. A later authorized pipeline case completed p1–p3, then contribution validation found one changed fact; later stages/final answer were unobserved. This is not an A2A adapter verdict. See [topology findings](../topology-investigation-findings.md) and [issue #35](https://github.com/tbrandenburg/opencode-a2a-lite/issues/35).

## Adapter lens

Check only the existing guarded MCP/A2A path for each observed handoff: approved peer dispatch, nonblocking task submission, returned handle/context provenance, task-state/artifact decoding, and cleanup. If OpenCode never issues a tool call, classify its readiness/MCP boundary; do not report pipeline quality or adapter failure from absent evidence.

## Recovered procedure and evidence

For a new separately authorized usability test, use the
[complete two-worker bootstrap](/docs/manual-two-worker-pipeline.md), then load the portable
[pipeline instructions](/.opencode/skills/multi-a2a-agent/references/topology-pipeline.md).
Map only the issue-reviewed worker peers; OpenCode relays every stage through guarded MCP.

In [the bounded assessment](/docs/authorized-live-acceptance.md#additional-bounded-adapter-assessments-2026-10-29),
two tasks completed in 6.043s and 6.635s with 10 paired calls. The actual first
artifact reached the second worker; dispatched inputs and terminal artifacts matched
worker sessions. This recovered procedure describes that mechanism, not the deleted
verbatim experiment prompt. More stages, answer quality and reliability were not tested.
