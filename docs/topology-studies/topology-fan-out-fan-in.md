# Fan-out / fan-in traffic

**Disclosure status:** `RECOVERED-THREE-WORKER-PREFIX`. Three-worker fan-out/fan-in was observed; this is not a new six-worker result.

**Traffic pattern:** Coordinator dispatches separable work to concurrent workers, then collects/synthesizes their results (historical T2; seven agents including coordinator).

**Historical evidence:** Two of three original cases worked and both scored final answers were correct. A separate authorized run completed with six workers and passed recorded handoff/integrity/correctness/operations checks. These are not reliability evidence or validation through the current manual `opencode run` baseline. See [topology findings](../topology-investigation-findings.md), [authorized results](../authorized-live-acceptance.md), and [issue #39](https://github.com/tbrandenburg/opencode-a2a-lite/issues/39).

## Adapter lens

Prioritize whether each actual guarded MCP call is bound to its approved peer, each returned task/context is tracked correctly, task artifacts are decoded without cross-worker leakage, and cleanup is owned. Do not grade parallelism or synthesis quality as adapter correctness.

## Recovered procedure and evidence

Use the [reviewed setup](/docs/manual-one-worker.md), then load the portable
[fan-out/fan-in instructions](/.opencode/skills/multi-a2a-agent/references/topology-fan-out-fan-in.md).
Have OpenCode submit independent nonblocking tasks before polling, track each
actual binding, and synthesize only after the required terminal artifacts are observed.

In [the bounded assessment](/docs/authorized-live-acceptance.md#additional-bounded-adapter-assessments-2026-10-29),
three workers were observed working in the first poll round and completed in
13.640s, 13.638s and 13.775s with 14 paired calls. Exact inputs and artifacts were
correlated into coordinator synthesis. The remaining three workers and synthesis
quality were not tested. No host batch runner was added.
