# Bounded-ring traffic

**Disclosure status:** `STUB`. No current executable manual procedure is defined here.

**Traffic pattern:** Bounded worker-to-worker/coordinator relay rounds with an explicit stop condition (historical T6; seven agents including coordinator).

**Historical evidence:** Original T6 was WORKING in 0/3 cases and had 0/3 final answers scored. No later authorized ring case is recorded. See [topology findings](../../../../docs/topology-investigation-findings.md) and [issue #36](https://github.com/tbrandenburg/opencode-a2a-lite/issues/36).

## Adapter lens

Observe only actual guarded A2A calls: exact peer routing, task/context handle continuity, terminal state/artifact reporting, attempt accounting, and cleanup. Do not add rounds, enlarge budgets, or treat a relay-quality failure as an adapter defect.

## Disclosed steps

None yet. Add validated adapter-focused steps incrementally through issue #36. Any ring schedule remains unavailable until separately reviewed and authorized.
