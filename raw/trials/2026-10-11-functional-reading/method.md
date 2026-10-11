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

| module | lines | functions | first count | every change | what carries the state | test cases |
|---|---|---|---|---|---|---|
| `ticket-parts.ts` | 485 | 26 | 7 | 50 | locals of one pass over a text (flags, an output list) | 78 |
| `view-stream.ts` | 1,134 | 43 | 18 | 93 | module-level variables read and changed by several functions | 58 |
| `style-findings.ts` | 1,827 | 96 | 31 | 219 | the fields of a parser class changed by its methods | 148 |

The counts are #372's rule on the pinned commit. The largest files of the project (`host.ts`, 5,766
lines with 9 test cases, and `host-self-test.ts`, 7,070 with none) were left out: nothing there can
prove a rewrite the same.

## The readers and the scoring

A reader is a fresh headless model session with no tools, no repository and no memory of another
session, given the module's source as text, a glossary of the helpers it imports (verified by
running them) and the questions, and asked for its answers as one JSON object. It is not told which
arrangement it has or that there is more than one. Each module and arrangement is read by several
independent sessions with the same prompt.

The questions are written by a helper that sees only the original, with the answers computed by
running it. 24 per module and two controls: 10 *trace* (one call on an input), 8 *state* (the answer
depends on something carried across steps), 6 *change* ("if the constant NAME were V ...", answered by
running the edited original), one *trivial* control (a line's content) and one *undetermined* control
(the code does not say; the right answer is "undetermined"). An answer is right when it equals the
ground truth after the normalisation in `apparatus/reading.ts`; a missing answer is wrong.

## What would count, fixed before any reader runs

For the user's claim, "functional is easier to follow, and more so as the code grows and its state
is more shared":

1. **A difference.** The functional arrangement answers more of a module's questions right than the
   original, and the paired bootstrap interval of the difference, over the questions, excludes zero.
2. **More than cleaning up.** The functional arrangement also beats the tidy one, by the same test.
3. **Growing with scale.** The difference is larger for the 1,827-line module than for the 485-line
   one. Three modules cannot separate size from the kind of state, and the record says so.

It counts against the claim if the functional arrangement answers no more right than the original on
the largest module, or no more than the tidy one. It says nothing if readers get nearly everything
right in every arrangement (above 95%) or very little (below 20%): the reader or the questions are
then the wrong strength, and the record says that instead.

## What it cannot show

Models are not people. Several model sessions are not several readers who differ as people do. The
rewrites are made by a model too, and a rewrite can drift in ways the tests do not see. Three modules
are three modules. A question that asks what a function returns for an input is one kind of
following; whether a change is easier to make is another and is not measured. The reader sessions
load the machine's standing instructions, the same for every arrangement.
