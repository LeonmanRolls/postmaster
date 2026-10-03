---
title: The planning stage
type: concept
standing: claimed
sources: [articles/ai-native-sdlc-playbook]
updated: 2026-09-30
---

# The planning stage

**Claim.** Every run has a planning stage before implementation: the coachman writes one
spec for the ticket, in the workhorse-spec template, and commits it; the user reviews that
one spec before any code is written; on the user's word every workhorse implements from it.

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
- **One review per run, not one per lane.** Reviewing two specs is too much, and the run
  waits on each. The coachman comes up with the spec and passes it down; the user works on
  that one with a spec session and approves it once.
- **Diversity moves from the plans to the implementations.** The spec stays at the level of
  the workhorse-spec template — what to build, the decisions that matter and the tests, not
  the code — so each workhorse still chooses its own implementation. Whether the models
  still differ usefully is an open question; the lane shares
  [#158](https://github.com/brindlewick/postmaster/issues/158) measures are what would show
  it.
- **Only the user's word approves a plan.** At the pause the postmaster starts a spec
  session on its own harness, model and effort, named for the ticket, with an editor link
  to the spec and the context it needs. The user and that session work on the spec
  together; when the user says it is ready the postmaster records the approval and resumes
  the run. A model does not approve a plan here for the same reason a coachman does not
  write one. The one exception is a fixture run, where the postmaster signs the spec off
  itself and the user is not asked.

## What it does

A run's stages gain `planning`, between `bootstrapped` and `workhorses-running`. The coachman
writes `WORKHORSE-SPEC.md` in the synthesis worktree, commits it as the run's record of
intent, and copies it to `<dispatch>/spec-review/` for review. The package has one entry:
the commit and a link built from the machine config's `planning.review_link` template, whose
`{path}` is that folder, or the path alone. The postmaster starts a spec session; the user
and that session revise the copy. On the user's word the postmaster records one decision:
approved, and the approved text is committed and every workhorse implements from it in
blinkers; changes in the user's words, and the coachman revises the spec and pauses again;
or dropped, and the run stops. The stage timings show how long the stage took, drafting
through the last decision, the spec session included.

## What would change it

The comparison in issue #9 runs the same tickets three ways: each workhorse drafting its own
spec, the coachman drafting one shared spec, and no spec at all. This page's earlier claim
was the own-spec level; on 2026-09-30 the user ruled that reviewing two specs is annoying and
the coachman comes up with the spec and passes it down. Whether the lanes still differ
usefully in their implementations is the open question the shared-spec level turns on. The
lane shares [#158](https://github.com/brindlewick/postmaster/issues/158) measures, and each
lane's branch scored beside the merged result
([#159](https://github.com/brindlewick/postmaster/issues/159)), are what would show it: if
one lane's work ships nearly whole, the shared spec has flattened the diversity. A clearly
better synthesis from no spec at all would change this again.

## What changed because of it

This reverses part of [#29](https://github.com/brindlewick/postmaster/issues/29), where the
spec was an audit record that nobody reviewed during the run, and then part of
[#81](https://github.com/brindlewick/postmaster/issues/81), where each workhorse drafted its
own spec and the user reviewed every one. The workhorse contract in
`skills/postmaster/coachman.md` gains the coachman-written spec and loses the per-workhorse
one; the postmaster's half in `skills/postmaster/postmaster.md` gains the spec session and
one decision per run; `scripts/spec-session.ts` writes the session's brief and commits the
approved text; `scripts/run spec-decisions` records one `## spec` stanza and still counts a
per-lane decisions file from before the change. Runs dispatched before this change keep
their per-workhorse specs through the tool each is pinned to.

## What would settle it

Across at least three dispatched runs after this change: the lane shares each lane supplied
to the shipped synthesis (#158), whether each lane's branch scores differently from the
merged result (#159), and how the planning row's time splits between drafting, the spec
session and revision. A run that implements from an unapproved spec, or that writes code
before the user's word, refutes the practice as written. If the shares collapse onto one
lane, the shared spec has cost the diversity the fleet exists for.
