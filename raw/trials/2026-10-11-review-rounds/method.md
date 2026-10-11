---
kind: trial
subject: why runs take as many review rounds as they do, counted from 61 runs' own records, and which causes begin before the run starts
date: 2026-10-11
---

# Method

**Question.** [Issue #400](https://github.com/brindlewick/postmaster/issues/400): a run's review
leg goes on in rounds while the last round found a serious problem. The design expected two or
three. The runs took a median of 3 and some took 13 or 20. What are the rounds after the first
made of, and which of that begins before the run, in how its ticket was prepared? A second
question was added on 2026-10-10: which signals of a review loop predict that the next round will
find nothing worth fixing, so that a loop could stop on its own, and what a loop would have to
record to apply such a rule.

It builds on [the lane audit](../2026-10-03-lane-audit/method.md), whose line parsers and whose
table of rounds it reuses (`apparatus/rounds.ts` imports `parse.ts`), on [the count of 21
runs](../2026-10-04-unbounded-criteria-count/method.md), whose finding of undercounted rounds it
adopts, and on [the classification of four runs' findings](../2026-10-04-review-findings-classified/method.md).

**Order of work, so the controls mean something.** [rule.md](rule.md), which says how a later
finding is traced to its cause and what is judged, was committed before any finding after round 1
was classified. This file and `apparatus/rounds.ts`, `ticket.ts`, `inventory.ts` and
`supplement.ts`, which count rounds and serious findings and read what each ticket carried, are in
the same commit, and so is `results/runs.json`, which holds only those counts.

## The runs

Every run folder of this repository's tickets, in the project's own `.postmaster/runs` and in the
older shared folder where the first week's runs live, that has at least one review round and whose
review leg ended before **2026-10-09T22:30:00Z**, by its own `stage` lines: the first stage line
naming `shipping`, `shipped` or `done` is the end. That is **61 runs**, dispatched from 28
September to 9 October. Left out, with the reason:

| left out | which | why |
| --- | --- | --- |
| parked, aborted, misdispatched | a folder named with a suffix after its ticket number | the work they began is in the run that finished it |
| fixture runs | `todo-fixture-*` | not this repository's tickets; kept apart in every earlier record |
| abandoned in review | #132 | its review never ended |
| reviewing at the cut | #216, #339, #344, #348 | still in review when the set was fixed with the user; read apart, at their end |
| no review round yet | four runs dispatched on 11 October | none to count |

Runs that ended their review after the cut are 18 in all (the four above and 14 dispatched from 9
October on). They are not in any count of the 61. They are the held-out set of the stop-signals
section, where a rule found on the 61 is tried on them.

The counts are of runs that ended, as of the cut. The four runs reviewing at the cut ended later,
and their final rounds are reported apart.

## What is counted

- **A serious finding** is the lane audit's: a `finding` line of class `gating` and severity `P1`
  or `P2` that is not marked dismissed. Two shapes older than the audit's window are read as the
  coachman meant them: a line that names no class and opens with its severity (run #108) is
  gating, since every finding was then, and a line with no severity whose target holds one
  (run #135, rounds 4 and 5) takes the target's. With the audit's parser alone, #108 reads 0
  serious findings in 4 rounds and #135 reads 32 where it holds 44.
- **A round** is counted as the audit counted it, with one more record: the highest round any
  `review-launch`, `review-harvest` or `finding` line names, or any file name of the run's folder
  or its `logs/` carries (`review-r<N>-…`, `review-r<N>.json`). The lines alone read 7 for #202,
  which ran 9; the two agree for the other 60.
- **Where the finding lines are a floor.** A round after round 2 runs only when the round before
  it logged a verified serious finding, or the user ruled that it should. A run with such a round
  and no finding line in the round before holds a serious finding that was not written as a line.
  The count of those *silent* rounds is the control, and it found seven runs: [#38](https://github.com/brindlewick/postmaster/issues/38),
  [#109](https://github.com/brindlewick/postmaster/issues/109), [#124](https://github.com/brindlewick/postmaster/issues/124),
  [#202](https://github.com/brindlewick/postmaster/issues/202), [#268](https://github.com/brindlewick/postmaster/issues/268), and two more whose round is explained by the run's record, [#200](https://github.com/brindlewick/postmaster/issues/200)
  (a round whose reviewer changed the code under review, so its verdict was void) and [#258](https://github.com/brindlewick/postmaster/issues/258)
  (a round that was clean, then a return on the user's word). For the five runs the run's own card
  or escalation lines state the number, and `apparatus/supplement.ts` has each with the words it
  was read from. A round with no finding line takes the run's own figure, and every table says
  which column it uses: *lines* is the finding lines alone, *best* is lines and the run's own
  figure for the rounds the lines miss.
- **What a ticket carried** is read from its text as dispatched: `ticket-body.md` where the run
  kept one, else the waybill's copy under `## Ticket`. A ticket is *two-part* where it has a `##
  For the agents` part, and its criteria, decisions, checks, technical notes and `Verified at` are
  counted by their markers.

## Commands

From a checkout of this repository, with the run folders on the machine that made them:

```
bun --no-env-file --config=/dev/null apparatus/inventory.ts --project <repo> \
    --legacy <older shared runs folder> --cut 2026-10-09T22:30:00Z --out results/runs.json
```

A reader without the run folders has `results/runs.json`, which is every row of that command.
`inventory.ts` refuses to write anything that names a path, a thread or a session. The tests are
beside the scripts, run with `bun test`.

## Tracing a later finding to its cause

The rule is [rule.md](rule.md). `apparatus/trace.ts` applies it to every serious finding that names
a round, 647 in the 61 runs, 382 of them in round 2 or later.

- **Where a run's commits are.** The run's own commits are those of its pull request's second
  parent that are not in its first, found by the merge's subject naming the ticket and the merge
  that holds most of the run's applied fix commits, or the branch tip against `origin/main` where
  it was never merged ([#135](https://github.com/brindlewick/postmaster/issues/135)). A commit
  with an equivalent by patch on main, a pick of main's work, is not the run's own.
- **When a commit was made** is its author time, which a rebase or a pick keeps. The committer
  time read #38's rounds as made after their own fixes.
- **Which phase a commit is in** follows from when each round's first reviewer was launched, the
  earliest of its `review-launch` lines and its prompt files' times. A commit made after round k
  was launched and at or before round k+1 was is a fix of round k.
- **What the lines are.** `git blame --porcelain -M -L` at the snapshot of the finding's round,
  on the file and lines of the finding's target. A reviewer's own report, where the finding line
  holds no text, gives the text and not the place.
- **Findings that cannot be placed** are 47 of the 382 and are left in the table as such: 18 of
  [#109](https://github.com/brindlewick/postmaster/issues/109) whose targets name a file and no
  line, 28 of [#135](https://github.com/brindlewick/postmaster/issues/135), whose run's early
  commits are not on any ref of the repository, and 1 of [#251](https://github.com/brindlewick/postmaster/issues/251).
  They are not read as caused by anything.
- **Serious findings the lines do not hold** are 94 in five runs (see the supplement). They are
  counted in each round and cannot be traced one by one, and no table of groups includes them.

## Controls

Every count has a control in [results/controls.md](results/controls.md), made by
`apparatus/controls.ts` and the tests beside the scripts:

- the finding lines of [#335](https://github.com/brindlewick/postmaster/issues/335) read the
  counts its own card states, 7, 3, 2, 1, 1, 2, 2, 1, 0, and a run with 11 finding lines that are
  all style or P3 reads 0 through the same command;
- rounds, round 1 and the total agree with the lane audit's table for 17 of its 18 runs, and the
  18th, #135, reads 44 where the audit read 32 for the reason given above;
- the inferred phase of a commit named by an `apply` line is the fix phase of the last round
  launched before the line for 230 of 233 such lines, the three that differ within a minute of a
  launch;
- the inferred snapshot of a round is the commit its reviewers' permalinks name, for all 8 rounds
  whose reports carry one;
- the commit named as the origin of a cited line added that line, read with `git show` and not
  with `git blame`, for 296 of 316 later findings placed in a fix or in the change.

## Stop signals

The question added on 2026-10-10: which signals a review loop can see at the end of a round predict
that the next round finds nothing worth fixing, and what a loop would have to record to apply a
rule built on them. The halting problem is only the framing: no method decides this for an
arbitrary program, so the question is which observable signs do in these runs.

- **A transition** is a point at which a loop went on: round r ended with its fixes in, and round
  r+1 ran. The 61 runs hold 199 and the later set 56. **Clean** means round r+1 held no serious
  finding, by the best column. A round that ended a run has no next round and is not a
  transition.
- **The signals** are in `apparatus/signals.ts` and were written before the later set was read:
  the count of serious findings in the round and against the round before; the lines the round's
  fix commits changed, in all files and in code; whether a P1 is among them; whether one lane alone
  named them; whether they are in lines an earlier fix wrote, in a file an earlier round's
  finding was in, or in the change and not named before; and what the two reviewer lanes' overlap
  leaves unseen by the Chapman form of the capture-recapture estimate. One more, five or more
  serious findings, was added after the first look at the 61 runs, and the later set is its only
  fair test.
- **The stopping rules** are four, fixed beforehand: at most one serious finding and fixes of 30
  lines or fewer; at most one and fewer than the round before; fixes that changed no code; and
  round 2 with at most two. Each is applied after each round of each run, and the first round at
  which it fires, before the run's own last round, is where the run would have stopped. It saves
  the rounds after it, and the serious findings those rounds held are the ones it would have left
  in the change.
- **The later set** is the 18 runs whose review ended after 2026-10-09T22:30:00Z and by
  2026-10-11T07:30:00Z, read the same way. It was not used to choose a signal or a rule.
  It is two days of runs under a flow that had moved on (verifiers, the five-criteria rule, a
  different security reviewer), and a run in it is one of 17 single-thread runs and one
  several-workhorse run, [#216](https://github.com/brindlewick/postmaster/issues/216), which took
  15 rounds.
- **The cost of a round** is read from launch lines: the time from one round's first launch to the
  next, which holds the reviewers, the coachman's judging and fixing, the gate and any wait for the
  user, and a reviewer lane's own time from its launch line to its `.done` marker.
