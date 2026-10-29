# Bounded ring

Read the skill's common preparation, submission, verification and cleanup rules first.

## Control and inputs

Use a coordinator-mediated relay with a predeclared finite visit list and one
closing visit to the starting worker. This is not a worker-to-worker network or an
instruction to loop indefinitely. Obtain the exact peers, visit order, closure
input, and termination rule from the host specification.

## Procedure

1. Submit the first fresh-context task nonblocking. Retain its exact peer and the
   returned context/task binding; preserve this original context for the closure.
2. Poll to terminal completion and retain the actual artifact. Have the coordinator
   relay it through the remaining approved visits as independent peer-bound tasks.
3. After the final relay completes, submit the actual closing input to the original
   peer in its original returned context. Follow the adapter's continuation contract:
   create a new task without the prior task ID when required.
4. Verify the closing response preserves the context and returns a distinct task ID.
   Poll that new task to terminal completion, collect its artifact, and stop.

## Coordinator prompt sketch

> Execute only the reviewed finite relay and one closure. Preserve the starting
> worker's actual returned context. Close on that same peer with a new nonblocking
> task, not by resending or polling the first task. Forward actual artifacts and
> retain distinct task IDs. Do not add a second circuit or replace an uncertain task.

## Verify and bound

Inspect the starting worker's session for both received turns. Confirm exact
handoffs, same-peer/context continuation, distinct task IDs, and terminal artifacts
separately. Merely invoking a similarly named worker again proves no continuity.
A reduced ring closure does not validate additional workers or repeated circuits.
