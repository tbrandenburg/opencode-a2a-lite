# Bounded-ring traffic

**Disclosure status:** `RECOVERED-BOUNDED-CLOSURE`. W1→W6→W1 was observed; the full six-worker ring remains unverified.

**Traffic pattern:** Bounded worker-to-worker/coordinator relay rounds with an explicit stop condition (historical T6; seven agents including coordinator).

**Historical evidence (before the bounded assessment below):** Original T6 was WORKING in 0/3 cases and had 0/3 final answers scored. No later authorized ring case was recorded in that historical matrix. See [topology findings](https://github.com/tbrandenburg/opencode-a2a-lite/blob/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs/topology-investigation-findings.md) and [issue #36](https://github.com/tbrandenburg/opencode-a2a-lite/issues/36).

## Adapter lens

Observe only actual guarded A2A calls: exact peer routing, task/context handle continuity, terminal state/artifact reporting, attempt accounting, and cleanup. Do not add rounds, enlarge budgets, or treat a relay-quality failure as an adapter defect.

## Recovered procedure and evidence

Use the [reviewed setup](/docs/manual-one-worker.md), then load the portable
[bounded-ring instructions](/.opencode/skills/multi-a2a-agent/references/topology-bounded-ring.md).
The coordinator relays each hop; the closing send uses W1's original returned context,
`blocking:false`, and no prior task ID. Require a distinct closing task ID.

In [the bounded assessment](https://github.com/tbrandenburg/opencode-a2a-lite/blob/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs/authorized-live-acceptance.md#additional-bounded-adapter-assessments-2026-10-29),
three tasks completed in 10.182s, 11.708s and 3.464s with 18 paired calls. Both W1
turns appeared in the same worker session and exact artifacts were relayed. This is
reconstructed procedural guidance, not a verbatim prompt or a multi-circuit result.
