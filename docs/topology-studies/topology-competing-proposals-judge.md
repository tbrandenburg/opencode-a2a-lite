# Competing proposals / judge traffic

**Disclosure status:** `RECOVERED-TWO-PROPOSER-PREFIX`. Two proposers and a judge were observed; P3 and judge quality remain unverified.

**Traffic pattern:** Multiple workers submit proposals/assessments and a judge receives and selects among them (historical T5; five agents including coordinator).

**Historical evidence:** Original T5 was WORKING in 0/3 cases and had 0/3 final answers scored. A later authorized case stopped on exact inbound artifact-string integrity after proposer evaluations; judge reasoning/final correctness were unobserved. This is not evidence of intrinsic judge reasoning or a general adapter failure. See [topology findings](../topology-investigation-findings.md), [authorized results](../authorized-live-acceptance.md), and [issue #38](https://github.com/tbrandenburg/opencode-a2a-lite/issues/38).

## Adapter lens

Check peer/task/context provenance and exact artifact delivery through the adapter. Separate transport/submission integrity from whether a judge chooses a good proposal. Never normalize or rewrite artifact contents to force a pass.

## Recovered procedure and evidence

Use the [reviewed setup](/docs/manual-one-worker.md), then load the portable
[proposal/judge instructions](/.opencode/skills/multi-a2a-agent/references/topology-competing-proposals-judge.md).
Keep distinct proposer bindings, use independent nonblocking submissions, and give
the judge the exact completed artifacts rather than coordinator paraphrases.

In [the bounded assessment](/docs/authorized-live-acceptance.md#additional-bounded-adapter-assessments-2026-10-29),
two proposer submissions preceded polling and both were observed working. The judge
received both exact artifacts. Three tasks completed in 17.350s, 19.553s and 11.023s
with 17 paired calls. The full three-proposer layout and judge reasoning were not
validated; the earlier integrity failure remains historical evidence.
