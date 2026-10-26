# SDK cancellation persistence

Tracking: [gateway issue #1](https://github.com/tbrandenburg/opencode-a2a-lite/issues/1).
Upstream defect report: [a2aproject/a2a-js#798](https://github.com/a2aproject/a2a-js/issues/798).
Keep #1 open until a published official SDK release passes the removal checks below.
The local regression work does not fix the upstream SDK.

## Decision and ownership

Retain [the request-handler adapter](/src/request-handler.ts) with the exactly pinned
`@a2a-js/sdk` 1.3.0. Registry inspection during this work returned `latest: 1.3.0`
and `next: 1.3.0`; no fixed published upgrade was available in that check.

The SDK remains responsible for the task store, event bus, request handling and
artifact merging. The adapter observes terminal saves through the public
`TaskStore` contract and invokes the public `AgentExecutor.cancelTask` API. It
does not add another task database, event engine, content deduplication or fork.
An executor cancel request is not confirmation: the original execution result
determines canceled/completed/failed state. Completion or failure winning the race
must make cancellation fail, not overwrite that truthful terminal state.

SDK 1.3.0 source (`29417a5bb4038f804f310ce4fffd267a9375aa90`):

- [Send paths and original persistence consumer](https://github.com/a2aproject/a2a-js/blob/29417a5bb4038f804f310ce4fffd267a9375aa90/src/server/request_handler/default_request_handler.ts#L631-L785).
- [Cancellation adds a queue and another ResultManager](https://github.com/a2aproject/a2a-js/blob/29417a5bb4038f804f310ce4fffd267a9375aa90/src/server/request_handler/default_request_handler.ts#L827-L903).
- [Append processing reloads and concatenates](https://github.com/a2aproject/a2a-js/blob/29417a5bb4038f804f310ce4fffd267a9375aa90/src/server/result_manager.ts#L285-L335).

Independent consumers receive the same publication. Serialized writes prevent
lost updates but do not prevent reapplying an append. Equal text is legitimate:
two consecutive `B` chunks must remain two chunks, and the final empty
`lastChunk` append must remain present exactly once. Deduplicating by content or
artifact ID would corrupt valid output.

## Portable stock-SDK reproducer

[scripts/repro-sdk-cancellation.mjs](/scripts/repro-sdk-cancellation.mjs) imports
only Node built-ins and the SDK's public package exports. It needs no gateway,
OpenCode, ACP subprocess, credentials, model or network service. It has a five
second watchdog and explicit save/cancellation-entry barriers rather than timing
an overlap with sleeps. Node 22+ with `Promise.withResolvers` is required.

From this checkout after installing frozen dependencies:

```sh
node scripts/repro-sdk-cancellation.mjs 0
node scripts/repro-sdk-cancellation.mjs 1
node scripts/repro-sdk-cancellation.mjs 2
```

The `0` control must exit 0. With stock 1.3.0 the `1` and `2` commands
**intentionally exit 1** on the exact-artifact assertion. This is an upstream
defect demonstration, not a normal passing test-suite command. Exit 2 means the
watchdog fired, which is inconclusive for the append assertion.

| Pending cancel requests | Published parts    | Stored parts on stock 1.3.0              |
| ----------------------: | ------------------ | ---------------------------------------- |
|                       0 | `["A","B","B",""]` | `["A","B","B",""]`                       |
|                       1 | `["A","B","B",""]` | `["A","B","B","B","B","",""]`            |
|                       2 | `["A","B","B",""]` | `["A","B","B","B","B","B","B","","",""]` |

For an independent upstream report, copy the script into a disposable directory
and install only the pinned SDK there:

```sh
REPRO=$(mktemp -d)
cp scripts/repro-sdk-cancellation.mjs "$REPRO/repro.mjs"
npm install --prefix "$REPRO" --ignore-scripts --no-audit --no-fund @a2a-js/sdk@1.3.0
node "$REPRO/repro.mjs" 1
```

The store observer in this script delegates to one SDK `InMemoryTaskStore`; it
only signals when the initial artifact has been saved. No SDK internals are
patched. The normal suite separately asserts the known stock defect so it can
stay green while the standalone reproducer expresses the desired invariant.

## Generator lifetime is not HTTP connection lifetime

There are three different boundaries, exercised separately:

1. **Explicit public-generator `return()`:** SDK `sendMessageStream` stops its
   event queue in `finally`. That generator was the original persistence owner.
   After saving `A`, closing it, and then canceling, the adapter has no consumer
   left to save `B`, `B`, the empty final append, or the terminal event. Cancellation
   rejects at the adapter deadline; `GetTask` stays working with only `A`. The
   stock SDK's extra cancellation consumer happens to take over in this case.
   This is a known limitation, not a supported recovery path or a false success.
2. **Paused public-generator iteration:** events remain queued, but persistence
   waits for the next iteration. Resuming within the adapter deadline lets the
   original owner persist the exact artifact and cancel successfully. A client
   that holds the generator paused indefinitely cannot expect cancellation to
   finish successfully through this adapter.
3. **Real JSON-RPC HTTP disconnect/paused socket reads:** the current Express SDK
   loop continues iterating and calling `response.write`; it does not explicitly
   close the generator on disconnect or await write backpressure. The new real
   HTTP probes destroy a response socket after `A`, or pause the response before
   a 4 MiB repeated-chunk burst. Cancellation still reaches the truthful terminal
   save while reads are paused. Resuming a connected reader yields text identical
   to storage, including the empty `lastChunk` append.

The HTTP probes use an actual ACP subprocess, gateway, SDK middleware and TCP
connection, with an atomically allocated ephemeral loopback port. They do not
mock execution or call generator `return()` as a substitute for disconnect.
They cover canceled-winning and completed-winning outcomes. A paused socket and
large response do not prove a particular kernel buffer threshold or bounded
memory usage on every platform. These tests are **not** a general backpressure
or resource-exhaustion guarantee. A future transport that closes or stops driving
the generator must re-evaluate persistence ownership before adopting that change.

An upstream fix needs one persistence owner independent of generator lifetime,
or a safe takeover after closure without simultaneous append writers. Merely
deleting the cancellation ResultManager does not solve both boundaries.

## Regression commands and removal gate

```sh
bun test ./tests/request-handler-cancellation.test.ts ./tests/cancellation-transport.test.ts
bun test ./tests/cancellation.test.ts
bun run typecheck
bun test ./tests
```

The focused SDK tests cover streaming, blocking and nonblocking sends; zero,
one and two concurrent cancels; canceled/completed/failed execution results;
terminal-before-cancel and repeated cancel; missing task; executor cancellation
rejection and nonsettlement; explicit generator closure and paused iteration.
Checks compare exact parts rather than deduplicated or substring-only text.
The adapter timeout tests verify bounded rejection without invented terminal
state, then finish the actual execution and check its persisted completion.

Remove or shrink the adapter only after an exactly pinned **published official
release** passes the stock reproducer, the wrapper's behavioral matrix and the
transport/lifetime checks with a defined persistence owner. Update known-defect
expectations deliberately when upgrading; do not retain assertions that require
an old SDK bug after it is fixed. Also run the existing cancellation, shutdown,
compiled-process and authorized live CLI acceptance checks at integration time.
An upstream patch, PR title or version bump alone is insufficient evidence.
