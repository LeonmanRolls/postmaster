---
title: Combining models
type: concept
standing: claimed
sources: []
updated: 2026-09-25
---

# Combining models

The hypotheses behind the tool, each with its standing and the measurement that would move
it. Standings follow [the schema](../schema.md). As of the wiki's first day every hypothesis is
**claimed**: the README states them from runs made before the ledger existed, so nothing here
can cite a `[@runs/...]` record yet. Each hypothesis names the measurement that would move it,
and ingest updates the standing when a run record bears on it.

## H1. Contributions are complementary

*The synthesis takes something from more than one lane: one lane's mechanism with another's
test, wiring or edge case, rather than one lane's work whole.*

Standing: **claimed** (README, from an unrecorded sample).

What would settle it: for each run record, the list of what the synthesis took from each
lane, as the coachman's synthesis note records it. Supported when, across at least three
runs, no synthesis took everything from one lane. Refuted when the winner-take-all case is
the common one.

## H2. Independent corroboration is actionable

*A defect that two lanes find independently is one to act on; a single lane's finding, or a
lane agreeing with itself across rounds, is not evidence of the same weight.*

Standing: **claimed**.

What would settle it: per run, the review findings with the lane that made each, whether a
second lane made it independently, and whether it held up (was fixed and stayed fixed
through the gate, or was dismissed). Supported when corroborated findings hold up at a
clearly higher rate than uncorroborated ones. The control is the uncorroborated rate.

## H3. Disagreement is diagnostic

*When two lanes build the same mechanism and name or shape it differently, the project's own
conventions did not decide it, and the gap is a rule the project lacks.*

Standing: **claimed**.

What would settle it: per run, each disagreement the coachman recorded as a proposed rule,
and whether the next run on that project met the same fork. Supported when recorded rules
stop the fork recurring.

## Open questions

These have no claim yet, only a measurement waiting for runs.

- **Does a third lane add anything?** Compare what the synthesis and the reviews took from a
  third lane against its cost, on tickets otherwise alike.
- **Does vendor diversity matter?** Two lanes from different vendors against two models from
  one vendor: do the complementary contributions of H1 and the corroboration of H2 depend
  on it?
- **Do blinkers matter?** Lanes that cannot see each other's work are the architecture's
  premise. A run where they could would test it, and would need a deliberate design.
- **What does it cost?** Tokens and wall-clock per shipped ticket, against a single-lane
  baseline on the same ticket.

Whether harness diversity matters, independent of the model, has left this list: it now has a
claim, a design and a decision rule of its own in [harness diversity](harness-diversity.md).

## Evidence

None recorded yet. Run records live in [sources/](../sources/index.md), compiled from
`raw/runs/`; until one exists, every standing above is `claimed` by definition.
