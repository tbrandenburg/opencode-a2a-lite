# Pipeline

Read the skill's common preparation, submission, verification and cleanup rules first.

## Control and inputs

Use a coordinator-mediated dependency chain. Each worker has its own gateway and
runtime session; workers do not call their successors. Obtain the reviewed ordered
peer list, stage tasks, initial input, and stop condition from the host specification.

## Procedure

1. Discover and verify the exact first peer. Submit one fresh-context nonblocking
   task containing the initial input; retain the returned peer/context/task binding.
2. Observe that actual task within its deadline and poll budget. Stop on failure,
   uncertainty, or pending work at the cutoff; do not advance with a fabricated result.
3. After completion, retain the stored text artifact and its source binding. Have
   the coordinator pass that exact artifact to the next reviewed peer in a new
   independent task. Do not reuse the previous worker's context on another peer.
4. Repeat only for the predeclared stages allowed by the remaining budget. Return
   the last observed artifact, or identify the exact stage where progress stopped.

## Coordinator prompt sketch

> Follow the reviewed stage order. Make every hop through the guarded network tools
> yourself; workers must not relay directly. Submit explicitly nonblocking, poll the
> actual returned handle, and forward only the exact stored completed artifact to
> the next peer. Preserve stage attribution. Never guess handles, resend uncertain
> input, add stages, or exceed the reviewed limits.

## Verify and bound

Correlate each predecessor artifact, coordinator send argument, dispatched input,
successor user message, and successor result. Keep changes introduced by a worker
separate from transport changes. A successful short prefix is evidence only for
those stages, not an arbitrary chain length or a correct final answer.
