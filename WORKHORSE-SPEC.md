# Workhorse spec: 38 Run the bug review through each harness's own code-review skill

## Summary

Run the bug lens through the configured harness's own review skill, normalize its findings for the coachman, and keep the style and security lenses on their existing brief-driven paths.

## Technical context

- **Language and version**: Bash and Python 3.11+, following the existing scripts.
- **Dependencies used or added**: Existing harness CLIs and shell utilities; no new dependency planned.
- **Testing**: The launch and finding-normalization self-tests, related flow self-tests, skill path and wiki checks, then the project gate and the ticket's named positive control where the available harnesses permit it.
- **Constraints**: Every harness form names BASE-to-HEAD and the review level; run at each harness's maximum level; no fallback to the bug brief; no gate from reviewers; no changes outside this worktree; never push.

## Direction check

- Keep each harness's review skill and invocation in `skills/postmaster/harnesses.md` and `scripts/launch.sh`.
- Keep review output normalization deterministic in a script; leave deduplication and verification with the coachman.
- Use the existing isolated worktree scratch and common snapshot for each lane.
- Do not ask a harness without a review skill to review bugs, and refuse dispatch before launch when the bug turnpike has no eligible reviewer.
- Preserve style and security review behavior apart from removing the style prompt's gate invitation.
- Save external review records in the run logs where the harness stores them separately from its event stream.
- Keep all commits under the configured brindlewick identity and do not push.

## Structure

- Update `skills/postmaster/harnesses.md` with each harness's code-review support, evidence, invocation, level, output, known-findings behavior, and tool-call record location.
- Update `scripts/launch.sh` with the `review` form for Claude Code, Codex, and MiMo Code, preserving `launch` event output and its `--last` and `--run` options.
- Add `scripts/review-findings.sh` to normalize harness review output, with positive and negative self-test controls.
- Update `scripts/reviewers.sh`, `scripts/setup.sh`, and the postmaster waybill/pre-flight instructions in `skills/postmaster/postmaster.md` for eligible bug reviewers and empty-review refusal.
- Update `skills/postmaster/coachman.md` for the bug lens's harness review launches, normalized findings, and the style brief's gate boundary.
- Update `wiki/concepts/own-review-skills.md` and `wiki/index.md` with sourced evidence and the scope trial/control.

## Complexity tracking

None.

## Decisions

- A harness with no documented or trial-confirmed review form is ineligible for the bug lens; it has no fallback.
- Review levels are fixed by the form: `max` for Claude Code and Codex, `high` for MiMo Code on MiMo V2.6 Pro.
- A field not supplied by the harness is recorded as not provided; the normalizer will not infer severity or other missing details.
- An output that cannot be recognized as a review report fails loudly; it is not treated as a clean review.
- Use the provided scope trial and the requested flow control as the evidence base; no comparison against brief-driven reviews is in scope.

## Tasks

- [ ] T001 [P] [AC1] Record sourced review-skill support for every harness in `skills/postmaster/harnesses.md`.
- [ ] T002 [P] [AC2] Document each supported review form, its range and level arguments, output shape, known-findings behavior, and tool-call record location in `skills/postmaster/harnesses.md`.
- [ ] T003 [P] [AC3] Implement `scripts/launch.sh review` with harness-specific commands, top review levels, event streaming, `--last` and `--run`, and exit 3 for unsupported harnesses.
- [ ] T004 [AC4] Route only eligible lanes through the review form for bugs, omit the bug brief, and preserve style/security lens behavior in `skills/postmaster/coachman.md` and related dispatch code.
- [ ] T005 [AC5] Filter waybill bug reviewers and reject an empty eligible set in `scripts/reviewers.sh`, `scripts/setup.sh`, and `skills/postmaster/postmaster.md`.
- [ ] T006 [AC6] Normalize supported harness review reports into the finding contract in `scripts/review-findings.sh`.
- [ ] T007 [AC7] Add parsing, empty-report, and unparseable-report controls to `scripts/review-findings.sh --self-test`.
- [ ] T008 [AC8] Harvest Claude's forked review task output file into run logs using the event's task-notification path.
- [ ] T009 [AC9] Run the requested detached-scratch, non-main default-branch, non-last-commit positive control through the actual launch and normalization path for each available supported harness.
- [ ] T010 [AC10] Document the bug lens and sourced trial and control in `wiki/concepts/own-review-skills.md` and `wiki/index.md`.
- [ ] T011 [AC11] Remove the gate invitation from the style brief and keep reviewers on targeted finding probes in `skills/postmaster/coachman.md`.
