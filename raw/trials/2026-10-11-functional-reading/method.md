---
kind: trial
subject: whether a module written with no mutation is easier for a model to follow than the same module with mutation, and whether the difference grows with the module's size and with how much state its functions share
date: 2026-10-11
---

# Method

**Question.** The user's, in their words on 2026-10-11: "see if functional code is easier to follow",
adding that it "only shows its benefits at larger scales and complexities, so the trial would need to
run on fairly complex code". It is a follow-up to [the functional-core
page](../../../wiki/concepts/functional-core-and-verification.md), which says that no study found
compares a reader's or a model's grasp of mutable and immutable versions of the same code. The
user asked for it to be run in the research session of #366, with no ticket of its own.

**Order of work, so the controls mean something.** This file, the briefs given to the helpers and
the apparatus are the first commit of this folder. The second holds the questions, their answers, the
glossaries and the three arrangements of each module, all fixed before any reader sees any of them.
The third holds the readers' sessions and the results. The history of the folder shows that order.

## What is compared

One **arrangement** of a module is the module's source, rewritten or not. Three arrangements of each
of three modules, all with the same behaviour:

- **original**: the module as it is on the main branch.
- **functional**: nothing changed after it is made, anywhere, locals included: no reassigned variable,
  no assignment to a property or element, no in-place method, no class with fields that change;
  decisions kept apart from reads and writes, which stay at the edges. Written to read well, not
  golfed.
- **tidy**: the same amount of rewriting (added plus deleted lines, within 15%) with the original's
  mutation kept: functions split, names clearer, definitions reordered, comments added. It is the
  control for "any cleanup helps".

Each rewrite is made by a model that has the original and the module's tests, and not the questions.
It is accepted when the module's own tests pass, a differential check on at least 300 inputs finds no
difference, and the type check and the repository's lint pass. **A manipulation check** is the two
mutation counts of [#372](https://github.com/brindlewick/postmaster/issues/372)'s rule, run on every
arrangement: the functional one should read 0 and 0 (or name its exceptions), the tidy one within
10% of the original.

## The modules, and why these

Chosen on 2026-10-11 from the 79 non-test modules of `scripts/` at the pinned commit, by three things
the question needs: it is real code of the project, its behaviour is deterministic and can be run for
a ground truth, and its own tests are strong enough to prove a rewrite the same. They differ in size
and in how the state is shared between functions:

| module | lines | functions | first count | every change | what carries the state | tests |
|---|---|---|---|---|---|---|
| `ticket-parts.ts` | 485 | 26 | 7 | 50 | locals of one pass over a text (flags, an output list) | 78 |
| `view-stream.ts` | 1,134 | 43 | 18 | 93 | module-level variables read and changed by several functions | 63 |
| `style-findings.ts` | 1,827 | 96 | 31 | 219 | the fields of a parser class changed by its methods | 148 |

The counts are #372's rule on the pinned commit, and the tests are what `bun test` runs for the module. The largest files of the project (`host.ts`, 5,766
lines with 9 test cases, and `host-self-test.ts`, 7,070 with none) were left out: nothing there can
prove a rewrite the same.

## The readers and the scoring

A reader is a fresh headless model session with no tools, no repository and no memory of another
session, given the module's source as text, a glossary of the helpers it imports (verified by
running them) and the questions, and asked for its answers as one JSON object. It is not told which
arrangement it has or that there is more than one. Each module and arrangement is read by several
independent sessions with the same prompt, in two modes: **careful** (it is told to trace each
answer step by step) and **quick** (it is told to write nothing but the answers). The sessions run
`claude -p` with no tools, a short system prompt, no session record and an empty working folder.

The questions are written by a helper that sees only the original, with the answers computed by
running it. 24 per module and two controls: 10 *trace* (one call on an input), 8 *state* (the answer
depends on something carried across steps), 6 *change* ("if the constant NAME were V ...", answered by
running the edited original), one *trivial* control (a line's content) and one *undetermined* control
(the code does not say; the right answer is "undetermined"). An answer is right when it equals the
ground truth after the normalisation in `apparatus/reading.ts`; a missing answer is wrong.

## Calibration, and what it changed

Before any rewrite existed, the original of `style-findings.ts` was read by 3 sessions of the small
model (`claude-haiku-5-5`) at medium reasoning effort, then 3 at low effort, then 2 with the reader told
to write no reasoning and its thinking capped at 0, and 2 capped at 3,000 tokens. Only the original
was read, so nothing about how the arrangements compare had been seen. [calibration/](calibration/)
holds every session.

| setting | valid sessions | answers right | mean output tokens | mean seconds |
|---|---|---|---|---|
| careful, medium effort | 3 | 74 of 78 (95%) | 67,500 | 269 |
| careful, low effort | 3 | 73 of 78 (94%) | 56,200 | 226 |
| quick, thinking capped at 0 | 2 | 43 of 52 (83%) | 39,100 | 162 |
| quick, thinking capped at 3,000 | 1 of 2 | 24 of 26 | 51,600 | 211 |

The model reads this 1,827-line module almost perfectly given the time, so accuracy at the careful
setting is at the ceiling, and neither the effort flag nor the cap bounds its thinking (a cap of 0
still spent 38,000 thinking tokens). One session in the last row answered "undetermined" to every
question after two seconds. So, fixed here and before any arrangement was read:

1. **The primary measure is the effort a reader spends to answer**: the output tokens of a
   careful-mode session, at equal accuracy. Accuracy is the primary measure only in quick mode,
   where the original reads 83%.
2. **A session is invalid** when its answers cannot be read out of its reply, or when at least half
   of them are "undetermined". It is kept, listed and left out of every figure.
3. **Five valid sessions** per arrangement in each mode, the first five in the order they ran. The
   readers are `claude-haiku-5-5` at medium effort in careful mode and at low effort in quick mode.

## What would count, fixed before any arrangement was read

Per module, functional against original, in careful mode:

- **Easier**: the ratio of mean output tokens (functional over original) has its bootstrap 95%
  interval below 1, and the share of answers right is not lower by more than 5 points.
- **Harder**: the interval is above 1, or the share right is lower by more than 5 points.
- **No difference**: otherwise.

In quick mode, **easier** is a higher share right with the paired bootstrap interval above zero,
**harder** a lower one with the interval below zero. The same reading is made for functional against
tidy: "more than cleaning up". The length of each arrangement and the tokens of its source are
reported beside the effort, since a longer module is not read for free.

For the user's claim, "and more so as the code grows and its state is more shared": it holds if the
modules read easier in the order of their size, the ratio smallest on the largest module. It counts
against the claim if the functional arrangement reads harder on the largest module, or no easier than
the tidy one. Three modules cannot separate size from the kind of state, and the record says so. It
says nothing if every arrangement of a module costs about the same and is answered equally well.

## What it cannot show

Models are not people. Several model sessions are not several readers who differ as people do. The
rewrites are made by a model too, and a rewrite can drift in ways the tests do not see. Three modules
are three modules. A question that asks what a function returns for an input is one kind of
following; whether a change is easier to make is another and is not measured. The reader sessions
load the machine's standing instructions, the same for every arrangement.

## What was made, and how each arrangement was checked

Nine helpers (model sessions with tools) did the writing: a question writer and two rewriters for
each module. Each rewriter had the original and its tests and did not see the questions; the tidy
rewriter was told only the number of lines the functional one had changed.

| module | arrangement | lines | lines changed | tests | differential comparisons, differences | first, every |
|---|---|---|---|---|---|---|
| `ticket-parts.ts` | original | 485 | | 78 | | 7, 50 |
| | functional | 705 | 774 | 78 | 111,279, 0 | 0, 0 |
| | tidy | 704 | 745 | 78 | 22,373, 0 | 7, 50 |
| `view-stream.ts` | original | 1,134 | | 63 | | 18, 93 |
| | functional | 1,277 | 1,125 | 63 | 286,352 (two seeds), 0 | 0, 0 |
| | tidy | 1,305 | 1,119 | 63 | 1,117,415, 0 | 18, 93 |
| `style-findings.ts` | original | 1,827 | | 148 | | 31, 219 |
| | functional | 2,293 | 2,868 | 148 | 6,520, 0 | 0, 0 |
| | tidy | 2,105 | 2,850 | 148 | 3,160, 0 | 31, 218 |

"Lines changed" is added plus deleted by `git diff --numstat` against the original. The helper's own
differential check is the one in the table; the checks below were made again from outside, for each
of the six rewrites: the module's tests, the two counts with the same rule, and the answers to all 26
questions, which equal the original's every time. The functional rewrites carry one exception each at
an edge or none: `readChunkEdge` in `view-stream.ts` hands a buffer to `readSync`, which fills it;
the others have no mutation anywhere.

## Results

Five valid sessions of each arrangement in each mode: the first five in the order they ran. Seven
ran; one session (the tidy `view-stream.ts`, careful) was invalid and is listed. "Prompt tokens" is
what the reader is given: the source, the glossary and the questions.

| module | arrangement | lines | prompt tokens | careful: right | careful: output tokens | quick: right | quick: output tokens |
|---|---|---|---|---|---|---|---|
| `ticket-parts.ts` | original | 485 | 24,900 | 128/130 (98.5%) | 61,900 | 128/130 (98.5%) | 44,400 |
| | functional | 705 | 28,500 | 126/130 (96.9%) | 68,000 | 127/130 (97.7%) | 45,900 |
| | tidy | 704 | 28,700 | 130/130 (100%) | 61,900 | 124/130 (95.4%) | 44,300 |
| `view-stream.ts` | original | 1,134 | 33,900 | 129/130 (99.2%) | 42,600 | 125/130 (96.2%) | 30,200 |
| | functional | 1,277 | 36,800 | 129/130 (99.2%) | 44,200 | 129/130 (99.2%) | 30,000 |
| | tidy | 1,305 | 36,600 | 128/130 (98.5%) | 40,700 | 126/130 (96.9%) | 28,300 |
| `style-findings.ts` | original | 1,827 | 44,700 | 123/130 (94.6%) | 71,000 | 117/130 (90.0%) | 45,300 |
| | functional | 2,293 | 55,000 | 129/130 (99.2%) | 72,400 | 115/130 (88.5%) | 48,800 |
| | tidy | 2,105 | 53,200 | 127/130 (97.7%) | 67,200 | 120/130 (92.3%) | 37,600 |

The rules fixed beforehand, applied to every comparison in [results/verdicts-careful.tsv](results/verdicts-careful.tsv)
and [results/verdicts-quick.tsv](results/verdicts-quick.tsv): **17 of the 18 read "no difference" and
one reads "easier", and none reads "harder".** The one is `view-stream.ts` in quick mode, functional
against original: 4 more answers right of 130, a difference of 3.1 points with an interval of 0.8 to
6.2. Against the tidy arrangement the functional one is never easier. In careful mode the ratio of
output tokens, functional over tidy, is above 1 in all three modules (1.10 for `ticket-parts.ts`, 1.09
for `view-stream.ts` and 1.08 for `style-findings.ts`), with each interval starting just under 1 (0.998,
0.998 and 0.995); in quick mode it is 1.03, 1.06 and 1.30, and the last is the one interval wholly
above 1 (1.16 to 1.46), on `style-findings.ts`.

On the user's claim, "easier, and more so as the code grows": **not supported.** The functional
arrangement is not easier than the original on the largest module in either mode. One pattern fits
it, and it is weak. In careful mode the share right, functional minus original, is -1.5, 0.0 and +4.6
points for the 485, 1,134 and 1,827 line modules, with the ratio of output tokens 1.10, 1.04 and 1.02.
Three modules, and the interval of the largest difference starts at 0.0. In quick mode there is no such
order (-0.8, +3.1 and -1.5).

**Pooled over the three modules, made after the results and not fixed beforehand**
([results/pooled-careful-first5.tsv](results/pooled-careful-first5.tsv),
[results/pooled-quick-first5.tsv](results/pooled-quick-first5.tsv)): in careful mode the functional
arrangement takes 1.05 times the output tokens of the original (interval 0.99 to 1.11) and 1.09 times
those of the tidy one (1.03 to 1.14), at the same share right (+1.0 and -0.3 points, both intervals
around zero). In quick mode the ratios are 1.03 (0.98 to 1.10) and 1.12 (1.07 to 1.18). The tidy
arrangement takes 0.97 (0.92 to 1.02) and 0.92 (0.86 to 0.99) of the original's. With all seven valid
sessions instead of five, the functional over original ratio pools to 1.08 (1.02 to 1.13) in careful
mode ([results/pooled-careful-all-valid.tsv](results/pooled-careful-all-valid.tsv)). So the best
reading of the effort is a few per cent more than the original and about a tenth more than a tidy
rewrite of the same size.

By question type ([results/careful-first5.tsv](results/careful-first5.tsv)) nothing separates them:
the *state* questions, which carry the mechanism the claim rests on, are answered 92% to 100% right in
every arrangement.

## How sure

- **Firm:** the rewrites are the same program (tests, a differential check of between 3,000 and
  1,100,000 inputs each, and the answers to the 26 questions), and the counts say the functional
  ones have no mutation and the tidy ones as much as the original.
- **Firm enough:** that this reader, at this effort, reads all nine arrangements nearly perfectly.
  Accuracy is at the ceiling (88% to 100%), so a difference in what is *right* could hardly show,
  and the measure that could show one is effort, which differs by a few per cent.
- **Soft:** every interval above is a bootstrap over 26 questions or over five sessions. Three
  modules differ in size, in state and in domain at once. One "easier" among 18 comparisons is
  what a few chance results would give.
- **Not measured:** whether a person finds either easier; whether a change is easier to make, or a
  defect easier to see, in one or the other; a stronger or weaker reader than the one used; code of
  a different kind from this project's scripts.

## What did not go as designed

- **The question writer and the rewriter of `ticket-parts.ts` shared a scratch folder**, because the
  briefs named one output folder. The writer ran its harness once on a draft of the rewrite it found
  there, to check the harness, and says it changed no question for it. The writer of
  `view-stream.ts` was still finishing when its rewriter began, and they too shared a folder; the
  writer says it touched nothing of the rewriter's. The writer of `style-findings.ts` had finished
  before its rewriter began.
- **Two question writers tried their questions on readers of their own,** model sessions that were
  told to run nothing and that had other tools. Those answered every question right in each round,
  which is why the calibration above was made.
- **The calibration changed the measures and the criteria,** once, before any arrangement was
  read. The record keeps the calibration sessions.
- **The reader's thinking could not be capped.** The setting that should have capped it did not, so
  "quick" is an instruction to write no reasoning, not a bound on thinking.
- **Session identifiers were removed** from the readers' result files, and local paths from the helpers'
  notes and the briefs' templates, before they were committed.
- **The questions files are laid out one object per line, each continuation line starting with a comma.**
  The project's private-data scanner reads `"id": "trace-1"` at the start of a line as an account
  identifier, and a first-person "I made 318" in a helper's notes as income. The layout and that one
  phrase were changed before the branch was published; the questions, their order and every other
  word are as the helpers wrote them.
- **The reader sessions loaded the machine's standing instructions,** which the project keeps in a
  global file and which say, among other things, how code should be written. The same for every
  arrangement.

## Side findings

- **A defect in the project's code.** `Tree.up(cwd, names)` in `style-findings.ts` never returns when
  no name is found and `cwd` is below the repository root. A gate of `cd sub && just lint` in a
  repository with no justfile reaches it, and so does a package script, run with cwd `.`, that calls a
  tool whose configuration file is absent (`npm run hooks` calling `lefthook`). The question writer
  found it, and the rewriters kept it, as they were told to.
- **The functional rewrite has costs beyond reading.** It is 45%, 13% and 25% longer than the original.
  The functional `style-findings.ts` reads blobs lazily by throwing an exception that the one edge
  catches, and is 5 to 10 times slower on a 20,000 line script (3.7 seconds against 0.4); where the
  original crashes it crashes with the same exit code and a different message.
- **The work was most of the cost.** The nine helpers used about 4.5 million tokens and between 45
  minutes and two hours each. The 136 reader sessions cost $3.64 in all.

## Repeating it

The pinned commit is `7b470584`. Each arrangement is in `arrangements/<module>/`, the questions,
answers, glossary and harness in `questions/<module>/`, and the sessions in `readers-careful/` and
`readers-quick/`. `bun test` over `apparatus/` runs the unit tests of the scoring. The commands:

    bun --no-env-file --config=/dev/null apparatus/read-module.ts --trial <this folder> --module <name> --cwd <empty folder>
    bun --no-env-file --config=/dev/null apparatus/tabulate.ts --trial <this folder> --readers readers-careful --take 5
    bun --no-env-file --config=/dev/null apparatus/verdicts.ts --trial <this folder> --readers readers-careful --mode careful
    bun --no-env-file --config=/dev/null apparatus/pooled.ts --trial <this folder> --readers readers-careful --take 5

The reader is `claude-haiku-5-5` run as `claude -p` with no tools, a short system prompt and no
session record. The mutation counts need the rule in
[`raw/trials/2026-10-09-mutation-counts/apparatus/`](../2026-10-09-mutation-counts/apparatus/) and
Oxlint 1.86.0.
