---
title: Why runs take the review rounds they do, and what the planning stage could cut
type: concept
standing: mixed
sources: [trials/2026-10-11-review-rounds, trials/2026-10-03-lane-audit, trials/2026-10-04-unbounded-criteria-count, trials/2026-10-04-review-findings-classified]
updated: 2026-10-11
---

# Why runs take the review rounds they do, and what the planning stage could cut

**The question.** A run's review leg goes on in rounds while the last round found a serious
problem. [The review loop](review-loop.md) expected two or three. [The lane audit](several-lanes.md)
read 18 runs, found a median of 4 and could not say why, since a ticket's size sets its first round
and its rounds together. [#400, Research: why do runs take so many review rounds, and what could the
planning stage do to cut them?](https://github.com/brindlewick/postmaster/issues/400) reads the
records of 61 runs, from 28 September to 9 October, and asks what the rounds after the first are
made of and which of that begins before the run, in how its ticket was prepared. On 10 October one
question was added: which signals of a loop predict that the next round finds nothing worth fixing,
so that a loop could stop on its own, and what a loop would have to record to apply such a rule.

**Claim.** The rounds are a long tail. The median run took 3, 21 of the 61 took two or fewer, and
the 12 runs of six or more, a fifth of the runs, hold 44% of the 260 rounds. A run's rounds follow
how many serious findings its first review makes (rank correlation 0.83), and across the 61 runs a
ticket's criteria and the size of its change go with the rounds through that count. In the 15
single-thread runs alone the lines changed keep a correlation of 0.64 with rounds when that count
is held. Of the later findings that
could be placed in the history, 44% were in the change when round 1 reviewed it and no round had
named them, 48% are in lines an earlier round's fix wrote, and 5% are outside the change. By two
readers' marks the ticket left a point open for 8% to 20% of the 309 marked later findings, most
often a state or an input case: what a step does when it fails or is edited, or what an option
means. No one cause a ticket could settle (open points, pairs that must agree, sites) accounts
for more than about a twentieth of the rounds, and the three together, counted once, for 5% to 7%. At the five-criteria cut, the 32 runs
with more criteria took 76 rounds above the median of the smaller tickets, counting only the runs
above it (68 net), an upper bound. The booking clerk's two-part tickets carried a median four times the
change of the one-part tickets before them and had a fifth of the serious findings per changed
line, with rounds that cannot be told apart from chance. A loop cannot yet tell from what it
records that its next round would be clean: the best single signal reached about half, and a round
of five or more serious findings was followed by a clean one in 1 of 51 cases in the 61 runs and
in none of 9 in the later set.

**Standing: mixed.** The counts are of this fleet's own records, with controls, and agree on finding
lines with the lane audit's table for 17 of its 18 runs and with the 21-run count's for 17 of 21,
the differences being named in the record: that part is **supported**. The later set read the same way agrees on
the criteria count and on how weak the stop signals are, and differs on some single signals.
What the planning stage could remove is **claimed**. The association
between a ticket's preparation and its findings is confounded with date, reviewers and the run's
mode, the marks are two models' readings with the defect known, and the rounds a change would have
removed are bounds, not experiments. The runs were not made to test any change.
[@trials/2026-10-11-review-rounds/method.md]

## What was counted

The 61 runs are every run of this repository's tickets with a review round whose review leg ended
before 2026-10-09 22:30 UTC, from the project's runs folder and the older shared one. Parked,
aborted, abandoned-in-review and fixture runs are left out; [#135](https://github.com/brindlewick/postmaster/issues/135),
abandoned after its review ended, is in. The 18 runs that ended their review after that time are a later set, read the same way, used to try the stop signals and to check the criteria
count and not to choose among them [@trials/2026-10-11-review-rounds/method.md].

- **A serious finding** is the lane audit's: a gating P1 or P2 the coachman did not dismiss. The
  finding lines are the coachman's verified list and a floor where a run logged a round elsewhere;
  94 findings in five runs are filled from the run's own card, and they cannot be traced one by one.
- **A round** is the highest round any launch, harvest or finding line, or any review file, names.
- **Where a line came from** is `git blame` at the snapshot the round reviewed, read against the
  commits the run made between rounds. The rule was written and committed before any finding was
  classified [@trials/2026-10-11-review-rounds/rule.md].
- **Controls.** The finding lines of one run read the counts its own card states; a run with only
  style or P3 findings reads zero; 17 of the audit's 18 runs agree on rounds, round 1 and the
  total of finding lines (the 18th read 32 where it holds 44) and 17 of the 21-run count's 21 do; the inferred phase of a
  fix commit matches the round its `apply` line follows for 236 of the 239 lines whose commit is
  among the run's own (12 more name another commit); and the commit named
  as a line's origin added that line for 296 of 316 findings
  [@trials/2026-10-11-review-rounds/results/controls.md].

The groups below are by how the ticket was prepared and how the run was done. **A**: 34 runs, a
one-part ticket, several workhorses. **B**: 12 runs, the booking clerk's two-part ticket with
decisions, checks and verified facts, several workhorses. **C**: 15 runs, the two-part shape
too (checks and verified facts in every one, decisions in 8) and a single thread, where the coachman
writes the change. They differ in date as well.

## The rounds

| Group | Runs | Rounds, median | Mean | Most | 2 or fewer | 3 | 4 or 5 | 6 or more | Round 1 serious, median |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A, one-part ticket, several workhorses | 34 | 4 | 5.0 | 20 | 7 | 7 | 13 | 7 | 4 |
| B, two-part ticket, several workhorses | 12 | 3 | 4.1 | 9 | 3 | 4 | 2 | 3 | 4 |
| C, two-part ticket, single thread | 15 | 2 | 2.8 | 9 | 11 | 2 | 0 | 2 | 1 |
| All | 61 | 3 | 4.3 | 20 | 21 | 13 | 15 | 12 | 3 |

[@trials/2026-10-11-review-rounds/results/rounds.md]

**A long tail.** 7 runs had no serious finding in round 1. Of the 260 rounds, 211 come up to and
including a run's last round with a serious finding and 49, 19%, come after it: the clean round
that confirms the last fixes. 15 runs ended on a round that still held a serious finding.

**The first round goes with the rounds.** Rounds follow round 1's serious findings with a rank
correlation of 0.83. Across all of a run's serious findings the line is rounds = 1.8 + 0.19 ×
findings by the Theil–Sen method and 2.1 + 0.18 × findings by least squares, so about five serious
findings add a round. Criteria (rho 0.43 with rounds) and lines changed before review
(0.23) are associated with rounds, and once round 1's count is held that falls to 0.08 and −0.01.
Ticket length has none (−0.01), and decisions and checks have none once the first round is held
(−0.12 and −0.11). The pattern differs in the 15 single-thread runs, where lines changed goes with
rounds at 0.64 and keeps 0.64 with round 1 held, against 0.12 and −0.09 in the 46 runs with several
workhorses. Size alone does not explain the rounds: runs of under 400 changed lines took a
median 3.5, of 400 to 999 took 2, and of 2,500 or more took 4
[@trials/2026-10-11-review-rounds/results/features.md].

## What the rounds after the first are made of

Each of the 382 serious findings from round 2 on is put in the first group of the rule that
applies, by where `git blame` says the cited lines came from.

| Group | All | A | B | C | Round 2 | Round 3 | Round 4 | Round 5 or later |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| In the change as first reviewed, not named before | 149 (39%) | 86 | 52 | 11 | 71 | 35 | 14 | 29 |
| Made by the last round's fix | 113 (30%) | 90 | 16 | 7 | 44 | 24 | 15 | 30 |
| Made by an older fix | 49 (13%) | 34 | 10 | 5 | 0 | 11 | 11 | 27 |
| Outside the change | 18 (5%) | 15 | 1 | 2 | 7 | 6 | 4 | 1 |
| The same lines named again | 6 (2%) | 3 | 1 | 2 | 3 | 3 | 0 | 0 |
| Unplaced | 47 (12%) | 46 | 1 | 0 | 4 | 13 | 17 | 13 |

[@trials/2026-10-11-review-rounds/results/later-findings.md]

- **Two groups carry nearly everything.** Of the 335 findings that could be placed, 44% were in the
  change when round 1 reviewed it and 48% are in lines an earlier fix wrote. Round 2 holds 71
  findings in lines that were in the change when round 1 reviewed it and that round 1 did not name,
  against 44 in the last fix. The group says how the lines came to be in the code, and not why a
  reviewer did not name them.
- **Fixes make more of the findings as the rounds go on.** From round 5, 57 of the 100 findings
  are in lines an earlier fix wrote. In the runs of six rounds or more, 18% were made by an older
  fix against 5% in the shorter runs.
- **Few rounds are about code outside the change.** 18 findings, 5%, in 10 runs: 10% in the shorter
  runs and 1% in the longer.
- **Few findings name lines an earlier finding named.** 6 do, and no fix rewrote those lines: the
  earlier report led to no change of them or to one that did not touch them.
- **A finding is rarely a reviewer's disagreement with an earlier round.** Both readers say 9 of
  the 309 marked findings ask for the reverse of an earlier change or ruling, at least one says 11
  [@trials/2026-10-11-review-rounds/results/marks.md].
- **About one fix commit in five gets a serious finding in its own lines in the next round**: 21%,
  18%, 24%, 12% and 15% after rounds 1, 2, 3, 4 and 5 and later; in the later set 10%, 5%, 0%, 0%
  and 5%. [When a review loop should stop](review-convergence.md) said its claim would be refuted
  if the rate of serious defects per fix did not fall from round to round, and measured that as
  the share of fixes with a serious finding in them. On that measure the rate is lower late and
  does not fall steadily. Per fix commit the next round holds 0.93, 1.02, 1.36, 1.12 and 1.47
  serious findings after rounds 1 to 5 and later, and 0.53 to 1.00 in the later set
  [@trials/2026-10-11-review-rounds/results/signals.md].

## Which of that begins before the run

**What the ticket left open.** Two readers, each a helper given the ticket as dispatched and the
finding, marked the 309 later findings that have text, 73 having none. They gave the same mark
on *ticket open* for 86% (kappa 0.56), on *disagrees* for 99% and on *kind* for 90% (0.84).
Both say the ticket left a point open for **26 findings, 8%**, and at least one says so for 63,
20%. The session read the 26 and a seeded sample of 24 of the 37 findings where one reader says
yes and the other does not: it confirms 22 of the 26 and 1 of the 24, and sides with reader A in
15 of the 24 and reader B in 9. So 8% is the better reading and 20% the ceiling
[@trials/2026-10-11-review-rounds/results/marks.md].

- **What kind they are.** Of the 26, 6 are of kind *state* (a failed
  cleanup, an edit after sign-off or racing it, a log that cannot be written), 6 *input* (an empty
  option, which of several records, what a relative path is relative to), 3 prose, 2 contract, 1
  site and 1 other, and for 7 the readers give different kinds. Typical: what a sign-off covers
  when the ticket is edited afterwards, what happens to a worktree when a run fails halfway, what
  a re-check does on the branch that introduces the checker, and what a relative env file is
  relative to.
- **They are few per ticket.** They are in 15 of the 61 runs, 4, 4, 3, 2, 2, 2 and then nine runs
  with one, so a clerk who settled each point before dispatch would have had 0.43 points to settle
  per ticket on average and 1 in a median ticket that had any.
- **Most are marked as not open.** For the others the readers say the ticket states the behaviour,
  or that any reading requires the fix, or that the ticket does not reach it. By kind, 51% of the
  309 are a reader or classifier of input that handled one shape wrongly and 18% a state or
  ordering case, which is the pattern [tickets that ask for what a run cannot
  finish](ticket-and-criteria-design.md) found by a different route.
- **Where the points sat.** 16 of the 26 are in the findings of the *missed* group, 4 in the last
  fix and 3 in an older fix. In group C, 5 of the 24 marked later findings, 21%, are open points
  against 7% and 9% in A and B; there are few findings left to mark in C.

**Size and the ticket's features.** The criteria count is the feature that goes with rounds. Runs
with more than five criteria took a median 4 rounds against 3, and 9 of 32 took six or more
against 3 of 29. In the later set 5 runs with more than five took a median 6 and 13 with five or
fewer took 3 [@trials/2026-10-11-review-rounds/results/features.md]. That is the cut the
five-criteria rule of 2026-10-10 makes, and the records fit it.

**How the ticket was prepared.** The two-part ticket carried a median four times the change (the
means are 1.3 times, and not distinguishable) and had a fifth of the findings per line, and no
fewer rounds that can be told from chance:

| Measure, median (mean) | A, one-part | B, two-part | One-sided p that A is higher |
| --- | --- | --- | --- |
| rounds | 4.0 (5.0) | 3.0 (4.1) | 0.27 |
| serious findings in round 1 | 4.0 (5.3) | 4.0 (4.4) | 0.31 |
| acceptance criteria | 5.5 (6.1) | 14.5 (13.5) | 1.00 |
| lines changed before review | 826 (2,627) | 3,383 (3,351) | 0.74 |
| serious findings per criterion | 2.1 (2.4) | 0.4 (0.9) | 0.009 |
| serious findings per 1,000 lines changed | 10.8 (17.1) | 2.0 (2.9) | 0.001 |

Group C, with the two-part shape and a single thread, had a median of 2 rounds and 1.3 serious
findings per 1,000 lines. Every two-part ticket carries its checks and its verified facts, so their
separate effect cannot be read here. Group B differs from A in date, in reviewer lanes, in whether
the cap of three rounds stood and in who prepared the ticket, and C in mode. The association is
real in the counts and is not shown to be the ticket's.

## When a loop could stop

The halting problem is only the framing: no method decides in general whether a change has a
defect left. The question is which observable signs predict, in these runs, that the next round
finds none, and what a loop would have to record to use them. The loop today stops on the round
itself: it runs round r+1 and stops if that holds no serious finding.

**The ceiling.** The 49 rounds after a run's last serious finding are 19% of the rounds. A round
and its fix turn took a median 71 minutes in the 61 runs and 54 in the later set, and a reviewer
lane in rounds 2 and after a median 13 (opus), 15 (luna) and 24 (mimo) minutes. A rule that never
missed could skip those rounds and no others.

**The signals.** At the end of each round that was followed by another, 199 times in the 61 runs
and 56 in the later set, with the next round clean 23% and 27% of the time:

| Signal at the end of round r | Next round clean, 61 runs | Later set |
| --- | --- | --- |
| one serious finding | 21 of 42 (50%) | 6 of 16 (38%) |
| the round's fixes changed 30 lines or fewer | 7 of 19 (37%) | 7 of 13 (54%) |
| one lane alone named the findings, none corroborated | 17 of 42 (40%) | 8 of 22 (36%) |
| the two lanes' overlap estimates under one more finding | 31 of 98 (32%) | 11 of 35 (31%) |
| no P1 among them | 40 of 131 (31%) | 14 of 48 (29%) |
| fewer findings than the round before | 18 of 84 (21%) | 6 of 22 (27%) |
| at least half the findings in lines an earlier fix wrote | 14 of 69 (20%) | 5 of 13 (38%) |
| five or more serious findings (added after the first look) | 1 of 51 (2%) | 0 of 9 (0%) |

[@trials/2026-10-11-review-rounds/results/signals.md]

- **No signal reaches 60% in either set.** The best are one finding (50%, interval 36 to 64) and
  small fixes (37%, then 54%, interval 29 to 77), far from the nine in ten a rule would need.
  Others look useful in one set and do not carry: every finding in the change and not named before
  was 50% and then 17%, and at least half in lines an earlier fix wrote 20% and then 38%.
- **The candidate rules of the convergence page do not do it.** A falling count (rule 4) was 21%
  against 23%. A signal near rule 5's, at least half the findings in lines an earlier fix wrote,
  was 20% against 28% in the 61 runs and 38% against 23% in the later set, so it does not hold the
  same way twice. The reviewers' overlap (rule 8) had the right sign, 32% against 18%, and is
  weak. Its estimate ran at about two thirds of what later rounds found in the change (102
  estimated unseen, 147 found), and at a fifth in the later set (11 against 56). In 23 of the 53
  runs the lanes had no finding in common, which makes the estimate large and uncertain: those
  runs give 55 of the 102.
- **What does predict is going on.** After a round of five or more serious findings the next round
  was clean once in 51 transitions in the 61 runs, and in none of 9 in the later set, where the
  signal was tried fresh. After two, three and four findings 25%, 18% and 17% were in the 61 runs
  and 33%, 36% and 0% in the later set. Five or more is a reason to go on, and one finding is not
  yet a reason to stop.
- **Four rules, tried after each round of each run.** At most one finding with fixes of 30 lines or
  fewer saved 18 rounds of 260 and left 14 serious findings in the change, and skipped only clean
  rounds in 5 of the 11 runs where it fired. Stopping after round 2 when it had at most two
  findings did best by that measure, 9 of 15. The rule that saved most, 47 rounds, left 59
  findings. Every rule left findings in the change in some runs it fired in, and none skipped
  all the confirming rounds [@trials/2026-10-11-review-rounds/results/signals.md].
- **Why the counts cannot say.** The clean round exists to look at the round's fixes, and the
  signals above count findings and lines. They say how many fixes were made and not whether they
  were right. About a fifth of fix commits have a serious finding in their lines in the next round,
  and 162 of the 382 later findings, 42%, are in lines a fix wrote; nothing in the records looks
  inside a fix.
- **A lane's yield does not mark a last round.** In rounds 2 and 3 one reviewer lane alone named
  73% of the findings, both lanes 14% and security alone 9%; from round 4 72%, 14% and 11%. Luna
  alone named 132 and mimo alone 132 of the 382 later findings, 35% each, so dropping either from
  later rounds would have lost about a third. Where a lane names a finding it names it alone in
  about 70% to 90% of cases from round 2 [@trials/2026-10-11-review-rounds/results/lanes.md].
- **A file that comes back does not mean stop either.** 109 of the 178 transitions with traced
  findings had a finding in a file an earlier round's finding was in, and the next round was
  clean in 21% of them against 32% where none was.

**What a loop would have to record.** What this record had to rebuild from git and from free text:

- for each finding a stable id that a re-report keeps, the commit the round reviewed, its place as
  a file and lines, and, from the loop's own state, the class of those lines at that commit (the
  change, a fix of round k, older than the run);
- on each `apply` line the commit it made and the finding ids it closes, and whether a later round
  finds the id again;
- for each round the snapshot, when each lane was launched and ended and with what verdict, the
  counts as reported and as verified, the lines its fixes changed in code and in words, and
  whether the user ruled;
- for each dismissal its reason, so a finding a reviewer made and the coachman refused is counted;
- at sign-off, the clerk's questions and the answers, and which criteria were rewritten for which
  shape.

With those a rule can be tried on the next hundred transitions without rebuilding history. As a bar
chosen here and not measured, a rule is worth having when its firings skip only clean rounds in
about nine of ten runs. None tried here does.

## Changes the planning stage could make

These are proposals. Nothing in the template, the clerk's instructions or a runbook was edited.
*Rounds removed* are of the 260 rounds of the 61 runs, in two ways. *Strict* counts a round only
where every serious finding left in the run's last rounds is one the change would have removed.
*Fitted* takes 0.18 of a round for each serious finding removed, with the findings that followed
from it, by the least-squares line. Both are bounds and not experiments, and either can be the
larger.

| Change | What it rests on | Rounds removed, strict and fitted | What it costs |
| --- | --- | --- | --- |
| Settle before dispatch what a step does when it fails, is interrupted or is edited after sign-off, and which of two copies, orders or records wins | 26 findings both readers say the ticket left open, in 15 runs | 1 and 5 (28 findings with what followed); if either reader counts, 4 and 12 (67) | 0.43 points per ticket, 1 in a median ticket that has any, 4 at most; each a question to the user at sign-off |
| Keep a ticket to five criteria and split above it (in force since 2026-10-10) | rho 0.43 with rounds; 9 of 32 runs with more than five took six or more against 3 of 29; later set 3 of 5 against 1 of 13 | up to 76 rounds above the median of the smaller tickets, an upper bound, since a slice has a first round and a confirming round of its own | an umbrella and slices, each with its own rounds, gate and card, and a slice the user checks |
| Name the pairs that must agree, a producer and its reader, a preview and the real action, a document and its code, and write a check for each | 27 findings of kind contract that both readers give, in 11 runs | 3 and 5 (28 findings) | one check per pair, written by the clerk; the template already says to name the cases that must agree where two implementations of one decision must |
| For a rule that must hold at every place, list the places at the base as a verified fact | 11 findings of kind site, in 7 runs | 0 and 2 (12 findings) | a census per such ticket |
| Keep the loop to the change: a serious finding in lines older than the run is filed and not fixed in the loop | 18 findings, 5%, in 10 runs | 4 and 3 (19 findings) | a list for the user; a rule of the loop more than of planning |
| Record at sign-off and in the loop what the list above needs | the rows of the previous section | none by itself; it lets a later count tell whether the others worked | a few fields and a script |

**What they add to.** The first, third and fourth rows overlap. Counted once, with the open points
from both readers they come to 5 rounds strict and 12 fitted of the 260, 5%, and with the open
points from at least one reader 8 and 17, 7%. With the findings outside the change added, which a
ticket does not settle, 7 and 14, or 10 and 20 [@trials/2026-10-11-review-rounds/results/marks.md].
No one cause is large, and rounds follow the count of serious findings in total. That count is
lower per criterion and per changed line in both groups with the clerk's two-part ticket. In total
it is lower in C (a median 1.0 serious finding against 9.5 in A, with lines changed alike) and not
clearly in B (7.0 against 9.5, p 0.33), where the work was bigger. Whether the ticket is the
reason, or the date, the lanes and the mode, the records cannot say.

## How sure, and what was not checked

- **The counts** are as sure as the finding lines, with controls, and are a floor in five runs; a
  sixth could be low where no record says so.
- **The groups** are computed from git and place 88% of the later findings. They say how a line
  came to be in the code, not why a reviewer did not name it.
- **The marks** agree at 86% on *ticket open* with kappa 0.56, which is moderate. Both readers are
  models and read the finding, which may make them quick to say the ticket could have settled it;
  the session's reading confirms 22 of the 26 both say yes to. The session's reading is a third
  reading and not the truth.
- **The associations** between a ticket's preparation and its rounds are confounded. The p values
  are one-sided permutation tests on 12, 15 and 34 runs and are a guide.
- **The stop signals** are tried after the fact. A transition exists only where the loop ran
  another round, because the round before held a serious finding, or round 1 applied a fix, or the
  user ruled so. The later set is two days of runs, 17 single thread, and was not used to choose a
  signal or a rule.
- **Not examined:** how much of a run's rounds were stale-base merges, gate speed or a reviewer
  that changed; the user's rulings as a cause of rounds past the third; tokens and money; and
  whether the single-thread runs got easier tickets.

## What would settle it

- **A prospective count.** With the last row of the table in place, count a run's open points and
  its rounds as tickets pass through. The lane audit's arithmetic puts a one-round difference at
  about 29 tickets in each group among runs of six rounds or fewer, and a two-round difference at
  about 8 [@trials/2026-10-03-lane-audit/results/numbers.md].
- **A paired test.** The same ticket run once with its open points answered and once without.
- **For the stop signals.** The fields above on the next hundred transitions, and a rule judged by
  whether its firings skip only clean rounds.
- **A reader that is not a model.** The user's own mark of a sample of the 26 and of the 63.

## What changed because of it

Nothing in a rule, runbook, template or gate. The record is
[raw/trials/2026-10-11-review-rounds](../../raw/trials/2026-10-11-review-rounds/method.md), and any
change this page proposes is a ticket the user decides.
