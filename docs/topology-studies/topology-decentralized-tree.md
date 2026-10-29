# Decentralized tree traffic

**Disclosure status:** `INVESTIGATION-APPROVED`. No verdict or validated procedure exists yet.

**Traffic pattern:** Workers would delegate or route work through a tree without relying solely on the current coordinator-to-worker adapter path.

**Historical evidence:** The topology findings explicitly state that decentralized trees have no verdict and worker-side MCP/delegation permissions were outside scope. See [topology findings](../topology-investigation-findings.md) and [scope issue #42](https://github.com/tbrandenburg/opencode-a2a-lite/issues/42).

## Adapter lens

Do not infer worker-side delegation support from coordinator-to-worker interoperability. User approval has opened issue #42 for a bounded assessment, including manually reviewed, issue-local worker delegation configuration for that experiment. This does not authorize production worker-side tools/delegation, adapter changes, or platform features. If the existing guarded path cannot support the attempt safely, record `BLOCKED`.

## Disclosed steps

None. Issue #42 now has scope approval; add only validated, sanitized steps that identify the adapter boundary exercised. Keep this page incomplete until evidence is reviewed.
