# Propose–critique–revise traffic

**Disclosure status:** `RECOVERED-BOUNDED-SEQUENCE`. P→K→P adapter traffic was observed; semantic refinement quality was not scored.

**Traffic pattern:** Proposal is assessed by a critic, then revised (historical T4 refinement; three agents including coordinator).

**Historical evidence:** Original T4 was WORKING in 0/3 cases and had 0/3 final answers scored. A later authorized refinement case passed transport, topology, final correctness and operations but failed `semantics.refine`; its precise role sub-criterion was not retained. This does not establish adapter failure. See [topology findings](https://github.com/tbrandenburg/opencode-a2a-lite/blob/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs/topology-investigation-findings.md), [authorized results](https://github.com/tbrandenburg/opencode-a2a-lite/blob/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs/authorized-live-acceptance.md), and [issue #37](https://github.com/tbrandenburg/opencode-a2a-lite/issues/37).

## Adapter lens

Verify the adapter transfers the proposal/critique/revision messages to the intended peers, preserves task and context bindings, returns the correct task artifacts, and isolates turns. Keep role-following and final-answer quality as separate observations.

## Recovered procedure and evidence

Use the [reviewed setup](/docs/manual-one-worker.md), then load the portable
[refinement instructions](/.opencode/skills/multi-a2a-agent/references/topology-propose-critique-revise.md).
Have OpenCode relay P's actual proposal to K and K's actual critique back to a new
P task in P's original context, explicitly nonblocking and without P's old task ID.

In [the bounded assessment](https://github.com/tbrandenburg/opencode-a2a-lite/blob/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs/authorized-live-acceptance.md#additional-bounded-adapter-assessments-2026-10-29),
three tasks completed in 10.631s, 12.613s and 4.219s with 17 paired calls. Both
handoffs and the proposer continuation correlated with worker sessions. These
reconstructed instructions neither reproduce nor resolve the historical semantic failure.
