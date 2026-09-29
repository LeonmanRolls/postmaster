# Workhorse spec: #80 Review loop exits on P1/P2 findings

## Summary

Update the review loop to apply every verified gating-lens finding in round 1, continue while a round has P1/P2 findings (or round 1 applied a fix), and stop at the existing three-round backstop, with a script deciding from the action log.

## Technical context

- **Language and version**: Bash with Python 3 in a heredoc for JSONL parsing; Markdown.
- **Dependencies used or added**: None.
- **Testing**: `scripts/review-loop.sh --self-test`, `scripts/wiki-lint.sh`, and the supplied repository gate through `/home/brindlewick/postmaster/scripts/verify.sh run .`.
- **Constraints**: Work only in this worktree; do not change markers, waybill fields, completion checks, review lenses, reviewer lanes, scratches, or round waits; keep the cap of three and repeated-class escalation; never push.

## Direction check

- Rewrite only Stage 2 steps 4 and 5 for which findings each round fixes and when the loop ends; add the required severity definitions to every lens brief's output contract; update the review checkpoint card with the ending round, reason, and deferred P3 list.
- Add a deterministic script in `scripts/` to read `finding` and `apply` actions, print the next-round or stop decision, and self-test both outcomes for each rule and the cap.
- Update the two named wiki concepts, retaining clean wiki lint.
- Keep all script paths in the runbook rooted at `<tool>/`.
- Keep the change project-agnostic and avoid marker, waybill, and completion-contract changes.
- The remote `wb/80-luna` ref is absent; the supplied clean worktree is at the pinned base `7e6a7151661ee61511ca908fdc0fa76459410e7c`.

## Structure

- `scripts/review-loop.sh`: deterministic review-loop decision and self-test.
- `skills/postmaster/coachman.md`: severity output contract, apply/continue rules, apply log detail format, checkpoint card, and deferred/open P3 reporting.
- `wiki/concepts/review-loop.md`: current end rule and cap.
- `wiki/concepts/review-convergence.md`: the user's 2026-09-27 rule in the user's words and its backstop.
- `WORKHORSE-SUMMARY.md`: final workhorse record, written after the required verification run.

## Decisions

- Round 1 applies verified findings from gating lenses at P1, P2, or P3. The style lens keeps its current round-one-only, non-gating handling.
- From round 2 onward, fix only P1/P2 findings; carry P3 findings to deferred findings and the ship card with their lens and originating round.
- A P1/P2 fix that is not verified closed is logged as a new finding of the same severity in the round that checks it.
- Review `apply` detail starts with `r<round>` and names the finding targets it fixes, allowing the script to scope each action to a round using the existing free-text action log.
- After round 3, a P1/P2 finding stops the loop at the cap and escalates with residue. The existing repeated-class escalation remains in force.
- Severity definitions are project-independent: P1 means severe harm or loss of a critical capability; P2 means material impairment or weakened protection with bounded impact; P3 means limited impact that does not materially impair normal use.
- The checkpoint card reports the final round and the rule that ended the loop, plus each deferred P3 with its lens and round.

## Tasks

- [ ] T001 [P] [AC1] Rewrite round-one fixes and later P3 deferral in `skills/postmaster/coachman.md`.
- [ ] T002 [P] [AC2] Define continued-round rules and unclosed-fix findings in `skills/postmaster/coachman.md`.
- [ ] T003 [P] [AC3] Carry later-round P3 findings with lens and round through deferred and ship-card instructions in `skills/postmaster/coachman.md`.
- [ ] T004 [P] [AC4] Add one-line P1, P2, and P3 definitions to each generated lens brief's output contract in `skills/postmaster/coachman.md`.
- [ ] T005 [P] [AC5] Add `scripts/review-loop.sh` to decide from round-scoped `finding` and `apply` actions, print its decision, and self-test positive and negative controls.
- [ ] T006 [P] [AC6] Preserve the three-round cap and repeated-class escalation in `skills/postmaster/coachman.md`, and cover the cap in `scripts/review-loop.sh --self-test`.
- [ ] T007 [P] [AC7] Update the review checkpoint card contents in `skills/postmaster/coachman.md`.
- [ ] T008 [P] [AC8] Update `wiki/concepts/review-loop.md` and the Decision section of `wiki/concepts/review-convergence.md`.
