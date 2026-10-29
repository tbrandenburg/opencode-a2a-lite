# Bounded-ring traffic

**Disclosure status:** `STUB`. No current executable manual procedure is defined here.

**Traffic pattern:** Bounded worker-to-worker/coordinator relay rounds with an explicit stop condition (historical T6; seven agents including coordinator).

**Historical evidence:** Original T6 was WORKING in 0/3 cases and had 0/3 final answers scored. No later authorized ring case is recorded. See [topology findings](../../../../docs/topology-investigation-findings.md) and [issue #36](https://github.com/tbrandenburg/opencode-a2a-lite/issues/36).

## Adapter lens

Observe only actual guarded A2A calls: exact peer routing, task/context handle continuity, terminal state/artifact reporting, attempt accounting, and cleanup. Do not add rounds, enlarge budgets, or treat a relay-quality failure as an adapter defect.

## Disclosed steps

None yet. Issue #36 is approved for a bounded, prompt-driven adapter investigation. Add only validated steps and sanitized evidence incrementally; do not add a host-side ring runner or a reusable schedule feature.
