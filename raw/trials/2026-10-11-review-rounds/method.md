---
kind: trial
subject: why runs take as many review rounds as they do, counted from 61 runs' own records, and which causes begin before the run starts
date: 2026-10-11
---

# Method

**Question.** [Issue #400, Research: why do runs take so many review rounds, and what could the planning stage do to cut them?](https://github.com/brindlewick/postmaster/issues/400): a run's review
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
| abandoned in review | #132 | its review never ended; #135, abandoned on 10 October after its review ended on 2 October and its work redone elsewhere, is in the set |
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
- the finding-line totals of the 21-run count agree for 17 of its 21 runs, and the four that differ
  are [#135](https://github.com/brindlewick/postmaster/issues/135) (severity in the target field),
  [#202](https://github.com/brindlewick/postmaster/issues/202) (31 on lines, 34 with the escalation
  lines of rounds 8 and 9), and [#216](https://github.com/brindlewick/postmaster/issues/216) and
  [#252](https://github.com/brindlewick/postmaster/issues/252), which that count read while they
  were running;
- the inferred phase of a commit named by an `apply` line is the fix phase of the last round
  launched before the line for 236 of 239 such lines, the three that differ within a minute of a
  launch, and 12 more name a commit that is not among the run's own;
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

## The loop's rule, the replay and the date split

Added on 2026-10-13, after main had moved. The runs were first read as if one rule of the loop
stood. Three did.

**The rule of a run.** A run is pinned at dispatch to a postmaster commit, which its `run.json`
records, and runs the loop that commit carries. Two changes are the boundaries. The first made the
decision a script with a cap of three rounds (`46f02902`, in main by the merge of pull request
#139 on 29 September at 05:33 UTC, ticket #80). The second made the loop go on until a round finds more serious defects
than the one before, with no cap (`c07793e6`, in main by the merge of pull request #385 on 9 October at 09:19 UTC, ticket
#316). `loop-rule.ts` asks git whether each pinned commit has each change among its ancestors.
Controls: each boundary holds itself and its parent does not; the three rules add to the 61 runs
and 260 rounds, and to the 18 runs and 74 rounds of the later set.

**The replay.** `rise.ts` reads a run's serious findings per round and finds the first round, from
2, that logged more than the round before, where the rule would still have been running: a round
after the first with none ends the loop, so a later rise is not one it reaches (#258 logged 4, 0, 1
and would have ended at round 2). That is where the rule in force would have stopped the loop for
a ruling. Controls: `[3, 5]` rises at round 2 and `[5, 3, 0]`, `[4, 4, 0]` and `[4, 0, 1]` do not;
the runs counted are the 61 and the rounds the 260.

**The date split and round 1 as a warning.** `rise.ts` splits group A at the first boundary and
counts the runs with five or more serious findings in round 1. `render.ts` prints both, with the
comparisons of the preparation table, into `results/loop-rule.md`. Controls: the two parts of A add
to the whole (34 runs, 169 rounds), and the whole equals the A row of `features.md`, as B does.

**What this does not do.** The replay is after the fact. In the 61 runs no ruling was made because
of a rise: the older rules ran to the cap of three and stopped for a ruling there, where 3 of the
16 first rose, and 9 more rose in rounds past it. In the later set 5 of the 6 that rose ran under
the rule, so a ruling was due at each.
The date split moves together with the ticket, the flow and the reviewers. A run is on the side its
pinned commit says, not its date, so a run dispatched in the hours before a merge can be on the
earlier side. The facts about the loop come from the decision script (`scripts/review-decide.sh`
at the first commit, `scripts/review-decide.ts` at the second) and the coachman runbook at the
commits named.

## The readers

Three marks of each later finding that has text, 309 of the 382, are judgements about prose and are
not computed: **ticket open**, **disagrees** and **kind**, defined in [rule.md](rule.md#marks-judged-by-reading).

- **Two readers, each a helper that returned its answer as text.** Each was given
  [readers/brief.md](readers/brief.md) and, for each run, a packet: the ticket as it was dispatched
  (the plain part the user signed off and its checks, not the technical notes), the run's own lines
  about rulings, and each later finding with its round, severity, lens, lanes, target, text, the code
  at the cited lines, where git says those lines came from, and the earlier findings in the same
  file. A packet holds no group. Each reader marked every finding in 37 packets, in three batches of
  12 or 13 runs, and the second reader had the runs of a batch in the reverse order. The first
  reader's second batch was marked in four smaller parts, after its helper stopped on an output
  limit and was stopped in its turn.
- **Only the marks are judged.** The groups are computed and are not read, so the agreement is on
  the marks. It is in [results/marks.md](results/marks.md): the share of identical marks, the
  Wilson interval of that share, and Cohen's kappa. Where one label is nearly all of them, as with
  *disagrees*, kappa says little and the share is the figure.
- **Where they differ.** A count of findings the ticket left open is given twice: *both readers*,
  the lower bound, and *at least one reader*, the upper. A kind is kept only where both give the
  same. The session read a seeded sample of the findings on which the readers differ on *ticket
  open* and recorded its own reading ([readers/adjudication.tsv](readers/adjudication.tsv)); that
  says which reader the session sides with, and it is a third reading and not the truth.
- **Packets and replies.** The packets are built by `apparatus/packets.ts` from the run folders and
  are not committed, since they hold the tickets, which are on the tracker, and the run records.
  [results/items.tsv](results/items.tsv) holds each finding as the readers saw it, less the ticket.
  One reader's reply came back with its first lines cut off, and the helper was asked to send it
  again whole; that second reply is the one kept.
- **Neither reader is free of hindsight.** Both read the finding, which says what went wrong, and
  both are models. A mark of *ticket open* is whether the ticket could have settled the point, and
  a reader who knows the defect is quick to say it could have.

## Limits

- **61 runs, one repository, one flow that changed under them.** The groups A, B and C differ in
  date, in reviewer lanes (luna and mimo in all of B, in 17 of A's 21 runs from the script and in 6
  of C's 15; luna and haiku in 9 of C, with sonnet on security in 3 of them) and in who prepared
  the ticket. The cap of three rounds stood for all of A and B and for 9 of C's 15, and group A is
  two periods by the script. A difference between them is not a measure of one change.
- **A size that is not known is left out and not counted as nothing.** The change commits of
  #135 could not be traced, so it has no lines or files in the tables, as against the 0 the first
  tables had.
- **The finding lines are the coachman's verified list.** They say what the loop acted on and not
  what the reviewers wrote, and they are a floor where a run logged a round elsewhere. Five runs
  are filled from their own cards. Another run could be low where no record says so.
- **Where a line came from is not why it was missed.** A line in the change that no round named
  may be there because the defect needed a later fix to show, or because a reviewer's attention
  went elsewhere. The group says how the lines came to be, and the readers' marks say nothing about
  a reviewer's attention.
- **A round past the third ran on the user's ruling** in the runs before the cap went on 9 October,
  so a run's rounds are partly a decision to go on.
- **The rounds a change would have removed are bounds and not experiments.** The strict figure
  leaves a round standing wherever one other serious finding remains in it, so it reads low. The
  figure from the fitted relation takes each serious finding as worth 0.18 of a round, which is an
  average over runs and not a rule for one.
- **The signals are tried after the fact.** A transition exists only where the loop ran another
  round, and the loop ran it because the round before held a finding or the user ruled so. The
  later set was not used to choose a signal, and is two days of runs, 17 of them single thread.
- **The marks are two models' readings** (see above), on 309 findings, 73 of which have no text and
  are not marked.

## To repeat

From a checkout of this repository, with the run folders and the fixture-free project folder on the
machine that made them, run the scripts of `apparatus/` in this order. `--cut` is the end of the
first set and `--after` its start for the later set:

```
bun --no-env-file --config=/dev/null apparatus/inventory.ts --project <repo> --legacy <dir> \
    --cut 2026-10-09T22:30:00Z --out results/runs.json
bun --no-env-file --config=/dev/null apparatus/trace.ts --repo <checkout> --project <repo> \
    --legacy <dir> --runs results/runs.json --cut 2026-10-09T22:30:00Z --out results/findings.json
bun --no-env-file --config=/dev/null apparatus/trace.ts --repo <checkout> --project <repo> \
    --legacy <dir> --runs results/runs.json --after 2026-10-09T22:30:00Z \
    --cut 2026-10-11T07:30:00Z --out results/findings-later.json
bun --no-env-file --config=/dev/null apparatus/lanes.ts --project <repo> --legacy <dir> \
    --runs results/runs.json --findings results/findings.json --cut 2026-10-09T22:30:00Z \
    --out results/lane-rounds.json
bun --no-env-file --config=/dev/null apparatus/lanes.ts --project <repo> --legacy <dir> \
    --runs results/runs.json --findings results/findings-later.json \
    --after 2026-10-09T22:30:00Z --cut 2026-10-11T07:30:00Z --out results/lane-rounds-later.json
bun --no-env-file --config=/dev/null apparatus/packets.ts --project <repo> --legacy <dir> \
    --runs results/runs.json --findings results/findings.json --out <packets dir> \
    --items results/items.tsv
bun --no-env-file --config=/dev/null apparatus/adjudicate.ts --readers readers \
    --items results/items.tsv --n 24 --seed 400 --out <file>
bun --no-env-file --config=/dev/null apparatus/loop-rule.ts --results results --repo <checkout> \
    --scripted 46f02902 --rise c07793e6
bun --no-env-file --config=/dev/null apparatus/render.ts --results results \
    --cut 2026-10-09T22:30:00Z --later findings-later.json
bun --no-env-file --config=/dev/null apparatus/controls.ts --results results --repo <checkout> \
    --cut 2026-10-09T22:30:00Z
bun test apparatus/
```

The run folders are needed for `inventory.ts`, `trace.ts`, `lanes.ts` and `packets.ts` and for
nothing else. A reader without them runs `render.ts` and `controls.ts` on the committed data:
`results/runs.json`, `findings.json`, `findings-later.json`, `lane-rounds.json`,
`lane-rounds-later.json`, `loop-rule.json`, and `readers/` with the readers' marks and
`adjudication.tsv`. They write every table of `results/`. `loop-rule.ts` needs a checkout of the
project and not the run folders. `inventory.ts`, `trace.ts`, `lanes.ts` and `packets.ts` refuse to write
anything that names a path, a thread or a session.
