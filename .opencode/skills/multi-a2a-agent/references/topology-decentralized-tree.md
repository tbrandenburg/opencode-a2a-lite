# Decentralized tree

Read the skill's common preparation, submission, verification and cleanup rules first.

## Control and inputs

Let the coordinator seed the root worker. Each parent worker's own model session
issues guarded calls only to its reviewed children; results return through the
parent task. Obtain the exact parent-child map, authorized depth, per-caller budgets,
and ancestor deadlines. Leaves have no outgoing delegation permissions.

## Procedure

1. Prepare and inspect the coordinator's root-only guard and each delegating parent's
   child-only guard. Do not infer worker MCP access from a working coordinator route.
2. Verify agent/tool readiness on the actual server backing each involved worker.
   Use the host's reviewed read-only probes; do not warm a separate inspection server
   and assume the ACP session uses its tool registry.
3. Submit one fresh root task nonblocking. Include the explicit nonblocking argument
   requirement in the instructions every parent will receive and forward to its child.
   Prohibit self-calls, broader peers, unapproved descendants and uncertain resubmits.
4. Have each parent retain its child's actual returned peer/context/task binding,
   poll it to terminal completion, and return the actual stored child artifact. Limit
   the initial probe to a useful approved path; do not expand just to fill the diagram.
5. Independently supervise each child operation and its ancestors. Child deadlines
   must fit inside the remaining parent deadline, not restart or extend it. Count
   calls separately on every worker connection and preserve each reserve.
6. Require the coordinator to observe the root task's terminal state and artifact.
   A completed leaf or child session does not prove a completed root A2A task.

## Root prompt sketch

> Use only your reviewed child peers, at most the approved depth. Explicitly select
> nonblocking submission and require the same argument in every forwarded parent
> instruction. Poll actual returned child handles within both child and ancestor
> limits. Return only completed stored child artifacts. Leaves must not delegate.

## Verify and bound

Inspect each parent worker's actual tool arguments, paired guard receipts, received
child input, and completed artifact separately. Text that resembles a tool call is
not a call. Keep root polling count and elapsed time distinct: do not stop early
under an invented cap or extend the deadline to compensate. Report pending/uncertain
outcomes honestly. A successful path is not a balanced-tree or reliability result.
