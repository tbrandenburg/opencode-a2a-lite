# Decentralized mesh traffic

**Disclosure status:** `INVESTIGATION-APPROVED`. No verdict or validated procedure exists yet.

**Traffic pattern:** Workers would route or delegate across a mesh rather than only through the coordinator's guarded peer list.

**Historical evidence:** The topology findings explicitly state that decentralized meshes have no verdict and worker-side MCP/delegation permissions were outside scope. See [topology findings](../topology-investigation-findings.md) and [scope issue #41](https://github.com/tbrandenburg/opencode-a2a-lite/issues/41).

## Adapter lens

Do not infer worker-to-worker support from the current guarded coordinator route. User approval has opened issue #41 for a bounded assessment, including manually reviewed, issue-local worker delegation configuration for that experiment. This does not authorize a production delegation feature, adapter/guard changes, or new platform infrastructure. If the existing guarded path cannot support the attempt safely, record `BLOCKED`.

## Disclosed steps

None. Issue #41 now has scope approval; add only validated, sanitized steps that identify the adapter boundary exercised. Keep this page incomplete until evidence is reviewed.
