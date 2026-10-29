# Propose–critique–revise

Read the skill's common preparation, submission, verification and cleanup rules first.

## Control and inputs

Use one coordinator, a proposer, and a separate critic. The coordinator relays
artifacts; the critic does not contact the proposer. Obtain the task, peer mapping,
and a bounded proposal/critique/revision sequence from the host specification.

## Procedure

1. Submit the proposal task to the proposer with a fresh context and explicit
   nonblocking mode. Retain its actual peer/context/task binding.
2. Poll until completed within the operation limit; retain the exact proposal artifact.
3. Submit an independent nonblocking task to the critic containing that proposal
   unchanged. Keep criticism instructions separate from the quoted artifact.
4. After the critic completes, pass its actual critique unchanged to a new proposer
   task in the proposer's original context. Omit the old task ID where required by
   the continuation contract; verify the returned context and distinct new task ID.
5. Collect the completed revision artifact and stop. Do not add critique cycles to
   improve answer quality or retry an uncertain proposal/revision.

## Coordinator prompt sketch

> Obtain P's proposal, pass the exact completed artifact to K, then pass K's exact
> completed critique back to P using P's original returned context and a new task.
> Explicitly select nonblocking submission each time and poll only returned handles.
> Keep semantic quality separate from verified transport, continuation and artifacts.

## Verify and bound

Compare received proposal and critique inputs against their actual source artifacts.
Inspect both proposer turns in the continuing worker session. A completed revision
and correct task bindings do not prove the critic found a defect or the answer
improved. Report these as separate, unscored observations unless explicitly assessed.
