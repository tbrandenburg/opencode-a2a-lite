# Diamond

Read the skill's common preparation, submission, verification and cleanup rules first.

## Control and inputs

Use a coordinator, a planner, two independent reviewers, and an integrator. The
coordinator relays the planner's common artifact to both branches, then joins the
reviewer artifacts at the integrator. There are no direct worker-to-worker calls.
Obtain the reviewed peers, branch assignments, join requirements and stop policy.

## Procedure

1. Submit one fresh-context nonblocking planner task. Observe its actual completion
   and retain the original stored artifact and binding.
2. Have the coordinator submit separate independent tasks to both reviewer peers,
   each containing the same planner artifact unchanged and its own branch assignment.
   Submit both before polling when branch overlap is part of the reviewed traffic.
3. Retain distinct reviewer peer/context/task bindings. Poll each within its own
   deadline and collect the actual completed artifact without mixing branch identities.
4. Once the required branches complete, submit a fresh nonblocking integrator task
   containing both original reviewer artifacts, labeled separately. Do not replace
   either review with a coordinator summary or reuse a reviewer context on the join peer.
5. Collect the integrator's actual terminal artifact. Stop if a required branch or
   join is uncertain; a partial result is not proof that the missing join ran.

## Coordinator prompt sketch

> Get P's completed artifact, send it unchanged to R1 and R2 as separate tasks, and
> preserve each branch's identity. Give I both exact completed reviews, separately
> labeled. Explicitly submit nonblocking and poll actual returned handles. Do not
> collapse the branches, invent join inputs, or add review rounds.

## Verify and bound

Check planner input provenance independently for each reviewer and both reviewer
artifacts independently at the integrator. Inspect the integrator's stored artifact,
not just the coordinator's final prose. Context isolation and intact joins do not
establish high-quality reviews, integration quality, or repeatability.
