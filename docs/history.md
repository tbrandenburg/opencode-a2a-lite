# Historical research and retired managed lab

The managed OpenCode/a2abridge **network and topology runners, fixtures, model
profiles, scorers, schedules and readiness plugin were retired**. They are not
current commands, and their removal did **not** fix historical failures.

The repository now retains a small production ACP → A2A gateway, optional guarded
MCP interoperability helpers, an independently checked provider-free bridge gate,
and manually owned coordination recipes. Live-model success and transport
correctness must still be reported separately.

The original source is available at
[pre-retirement revision `a70b639`](https://github.com/tbrandenburg/opencode-a2a-lite/tree/a70b639/examples/agent-network).
The following deleted working-tree documents remain permanently accessible in
[the pre-cleanup snapshot `c0f718d`](https://github.com/tbrandenburg/opencode-a2a-lite/tree/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs).
They are archived in Git history rather than copied into current operational docs.

| Historical report                                                                                                                                                                                                                                                                                                         | Important retained result                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Network findings](https://github.com/tbrandenburg/opencode-a2a-lite/blob/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs/agent-network-findings.md)                                                                                                                                                                        | Specific guarded MCP/A2A handoffs were observed; not a reliability benchmark. Includes successful and failed attempts and bounded polling/cleanup corrections.                                                                     |
| [Original topology investigation](https://github.com/tbrandenburg/opencode-a2a-lite/blob/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs/topology-investigation.md) and [findings](https://github.com/tbrandenburg/opencode-a2a-lite/blob/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs/topology-investigation-findings.md) | 21 live cases: **5 worked, 16 failed**; six controlled negative experiments worked. Comparative verdict **INCOMPLETE**, not a universally winning topology.                                                                        |
| [Topology integrity contract](https://github.com/tbrandenburg/opencode-a2a-lite/blob/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs/topology-integrity.md) and [diagnostics](https://github.com/tbrandenburg/opencode-a2a-lite/blob/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs/topology-integrity-diagnostics.md)       | Controlled/provider-free implementation checks passed; later **live failures remained unresolved**. Correlating identifiers is not equivalent to exact artifact content integrity.                                                 |
| [Authorized live acceptance](https://github.com/tbrandenburg/opencode-a2a-lite/blob/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs/authorized-live-acceptance.md)                                                                                                                                                          | Production E2E reached five passes and failed at **E2E06**; eight scenarios were not reached. Separate five-case topology subset: **two working, three broken**. Later bounded observations do not erase these once-only failures. |
| [Test reduction](https://github.com/tbrandenburg/opencode-a2a-lite/blob/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs/test-reduction.md) and [361-case decision map](https://github.com/tbrandenburg/opencode-a2a-lite/blob/c0f718d27728d8941f06ecf4b0554b8ecb1c58c9/docs/test-reduction-map.md)                          | Historical test selection went from **361 expanded cases to 69**, with 41 KEEP, 170 REPLACE and 150 REMOVE decisions; later correction added a distinct N19 test. Selected suite is not equivalent permutation coverage.           |

These results were produced under their stated, pinned versions and conditions.
Unmeasured/model-quality dimensions remain unmeasured. Historical commands may
refer to removed paths and should be reproduced only from their original revision,
not from the current checkout.

## Current sources

- [Architecture](architecture.md), [acceptance](acceptance.md) and
  [SDK cancellation/removal gate](sdk-cancellation.md)
- [Guarded interoperability](../interop/README.md) and
  [provider-free host helper guide](../interop/client-guide.md)
- [Manual one-worker](manual-one-worker.md),
  [two-worker bootstrap](manual-two-worker-pipeline.md) and
  [passive supervision](passive-mcp-supervision.md)
- [Scoped topology studies](topology-studies/topology-pipeline.md) and
  [portable OpenCode skill](../.opencode/skills/multi-a2a-agent/SKILL.md)

The dated research and test decisions remain recoverable from Git/issue history;
the active repository does not need to ship their full internal ledgers.
