# Competing proposals / judge

Read the skill's common preparation, submission, verification and cleanup rules first.

## Control and inputs

Use a coordinator, independent proposers, and a separate judge. The coordinator
collects and forwards artifacts; proposers never call the judge. Obtain the reviewed
peers, common candidate/task input, comparison instructions and fan-in stop policy.

## Procedure

1. Discover the exact proposer and judge peers. Submit each proposal independently
   with explicit nonblocking mode and a fresh context; retain separate bindings.
2. When overlap is part of the reviewed traffic, submit the approved independent
   tasks before polling. Retain each submission's own absolute deadline.
3. Observe each actual task within its own limits. Require the source artifacts
   needed by the approved fan-in policy; never invent a missing proposal.
4. Have the coordinator submit one new judge task containing the original collected
   artifacts unchanged, separately labeled by source. Do not silently paraphrase or
   select a favorite before the judge sees the inputs.
5. Observe the judge's actual terminal task and stored artifact. Report missing
   proposals or integrity uncertainty explicitly rather than attributing them to
   judge reasoning. Stop after the predeclared comparison.

## Coordinator prompt sketch

> Collect independent proposals using fresh nonblocking tasks. Keep source handles
> separate. Once the required proposals are completed, give J their exact original
> artifacts, separately labeled. Poll J's actual returned handle and stop. Do not
> substitute summaries, invent a vote, or resend uncertain proposals.

## Verify and bound

Correlate each proposal artifact with the judge's received input, including nested
strings or formatting when exact text is required. Distinguish tool-argument changes
from transport changes. Receiving intact inputs does not establish a good selection,
and a small proposer set does not establish larger fan-in capacity or reliability.
