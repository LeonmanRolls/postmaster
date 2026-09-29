# Workhorse spec: 81 A planning stage: each workhorse's spec passes the user's review before any code

## Summary

Add a planning stage where workhorses commit independent specs, the postmaster reviews them with the user one at a time, and implementation starts only after enough specs are approved.

## Technical context

- **Language and version**: Bash, Python 3.11+, and Markdown.
- **Dependencies used or added**: No new dependencies.
- **Testing**: The project gate; `scripts/stage.sh --self-test`, `scripts/run-times.sh --self-test`, `scripts/log-action.sh --self-test`, `scripts/setup.sh --self-test`, `scripts/spec-review-link.sh --self-test`, and `scripts/wiki-lint.sh`.
- **Constraints**: Keep specs independent and in the existing Spec Kit plan/tasks format. The postmaster owns the interactive review; the coachman and workhorses stay headless. Use the run's recorded machine config for links. Do not add a ticket switch to skip review or make the coachman check code against the spec.

## Direction check

- Each workhorse drafts and commits its own spec, blind to the other worktrees, then exits before code. The coachman resumes that same thread for requested revisions and later for implementation.
- The postmaster presents each spec to the user in sequence. It records approval, exact requested changes, or a drop through the action logger. No implementation thread starts until every lane has a decision and at least two specs are approved.
- If fewer than two specs are approved, the run stops with the reason recorded and no workhorse implements.
- The spec remains in the existing plan and tasks format. The coachman records the approved commit SHA and does not judge implementation against the spec.
- Put the code-server URL template in machine config under `planning.review_link`; the postmaster substitutes the spec's absolute path and shows that path when no template is configured. Never put the private host in a ticket or repository default.
- Use `scripts/stage.sh` for the planning stage and `scripts/log-action.sh` for every user decision. Stage timings cover planning through approval, including the user's review time.
- Keep the wiki's standing at `claimed`: Anthropic's article motivates the workflow but does not establish that it improves this project. Capture only the passages relied on, per `raw/README.md`.
- Do not add a per-ticket skip switch or a coachman code-to-spec check.

## Structure

- `skills/postmaster/coachman.md`: separate spec drafting from implementation, pause through the existing escalation and resume flow, record approved SHAs, enforce the two-approval minimum, and continue with approved lanes only.
- `skills/postmaster/postmaster.md`: present links sequentially, capture the user's decision and exact change request, log each decision immediately, and stop runs with fewer than two approvals.
- `scripts/stage.sh`: add `planning` and controls for entering it.
- `scripts/run-times.sh`: exercise the planning interval in its timing controls.
- `scripts/log-action.sh`: allow and self-test the `spec-review` decision action.
- `scripts/spec-review-link.sh`: resolve the recorded template and spec path with positive and negative controls.
- `scripts/setup.sh`, `config.example.toml`: collect and document `planning.review_link`.
- `raw/articles/ai-native-sdlc-playbook/source.md`: capture the article passages relied on.
- `wiki/sources/ai-native-sdlc-playbook.md`: summarize the article's design-review recommendation and its relevance here.
- `wiki/concepts/workhorse-spec.md`, `wiki/index.md`, `wiki/log.md`: update the decision, catalog it, and record the change.
- `wiki/sources/index.md`: list the captured article.
- `wiki/concepts/run-config.md`: record that the planning link uses the run's captured config.

## Complexity tracking

No departures.

## Decisions

- Use `planning.review_link` as the machine-config key, parallel to `ship.review_link`.
- Use the existing coachman escalation and resume mechanism for every postmaster review and workhorse revision; add no interactive process to the headless fleet.
- Present workhorse specs one at a time. Approval, exact user-worded changes, and dropping a workhorse are the available outcomes.
- Wait until every workhorse has a decision before any implementation begins, even when an earlier spec is approved.
- Require at least two approvals. With fewer, stop the run, record why, and leave implementation unstarted.
- Record every decision as `spec-review`; include the reviewed commit SHA in the event, and include the user's words verbatim when changes are requested.
- Measure the `planning` stage from spec drafting through the transition to implementation, so its duration includes the user's review and iteration time.
- Capture only the short source passages relevant to review-before-code, not the whole article. The source is motivation, not evidence that the design works here.
- In issue #9's experiment, treat the own-spec condition as specs reviewed by the user, and measure whether review makes the independent specs converge.

## Tasks

- [ ] T001 [P] [AC1] Update `skills/postmaster/coachman.md` so workhorses commit spec-only plans and exit, the postmaster reviews through escalations, and implementation resumes only after all reviews with at least two approvals.
- [ ] T002 [P] [AC2] Update `skills/postmaster/postmaster.md` to show one spec link at a time, record approval or the user's exact change request, and log each decision through `scripts/log-action.sh`.
- [ ] T003 [AC3] Extend `skills/postmaster/coachman.md` to resume the same workhorse thread for spec revisions from the user's words and prohibit code until approval.
- [ ] T004 [AC4] Update `skills/postmaster/postmaster.md` to support dropping a workhorse and stop with an explanation when fewer than two specs are approved.
- [ ] T005 [AC5] Add the `spec-review` action and its controls in `scripts/log-action.sh`, and record each approved spec's commit SHA in the decision event and run record.
- [ ] T006 [AC6] Add the `planning` stage and self-test controls in `scripts/stage.sh`, and cover its elapsed time in `scripts/run-times.sh`.
- [ ] T007 [AC7] Capture the relevant Anthropic playbook passages in `raw/articles/ai-native-sdlc-playbook/source.md`; add the source page and revise `wiki/concepts/workhorse-spec.md`, `wiki/index.md`, `wiki/sources/index.md`, and `wiki/log.md` while keeping the standing `claimed`.
- [ ] T008 [AC8] Add `planning.review_link` to `config.example.toml` and `scripts/setup.sh`, implement path substitution in `scripts/spec-review-link.sh`, and document link rendering in `skills/postmaster/postmaster.md` and `wiki/concepts/run-config.md`, including a fresh link after revisions.
