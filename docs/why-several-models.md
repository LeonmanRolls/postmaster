# Several models on one ticket

A run can be written two ways. In single-thread mode the coachman writes the change itself. Synthesis mode, which this page is about, works like this.

Two or more models implement the same ticket independently, in separate worktrees, unable
to see each other's work. A coachman combines what each got right, puts the result through
the adversarial review rounds its ticket names, then leaves a ship card for the
project's landing route. Pull-request projects are merged by the user; local-merge projects use
the merge authority in the config.

## Why several models rather than one good one

Because they disagree usefully. Across a sample of runs, the synthesis took contributions
from both lanes every time: not "pick the winner", but one lane's mechanism plus the
other's test, wiring or edge case. And a second lane finding the same defect independently
is corroboration you can act on; a single lane agreeing with itself is not.

Disagreement is also diagnostic. When two lanes build the same mechanism and name it
differently, the project's own conventions did not decide it, and the coachman records the
gap as a proposed rule rather than flipping a coin the next run will flip again.

Running several models is also a way to take full advantage of the competition between
providers. There are many strong models now, from many providers, and they compete hard.
postmaster runs several side by side, so it is not locked into anyone's ecosystem. A lane is
a harness plus a model, each harness sits behind an adapter, and nothing in the flow depends
on one provider's tools. The config says which harness and model fills each role, so moving
a role to a different model is an edit to the config.

Back to the [README](../README.md).
