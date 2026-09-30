---
title: The workhorse spec
type: concept
standing: claimed
sources: [articles/spec-kit-templates]
updated: 2026-09-30
---

# The workhorse spec

**Claim.** The current planning contract has the coachman write one shared `WORKHORSE-SPEC.md`
for the run. Each workhorse receives the approved copy and writes no spec. The spec says what
to build, the decisions that matter and the tests, not the code, leaving implementation choices
to each lane. This policy, adopted in [#170](https://github.com/brindlewick/postmaster/issues/170),
is unverified by completed runs.

**Standing: claimed.** The policy is a decision, not a measured result. The comparison in
[#9](https://github.com/brindlewick/postmaster/issues/9) asks whether shared specs, independent
specs or no spec lead to better syntheses.

## The format

The template adapts GitHub Spec Kit's plan and tasks templates into one file
[@articles/spec-kit-templates]. The ticket already holds the what, why and high-level
direction; the shared spec records the work to do, decisions that matter, and tests. It stops
before implementation detail so that the workhorses can make their own code choices.

## What reviews it

The user reviews one shared spec before any code. The spec session works with the user on the
review copy; the postmaster records approval, requests changes in the user's words for the
coachman to revise, or stops the run. The [planning stage](planning-stage.md) carries the
current contract. Whether the coachman's authorship biases later synthesis is not yet measured.

## What would change it

The comparison in issue #9 originally included each workhorse drafting its own reviewed spec,
one coachman spec, and no spec. Runs #158 and #159 now follow the shared-spec direction by
ruling as first trials. [#158](https://github.com/brindlewick/postmaster/issues/158) measures
each lane's share of the synthesis; [#159](https://github.com/brindlewick/postmaster/issues/159)
measures each lane's branch against fixture hidden tests. Compare the contribution and score
measures across the old and new planning policies. A lane's share can show distinct work, while
the hidden tests show whether a lane's work helps the result.

## What changed because of it

Before #170, the workhorse contract asked each lane to write and commit its own plan before
code, and the planning stage asked the user to review each one. The current
[coachman contract](../../skills/postmaster/coachman.md) replaces that with one coachman-authored
spec, a single review package and one user decision. Runs dispatched before the change keep
their per-workhorse specs through their pinned tool.
