# Competing proposals / judge traffic

**Disclosure status:** `STUB`. Historical handoff-integrity failure exists; no current executable multi-worker procedure is defined here.

**Traffic pattern:** Multiple workers submit proposals/assessments and a judge receives and selects among them (historical T5; five agents including coordinator).

**Historical evidence:** Original T5 was WORKING in 0/3 cases and had 0/3 final answers scored. A later authorized case stopped on exact inbound artifact-string integrity after proposer evaluations; judge reasoning/final correctness were unobserved. This is not evidence of intrinsic judge reasoning or a general adapter failure. See [topology findings](../topology-investigation-findings.md), [authorized results](../authorized-live-acceptance.md), and [issue #38](https://github.com/tbrandenburg/opencode-a2a-lite/issues/38).

## Adapter lens

Check peer/task/context provenance and exact artifact delivery through the adapter. Separate transport/submission integrity from whether a judge chooses a good proposal. Never normalize or rewrite artifact contents to force a pass.

## Disclosed steps

None yet. Issue #38 is approved for a bounded, prompt-driven adapter investigation. Add validated steps incrementally; do not restore the retired judge runner/schedule or add a scorer.
