# Decentralized tree traffic

**Disclosure status:** `RECOVERED-TWO-HOP-PATH`. Corrected nonblocking C→W1→W2→W4 traffic was observed; sibling branches and the full tree remain unverified.

**Traffic pattern:** Workers would delegate or route work through a tree without relying solely on the current coordinator-to-worker adapter path.

**Historical evidence:** The topology findings explicitly state that decentralized trees have no verdict and worker-side MCP/delegation permissions were outside scope. See [topology findings](../topology-investigation-findings.md) and [scope issue #42](https://github.com/tbrandenburg/opencode-a2a-lite/issues/42).

## Adapter lens

Do not infer worker-side delegation support from coordinator-to-worker interoperability. User approval has opened issue #42 for a bounded assessment, including manually reviewed, issue-local worker delegation configuration for that experiment. This does not authorize production worker-side tools/delegation, adapter changes, or platform features. If the existing guarded path cannot support the attempt safely, record `BLOCKED`.

## Recovered procedure and evidence

Use the [reviewed setup](/docs/manual-one-worker.md), then load the portable
[tree instructions](/.opencode/skills/multi-a2a-agent/references/topology-decentralized-tree.md).
For the observed path, C's guard allowed only W1; W1's allowed W2/W3; W2's W4/W5;
W4 had no outgoing tools. Only W1/W2/W4 were started. Review tools on their actual
ACP-owned private servers using read-only probes; do not modify shared service state.

Explicitly propagate `blocking:false` to each parent and its forwarded task text.
Independently supervise each 30-second submit-plus-wait deadline, poll allowance of
up to eight spaced calls, and 32/40 ordinary-call ceiling per guard connection. A
child's limit cannot extend its ancestor's deadline. C must collect a terminal root
task artifact, not infer completion from worker sessions or CLI exit zero.

The [third targeted correction](/docs/authorized-live-acceptance.md#42-three-targeted-corrections-2026-10-29)
observed terminal tasks in 14.502s, 9.127s and 3.605s with C/W1/W2 call totals
11/6/3. Actual inputs, handles, and artifacts correlated; each send was nonblocking.
The baseline and two incomplete corrections remain retained. The approved attempt
cap is exhausted: these instructions do not authorize another live run or validate
unvisited siblings, reliability, or the full seven-worker tree.
