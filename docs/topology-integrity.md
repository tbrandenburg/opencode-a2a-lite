# Topology handoff integrity contract

## Scope and evidence boundary

Issue #22 corrects the example harness after the #23 test-only reduction at
`a670ccd`. The [original findings](/docs/topology-investigation-findings.md) and
original matrix artifacts are unchanged. This document describes a diagnostic
contract, **not a live-model pass or a reliability result**.

The coordinator model still submits through guarded local stdio MCP → pinned
a2abridge 4.0.2 → loopback A2A 1.0 → ACP workers. Host code supplies the fixed
schedule, original input metadata, artifact hashes and in-memory observations;
it does not submit worker requests in place of the model. Bun 1.3.9, OpenCode
2.0.28, 40 connection attempts, eight reserved calls, deadlines and no-resend
rules are unchanged. No provider credentials or global configuration are changed.

## Field-level comparison

`topology-envelope-v1` is deliberately not a generic JSON normalization API.
Only a validated request object with these fields receives a structured digest:

| Field                                                          | Contract                                                                                                                                                                                                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instructions`, `stepId`, `role`, `roleInstructions`, `marker` | Exact parsed string values; no trimming, Unicode normalization or instruction repair.                                                                                                                                                               |
| `final`                                                        | Exact boolean; no coercion/default.                                                                                                                                                                                                                 |
| `inputHashes`                                                  | Exact key/string map, lowercase SHA256 values; keys equal inbound keys.                                                                                                                                                                             |
| `inbound`                                                      | Exact key/string map. Nested artifact strings are opaque: never parsed, reserialized, trimmed or reordered.                                                                                                                                         |
| optional `privateFacts`                                        | Ordered array, at most 11 validated item/bounds/dependency/incompatibility facts. Exact IDs, kinds, values and array order; object-key order is insignificant. Numbers are nonnegative safe integers; negative zero is rejected for integer fields. |

Unknown/missing fields, duplicate object keys (including escaped aliases), invalid
JSON and incorrect types are rejected from structured comparison. Parsing is
bounded to 4 MiB, 4,096 syntax tokens and depth eight. String contents are not
tokenized as nested artifacts. Object keys in the validated envelope/maps/facts
are sorted for hashing; arrays stay ordered and strings stay unchanged. Equivalent
JSON escapes represent the same string, not a rewrite of its value. This is a
restricted schema digest, not a claim of general RFC 8785 conformance.

Legacy non-envelope text remains exact raw-hash comparison, including whitespace.
JSON object/array-looking text that does not match the known schema is invalid,
not an opportunity for generic normalization. The endpoint guard records metadata
only; its URL/tool/budget decisions and forwarded bytes are unchanged.

## Correlation is not content integrity

1. Before dispatch, retain expected raw hash and validated field/digest metadata.
2. Correlate by the approved peer and exact submitted continuation context. Pair
   MCP request/results by connection, request ID and tool; ambiguous results do
   not supply a handle. Missing, repeated and wrong-binding calls have distinct
   finite criteria. Returned real task/context handles remain in the run's handle
   ledger even if semantic validation fails; no handle is fabricated.
3. Compare expected content with guarded-call metadata only under the same known
   contract (or an exact legacy raw hash). Different raw hashes with equal known
   digests mean encoding-only differences. A changed field is not a retry.
4. Require the **actual guarded-call raw hash to equal the actual worker-input raw
   hash**, without a formatting exception on this transport boundary. Retain the
   observed worker hash when extraction can bind an observation, even if subsequent
   integrity validation fails. Worker role, returned task/context and continuation
   context are checked independently. Terminal observations require a paired poll
   for that peer/task (or the original paired send result); an unrelated result
   cannot advance state. Completed artifact hashes remain exact.
5. Operational input integrity uses the same metadata comparison and checks
   captured worker bytes against the corresponding paired send. Missing expected
   submissions cannot become integrity success through a vacuous `every()`.

`operations.guardedPath` establishes a captured single guarded connection/catalog
and paired calls/results, independent of whether MCP returned an error.
`operations.parameterPolicy` separately requires explicit `blocking:false`,
omitted `task_id`, permitted experiment tools and no guard rejection. Omission
does not imply guard bypass, and still fails strict operational acceptance.
Repeated sends and uncertain resubmissions remain independent failures; no code
repairs, retries or reconnects a request.

A local timeout means pending/incomplete when no terminal evidence exists; it
does not mean remote cancellation. Baseline/no-worker route, budget and parameter
checks describe a vacuous no-worker contract, **not MCP delegation evidence**.
Non-review roles have no independent role-specific review requirement (N/A within
role semantics); missing outputs on a required role are unknown/unobserved, not
N/A or pass. Final correctness/proof checks remain unknown until their required
answer exists. Objective answers, authoritative facts and proof oracles are not
relaxed by this change.
Operational input integrity remains unknown until matching worker inputs are
observed, unless captured evidence proves corruption first. A locally aborted
wait without completed guarded-route evidence is unknown, not proof of bypass.

## Sanitized failure evidence

Submission mismatch diagnostics contain expected/observed raw hashes, an
encoding-only flag, finite known field names and a malformed-envelope flag.
Contribution errors contain missing/extra/changed/repeated counts and at most 16
SHA256-hashed identifiers. Even a malicious fact ID cannot enter the report as
raw text. Field-hash metadata is explicitly projected to known fields and hash
syntax; private payloads cannot be smuggled through nested metadata objects.
Assertion frame extraction searches the stack for an actual `at` frame in the
allowlisted example modules, rather than truncating before large diffs. Neither
assertion diffs nor exception messages are persisted. Reports retain score
dimensions and real handle provenance, not raw model/provider text.

## Counterexample checklist and maintained workload disclosure

The suite grows from 69 to **70 expanded cases**, using one spare case. No old
parameter table is restored. The existing N11 property checks remain three
64-subset oracle workloads, unchanged.

- **N19 positive:** reverse envelope keys and pretty-print; `submission()`,
  `workerReceipt()` and operational integrity accept. Expected/observed raw hashes
  differ; guarded and actual-worker raw hashes match.
- **N19 ten fixed semantic mutations:** instruction string, marker, predecessor
  hash, reserialized nested artifact string, reversed private-fact array, changed
  fact cost, role, final flag, role instruction string and step ID. Each fails
  input integrity while one completed send remains not-a-retry.
- **N19 parser representatives:** unexpected field, duplicate `final`, malformed
  object, invalid colon syntax, excessive depth, token count and byte size reject.
  These are seven named fixed parser representatives, not an exhaustive grammar
  corpus. Guard-to-worker byte mutation fails even if the worker input equals the
  original host envelope.
- **N19 policy:** omitted explicit nonblocking and supplied task ID fail policy;
  nonblocking omission does not fail captured guarded-route evidence.
- **N14:** modified single send is not a retry; correlation retains its real
  returned handles. Missing, duplicate, unresolved/uncertain and ambiguous-result
  evidence cannot create successful submissions or invented handles.
- **N15:** wrong peer/context/task, continuation replacement, unrelated/unpaired
  terminal result, changed actual worker input and artifact hash fail at their
  respective boundaries. Missing/changed/repeated facts, inherited proof,
  predecessor hash and final proof corruption stay rejected.
- **N18:** a real large assertion diff with private sentinels still yields an
  allowlisted source frame and no diff text.
- **N17:** persisted JSON/summary/Markdown exclude provider/marker sentinels,
  malicious fact IDs and nested metadata payloads while retaining hashed IDs,
  finite contribution counts, independent dimensions and paired handle provenance.

## Reproduction and pending live gate

Provider-free commands from the worktree root:

```sh
bun test ./tests/agent-network
bun run fmt-check
bun run lint
bun run typecheck
bun run build
bun test ./tests
A2ABRIDGE_BIN=/absolute/path/to/verified/a2abridge make interop-test
```

Interop probes free loopback ports before starting its owned services and drains
owned resources; never stop another owner's listeners. Interop is real-bridge,
controlled-ACP evidence, not live-model topology acceptance. Use a unique ignored
output directory for new diagnostics, never the original matrix directory.

**Live gate remains pending explicit billable opt-in, owned by the coordinator.**
Predeclare V1 coordinator-only reference, pipeline, fanout, refinement and judge
in that order, one attempt each. Require an actual completed model-issued MCP
handoff with exact artifact/proof integrity; retain remaining failures and missing
evidence. Do not retry for a favorable result, run an autonomous/full matrix,
pool new diagnostics with the original matrix or claim an 80% pass rate. A partial
five-case report intentionally leaves the 27-case comparative verdict incomplete.
Stop unsafe continuation if owned cleanup fails.

Research: [RFC 8785 §§3.1, 3.2.3 and Appendix E](https://www.rfc-editor.org/rfc/rfc8785.html)
explain duplicate-key rejection, ordered arrays and immutable string subtypes;
[Bun hashing documentation](https://bun.com/docs/runtime/hashing) confirms
`node:crypto` SHA256 support. Context7 was attempted before implementation but
returned its monthly-quota error; official documentation was used instead.

### Provider-free implementation evidence

| Command                                  | Observed result                                                                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun test ./tests/agent-network`         | 19 pass, zero failures, 970 assertions.                                                                                                                                                                |
| `bun test ./tests`                       | 70 pass across 21 files, zero failures, 1,360 assertions; one observed run took 34.78 s, not a timing benchmark.                                                                                       |
| `bun run fmt-check`                      | 105 matched files formatted.                                                                                                                                                                           |
| `bun run lint`                           | Exit zero; seven existing warnings in `src/`, no new example/test warnings.                                                                                                                            |
| `bun run typecheck` / `bun run build`    | Exit zero.                                                                                                                                                                                             |
| Pinned `make interop-test` command above | Exit zero, `providerFreeContextInterop:true`; first fixture connection used 30 attempts, within 40/eight-reserve limits. Expected terminal-subscription diagnostics appeared during negative fixtures. |
| `git diff --check`                       | Exit zero.                                                                                                                                                                                             |

Interop's owned shutdown/released-port checks passed; an independent process
inspection found zero remaining interop-fixture processes. The worktree's
`make lint` wrapper could not find a worktree-local `node_modules/.bin/oxlint`;
the direct Bun lint/typecheck/build scripts resolved installed ancestor tooling
and passed without dependency/shared-state changes. A test-fixture union typing
error found during development was corrected before the final gates. These are
provider-free results; the five-case live gate above remains pending.
