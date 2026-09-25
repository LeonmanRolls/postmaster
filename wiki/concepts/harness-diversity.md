---
title: Harness diversity, independent of the model
type: concept
standing: claimed
sources: []
updated: 2026-09-25
---

# Harness diversity, independent of the model

**Claim.** The harness a lane runs under varies its output in ways that contribute to the
synthesis or to corroboration, independent of the model. If it holds, two lanes on one model
through different harnesses are a kind of diversity that needs no second vendor.

**Standing: claimed.** Pre-registered: the claim, its measurement and its decision rule are
written down before any run or trial bears on them.
[Issue #12](https://github.com/brindlewick/postmaster/issues/12) is its test.

## Why it is a question

A lane is a harness plus a model, and the diversity rule looks only at the model: `[team]` in
`config.example.toml` asks for workhorses from at least two vendors. A harness sets the system
prompt, the tool set, the permission model, which context files are read and how context is
compacted. One model under two harnesses is therefore not quite the same agent. Whether the
difference is worth anything has not been measured.

The rule's own example mixes the two. The two workhorses in `config.example.toml` differ in
harness as well as in vendor, so what the rule has bought so far has never been separated from
what a harness buys.

A harness can change what the model receives, as [prompt delivery](prompt-delivery.md) shows.
That is a difference in input. This page is about output, and what it is worth.

## The three arrangements

One workhorse is the same in all three: a model on a harness. Only the other workhorse changes.

| arrangement | the other workhorse | differs from the control in |
|---|---|---|
| **A**, the control | the same model on the same harness | nothing but chance |
| **B** | the same model on another harness | the harness |
| **C** | another vendor's model on the same harness | the model |

C is the arrangement the diversity rule asks for today. Holding its harness fixed needs a
harness that reaches both vendors, such as pi, whose adapter takes a provider-qualified model id
(`skills/postmaster/harnesses.md`). Where no harness reaches both, the run records that C
differs in both.

Everything else is identical across the arrangements of a comparison: the ticket, the base
commit, the brief, the effort, the coachman, the reviewers and the gate.

The arrangements are the measurement's own controls. A should vary least of the three, and C
should vary more than A. If either fails, the measures are not seeing diversity, and nothing
can be read about B.

## What is measured

The measures are those of [issue #9](https://github.com/brindlewick/postmaster/issues/9), so
that the two experiments read side by side:

- **Diversity**: the share of changed lines on which the two workhorses' diffs differ, and the
  overlap of the files each one touched.
- **Design against code**: how far the two [workhorse specs](workhorse-spec.md) differ, beside
  how far the diffs differ. It shows whether a harness changes the approach or only how the
  approach is carried out.
- **Provenance**: what the synthesis took from each workhorse, and the share of its lines that
  came from each (H1 on [combining models](combining-models.md)).
- **Corroboration**: each review finding, the lane that made it, whether a second lane made it
  independently, and whether it held up (H2).
- **The gate**: its exit on the synthesis before review and after the last round, and the
  rounds to clean.
- **Quality**: a hidden acceptance suite, written before dispatch and kept out of every
  worktree, run against each workhorse and the synthesis.
- **The multi-model margin**: the synthesis's hidden-suite score minus the best single
  workhorse's.
- **Cost**: tokens and wall-clock per lane, as each harness reports them.

One comparison belongs to this question alone. In B, a corroborated finding is one model
agreeing with itself under two harnesses. The hold-up rate of B's corroborated findings, set
against C's, shows whether that agreement is worth as much as agreement between vendors.

## Controls

- Each ticket in each arrangement runs at least twice. A difference between arrangements counts
  only if it exceeds the spread between repeats of one arrangement.
- A runs on one of B's two harnesses. The trial below measures repeats on both, so that a
  harness which varies more on its own is not mistaken for diversity between harnesses.
- The same model means the same provider-qualified model id, checked on each harness's own
  record of what it called rather than taken from the config.
- The brief is byte-identical in every lane, and each harness is checked to have received it
  verbatim.
- Measurement runs cut `wiki/` and `raw/` from lane worktrees, because this page holds the
  hypothesis under test.

## Confounds, recorded rather than removed

A harness is a bundle, and B measures the whole bundle. Some parts of it are not what the claim
is about, so every run records them:

- **Effort.** Each harness has its own effort flag (`skills/postmaster/harnesses.md`). The same
  word need not reach the model as the same setting. Record the flag each lane got and, where it
  can be seen, what reached the model.
- **Ambient context.** Which context files each harness read: in the worktree, in the
  directories above it, and at user level outside the repository. A lane whose harness found no
  context file starts blind, a handicap that has nothing to do with the model. The flow then
  names the project's docs in that lane's brief, so its brief differs from the others', and the
  run records that too.
- **Other models.** Every model id in each harness's own record, in case a harness calls a model
  other than the lane's, for a subagent or for auxiliary work.
- **Compaction.** Whether and when each harness compacted a lane's context.
- **Versions and billing.** Each harness's version, and how each lane was billed. Billing bears
  on the cost comparison, not on the output.

## What would settle it

The standing moves only on run records.

- **Supported** when B exceeds A by more than the spread between repeats on provenance, on the
  multi-model margin or on corroborated findings that held up, with A and C behaving as
  controls.
- **Refuted** when B stays within that spread of A while C exceeds it.
- **Mixed** when the two tickets disagree.

If the controls fail, the standing stays `claimed` whatever B shows.

## Decision rule

Fixed before any run. It decides whether two harnesses on one model count toward the diversity
rule in `[team]`:

- **B matches C** on the multi-model margin and on the hold-up rate of corroborated findings,
  within the spread between repeats, and exceeds A by more than that spread: they count. The
  rule in `config.example.toml` and the setup prompt in `scripts/setup.sh` change to say so, and
  `AGENTS.md`, which states no diversity rule today, gains it where it describes setup.
- **B exceeds A but falls short of C**: the rule stays vendor-based, and its statement in
  `config.example.toml` gains the reason: a second harness adds diversity, but not enough to
  stand in for a second vendor.
- **B stays within the spread of A**: the rule stays vendor-based, and gains the reason that a
  second harness on one model was measured and added nothing a repeat did not.
- **A does not vary least, or C does not exceed A**: the measurement failed its own control,
  and nothing changes on it.

The rule changes on runs across both tickets, never on the trial below.

## Prediction

To be tested, not assumed. B varies more than A and less than C, and more in the code than in
the design, since a harness shapes how a lane works more than what it decides to build. B's
corroborated findings are dismissed more often than C's, because one model carries the same
blind spots through both harnesses. On that prediction the rule stays vendor-based and gains
its reason. A result where B matches C would refute the prediction, and is as useful.

## Minimum design for the runs

Two tickets of different kinds, one tightly constrained and one open in design, each in the
three arrangements, twice each: twelve runs. Where runs at issue #9's own-spec level use the
same tickets and lanes, they are arrangement C already and need not be run again. The runs
depend on the gate (#17) for gate results, the ledger fields (#19) for findings and
corroboration, and the session exports (#20) for the models each harness called and the
contamination check.

## A cheap trial first

Before any full run, in the manner of issue #9's trial, in two steps:

1. **What each harness sends.** The same brief goes through each harness to the same model id,
   against a local stand-in that records every request and replies with a fixed message, as the
   trial behind [prompt delivery](prompt-delivery.md) did. It records the system prompt's size
   and the context files in it, the tools offered, the effort and thinking settings, and any
   other model called. It needs no model, and no credential beyond a dummy token.
2. **What each harness produces.** A small task in a fixture repository made for the trial,
   with no wiki in it, goes single-shot to each lane the arrangements use, several samples
   each. Each sample runs against a hidden suite. The divergence between harnesses is compared
   with the divergence between repeats on one harness. So is the gain two samples could offer a
   synthesis: the hidden tests either one passes, minus those the better one passes.

Step 1 settles a fact about the tools. Step 2 settles one narrow thing: whether changing the
harness moves a lane's output more than running it again does. It counts as doing so when the
median divergence between harnesses exceeds the largest divergence between two repeats on
either harness. With a handful of samples that reading can show an effect but cannot show its
absence. Neither step moves this page's standing, which is about synthesis and corroboration
and needs runs.

## What changed because of it

Nothing yet. The diversity rule stands as written until the runs are in.
