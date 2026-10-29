# Fan-out / fan-in

Read the skill's common preparation, submission, verification and cleanup rules first.

## Control and inputs

Use a coordinator to dispatch independent tasks and synthesize the returned
contributions itself. Workers have no peer-call permissions. Obtain the approved
worker set, task decomposition, collection policy and synthesis requirements.

## Procedure

1. Verify the exact worker peers. Submit one independent fresh-context task to each
   approved worker with explicit nonblocking mode. Retain each returned binding.
2. When testing overlap, issue the independent submissions before polling any task;
   do not use a host-side batch caller to enforce that ordering.
3. Observe each task using its own peer and returned task ID. Track separate absolute
   deadlines and poll allowances while reserving the coordinator's shared call budget.
4. Collect only observed terminal artifacts. If a required task is failed, uncertain
   or pending at its cutoff, report the missing contribution; do not manufacture it.
   Use partial synthesis only if the predeclared host policy permits it.
5. Have the coordinator synthesize from the collected artifacts with attribution,
   after applying the approved collection policy. Stop without extra worker rounds.

## Coordinator prompt sketch

> Submit the reviewed independent tasks nonblocking before polling. Keep a separate
> peer/context/task binding per worker; never share contexts between workers. Collect
> actual completed artifacts under their deadlines, then synthesize them yourself.
> Clearly identify missing contributors and distinguish synthesis quality from
> adapter evidence. No retries, hidden substitutes or additional rounds.

## Verify and bound

Observe actual submission and working-state timestamps; do not equate desired
parallelism with observed overlap. Verify each input and stored artifact against
its worker session and correlate the artifacts used by the coordinator. No busy
rejection on independent gateways proves same-gateway busy admission behavior.
A small fan-out does not establish the full declared worker count or scale.
