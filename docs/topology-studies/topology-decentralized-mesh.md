# Decentralized mesh traffic

**Disclosure status:** `RECOVERED-ONE-EDGE-WAVE`. One worker-originated W1→W2 edge was observed; a full mesh remains unverified.

**Traffic pattern:** Workers would route or delegate across a mesh rather than only through the coordinator's guarded peer list.

**Historical evidence:** The topology findings explicitly state that decentralized meshes have no verdict and worker-side MCP/delegation permissions were outside scope. See [topology findings](../topology-investigation-findings.md) and [scope issue #41](https://github.com/tbrandenburg/opencode-a2a-lite/issues/41).

## Adapter lens

Do not infer worker-to-worker support from the current guarded coordinator route. User approval has opened issue #41 for a bounded assessment, including manually reviewed, issue-local worker delegation configuration for that experiment. This does not authorize a production delegation feature, adapter/guard changes, or new platform infrastructure. If the existing guarded path cannot support the attempt safely, record `BLOCKED`.

## Recovered procedure and evidence

Use the [reviewed setup](/docs/manual-one-worker.md), then load the portable
[mesh instructions](/.opencode/skills/multi-a2a-agent/references/topology-decentralized-mesh.md).
For this approved assessment, each worker guard's peer set contained only the other
three workers; C could reach only W1. Temporary network-tool permissions applied
to the reviewed worker agents; only one W1→W2 wave was requested, with no fanback.

In [the bounded assessment](/docs/authorized-live-acceptance.md#additional-bounded-adapter-assessments-2026-10-29),
W1's actual ACP/OpenCode session made the child call nonblocking. The child completed
in 6.361s and its exact artifact returned through W1's root task in 18.357s. C and
W1 recorded 9 and 6 paired calls. No other permitted edge or recursive wave was
tested; this is not permanent production delegation support.
