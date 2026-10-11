---
kind: trial
subject: whether the tickets of 21 runs asked for something a run cannot finish, set beside each run's review rounds and severe findings
date: 2026-10-04
---

# Method

**Question.** [Issue #293](https://github.com/brindlewick/postmaster/issues/293): the ticket template now says a criterion must be finishable and names four shapes that are not. Those rules came from three runs and no reading. This trial asks what the run records say about them: how many review rounds and severe findings each run had, whether its ticket asked for something unbounded, and where its late findings sat.

**Runs.** The 18 runs of [the lane audit](../2026-10-03-lane-audit/method.md) that reached synthesis ([#57](https://github.com/brindlewick/postmaster/issues/57), [#75](https://github.com/brindlewick/postmaster/issues/75), [#98](https://github.com/brindlewick/postmaster/issues/98), [#109](https://github.com/brindlewick/postmaster/issues/109), [#110](https://github.com/brindlewick/postmaster/issues/110), [#122](https://github.com/brindlewick/postmaster/issues/122), [#124](https://github.com/brindlewick/postmaster/issues/124), [#135](https://github.com/brindlewick/postmaster/issues/135), [#158](https://github.com/brindlewick/postmaster/issues/158), [#159](https://github.com/brindlewick/postmaster/issues/159), [#160](https://github.com/brindlewick/postmaster/issues/160), [#163](https://github.com/brindlewick/postmaster/issues/163), [#165](https://github.com/brindlewick/postmaster/issues/165), [#170](https://github.com/brindlewick/postmaster/issues/170), [#179](https://github.com/brindlewick/postmaster/issues/179), [#182](https://github.com/brindlewick/postmaster/issues/182), [#200](https://github.com/brindlewick/postmaster/issues/200), [#201](https://github.com/brindlewick/postmaster/issues/201)) and three more: [#202](https://github.com/brindlewick/postmaster/issues/202), [#216](https://github.com/brindlewick/postmaster/issues/216) and [#252](https://github.com/brindlewick/postmaster/issues/252), the runs the rules were written from. [#202](https://github.com/brindlewick/postmaster/issues/202) had finished its review and written its card. [#216](https://github.com/brindlewick/postmaster/issues/216) and [#252](https://github.com/brindlewick/postmaster/issues/252) were still running when their records were read at 2026-10-04 22:21 UTC, with round 4 not yet reported, so their counts stop at round 3. Fixture runs are not in it. The run folders stay where they are and are not promoted; only the derived data here is.

**Definitions.**

- *A severe finding*: a `finding` line in the run's action log whose detail starts `gating P1` or `gating P2`, counted in the round the line names. Rounds the lines do not name are counted in the total only. This is the lane audit's definition, read by a simpler command ([commands](#commands)).
- *Rounds*: the highest round any launch, harvest or finding line names. For [#202](https://github.com/brindlewick/postmaster/issues/202) it is the highest `review-r<N>` prompt file, because rounds 4 to 9 ran on the user's ruling and logged no launch line.
- *From round 4 on*: severe findings in rounds past the flow's cap of three. Those rounds ran on the user's ruling, except in the runs that predate the cap.
- *Where a run's own record says more*: for [#124](https://github.com/brindlewick/postmaster/issues/124) the review checkpoint lists verified findings round by round and its finding lines name no round from 5 to 18; for [#109](https://github.com/brindlewick/postmaster/issues/109) rounds 7 and 11 have no finding lines. The table keeps the finding-line count and gives the checkpoint's beside it, and the analysis is run both ways ([results/severe-by-round.md](results/severe-by-round.md)).
- *The ticket as the workhorses first received it* (T0): the last body of the ticket on the tracker before the first workhorse launched, read from the tracker's edit history, or the run's own copy where it kept one ([#202](https://github.com/brindlewick/postmaster/issues/202), [#216](https://github.com/brindlewick/postmaster/issues/216), [#252](https://github.com/brindlewick/postmaster/issues/252) keep `ticket-body.md`). Four runs were edited after their lanes started ([#109](https://github.com/brindlewick/postmaster/issues/109), [#124](https://github.com/brindlewick/postmaster/issues/124), [#163](https://github.com/brindlewick/postmaster/issues/163) and, in the last hour, [#252](https://github.com/brindlewick/postmaster/issues/252)), and for [#135](https://github.com/brindlewick/postmaster/issues/135) the user edited the ticket before any lane started and again after; the waybill copy of those tickets carries the later text, so it was not used. [Results](results/mid-run-changes.md) lists every edit made after launch.
- *Asked for something unbounded*: read from T0 alone. The rubric is the four shapes in the template's "A criterion must be finishable" at origin/main 905efef, restated to the readers. Three labels. `yes`: at least one acceptance criterion, or a decision a criterion depends on, matches a shape, and the ticket names no bounded form for it. `partly`: it matches a shape by what it says, and the ticket also names a closed set, an observable, named cases or named formats that give the check a finite form. `no`: no criterion matches. A universal word does not make a criterion unbounded by itself: "every acceptance criterion has a check" ranges over a finite list the ticket holds. The question to ask is whether the run would have to examine an open-ended set of cases to show the criterion, with nothing finite to fall back on.
- *Where a late finding sits* (mechanism): one of five tags, `M1` the code reads or classifies an input it could not list in advance, `M2` a difference between this code and another implementation of the same decision, `M3` a forecast of what another program will do, `M4` a race, ordering, crash or combination of conditions in the code's own state, `M5` anything else. A finding is tagged from its logged text, without the run or the ticket.

**Who labelled.** One reader, this session, who had seen the audit's round counts and many finding lines when it labelled (not blind; [results/labels.md](results/labels.md) says what changed after reading findings). Two further readers, given as helpers, were each given the 21 ticket texts T0 in a shuffled order under neutral names, the rubric above and nothing about the runs' outcomes. For the tail findings, this session and two further readers tagged the 99 findings of rounds 4 and later, in a shuffled list without run, round or ticket, with the five tags; for round 1 of the same runs, this session and one further reader tagged the 92 severe findings the same way.

<a id="commands"></a>
**Commands.** From a run folder, with `jq` and a POSIX shell:

```
# severe findings by round: "<round>:<count>"; a line that names no round prints as its first word
jq -r 'select(.action=="finding") | .detail' actions.jsonl \
  | grep -E '^gating P[12] ' | sed -E 's/^gating P[12] (r|round )([0-9]+).*/\2/' \
  | sort -n | uniq -c | awk '{printf "%s:%s ", $2, $1} END {print ""}'

# rounds named by launch, harvest and finding lines
jq -r 'select(.action=="review-launch" or .action=="review-harvest" or .action=="finding") | .detail' actions.jsonl \
  | grep -oE '\b(r|round )[0-9]+\b' | grep -oE '[0-9]+' | sort -n | tail -1

# the user's edits to a ticket after its run started, from the tracker
gh api graphql -f query='{repository(owner:"<owner>",name:"<repo>"){issue(number:<n>){userContentEdits(first:30){nodes{editedAt diff}}}}}'
```

**Controls.** Positive and negative controls through the identical command, agreement with the lane audit's table, and where a run's own checkpoint states the same counts, the comparison: [results/controls.md](results/controls.md). One control failed: for [#124](https://github.com/brindlewick/postmaster/issues/124) the finding lines read 28 where the run's own checkpoint lists 94.

**To repeat.** The run folders are not promoted. A reader without them has the derived tables in [results/](results/): the per-run counts in `severe-by-round.md`, the labels and the comparison of groups in `labels.md`, and the tagged findings in `tail-findings.md`.

**Limits.**

- Twenty-one runs, one repository, one flow that changed between the oldest run and the newest: [#109](https://github.com/brindlewick/postmaster/issues/109), [#122](https://github.com/brindlewick/postmaster/issues/122), [#124](https://github.com/brindlewick/postmaster/issues/124) and [#135](https://github.com/brindlewick/postmaster/issues/135) ran with a ship leg and no planning stage; the 18 audit runs have tickets in the older one-part shape, and [#202](https://github.com/brindlewick/postmaster/issues/202), [#216](https://github.com/brindlewick/postmaster/issues/216) and [#252](https://github.com/brindlewick/postmaster/issues/252) in the two-part shape. A run's rounds are partly a decision to go on: past round 3 each round ran on the user's ruling.
- Review rounds and severe findings depend on the size of the change and on how many lanes reviewed. The flagged runs already had more severe findings in round 1 (a median 6 against 2.5), which suggests larger or harder changes, so a difference between the groups is not evidence that the shape caused it. The lane audit's own arithmetic puts a one-round difference in mean rounds at 372 tickets in each group at the spread of all 18 of its runs, and 29 at the spread of the 15 runs of six rounds or fewer [@trials/2026-10-03-lane-audit/results/numbers.md].
- The finding lines are what the coachman logged. Where a round's findings were written elsewhere the count reads low, as in [#124](https://github.com/brindlewick/postmaster/issues/124).
- The labels are judgements about prose. Three readers agree on some tickets and not on others, and the borderline ones are listed.
- A ticket's wording is one place a shape can show. The tail-finding tags show another: where the findings sat, not what the ticket said.
- [#216](https://github.com/brindlewick/postmaster/issues/216) and [#252](https://github.com/brindlewick/postmaster/issues/252) were still running, and [#252](https://github.com/brindlewick/postmaster/issues/252)'s ticket changed in the hour before it was read.
