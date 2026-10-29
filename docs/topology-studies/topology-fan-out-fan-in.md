# Fan-out / fan-in traffic

**Disclosure status:** `STUB`. Historical feasibility exists; no current multi-worker procedure is defined here.

**Traffic pattern:** Coordinator dispatches separable work to concurrent workers, then collects/synthesizes their results (historical T2; seven agents including coordinator).

**Historical evidence:** Two of three original cases worked and both scored final answers were correct. A separate authorized run completed with six workers and passed recorded handoff/integrity/correctness/operations checks. These are not reliability evidence or validation through the current manual `opencode run` baseline. See [topology findings](../topology-investigation-findings.md), [authorized results](../authorized-live-acceptance.md), and [issue #39](https://github.com/tbrandenburg/opencode-a2a-lite/issues/39).

## Adapter lens

Prioritize whether each actual guarded MCP call is bound to its approved peer, each returned task/context is tracked correctly, task artifacts are decoded without cross-worker leakage, and cleanup is owned. Do not grade parallelism or synthesis quality as adapter correctness.

## Disclosed steps

None yet. Issue #39 is approved for a bounded, prompt-driven adapter investigation. Add validated steps incrementally; use only the issue-reviewed peers and setup, and do not recreate a host-side runner or expand the production adapter contract.
