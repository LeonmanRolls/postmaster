---
title: The planning stage
type: concept
standing: claimed
sources: [articles/ai-native-sdlc-playbook]
updated: 2026-09-29
---

# The planning stage

**Claim.** Every run has a planning stage before implementation: each workhorse drafts its
own spec and commits it, blind to the others, and stops; the user reviews each spec before
any code is written; no workhorse implements until its own spec is approved.

**Standing: claimed.** This is a decision taken on reasoning and on outside work, before any
run bears on it. The comparison in [issue #9](https://github.com/brindlewick/postmaster/issues/9)
is its test. Outside work motivates the shape and moves no standing.

## The reasoning

- **A fault is cheapest to fix at the planning stage.** When the plan is still a document, a
  change of approach is an edit. When it is already code, it is rework. The playbook says the
  same: "Design review happens before any code is generated, when changing course is still a
  matter of editing a document"
  [@articles/ai-native-sdlc-playbook/passages.md] ([the capture](../sources/ai-native-sdlc-playbook.md)).
- **Weaker models gain the most from a reviewed plan** (unverified: no run has compared
  reviewed plans against unreviewed ones yet). A plan the user has already scoped and
  corrected is a better starting point than one a model invented and nobody checked. The
  playbook holds the call with the human: a person decides whether the spec may progress to
  build [@articles/ai-native-sdlc-playbook/passages.md].
- **Review is for scope and correctness, not for making the specs alike.** Each workhorse
  still drafts its own spec, blind to the others ([the workhorse spec](workhorse-spec.md)),
  so the approaches stay independent and the synthesis still has something to choose between.
  One workhorse's spec is never shown to another, and feedback goes to one workhorse at a
  time.
- **Only the user's word approves a plan.** The postmaster puts each spec to the user in its
  interactive session, one at a time, and records the decision: approved, changes requested in
  the user's words, or dropped. A model does not approve a plan here for the same reason a
  coachman does not write one. The one exception is a fixture run, where the postmaster signs
  each spec off itself and the user is not asked.

## What it does

A run's stages gain `planning`, between `bootstrapped` and `workhorses-running`. Each
workhorse writes `WORKHORSE-SPEC.md`, commits it, and stops before any code. The coachman
builds a review package — each spec's commit and a link to the file in that workhorse's
worktree — and pauses. The postmaster puts one spec to the user at a time, as a link built
from the machine config's `planning.review_link` template or the path alone, and logs each
decision as it happens. A workhorse whose spec needs changes revises it from the user's words,
in its own thread, and the revised spec comes back for review at a new commit. The user may
drop a workhorse at review. Implementation needs at least two approved specs; a run with fewer
stops and says why. The stage timings show how long the stage took, drafting through the
last decision.

## What would change it

The comparison in issue #9 runs the same tickets three ways: each workhorse drafting its own
spec, the coachman drafting one shared spec, and no spec at all. Its own-spec level is the
workhorses' own specs reviewed by the user, and whether review makes the specs converge is a
measure of it. This stays the default unless a shared spec or no spec produces a clearly
better synthesis.

## What changed because of it

This reverses part of [#29](https://github.com/brindlewick/postmaster/issues/29), where the
spec was an audit record that nobody reviewed during the run. #29's other decision stands:
the coachman does not check code against the spec. The workhorse contract in
`skills/postmaster/coachman.md` gains the planning pause and the two-approved bar; the
postmaster's half in `skills/postmaster/postmaster.md` gains the interactive spec review;
`scripts/stage.sh` gains the `planning` stage, `scripts/log-action.sh` the `spec-review`
action, and `scripts/spec-decisions.sh` owns the decisions file and the run-wide approval
count. The cost it adds is the user's review time, which the stage timings carry.

## What would settle it

Across at least three dispatched runs: whether reviewed specs lead to fewer changes of
approach after implementation starts than unreviewed ones, whether the specs of two
workhorses converge more after review than before it, and how the planning row's time splits
between drafting, the user's review and revision. A run that implements from an
unapproved spec, or shows one workhorse's spec to another, refutes the practice as written.
