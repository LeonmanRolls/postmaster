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
