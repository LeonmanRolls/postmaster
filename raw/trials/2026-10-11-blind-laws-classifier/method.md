---
kind: trial
subject: whether laws written from a ticket alone, without sight of the review findings, find the first-round defects of #202's shell-command classifier
date: 2026-10-11
---

# Method

**Question.** [Issue #367](https://github.com/brindlewick/postmaster/issues/367), trial 1 of
[the functional-core page](../../../wiki/concepts/functional-core-and-verification.md). The
[earlier count](../2026-10-04-review-findings-classified/method.md) judged that a stated property
would have caught most serious review findings, but both of its readers knew each defect. This
trial measures that hindsight on one family: laws written by a model that has seen neither the
findings nor the code are run against the code the first review round read.

**Order of work, so the result means something.** This file and the folder `writer/`, which is
the writer's whole input, are committed before the writer starts. The writer's laws are committed
unchanged before they first run against any version of the classifier.

## The target

The shell-command classifier of [#202](https://github.com/brindlewick/postmaster/issues/202):
`commandTouches` and the shell helpers it calls (`splitShell`, `shellWords`, `unwrapShell`,
`expandPath`, `isPathToken`) in `scripts/reach.ts` at `3abedd7`, the commit the first review round
read. The code after that round's fixes is `b8056c9` (`da3305c` applied the fixes; `b8056c9`
changed one regular-expression class).

The eight findings are the round-1 findings of #202 that the earlier count's first reading tags
with a classifier family: 202/bug-1, bug-2, bug-3, bug-4, bug-5, sec-2, sec-3 and style-1
([findings.tsv](../2026-10-04-review-findings-classified/data/findings.tsv),
[first-reading.tsv](../2026-10-04-review-findings-classified/first-reading.tsv)). The five cheap
ones are bug-2, bug-3, bug-5, sec-3 and style-1; bug-4 and sec-2 are heavy; bug-1 is `neither`.

## The writer

- **Who.** A sub-agent of the session that prepared #367, started with a fresh context and no
  model override, so it runs on that session's model. That session has read the findings, so it
  does not write the laws.
- **What it is given,** all in `writer/`, and nothing else: [`BRIEF.md`](writer/BRIEF.md), its
  instructions, which name no defect and no law; [`ticket-202.md`](writer/ticket-202.md), the body
  of #202 byte for byte as the run was dispatched with it (last edited 2026-10-03 15:30 UTC,
  before round 1); [`signatures.ts`](writer/signatures.ts), the declarations of the functions above
  and the types they use, bodies removed; [`classifier.ts`](writer/classifier.ts), a stand-in with
  the same exports that returns empty answers; [`sandbox.ts`](writer/sandbox.ts), which runs a real
  program where only one throwaway folder can be written and the network is off;
  [`run-stub.ts`](writer/run-stub.ts), which runs the laws against the stand-in; a placeholder
  [`laws.ts`](writer/laws.ts); and fast-check 4.10.2, pinned in
  [`package.json`](writer/package.json) and [`bun.lock`](writer/bun.lock).
- **Where.** A folder outside the repository holding exactly those files and fast-check's
  installed files. Not a worktree: a worktree shares the repository's history, where the page,
  the findings and the fix commits are one command away.
- **Blindness is checked, not assumed.** Every file the writer read and every command it ran is
  listed from its transcript. Anything outside its folder is a deviation below, with its effect.
  The list is committed; the transcript is not, since it holds the model's reasoning.

## fast-check

Installed only in the writer's folder with `bun add --exact --minimum-release-age=604800
fast-check@4.10.2`: 4.10.2 was published 2026-09-19 and was the newest release at least seven
days old. Its one dependency resolved to pure-rand 8.4.2. The project's own `package.json` does
not change.

## The sandbox

Checked before the writer started, through `sandboxed` itself: a write inside its folder works
and reads back (positive); a write to another folder and a write to the home folder both fail
with `Read-only file system`, and neither file exists afterwards (negative); git runs, with its
global config written inside the folder; a name lookup fails, so the network is off. The macOS
form was not run here.

## Running the laws

The functions are not exported at `3abedd7` (the module exports only `reachActions`). Each version
is taken whole with `git archive <commit> scripts`, and `export` is added to the declarations above
and to nothing else; the diff is in `apparatus/`. A law runs in a folder holding the frozen laws
and a `classifier.ts` that re-exports that version's functions, with fast-check's seed fixed so a
run can be repeated.

## Counting

- **Found.** A law fails at `3abedd7` on an input that shows the finding's defect, matched by the
  finding's description and its fix in `da3305c`. For a finding not found, the reading says whether
  a law states it and its generator never reached it, or no law states it. A later-round
  classifier finding that a law reaches is noted, not counted.
- **False alarm.** A failure whose input the classifier answered as #202 asks. It is judged
  against #202's text, because no version of the classifier was ever found clean: every review
  round from 1 to 7 found classifier defects, and the run removed the classifier in `addd072`,
  before round 8.
- **Time.** The writer's wall-clock time from its start to its finished laws.

## Control

The page's own law for bug-2, written by this session and not one of the writer's: the writes
found in two commands joined by a newline are the union of the writes found in each. Through the
identical command it must pass at `b8056c9` and fail at `b8056c9` with newline splitting taken
out again (negative and positive). It counts toward nothing.

## Failure tests, from the page

The trial failed if the laws find fewer than a third of the eight, if they fail on code the review
later found clean (read here as a false alarm), or if the generators take more than a day.

## Deviations

None yet.
