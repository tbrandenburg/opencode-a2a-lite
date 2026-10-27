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
tokenized as nested artifacts. A forward-only sticky lexer consumes at its current
cursor, including JSON whitespace, and rejects an invalid escape or unterminated
string without searching again at later quotes. Object keys in the validated envelope/maps/facts
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
   New guard call receipts store submitted `context_id`/`task_id` as SHA256
   `contextHash`/`taskHash` plus explicit `contextPresent`/`taskPresent` flags,
   never raw argument strings. Exact expected-ID hashes bind continuations and
   polls; an unknown or explicitly supplied non-string ID is not an omitted ID.
   Genuine returned `contextId`/`taskId` remain actual result values. An unknown
   submitted context echoed by a result is not proof of an ACP conversation:
   receipt-only provenance tracks returned identities per approved peer. Such an
   echo is stored as `contextHash` plus `contextUntrusted:true`, including pending
   results before an eventual failure and later failed polls. A fresh implicit
   returned context and a recognized continuation stay exact, even on failure;
   independently generated task IDs stay exact. Failed task-ID argument echoes
   receive the same protection if not previously returned. The bounded request
   map retains argument hashes, not raw submitted IDs. No forwarded argument or
   MCP result is rewritten, authorized by its hash, or replaced with a guessed handle.
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
   Missing sends remain unobserved (unknown), including interruption after stage
   preparation but before submission; observed changed bytes, extra sends or bad
   bindings still fail independently, even during an abort.

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
Report projection also hashes legacy raw call `context`/`task` fields; historical
receipt files themselves are not rewritten. Paired legacy failed-result echoes
are filtered as well, including their copies in receipts, expectations and the
handle ledger; the actual failure state and generated task ID are retained.
Recognized returned handles remain available in result records, receipts and the
handle ledger, while untrusted identifiers use validated bounded hash metadata.

## Counterexample checklist and maintained workload disclosure

The suite remains at **70 expanded cases** after focused review fixes. No old
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
  Review adds one escaped duplicate-key alias and two malformed-string workloads:
  each has 200,000 escaped quotes (400,006-byte prefix), one ending in invalid
  `\q`, the other unterminated. Both execute in one owned child with a three-second
  OS SIGKILL deadline including startup and verified reaping. These are ten named
  fixed parser representatives, not an exhaustive grammar corpus or timing
  benchmark. Guard-to-worker byte mutation fails even if the worker input equals the
  original host envelope.
- **N19 policy:** omitted explicit nonblocking and supplied task ID fail policy;
  nonblocking omission does not fail captured guarded-route evidence.
- **N14:** modified single send is not a retry; correlation retains its real
  returned handles. Missing, duplicate, unresolved/uncertain and ambiguous-result
  evidence cannot create successful submissions or invented handles.
  The actual stage executor is interrupted at its submit-prompt boundary after
  expectation preparation: zero sends leave integrity unknown/overall incomplete;
  observed corruption still makes an aborted run broken.
- **N15:** wrong peer/context/task, continuation replacement, unrelated/unpaired
  terminal result, changed actual worker input and artifact hash fail at their
  respective boundaries. Missing/changed/repeated facts, inherited proof,
  predecessor hash and final proof corruption stay rejected.
- **N18:** a real large assertion diff with private sentinels still yields an
  allowlisted source frame and no diff text.
- **N17:** persisted JSON/summary/Markdown exclude provider/marker sentinels,
  malicious fact IDs and nested metadata payloads while retaining hashed IDs,
  finite contribution counts, independent dimensions and paired handle provenance.
  Legacy raw unknown context/task arguments and new guard-helper hashes are both
  projected without sentinel content; genuine returned handles remain raw. N19
  checks hashed continuation/poll binding, explicit-null rejection and duplicate
  detection across legacy and new receipt metadata.
  N17 also covers a legacy failed unknown-context reflection and its copied
  receipt/expectation/handle fields, a recognized failed poll, and the actual
  guard helper's pending-to-failed reflection handling. These are fixed named
  flows, not a restored input matrix.

Pinned provider-free interop additionally submits one deliberately unknown
sentinel context through actual guarded MCP → a2abridge → controlled gateway,
then performs one poll of the actual generated task. The unchanged MCP result
echoes the context and truthfully fails with an unknown-context error, without an
ACP prompt. Guard receipts and persisted report-evidence projection exclude the
sentinel while retaining the exact generated task ID, hash and failure state.
Existing fresh/continuation/stale context criteria and no-resend checks remain.

The separate pre-existing quadratic duplicate scan in `verifyContributions()` is
not changed by this envelope/privacy slice; large fact-list hardening remains a
coordinator-owned follow-up, not a claimed fix.

## Reproduction and live acceptance boundary

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

**The user authorized the live gate; it was executed once at `a7f178d`.**
The V1 coordinator reference and fanout worked; pipeline, refinement and judge
failed at their recorded contract checks. The production E2E harness stopped at
E2E06 after five passed scenarios. See the
[authorized live report](/docs/authorized-live-acceptance.md) and follow-ups #27/#28.
Fanout establishes a completed model-issued MCP workflow with exact artifact/proof
integrity; remaining failures and missing evidence are retained. No favorable-result
retry, autonomous/full matrix, pooling with original observations or 80% pass-rate
claim follows. Cleanup passed, and future paid reproduction requires another
explicit decision after the bounded diagnostic follow-ups.

Research: [RFC 8785 §§3.1, 3.2.3 and Appendix E](https://www.rfc-editor.org/rfc/rfc8785.html)
explain duplicate-key rejection, ordered arrays and immutable string subtypes;
[Bun hashing documentation](https://bun.com/docs/runtime/hashing) confirms
`node:crypto` SHA256 support. Context7 was attempted before implementation but
returned its monthly-quota error; official documentation was used instead.

### Historical provider-free evidence at `8ad715e`

The following retained results predate the reflected-result privacy correction
and expanded interop write scope. Current validation follows this historical record.

| Command                                  | Observed result                                                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun test ./tests/agent-network`         | 19 pass, zero failures, 1,002 assertions.                                                                                                                                                                          |
| `bun test ./tests`                       | 70 pass across 21 files, zero failures, 1,392 assertions; one observed review-fix run took 33.45 s, not a timing benchmark.                                                                                        |
| `bun run fmt-check`                      | 105 matched files formatted.                                                                                                                                                                                       |
| `bun run lint`                           | Exit zero; seven existing warnings in `src/`, no new example/test warnings.                                                                                                                                        |
| `bun run typecheck` / `bun run build`    | Exit zero.                                                                                                                                                                                                         |
| Pinned `make interop-test` command above | Review-fix run failed at `receipts-and-budget`: the external fixture still requires raw `call.context`, now intentionally hashed. Earlier context/deadline/cancel boundaries ran; later subcases were not reached. |
| `git diff --check`                       | Exit zero.                                                                                                                                                                                                         |

Interop's owned shutdown/released-port checks passed despite that fixture failure;
independent binds to its four printed loopback ports confirmed release. The
fixture's assertion must check `contextPresent` and the SHA256 of the actual
returned context, and `taskPresent:false`, before complete real-bridge acceptance
can be claimed. That fixture update is outside this focused fix's write scope.
The worktree's
`make lint` wrapper could not find a worktree-local `node_modules/.bin/oxlint`;
the direct Bun lint/typecheck/build scripts resolved installed ancestor tooling
and passed without dependency/shared-state changes. Two temporary type-narrowing
errors and new lexer/test-size lint warnings found during review-fix development
were corrected before the final deterministic gates. Restoring the original
lexer, legacy raw-field projection and missing-send predicate made N19/N17/N14
fail respectively (one focused run: one pass, three failures); those temporary
faults were removed. At that revision, complete interop acceptance was blocked as
described above. The follow-up below resolved that blocker before the separately
recorded authorized live gate.

### Reflected-result privacy correction: retained worktree validation

The interop fixture now checks `contextPresent`, the exact SHA256 of the actual
returned context, and `taskPresent:false`, plus exact fresh/continuation/stale
returned identities. It does not drop the earlier identity assertion.

| Command                               | Observed result                                                                                                                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun test ./tests/agent-network`      | 19 pass, zero failures, 1,010 assertions.                                                                                                                                                            |
| `bun test ./tests`                    | 70 pass, zero failures, 1,400 assertions, 21 files, 35.27 s (one observation, not a benchmark).                                                                                                      |
| `bun run fmt-check`                   | 105 matched files formatted.                                                                                                                                                                         |
| `bun run lint`                        | Exit zero; seven baseline `src/` warnings, no new warnings.                                                                                                                                          |
| `bun run typecheck` / `bun run build` | Exit zero.                                                                                                                                                                                           |
| Pinned `make interop-test`            | Exit zero; `providerFreeContextInterop:true`, `untrustedContextReflectionSanitized:true`; final separately planned fixture connections used 29 and 16 attempts, each within 40/eight-reserve limits. |

Interop's owned shutdown/released-port checks passed; independent bind probes
confirmed release, and process inspection found no remaining fixture/proxy
processes from this worktree. Expected terminal-subscription diagnostics appeared
during the controlled negative fixtures.

Temporarily restoring pre-filter guard result logging made the real-bridge
reflection probe fail at receipt privacy; the restored filter passed complete
acceptance. One full deterministic run recorded two fixture-marker timeouts
(H03/H04); those unchanged tests passed in isolation and the next standalone full
run passed 70/70 without deadline or assertion changes. Those earlier failures
are retained rather than presented as a clean first attempt. No live-model or
paid acceptance was run in that implementation worktree. The subsequent
[coordinator checks](/docs/topology-integrity-diagnostics.md) include the merged
#23 fixes; the [authorized live observations](/docs/authorized-live-acceptance.md)
remain a separate evidence class with unresolved failures.
