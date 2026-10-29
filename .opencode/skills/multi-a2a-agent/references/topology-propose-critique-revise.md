# Propose–critique–revise traffic

**Disclosure status:** `STUB`. Historical role-contract evidence exists; no current executable multi-worker procedure is defined here.

**Traffic pattern:** Proposal is assessed by a critic, then revised (historical T4 refinement; three agents including coordinator).

**Historical evidence:** Original T4 was WORKING in 0/3 cases and had 0/3 final answers scored. A later authorized refinement case passed transport, topology, final correctness and operations but failed `semantics.refine`; its precise role sub-criterion was not retained. This does not establish adapter failure. See [topology findings](../../../../docs/topology-investigation-findings.md), [authorized results](../../../../docs/authorized-live-acceptance.md), and [issue #37](https://github.com/tbrandenburg/opencode-a2a-lite/issues/37).

## Adapter lens

Verify the adapter transfers the proposal/critique/revision messages to the intended peers, preserves task and context bindings, returns the correct task artifacts, and isolates turns. Keep role-following and final-answer quality as separate observations.

## Disclosed steps

None yet. Issue #37 is approved for a bounded, prompt-driven adapter investigation. Add validated steps incrementally; preserve the historical role finding separately and do not add a host-side schedule or weaken adapter checks.
