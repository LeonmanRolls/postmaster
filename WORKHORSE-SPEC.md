# Workhorse spec: #170, The coachman writes one spec that every workhorse implements, and the user reviews it once

_Shared spec written by the coachman from the two lane specs, per the user's word in planning round 1. Identical in both lanes' worktrees. Both lanes implement from this same file, in blinkers as before._

## Summary

The planning stage drops per-workhorse specs: the coachman writes one spec for the ticket in the workhorse-spec template and commits it, the user reviews that one spec, and on approval every workhorse implements from it in blinkers, still free to choose the code.

## Technical context

- **Language and version**: bash with Python in heredocs (the repo's existing scripts), markdown runbooks and wiki pages
- **Dependencies used or added**: none
- **Testing**: the waybill's gate, in particular `scripts/spec-decisions.sh --self-test` with controls for a one-spec package, a changes round, an approval and a run from before the change; a fixture run scores clean before merge, per the ticket's note
- **Constraints**: the coachman contract changes only in runbooks and scripts the runbooks name; runs dispatched before this change keep their per-workhorse specs through the tool they were pinned to; lanes stay in blinkers; the spec stays at the template's level; deterministic behaviour lives in `scripts/`, not prose; no harness-specific wording in the flow

## Direction check

| Constraint | How this plan meets it |
|---|---|
| The coachman comes up with the spec and passes it down | Planning becomes a coachman-only act: one `WORKHORSE-SPEC.md` written from the template and committed in the synthesis worktree. Workhorses are not launched until the spec is approved; their briefs no longer carry a planning stop or the template. |
| The user reviews one spec: approved, changes in their words, or the run stops | One review package, one decision recorded for the run. A changes round is the coachman revising the one file and pausing again. A fixture run's spec is signed off by the postmaster, as today. |
| Lanes still make their own implementation choices; the spec is not overly detailed | The template stays the level of the spec: what to build, the decisions that matter and the tests, not the code. Each workhorse still works in its own worktree from that shared spec and never sees another lane's work. |
| Whether models still provide useful diversity is an open question to observe | The planning-stage wiki page records the change and names the lane shares from #158 as what would show whether the lanes still differ usefully. |
| Workhorses write no specs | The workhorse contract and the brief lose `WORKHORSE-SPEC.md` as a workhorse file; the summary and blocked shapes stay. |
| `spec-decisions.sh`, the review package, `.spec-review-ready`, the stage timings and the action log follow one spec per run | The decision script records and counts without a lane; the package holds one entry; the marker, the planning span and the `spec-review` action keep their shape against the one spec. |
| A run dispatched before this change keeps its per-workhorse specs | Run pinning already freezes older runs on the older tool. Where a decisions file in the old per-lane shape is still read, `spec-decisions.sh count` keeps counting it; a self-test control covers that shape. |
| Deterministic work in scripts, counts have controls | `spec-decisions.sh` owns the one-spec record and count; its self-test is the control for the one-spec package, the changes round, the approval and the pre-change shape. |

## Structure

- `skills/postmaster/coachman.md` — planning stage is one coachman-written spec; workhorse contract drops the spec; briefs drop the planning stop; Stage 1 implements from the approved shared spec; hard rules and audit wording follow one spec per run
- `skills/postmaster/postmaster.md` — Spec review puts one spec to the user: approved, changes in the user's words then revise and pause again, or the run stops; fixture runs sign off that one spec; the two-approved bar goes
- `skills/postmaster/workhorse-spec-template.md` — the coachman fills this one per run; the level is what to build, the decisions that matter and the tests, not the code
- `skills/postmaster/harnesses.md` — the prompt contract line follows the workhorses no longer writing specs
- `skills/postmaster/trackers.md` — ticket-shape wording where it says each workhorse drafts its own spec
- `scripts/spec-decisions.sh` — one spec per run: record and count without a lane; a pre-change per-lane decisions file is still counted; self-test controls for a one-spec package, a changes round, an approval and the pre-change shape
- `scripts/spec-review-link.sh` — usage text names the worktree that holds the run's one spec (unchanged behaviour)
- `scripts/log-action.sh` — `spec-review` wording follows one spec per run where the control examples need it
- `scripts/runs-status.sh` — comment for SPEC follows one spec
- `wiki/concepts/planning-stage.md` — the change and what would show the lanes still differ usefully (lane shares, #158)
- `wiki/concepts/workhorse-spec.md` — the claim follows one spec written by the coachman, with the old claim kept as history
- `wiki/concepts/ticket-shape.md` — the line that says each workhorse drafts its own spec
- `wiki/index.md` — the decision bullets that restate the old claim

Unchanged: `scripts/stage.sh` (the planning span is unchanged, so timings follow with no edit) and `scripts/fixture.sh` (fixture sign-off works as today, against the one spec; no new mechanism).

## Decisions

- **Where the one spec lives and is committed.** `WORKHORSE-SPEC.md` at the synthesis worktree root, committed on the ticket branch before implementation. That is the run's record of intent, and the name stays so `spec-review-link.sh` and the audit path need no new filename. On approval the coachman copies that file into each workhorse worktree root; each lane reads its own copy and never leaves its worktree for it.
- **Workhorses are not launched in the planning stage.** The coachman writes the spec alone. A workhorse is first launched after the spec is approved, to implement. This removes the harvest-of-specs step and the per-lane revise-a-spec resume; a changes round is the coachman revising the one file and pausing again.
- **Decision words stay `approved|changes|dropped`.** `dropped` now means the run stops (the one spec is not taken up), not that a single workhorse is dropped. This keeps `log-action.sh`'s validation and the audit language stable; the runbooks say what dropped means.
- **`spec-decisions.sh` record takes no lane.** One stanza for the run's spec (`## spec`), with `decision`, `commit` and `words` as today. `count` prints `approved 0|1` and `changes 0|1` for that shape. A decisions file still in the pre-change per-lane shape (stanza per manifest lane) is counted as before, so a run from before the change is not misread by anything that looks at its file with the new script.
- **The implementation bar is one approved spec.** The two-approved-specs bar goes. If the decision is neither approved nor changes (dropped), the run stops and says why.
- **Manifest.** On approval, `lanes.<lane>.spec_commit` is set to the same approved synthesis commit on every implementing lane, so audit code that already reads that field keeps working and every lane points at the one agreed spec. No new top-level key.
- **Review package.** `spec-review.md` holds one entry: the spec's commit, the link from `spec-review-link.sh` against the synthesis worktree, and the path. A revised spec is a new entry at its new commit (the first commit is never rewritten). `.spec-review-ready` is unchanged.
- **Stage timings.** The `planning` stage remains between `bootstrapped` and `workhorses-running`, and still spans drafting through the last decision; no `stage.sh` change.
- **Template level (AC4).** The template file gains one sentence that the spec is what to build, the decisions that matter and the tests, not the code. No new template section.
- **Extend the existing review machinery; no second system.** The package, marker, decision script and action log change shape, not kind. The pinned tool preserves the per-workhorse workflow for runs started before this change; a legacy-run self-test fixture covers that boundary instead of migrating old artifacts.

## Tasks

Format: `- [ ] T<n> [P] [AC<n>] <description, with exact file paths>`.

- [ ] T001 [P] [AC1] In `skills/postmaster/coachman.md`, rewrite the planning stage so the coachman writes one `WORKHORSE-SPEC.md` from `workhorse-spec-template.md` in the synthesis worktree and commits it, harvests nothing from workhorses, builds a one-entry review package and pauses; workhorses write no specs and are not launched until the spec is approved.
- [ ] T002 [P] [AC2] In `skills/postmaster/postmaster.md`, rewrite Spec review for one spec: approved; changes in the user's words, after which the coachman revises and pauses again; or the run stops. A fixture run's spec is signed off by the postmaster. Remove the two-approved bar and the under-two path.
- [ ] T003 [P] [AC3] In `skills/postmaster/coachman.md` (workhorse contract, brief text, Stage 1) and `skills/postmaster/harnesses.md`, have every workhorse implement from the same approved spec copied into its worktree root, in blinkers, never seeing another lane's work; the brief drops the planning stop and the template.
- [ ] T004 [P] [AC4] In `skills/postmaster/workhorse-spec-template.md` and the coachman's planning step, keep the spec at the level of the template: what to build, the decisions that matter and the tests, not the code, so the lanes still choose their own implementation.
- [ ] T005 [AC5] In `scripts/spec-decisions.sh`, follow one spec per run (record and count without a lane), and keep `count` reading a pre-change per-lane decisions file; in `scripts/spec-review-link.sh` and `scripts/runs-status.sh`, fix wording to one spec per run.
- [ ] T006 [AC5] In `skills/postmaster/coachman.md` and `skills/postmaster/postmaster.md`, make the review package, `.spec-review-ready`, the planning stage timings and the `spec-review` action log follow one spec per run; note that a run dispatched before this change keeps its per-workhorse specs.
- [ ] T007 [AC6] In `scripts/spec-decisions.sh --self-test`, add controls for a one-spec package, a changes round, an approval, and a run from before the change (the per-lane decisions shape still counts).
- [ ] T008 [AC7] In `wiki/concepts/planning-stage.md`, record the change and what would show whether the lanes still differ usefully, such as the lane shares #158 measures; update `wiki/concepts/workhorse-spec.md`, `wiki/concepts/ticket-shape.md` and `wiki/index.md` so the wiki does not still claim each workhorse drafts its own spec.
