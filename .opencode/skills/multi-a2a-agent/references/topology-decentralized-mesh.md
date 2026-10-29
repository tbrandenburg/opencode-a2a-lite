# Decentralized mesh

Read the skill's common preparation, submission, verification and cleanup rules first.

## Control and inputs

Let selected worker sessions call reviewed peer workers through their own local
guards. Treat the allowed graph as permissions, not a requirement to exercise every
edge. Obtain an exact non-self peer set per caller, one finite delegation-wave rule,
an explicit no-forwarding rule for recipients, and independently supervised budgets.

## Procedure

1. Review temporary worker-side agent permissions and each exact non-self peer guard.
   Do not add production delegation support or broaden peers to obtain a result.
2. Verify tools on the actual initiating worker server, not just the coordinator's
   catalog. Confirm recipient behavior forbids recursive fanback or another wave.
3. Have the coordinator seed the reviewed root worker with one bounded task. Begin
   with one useful approved worker-originated edge rather than a whole-graph sweep.
4. Have the initiating worker discover/verify its intended peer, explicitly submit
   one nonblocking fresh-context task, retain the returned binding, and poll that
   task under both local and ancestor limits. The recipient does not delegate further.
5. Return the observed completed peer artifact through the initiating worker's root
   result. Have the coordinator inspect that root task's actual terminal artifact.
6. Stop after the approved wave. Any additional edge needs an explicit finite scope
   and remaining supervised budget; never reconnect to reset a connection's count.

## Root prompt sketch

> Make one reviewed peer call through your own guarded tools, explicitly nonblocking.
> The recipient must answer without delegation. Keep the actual peer/context/task
> binding, collect the completed artifact, and return it through your root task.
> No self-call, recursion, fanback, repeat wave, guessed handle or uncertain resend.

## Verify and bound

Inspect the worker-originated call in the initiating worker's session; coordinator
calls to the same recipient do not substitute for it. Correlate actual inputs and
artifacts at each gateway and enforce budgets per connection, not just a global
total. One observed edge is not evidence that the whole mesh, cycles, or other
workers' delegation works. Missing worker tools are an execution-layer blocker,
not by themselves evidence of an A2A adapter defect.
