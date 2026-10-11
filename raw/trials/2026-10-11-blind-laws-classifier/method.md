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
not change. The trial predates #425: re-running the record installs these two, pinned in its lock file, at
least a week old and with no install script, into a throwaway folder outside the repository, without the
Socket scan that #425 adds to the repository's own installs.

## The sandbox

Checked before the writer started, through `sandboxed` itself: a write inside its folder works
and reads back (positive); a write to another folder and a write to the home folder both fail
with `Read-only file system`, and neither file exists afterwards (negative); git runs, with its
global config written inside the folder; a name lookup fails, so the network is off. The macOS
form was not run here.

## Running the laws

The functions are not exported at `3abedd7` (the module exports only `reachActions`). Each version
is taken whole with `git archive <commit> scripts`, and `export` is added to the declarations above
and to nothing else; the diffs are in [`results/`](results/). A law runs in a folder holding the frozen
laws and a `classifier.ts` that re-exports that version's functions, in a process of its own, with
fast-check's seed fixed at 367 so a run can be repeated:
[`apparatus/run-laws.ts`](apparatus/run-laws.ts), whose transforms have tests beside it.

    bun apparatus/run-laws.ts 3abedd7 laws
    bun apparatus/run-laws.ts b8056c9 laws
    bun apparatus/run-laws.ts b8056c9 apparatus/control
    bun apparatus/run-laws.ts b8056c9 apparatus/control --without-newline-split

## The census and the call record

Added after the laws first ran, with the laws unchanged. fast-check stops at a law's first failing
input, and four of the seven failing laws stopped on the same defect, which could hide whatever else
they reach. `--census 400` runs each law's own predicate on 400 inputs from its own generator and keeps
every failure: fast-check is swapped, in the throwaway folder only, for a package that re-exports it
with an `assert` that does not stop. Its control, through the identical command: the newline law fails
on 0 of 300 inputs at `b8056c9` and on 70 of 300 without the newline. `--record` writes every call the
laws make to `commandTouches`, and [`apparatus/shapes.ts`](apparatus/shapes.ts) counts in them the inputs
that could show each finding.

    bun apparatus/run-laws.ts <commit> laws --census 400
    bun apparatus/run-laws.ts b8056c9 laws --census 400 --record calls.jsonl
    bun apparatus/shapes.ts calls.jsonl

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

## The writer's run

- **Time.** From its first event at 2026-10-11 04:35:53 UTC to its last at 05:41:18 UTC: 65
  minutes, 62 tool calls, about 511,000 tokens. That covers reading the ticket, writing the ten
  laws and checking their generators.
- **What it wrote.** [`laws/laws.ts`](laws/laws.ts) and [`laws/LAWS.md`](laws/LAWS.md), copied
  byte for byte from its folder and committed before any law ran against any version of the
  classifier. Its own account is [`results/writer-report.md`](results/writer-report.md).
- **What it read and ran.** [`results/writer-calls.tsv`](results/writer-calls.tsv), from its
  transcript by [`apparatus/reads.ts`](apparatus/reads.ts): 62 calls, every file read, written
  or edited inside its folder. The check marks five shell commands as naming a place outside;
  read by hand, none reads anything outside. Two set `HOME` inside a Bun process to made-up
  paths to see how Bun follows it; one sends errors to `/dev/null`; two run real bash only
  through `sandboxed`, in temporary folders inside the writer's folder, one of them trying a
  write to `/etc` that the sandbox refused. Nothing they named exists afterwards.
- **What else it may have seen.** A sub-agent starts with the harness's own instructions, which
  can include the project's `CLAUDE.md` and the session memory's index. Neither names any of the
  eight findings or anything about the classifier's defects.
- **It tested its generators against real bash, never against a classifier,** through the
  sandbox, with two scripts it deleted afterwards. The brief allows that: it bars running the
  laws against any code but the stand-in.

## Result

[`results/reading.md`](results/reading.md). The laws found 2 of the 8 findings (bug-4 and style-1) and
1 of the 5 cheap ones (style-1). Five of the other six are stated by a law whose generator never produced
an input that shows them; bug-2 is stated by none, because #202's list of separators leaves out the
newline. No failure was a false alarm, and law 4 found a defect that no review round found. By the page's
tests the trial failed on the first (fewer than a third found) and passed the other two.

## Deviations

- The census and the call record were added after the laws first ran, as above. The laws did not change,
  and the count is the same with or without them: the first failing inputs alone show bug-4 and style-1.
- Law 7 was also run on 4,000 inputs, ten times its own number
  ([`results/law7-4000.txt`](results/law7-4000.txt)). It is reported and not counted.
