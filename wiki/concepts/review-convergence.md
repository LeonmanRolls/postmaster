---
title: When a review loop should stop, and what counts toward it
type: concept
standing: claimed
sources: [runs/2026-09-26-postmaster-36, papers/petersson-2004-capture-recapture, papers/kemerer-paulk-2009-review-rate, papers/czerwonka-2015-code-reviews, papers/tian-2016-severity, papers/purushothaman-perry-2005-small-changes, papers/wang-lin-2026-iterative-bug-fixing, papers/gao-2026-looping-not-reliability, papers/olausson-2024-self-repair, papers/wang-2026-solved-issues, papers/ullah-2024-llm-vulnerabilities, papers/klishevich-2025-review-determinism, papers/cihan-2025-automated-review, papers/lin-2026-agentic-review, papers/al-haddad-2025-vulnerability-triage]
updated: 2026-09-27
---

# When a review loop should stop, and what counts toward it

**The question.** The [review loop](review-loop.md) ends when a round returns no new verified gating
finding and every fix verifies closed. It has a round cap, five until #60 made it three on
2026-09-26, and it escalates when one class of defect recurs in three consecutive rounds. That
follows the practice of people, who re-review until the reviewer has no more comments. Model
reviewers may not run out of comments the way people do. This page asks what should end a loop of
model reviewers, and what should count toward ending it. The question is [issue
#59](https://github.com/brindlewick/postmaster/issues/59).

**Claim.** For a loop of model reviewers, "no findings at all" is not a reachable end. The end
should turn on verified serious findings in what the change introduced. When serious findings keep
landing in the last round's fixes of one mechanism, the answer is a redesign of that mechanism,
not another round.

**Standing: claimed.** One record bears on it, the review of #36, which was run by hand and not by
a dispatch ([run record](../sources/2026-09-26-postmaster-36.md)). The outside work below motivates
the candidates and moves no standing. The page ends with the options for the loop's end and the
user's decision: for now, one round of bug review.

## The first evidence: the review of #36

Pull request #39, which implemented #36, went through five rounds of review before it merged. Round
0 checked the ticket's criteria. Round 1 ran `/code-review` over the whole pull request. Rounds 2 to
4 each ran the bug and the security lens on two models, A and B, both from one vendor, each in its
own scratch, on the previous round's fixes. The session that implemented the ticket also acted as
coachman: it wrote the fixes and the briefs and verified the findings. Nothing that was reviewed
had run [@runs/2026-09-26-postmaster-36/promotion.md].

Every finding in rounds 2 to 4 is listed, with the reports that made it, where it sat and what
became of it, in the [run record](../sources/2026-09-26-postmaster-36.md). The counts, from the
reports and the next round's briefs [@runs/2026-09-26-postmaster-36/reports]
[@runs/2026-09-26-postmaster-36/briefs]:

| | round 2 | round 3 | round 4 |
|---|---|---|---|
| snapshot reviewed | `ad786ec` | `86dcdfb` | `b4b1199` |
| lines the reviewed fixes changed | 278 | 340 | 118 |
| reports of a finding, from four reviewers | 26 | 20 | 14 |
| distinct findings | 25 | 13 | 10 |
| P1 / P2 / P3, by the highest rating given | 0 / 7 / 18 | 3 / 4 / 6 | 1 / 1 / 8 |
| found by the bug lens only / security only / both | 14 / 10 / 1 | 4 / 4 / 5 | 4 / 3 / 3 |
| made by the last round's fixes / left open by them | 11 / 8 | 8 / 2 | 6 / 1 |
| earlier in the change / on main / from the merge | 2 / 3 / 1 | 0 / 3 / 0 | 1 / 2 / 0 |
| P1 and P2 sitting in the last round's fixes | 6 of 7 | 6 of 7 | 1 of 2 |
| in runbook prose / scripts / the wiki | 14 / 9 / 2 | 8 / 5 / 0 | 5 / 5 / 0 |
| made by more than one report / with severities that differ | 1 / 0 | 5 / 2 | 3 / 1 |
| dismissed by the coachman | 1 | 1 | 0 |
| reviewer tokens, recorded | 840,538 | 776,005 | 725,607 |
| reviewer minutes, longest / all four, recorded | 22 / 68 | 19 / 61 | 19 / 60 |
| reviewed commit to fix commit | 99 min | 25 min | 53 min, to the merge |

The fix sizes are from git [@runs/2026-09-26-postmaster-36/diffstat.txt] and the times between
commits from their commit times [@runs/2026-09-26-postmaster-36/commits.txt]. Tokens and minutes
are as the implementing session recorded them from its task notifications. The reports carry no
costs, so these were not recomputed [@runs/2026-09-26-postmaster-36/README.md].

Where a finding sat was worked out with `git blame` on its cited lines at the snapshot the round
reviewed, read against the previous round's fix commit and against main. "Made by" the last fixes
means the fix created it; "left open by" them means it predates the fix, which was meant to close it
or its kind and did not. The run record gives the method and the three judgement calls.

Rounds 0 and 1 had no severities. Round 0 found all of #36's criteria met, with three minor defects
[@runs/2026-09-26-postmaster-36/reports/round-0-criteria-check.md]. Round 1 confirmed 24 of 39
candidates and reported 15 in full [@runs/2026-09-26-postmaster-36/reports/round-1-code-review.md];
21 were fixed, 5 deferred to tickets, 7 left with a reason and 4 refuted
[@runs/2026-09-26-postmaster-36/briefs/round-2-bug-brief.md]. Round 1's recorded cost was 528,626
tokens for its orchestrator alone, without its 50 or so helper agents
[@runs/2026-09-26-postmaster-36/README.md].

### Where these figures differ from the implementing session's index

The index is the implementing session's own tally [@runs/2026-09-26-postmaster-36/README.md].
Recounted from the reports:

- **Round 2 had 25 distinct findings, not 26, and 7 at P2, not 8.** One defect was reported twice,
  once by each lens of model A. The index's series for P1 and P2, "8, 7, 2", counts reports in round
  2 and distinct findings in rounds 3 and 4. Counted the same way throughout, it is 7, 7, 2 distinct,
  or 8, 11, 4 reports.
- **Round 2's closure check found two of round 1's 21 fixes not fully closed**, fix 12 and fix 17,
  each by one reviewer. The index says one.
- **Round 3's 13 findings include one dismissed and one kept as a standing limit.** Twelve were
  accepted as defects: 10 fixed and 1 deferred to #48, with the limit's header rewritten. The
  index's second dismissal was of a remark inside a closure line, not of a finding.
- **Round 4's refused resume was rated P1 by one reviewer and P2 by two.** The fourth named it only
  among remarks it did not file. The index says P2 from three.
- **The class the loop stopped on was already there in rounds 1, 2 and 3.** Round 1 reported the
  refusal branch with no mechanism behind it, the takeover's wrapper and Stage C step 2's resume
  [@runs/2026-09-26-postmaster-36/reports/round-1-code-review.md]. So the repeated-class rule, as
  written, would have stopped the loop after round 3. It was applied after round 4.

The index's other readings hold: in round 2, 6 of the 7 distinct P2 findings sat in round 1's fixes
(2 made by them, 4 left open by them); in round 3, all 3 P1 and 3 of the 4 P2.

### What the rounds show

1. **Serious findings fell; minor ones did not.** Distinct P1 and P2 went 7, 7, 2; P3 went 18, 6,
   8. Outside the one class the loop stopped on, what the postmaster does with a leg that exited
   without finishing, serious findings went 5, 4, 0. Inside it they went 2, 3, 2
   [@runs/2026-09-26-postmaster-36/reports].
2. **Most findings sat in the last round's fixes.** 19 of 25, 10 of 13 and 7 of 10; of the serious
   ones, 6 of 7, 6 of 7 and 1 of 2. Counted per fix, 11 of round 1's 18 fixes had a finding in them
   in round 2, 7 of round 2's 22 in round 3, and 5 of round 3's 10 in round 4. A serious one: 6 of
   18, 5 of 22 and 1 of 10 [@runs/2026-09-26-postmaster-36/reports]
   [@runs/2026-09-26-postmaster-36/briefs]. The rate of serious defects per fix fell each round.
3. **Few findings were older than the change, but fixing them cost a round.** 3, 3 and 2 findings
   were already on main, and 2 of the 16 serious ones. Three of round 4's ten findings sat in the
   fixes of two round-3 findings that were on main (4.04 in the fix of 3.12; 4.05 and 4.06 in the
   fix of 3.04) [@runs/2026-09-26-postmaster-36/reports] [@runs/2026-09-26-postmaster-36/briefs].
4. **Severity labels split, but not across the line that gates.** Of the 9 findings more than one
   report made, 3 got different severities, all P1 against P2. Twice the split was one model
   disagreeing with itself under two lenses: 3.01, P1 from model A's bug report and P2 from its
   security report, and 4.01, P1 and P2 from model B. No split crossed from P2 to P3. But 39 of the
   48 findings rested on one reviewer's label alone [@runs/2026-09-26-postmaster-36/reports].
5. **The two models barely overlapped.** Model A made 17, 10 and 8 distinct findings; model B made
   8, 6 and 3; both made 0, 3 and 1 [@runs/2026-09-26-postmaster-36/reports]. Read as a
   capture-recapture sample of two reviewers ([Petersson and
   others](../sources/petersson-2004-capture-recapture.md)), round 2's serious findings had no
   overlap, so nothing bounds what was left. Round 3's (5 by A, 4 by B, 2 by both) estimate about 10
   present, 7 found. Round 4's (2, 1, 1) estimate 2 present, 2 found. Two reviewers from one vendor
   are too few and too alike for these to be more than an illustration (unverified as estimates).
6. **The coachman accepted nearly everything.** It dismissed 2 of 48 distinct findings
   [@runs/2026-09-26-postmaster-36/briefs]. Outside studies see far more of a model reviewer's
   comments rejected, below. This record cannot say whether that is because these findings were
   real, because the briefs asked reviewers to verify by running things, or because the verifier was
   the same vendor's model as the reviewers.
7. **Cost did not fall with the size of the fix.** Reviewer tokens stayed near 0.8 million a round
   while the fixes reviewed went 278, 340, 118 changed lines. Per distinct serious finding that is
   about 120,000, 111,000 and 363,000 tokens, before the coachman's own work
   [@runs/2026-09-26-postmaster-36/README.md] [@runs/2026-09-26-postmaster-36/diffstat.txt].
8. **The class that did not converge was a decision table written in prose.** Each round's fix of it
   produced the next round's serious finding in it: 2.01's fix produced 3.01 and 3.02, and 3.02's
   fix produced 4.01 [@runs/2026-09-26-postmaster-36/reports]. Across rounds 2 to 4, 11 of the 16
   serious findings sat in runbook prose, which was 57% of the lines the pull request changed in
   runbooks and scripts [@runs/2026-09-26-postmaster-36/diffstat.txt].

## What outside work says

Each source has its own page, and each figure here is quoted in the capture it cites. None of it
moves a standing.

**When review ends.** For people's inspections, the overlap between independent reviewers
estimates the faults left, and the estimate informs whether to inspect again. It needs four or five
reviewers for acceptable accuracy, tends to underestimate, and should not decide alone
([Petersson and others, 2004](../sources/petersson-2004-capture-recapture.md))
[@papers/petersson-2004-capture-recapture/passages.md]. For models, a loop
that reviews and fixes the same code until it finds nothing claims bugs in bug-free programs,
damages correct code faster than it repairs incorrect code, and often cycles
([Wang-Lin and others, 2026](../sources/wang-lin-2026-iterative-bug-fixing.md))
[@papers/wang-lin-2026-iterative-bug-fixing/passages.md]. Forcing a second revision lowered
correctness from 0.820 to 0.673 ([Gao and others, 2026](../sources/gao-2026-looping-not-reliability.md))
[@papers/gao-2026-looping-not-reliability/passages.md].

**How much each pass finds.** A careful review by one person found more than half the defects in
code ([Kemerer and Paulk, 2009](../sources/kemerer-paulk-2009-review-rate.md))
[@papers/kemerer-paulk-2009-review-rate/passages.md]. About 15% of people's review comments point to
a possible defect ([Czerwonka and others, 2015](../sources/czerwonka-2015-code-reviews.md))
[@papers/czerwonka-2015-code-reviews/passages.md]. Of a model reviewer's comments, 26.2% were not
acted on in one company ([Cihan and others](../sources/cihan-2025-automated-review.md))
[@papers/cihan-2025-automated-review/passages.md], and 56.3% were rejected across 239 repositories,
mostly as false positives, redundant or out of scope ([Lin and others,
2026](../sources/lin-2026-agentic-review.md)) [@papers/lin-2026-agentic-review/passages.md].

**Defects introduced by fixes.** Nearly 40% of people's fixes in one large system introduced another
defect ([Purushothaman and Perry, 2005](../sources/purushothaman-perry-2005-small-changes.md))
[@papers/purushothaman-perry-2005-small-changes/passages.md]. About 8% of agents' patches that passed
their tests were certainly incorrect, computed from two of its figures ([Wang and others,
2026](../sources/wang-2026-solved-issues.md)) [@papers/wang-2026-solved-issues/passages.md]. A
model's repair is limited by the quality of the feedback it is given ([Olausson and others,
2024](../sources/olausson-2024-self-repair.md)) [@papers/olausson-2024-self-repair/passages.md].

**Agreement and severity.** People gave one problem different severities in around 51% of duplicate
bug reports ([Tian and others, 2016](../sources/tian-2016-severity.md))
[@papers/tian-2016-severity/passages.md]. Models over-predicted the risk of vulnerabilities ([Al
Haddad and others, 2025](../sources/al-haddad-2025-vulnerability-triage.md))
[@papers/al-haddad-2025-vulnerability-triage/passages.md]. The same review repeated at temperature
zero came out different ([Klishevich and others, 2025](../sources/klishevich-2025-review-determinism.md))
[@papers/klishevich-2025-review-determinism/passages.md]. Models flagged patched code as still
vulnerable and changed their answers between runs ([Ullah and others,
2024](../sources/ullah-2024-llm-vulnerabilities.md)) [@papers/ullah-2024-llm-vulnerabilities/passages.md].
A second model is not automatically an independent judge of the first ([Gao and
others](../sources/gao-2026-looping-not-reliability.md)).

**Searched for and not captured.**

- Yin and others, "How do fixes become bugs?" (FSE 2011), reports that at least 14.8% to 24.4% of
  sampled fixes for post-release bugs in four operating systems were incorrect (unverified here).
  Only its abstract page was reachable, and only through a fetch tool that rewrites text, so no
  passage could be quoted exactly.
- The curl maintainer's accounts of security reports written with models (daniel.haxx.se, 2025):
  first many invalid ones, then a set that led to about 50 fixes (unverified here). Not captured,
  for the same reason. They bear on reproduction as the filter for a model's finding.
- Briand and others (2000) and Eick and others (1992) on capture-recapture for inspections, and
  Musa and Ackerman (1989) on when to stop testing: behind publishers' paywalls. Petersson and
  others summarise the first two.
- A study that follows model reviewers and model fixers on one change, round by round, as the record
  of #36 does. None was found. The nearest is the iterative bug-fixing study above, on small
  programs and small models with no history.

## What counts toward a rule

Before any rule, the loop has to say which findings count. Figures for #36 in this section and the
next three are from the table and the run record above [@runs/2026-09-26-postmaster-36/reports]
[@runs/2026-09-26-postmaster-36/briefs], and those for outside work from the captures cited above.

- **Verified by the coachman.** The current rule counts only verified findings. In #36 that filtered
  almost nothing: 2 of 48 were dismissed.
- **Backed by evidence.** A reproduction for a script; for prose, a walk through the steps to a state
  the next step cannot handle. In #36, 14 of the 16 serious findings had their mechanism shown by
  running something, and 2 rested on reading alone, 2.24 and 3.08
  [@runs/2026-09-26-postmaster-36/reports]. Their consequence was mostly argued by reading.
  Evidence settles whether a defect exists better than it settles how bad it is.
- **In what the change introduced.** Findings on main are filed, not fixed in the loop. In #36 that
  would have set aside 8 of 48, and 2 of 16 serious ones.
- **Serious.** P1 and P2 block; P3 goes to the user. The labels are noisy, but in #36 no label split
  crossed the P2 to P3 line.
- **Corroborated.** Only what two lanes found without seeing each other, per H2 in [combining
  models](combining-models.md). In #36 corroborated findings held up at the same rate as the rest,
  and one P1, 3.08, was made by one reviewer alone. As a filter it would have dropped real findings.

## The candidate rules

What each rule says, the evidence for and against it, and what #36's loop would have done under it.

**1. No findings at all.** This is the current rule in substance: no new verified gating finding,
whatever its severity.
*For:* the most conservative rule, and people's practice. *Against:* in #36, rounds 2 to 4 each had
at least 10 distinct findings, and P3s went 18, 6, 8. Model reviewers flag code with no bugs, vary
between runs, and have many of their comments rejected. People's own "no more comments" comes when
attention runs out, not defects: one careful pass finds about half. *In #36:* never met; the loop
would have run to the cap unless the repeated-class rule stopped it.

**2. No new P1 or P2.**
*For:* serious findings fell to 2 by round 4, and to 0 outside the class; minor ones never would.
*Against:* the label is noisy: people split on 51% of duplicates, models over-predict risk, and in
#36 one model split with itself. A single high label keeps the loop going. *In #36:* round 4 still
had two, so round 5, unless the repeated-class rule stopped it first.

**3. Only verified findings in what the change introduced count.**
*For:* keeps the fix surface to the change. Fixing older problems in the loop produced three of
round 4's ten findings. People complain of model reviewers suggesting changes outside the task.
*Against:* as a stopping rule it does little: few findings were older than the change, and the
change includes its own earlier fixes, where most findings sat. *In #36:* the same rounds, with the
eight findings on main filed rather than fixed, which would have spared round 4's 4.04 to 4.06.

**4. A falling count.**
*For:* serious findings did fall, and the rate of serious defects per fix fell each round.
*Against:* counts are small and noisy and depend on the draw of reviewers. The total fell 25, 13, 10
without nearing zero, and serious findings held at 7 for two rounds before falling. A count can fall
because the fixes got smaller rather than the code better. *In #36:* a rule of "fewer serious
findings than last round" would have stopped after round 4, where it did stop.

**5. The share of findings in the previous round's fixes.** The implementing session's reading: when
most serious findings sit in the last fixes, redesign rather than run another round.
*For:* it names the mechanism that drove #36's loop. It is cheap to measure from the `finding` and
`apply` lines. People's fixes also bring new defects often, so the signal is general.
*Against:* it is a signal about the round, not about any one mechanism. In #36 the share was high
in every round, 6 of 7, 6 of 7 and 1 of 2. Round 2's six sat in four mechanisms. Three of them kept
producing serious findings in their fixes in round 3; one, the order in which Stage F removes its
marker, did not. *In #36:* a call to redesign after round 2, right for three mechanisms, early for
the fourth, and silent on which was which.

**6. A round cap.**
*For:* bounds the cost, about 0.8 million reviewer tokens a round in #36, and the risk that more
revision undoes correct fixes. *Against:* it ends review regardless of what is open, and a loop
stopped at the cap ships its last round's fixes unreviewed. *In #36:* the cap was five and was
never reached; the loop stopped at four. Under today's cap of three it would have stopped after
round 3, where the class rule as written would also have stopped it.

**7. A fixed budget.** One full round, then one round that checks the fixes and hunts holes in them,
then the user triages everything left.
*For:* predictable cost; the user decides what the residue is worth; it does not depend on noisy
counts or labels. *Against:* it ignores what was found, puts the judgement on the user every time,
and ships the second round's fixes unreviewed. *In #36:* after round 2 the user would have faced 25
findings, 7 of them P2.

**8. The overlap between independent reviewers.** Stop when capture-recapture estimates less than one
serious finding left.
*For:* the lanes already work in blinkers, so the overlap comes free. In #36 it would have said
continue after rounds 2 and 3 and stop after round 4, where the loop did stop.
*Against:* inspections need four or five reviewers for acceptable accuracy, and the loop runs two.
Two lanes from one vendor share blind spots, which understates what is left. The counts are tiny.
*In #36:* stop after round 4, by the illustration above.

## The implementing session's reading, tested

The ticket's notes carry five readings by the session that ran #36's loop, to be tested rather than
assumed.

1. *People's comments run out because their attention is finite, and a model's do not.* **Partly.**
   Minor findings did not run out in #36, and outside work shows models flagging code with no bugs.
   But serious findings did fall, to none outside one class. And people's comments run out before
   their defects do, so their "no more comments" was never a sign of clean code either.
2. *Severity should be settled by evidence, such as a reproduction, rather than by the reviewer's
   label.* **Supported for the label's noise, with a limit.** Labels split in #36, within one model
   too, and outside work finds the same for people and models. But #36's splits were all P1 against
   P2, and most serious findings already had their mechanism reproduced. The split was about
   consequence, which a reproduction of the mechanism does not settle. The consequence needs a
   stated scenario: which run it breaks, and how.
3. *Only findings in what the change introduced should block the loop, with older problems filed.*
   **Supported as a rule about the surface, not about stopping.** It would not have ended #36 any
   sooner, but fixing older problems in the loop produced three of round 4's ten findings.
4. *When a round's serious findings sit mostly in the last round's fixes, the answer is a redesign,
   not another round.* **Refined.** The share was high in every round. The signal that held was
   narrower: serious findings in the last fixes of one mechanism, round after round. That is what
   the repeated-class rule looks for, and it fired a round late because "the same class" is a
   judgement.
5. *A loop that will not converge usually means logic lives in prose rather than in scripts with
   tests.* **Consistent, on one case.** The mechanism that did not converge was a decision table in
   runbook prose, and 11 of 16 serious findings sat in runbook prose against 57% of the changed
   lines. Scripts had serious findings too, 5 of 16, and one class is one case. #57 moves that table
   into a script and will show whether its findings stop.

## Proposed trial: fresh reviewers on code already reviewed clean

This measures what the choice turns on: whether a fresh model reviewer, given code a loop has
passed, still finds serious defects, or only minor ones.

**Method.** Pin commit `547687c`, main after #36. Two scopes, in one brief:

- *Reviewed clean:* `scripts/stage.sh` and `scripts/runs-status.sh`. Round 3 found a defect in
  each; in round 4 all four reviewers confirmed the fixes closed and reported nothing new in
  either.
- *Known open:* the REMOUNT rules in `postmaster.md` and `launch.sh`'s input checks, where #57 and
  #58 list the findings already known. This is the control: a reviewer that finds none of them there
  is not looking.

Three levels, each run three times from a fresh scratch: model A, model B, and a model from another
vendor. Nine reviews, each blind: the brief lists no earlier findings, unlike the loop's briefs. The
output contract is the bug lens's, with a reproduction or a walk-through for each finding. The
coachman verifies every finding. The user rates the severity of every P1 and P2 and of ten P3 chosen
at random, without seeing the reviewers' labels.

**Measures.**

1. Verified new findings per review in the reviewed-clean scope, by severity.
2. How many of the known findings each review makes in the control scope: the yield of one pass.
3. Overlap between repeats of one model, between models of one vendor, and across vendors; and a
   capture-recapture estimate from nine reviews, which is enough for the estimators inspections use.
4. Agreement on severity, among reviewers and with the user, and how often it crosses P2 to P3.
5. The share of reported findings the coachman dismisses, per level.

**What each result would mean.** If verified P1 and P2 findings in the reviewed-clean scope are near
zero while P3s keep coming, the loop can end on serious findings, and no-findings is the wrong end.
If serious findings appear there at a rate like the control's, a loop's "clean" is not a stable
property, and a budget with the user's triage is the honest end. If repeats of one model overlap
little, each fresh reviewer is a new draw, which argues for more lanes over more rounds.

**Cost.** About 2.5 million tokens and three hours from start to end, of which under an hour is the
user's. Nine reviews at about 0.2 million tokens and 20 minutes each, from #36's recorded costs,
run three at a time [@runs/2026-09-26-postmaster-36/README.md]; about half a million more for the
coachman to verify; the user's rating of 15 to 25 findings. A reviewer from another vendor may cost
more or less per token. This is an estimate, not a measurement.

**A second trial, later: how often a fix brings a new defect.** Fix each finding the first trial
verifies, one commit each, and have two reviewers check each fix's diff alone for closure and new
holes. It measures the per-fix rate directly, where #36 gives it only per round: 6 of 18, 5 of 22
and 1 of 10 fixes with a serious finding in them. For about ten fixes, about 3.5 million tokens and
four hours, estimated the same way. The same rate falls out of every dispatched run's `finding` and
`apply` lines at no cost, once a script joins them, which would be a ticket of its own.

## Options for the loop-ending rule in `coachman.md`

What each option would say, what #36 would have done under it, and what it costs. Nothing here
changes a runbook; the user chooses.

**A. Keep the current rule.** No new verified gating finding and every fix closed; the cap of
three; escalation on a class found in three consecutive rounds. *In #36:* the end condition was
never met. The loop stopped after round 4 on the class rule, when the cap was five; under the cap of
three, and under the class rule as written, it stops after round 3. *Cost:* up to three rounds,
about 0.8 million reviewer tokens each, plus the coachman's fixes.

**B. End on serious findings with evidence, in the change's own code.** The loop ends when a round
has no new verified P1 or P2 in what the change introduced, and every fix is closed. The coachman
sets severity from the evidence, with the reviewers' labels as input. The last round's P3 findings go
to the user as a list, to fix, file or dismiss, not into another round. Findings on main are filed,
not fixed, unless P1. The cap and the class rule stay. *In #36:* round 4 still had a serious
finding in the change, 4.01, so the end condition was not met, and the class rule would have
stopped the loop as under A. What changes is what gets fixed: no P3 fixes in the last round, and
3.04 and 3.12 filed rather than fixed, which would have spared round 4's 4.04 to 4.06. *Cost:* like
A in rounds, less in fixes, and one triage list for the user.

**C. B, with the class rule made mechanical.** Each `finding` line also names its mechanism, as a
file and section. When serious findings sit in the last round's fixes of the same mechanism in two
consecutive rounds, stop fixing that mechanism and escalate it for redesign, while the loop goes on
for the rest. *In #36:* after round 3 three mechanisms qualify, each with serious findings in the
last fixes in rounds 2 and 3: what the postmaster does with an exited leg (2.01 and 2.02, then 3.01,
3.02 and 3.08), loading the env file (2.16, then 3.03), and re-running an interrupted round (2.12
and 2.17, then 3.10). The loop did not close any of the three by fixing: the third was deferred to
#48 after round 3, and the first two still had serious findings in round 4 (4.01 and 4.02) and went
to #57 and #58. Under C, round 4 would have checked only the other fixes. *Cost:* one more field on
a log line, and redesign tickets a round sooner.

**D. A fixed budget.** One full round and one round on the fixes, then the user triages everything
left; more rounds only on the user's word. *In #36:* stop after round 2, with 25 findings for the
user, 7 of them P2. *Cost:* two rounds; the most of the user's time per change.

**E. Stop on the reviewers' overlap.** End when capture-recapture estimates less than one serious
finding left. *In #36:* stop after round 4. *Cost:* nothing new to collect, since each `finding`
line names every lane that made it; but it needs three or more lanes, one from another vendor,
before its estimates mean anything, and the first trial to check it.

**Recommendation: C, with the first trial run alongside it.** In #36 the serious findings that kept
coming came from a few mechanisms whose fixes kept breaking. C picks out those three after round 3;
the loop reached two of them only after round 4. C ends on what fell, serious findings, and hands
what did not fall, minor ones, to the user once. It stops fixing older problems inside the loop,
which cost a round in #36. And it replaces the judgement of "the same class", applied a round late
in #36, with a field on a log line. Keep a cap. If the trial finds serious defects in code
a loop has passed about as often as in code with known defects, no rule based on findings is safe,
and D is the honest choice. E needs nothing new logged, so it can be judged once runs with three
lanes exist.

## Decision

On 2026-09-27 the user chose the rule the loop runs under #80: "in the first round we fix as much
as we can, then we repeat until there are no more P1 and P2s." Round 1 applies the fix for every
verified gating finding, P1, P2 and P3 alike; from round 2 on only P1 and P2 findings are fixed,
and a P3 finding goes to the user unfixed. The cap of three rounds stays as a backstop: when
round 3 logs a verified P1 or P2 finding, the loop stops and escalates with the residue. The
repeated-class escalation stays too. The user's first answer, "for now we will just have one
round of bug review, if we see lots of bugs in prod, we can revisit this", was refined into this
rule; many bugs reaching production stays the signal to revisit it. It is none of options A to E.
`coachman.md` changes under #80. The trial was not run.

## What would settle it

The user's test for the decision is how many bugs reach production from changes that had review
under this rule. For the claim: it is supported if, across at least three dispatched runs, serious
findings reach zero outside escalated mechanisms within the cap while minor ones continue, and the
first trial finds few verified P1 or P2 in code already reviewed clean. It is refuted if fresh
reviewers keep finding verified serious defects in code a loop has passed, or if the rate of serious
defects per fix does not fall from round to round. Each dispatched run's `finding` and `apply` lines
already carry most of what this needs: the round, the file and line, every lens and lane that made a
finding, and the commit of each fix.