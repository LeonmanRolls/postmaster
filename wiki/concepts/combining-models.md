---
title: Combining models
type: concept
standing: claimed
sources: [runs/2026-09-26-postmaster-36, trials/2026-09-29-synthesis-audit]
updated: 2026-09-29
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

Standing: **claimed**. The README states it from an unrecorded sample. An audit of 25 runs
now bears on it but cannot move it. The audit reads the runs' own records and counts their
branches in git; it promotes no run, and only a run record moves a standing.

So far, the audit covers every run that reached synthesis by 2026-09-29: 16 against this
repository and 9 fixture runs, each with luna on `gpt-6-luna` and mimo on `mimo-v2.6-pro`
[@trials/2026-09-29-synthesis-audit/results.md].

- **The coachman's record cannot fail the test this page used to give.** All 25 SYNTHESIS
  lines name something taken from each lane
  [@trials/2026-09-29-synthesis-audit/synthesis-lines.txt], so no synthesis took everything
  from one lane. But `skills/postmaster/coachman.md` requires `took=` to name a contribution
  from every lane that produced work, and has since the repository's first commit
  [@trials/2026-09-29-synthesis-audit/method.md]. In #106 the line credits luna with a README
  sentence "identical to mimo's".
- **Counted in git, the second-ranked lane's share varies widely.** Its share of the synthesis,
  as runs of six words found in its diff and not in the first lane's, was 2% or less in 8 runs
  (#105, #106, #108, #116, #121, todo-fixture-4, todo-fixture-6 and todo-fixture-8) and 10% or
  more in 15 [@trials/2026-09-29-synthesis-audit/share.md].
- **On this repository's tickets the second lane's part was often substantive.** Read from the
  cards, it supplied a core mechanism, a script, half the feature or a fix in 8 of the 16 runs
  (#18, #38, #81, #109, #112, #114, #122, #124), small real items in 4 (#80, #116, #121, #135),
  and trivial or identical items in 4 (#105, #106, #108, #113). These classes are one reader's
  judgement [@trials/2026-09-29-synthesis-audit/results.md].
- **On the fixture tickets it was mostly tests.** Both lanes passed the coachman's blind tests
  in all nine fixture runs. The second lane supplied a fix in one (todo-fixture-4), tests or a
  small item in six, and a trivial item in two
  [@trials/2026-09-29-synthesis-audit/results.md].
- **In nine runs the first lane's version had a defect the second's did not,** by the card's
  account, and for #121 by the lane's own code: #18, #38, #109, #112, #114, #121, #124, #135,
  and todo-fixture-4, where mimo's stored counter went on to issue ids 1, 5, 1
  [@trials/2026-09-29-synthesis-audit/results.md].
- **Rank is not authorship.** In #109 and #114 the lane ranked first supplied 12% and 3% of the
  synthesis and the second 73% and 65%; in #38 the second supplied 77% of the code
  [@trials/2026-09-29-synthesis-audit/share.md]. The cards rank the branch as it stood, on a
  stall, a failing gate or a criterion shipped wrong
  [@trials/2026-09-29-synthesis-audit/results.md].
- **The coachman writes some of the synthesis itself.** Text in neither lane's diff was a median
  of 10% of the synthesis, and 66% in #135 [@trials/2026-09-29-synthesis-audit/share.md].

Read as run records, this would make H1 **mixed**: in most runs work from both lanes ships, and
in 8 of the 25 the second lane's own text is 2% or less. The records do not say what separates
the two. Ticket size alone does not: five of the eight are runs against this repository.

The limits [@trials/2026-09-29-synthesis-audit/method.md]:

- Runs of six words count text, not ideas. A fix the coachman rewrote in its own words counts
  as the coachman's: #116's race, #121's held-list guard and todo-fixture-4's counter check each
  read 2% or less for the lane they came from.
- The coachman's choices are not stable. Across the eight runs of one fixture ticket it chose a
  strict stored counter three times and a lenient one three times, each with a stated reason,
  and ranked mimo first five times
  [@trials/2026-09-29-synthesis-audit/synthesis-lines.txt]. One run's "taken from" may be a coin
  flip.
- One coachman model ranked and composed every run, knowing which lane was which. The blind
  tests, the one field of the SYNTHESIS line no model decided, told the lanes apart in 3 of 25
  runs (#38, #80, #114), and the cards read two of those three as wording.
- No run shipped a lane alone, so nothing here says whether a synthesis beat the better lane.
- The lane branches and the fixture repositories are local, so the count repeats only where
  they are.

What would settle it: not the coachman's record, which has to name both lanes. On runs promoted
to `raw/runs/`:

- the share each lane supplied, counted by a script as the synthesis is made and kept in the
  run's record ([#158](https://github.com/brindlewick/postmaster/issues/158));
- each lane's branch scored on the fixture's hidden tests, beside the merged result
  ([#159](https://github.com/brindlewick/postmaster/issues/159));
- tokens and cost for each lane and each leg, which no run records yet
  ([#160](https://github.com/brindlewick/postmaster/issues/160));
- and as the control, a single-lane baseline: the same tickets run with one lane and scored the
  same way.

Supported when, across at least three such runs, each lane's share is above a threshold fixed
before the runs, and the synthesis passes a hidden test that the better lane alone fails.
Refuted when one lane's work ships nearly whole in most runs, or when the better lane alone, or
the single-lane run, passes every hidden test the synthesis does. The cost says what a
difference is worth.

## H2. Independent corroboration is actionable

*A defect that two lanes find independently is one to act on; a single lane's finding, or a
lane agreeing with itself across rounds, is not evidence of the same weight.*

Standing: **claimed**.

What would settle it: per run, the review findings with the lane that made each, whether a
second lane made it independently, and whether it held up (was fixed and stayed fixed
through the gate, or was dismissed). Supported when corroborated findings hold up at a
clearly higher rate than uncorroborated ones. The control is the uncorroborated rate.

So far: in [the review rounds of #36](../sources/2026-09-26-postmaster-36.md), run by hand, 4 of
48 findings were made by both reviewer models, and all 4 held up; so did 42 of the other 44
[@runs/2026-09-26-postmaster-36/reports]. The rates do not separate. "Held up" there means the
coachman accepted the finding, the coachman shared the reviewers' vendor, and nothing reviewed had
run, so this is weaker than the measure above asks for. It moves no standing.

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
- **Does harness diversity matter, independent of the model?** A harness sets the system
  prompt, the tool set, the permission model, which context files are read and how context
  is compacted, so one model under two harnesses is not quite the same agent. Three
  arrangements to compare, cheapest first: same model same harness (the control), same model
  different harness, different vendor.
- **Do blinkers matter?** Lanes that cannot see each other's work are the architecture's
  premise. A run where they could would test it, and would need a deliberate design.
- **What does it cost?** Tokens and wall-clock per shipped ticket, against a single-lane
  baseline on the same ticket. No run records tokens or cost yet
  ([#160](https://github.com/brindlewick/postmaster/issues/160)). The audit under H1 found only
  minutes: in eight runs with no restart, the slower lane took 4 to 48 minutes longer than the
  other, and the coachman's gate runs on lane branches came to 249 minutes over 14 runs
  [@trials/2026-09-29-synthesis-audit/results.md].

## Evidence

One record, run by hand rather than by a dispatch: [the review rounds of
#36](../sources/2026-09-26-postmaster-36.md). It bears on H2 only, and moves no standing. Run
records live in [sources/](../sources/index.md), compiled from `raw/runs/`.

One trial over dispatched runs' records: the synthesis audit of 25 runs
[@trials/2026-09-29-synthesis-audit/method.md]. It bears on H1 and on what combining models
costs, and moves no standing, since it promotes no run. A recorded trial needs no page in
`sources/`; its method describes it.
