---
kind: rule
subject: how a serious review finding after round 1 is traced to its cause, written before any was
date: 2026-10-11
---

# The rule

This file was committed before any finding after round 1 was classified. It says what is counted,
which facts are computed from git, which marks are judged, in what order a finding is put in a
group, and how the second reader is used. [method.md](method.md) says what was done with it.

## What is classified

A **later finding** is a `finding` line of a run's action log that is serious and names round 2 or
later. *Serious* is the lane audit's: class `gating`, severity P1 or P2, not marked dismissed. The
runs are the 61 of [method.md](method.md#the-runs). Round 1 is not classified: it is what the first
review found in the change as written, and every later round is read against it.

A later finding whose target is the same `file:line` text as a serious finding of an earlier round
of the same run is a **re-log**. A re-log is one more report of a finding already counted, and it
is classified with the rest, not dropped, because a defect that comes back is one of the things
this asks about.

## Facts, computed by script from git

For a later finding in round r of a run, with its lines K (the cited line, or the cited range):

- **The snapshot** of round r is the last commit on the run's own branch made at or before the
  time round r's first reviewer was launched. A round's launch time is the earliest of its
  `review-launch` lines and the time its review prompt files were written.
- **The run's own commits** are the commits of its pull request that are not on main: the commits
  from the first parent of the merge to its second, or from `origin/main` to the branch tip where
  it is not merged. A commit among them that has an equivalent by patch on main (a pick of main's
  work) is not the run's own; it counts as main's.
- **A fix commit of round k** is an own commit made after round k's launch and at or before round
  k+1's launch. **The change** is the own commits made at or before round 1's launch.
- **The origin of a line** is the commit that `git blame` gives for it at the snapshot, followed
  across moves and copies within the file only.
- **The origin class of a finding** is the first that applies over K: *fix* (some line's origin is
  a fix commit of a round before r; the round k is recorded), *change* (some line's origin is the
  change), *base* (a line's origin is an ancestor of the run's base commit, or a commit that came
  in from main), *unplaced* (the target names no line, or its file or line is not in the snapshot).
- **Placed before** is whether a line of K has the same origin (commit and line in it) as a line of
  an earlier serious finding of the same run, at that finding's own snapshot. A line a fix rewrote
  has a new origin, so a place a fix rewrote reads *fix*, not *placed before*.
- **The fix it sits in**: for an origin class *fix*, the earlier finding or findings whose `apply`
  line names the origin commit, where one does.

## Groups

A later finding goes in the first group that applies. The group says how the defect came to be
found in a round after the first, and nothing about how serious it is.

1. **Held open.** *Placed before* is yes and the origin class is not *fix*: lines an earlier
   serious finding already named are named again, after a fix was applied elsewhere in the run.
   The earlier report did not lead to a change of these lines, or led to one that did not touch
   them.
2. **Made by a fix.** The origin class is *fix*: the lines were written by a fix commit of an
   earlier round. It is **made by the last fix** where k is r-1 and **made by an older fix**
   otherwise.
3. **Missed.** The origin class is *change* and *placed before* is no: the lines were in the
   change the first round reviewed, and no earlier round named them. It is **missed by a lens that
   had reviewed** where a reviewer of the finding's lens ran in an earlier round, and **not asked
   before** where no reviewer of that lens had.
4. **Outside the change.** The origin class is *base*: the lines are older than the run, or main's.
5. **Unplaced.** The origin class is *unplaced*.

## Marks, judged by reading

Each is read from the finding's text, its target, the finding's neighbours in the run, and the
ticket as it was dispatched. A finding with no text is marked `no text` and is left out of the
marked counts.

- **Ticket open**, `yes`, `no` or `unclear`.
  - `yes`: the finding is about behaviour the ticket's criteria, decisions, direction and checks
    neither state nor rule out, where more than one reasonable behaviour exists, so the fix chose
    one the ticket could have chosen: a case a criterion does not cover, a precedence, a failure
    mode, a "what happens when" the ticket never says.
  - `no`: the ticket states the behaviour, so the code is wrong against it; or any reading of the
    ticket requires the fix (a crash, a wrong comparison, a missing guard, a stale sentence); or the
    finding is about something the ticket does not reach.
  - `unclear`: the text is too short to tell.
  - A small gap that has one sane answer is `no`. The ticket template leaves such gaps to the
    lanes, and a finding on one is the lanes' to find.
- **Disagrees**, `yes` or `no`: the finding asks for the reverse of a change an earlier round made,
  objects to a decision an earlier ruling made, or is the opposite of what another reviewer of the
  same round reported.
- **Kind**, one of seven, in this order of precedence:
  `input` the code reads or classifies an input it could not list in advance and handles one shape
  wrongly; `state` an ordering, a race, a crash or restart, a partial failure or a repeated call;
  `contract` two places that must agree do not: a producer and its reader, a document and its
  code, a test and what it tests, a preview and the real action; `site` the same defect, or the
  same missing rule, at one more place a fix or the ticket's rule should have reached; `prose` a
  runbook or document that is wrong, ambiguous or missing a step, where the defect is in the words;
  `test` a check or test that is missing, vacuous or wrong; `other`.

## The second reader

A reader that is a helper returning its answer as text is given this file, each finding's facts as
computed (group inputs, not the group), its text, the finding's neighbours and the ticket, and
none of the first reader's marks. It marks every later finding with text. The groups are computed
and are not read, so the agreement reported is on the three marks. Agreement is reported as the
share of identical marks and Cohen's kappa, per mark. Where the readers differ, the session
adjudicates and says so, and both readers' marks are kept.

## What is not decided here

The facts are the script's. The marks are two readers' judgements about prose and are not the
runs' own account of why. The groups count how a defect relates to the code's history in git, which
is not the same as what caused it in the mind of a reviewer or a lane.
