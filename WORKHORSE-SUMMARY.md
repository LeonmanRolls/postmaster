# Workhorse summary: #170, The coachman writes one spec that every workhorse implements, and the user reviews it once

## Built

Commits on this branch before this summary commit:

- `10df1f0` Plan one spec per run
- `b20c549` 170: adopt the coachman's shared workhorse spec (planning round 2)
- `ef8258e` 170: adopt the user-approved shared workhorse spec (planning round 3)
- `53a5f69` Copy #109 spec review scripts
- `f47f2a0` Implement shared spec decisions and links
- `1e4e8eb` Keep spec script tests in run-local scratch
- `08c619c` Add the interactive shared spec review session
- `a7e5f7e` Make one coachman spec the planning contract
- `073fbca` Handle spec review without an interactive host
- `066493b` Complete acceptance checks
- `d0aa1e2` Keep wiki links within the lint fixture

The coachman now authors one committed ticket spec. The postmaster presents one package, starts a ticket-named spec session where the host supports it, and records approval, changes, or a stop. On approval the coachman commits the approved text in each lane before launch. The scripts record one run-level decision and preserve legacy per-lane counts; the wiki explains the policy and the lane-share and fixture-score evidence that can show whether implementation diversity remains useful.

## Checks

The pinned gate transcript immediately before this summary is `.postmaster/verify/final-pass/pinned-gate-final.txt`. Its output was:

```text
command: /home/brindlewick/.postmaster/tool-pins/ffe37821779aa7cc77275860573a8fdd43cd6e2d/scripts/verify.sh run .
gate: pass, exit 0, 713s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
exit: 0
```

Gate checks, each exit 0:

- `for f in scripts/*.sh; do bash -n "$f" || exit 1; done`
- `scripts/skill-refs.sh`
- `scripts/wiki-lint.sh`
- `scripts/cut-scratch.sh --self-test`
- `scripts/export-session.sh --self-test`
- `scripts/fixture.sh --self-test`
- `scripts/front-door.sh --self-test`
- `scripts/front-door-acceptance.sh --self-test`
- `scripts/github.sh --self-test`
- `scripts/host.sh --self-test`
- `scripts/launch.sh --self-test`
- `scripts/link-skills.sh --self-test`
- `scripts/local.sh --self-test`
- `scripts/log-action.sh --self-test`
- `scripts/parallel-runs-acceptance.sh --self-test`
- `scripts/plane.sh --self-test`
- `scripts/project-settings.sh --self-test`
- `scripts/review-decide.sh --self-test`
- `scripts/review-findings.sh --self-test`
- `scripts/review-forms.sh --self-test`
- `scripts/review-round.sh --self-test`
- `scripts/reviewers.sh --self-test`
- `scripts/run-log.sh --self-test`
- `scripts/run-meta.sh --self-test`
- `scripts/run-times.sh --self-test`
- `scripts/runs-status.sh --self-test`
- `scripts/runs-watch.sh --self-test`
- `scripts/setup.sh --self-test`
- `scripts/skill-refs.sh --self-test`
- `scripts/spec-decisions.sh --self-test`
- `scripts/spec-review-link.sh --self-test`
- `scripts/stage.sh --self-test`
- `scripts/style-findings.sh --self-test`
- `scripts/ticket-check.sh --self-test`
- `scripts/tool-faults.sh --self-test`
- `scripts/turnpikes.sh --self-test`
- `scripts/verify.sh --self-test`
- `scripts/verify-examples.sh --self-test`
- `scripts/verify-journey.sh --self-test`
- `scripts/verify-library.sh --self-test`
- `scripts/view-stream.sh --self-test`
- `scripts/wait-for-markers.sh --self-test`
- `scripts/wiki-lint.sh --self-test`

Other checks, each exit 0:

- `bun test scripts/` — `.postmaster/verify/final-pass/pass14-bun-test.txt`
- `scripts/spec-decisions.sh --self-test` — `.postmaster/verify/pass11-spec-decisions-self-test.txt`
- `scripts/spec-review-link.sh --self-test` — `.postmaster/verify/pass11-spec-review-link-self-test.txt`
- `scripts/wiki-lint.sh --self-test`, `scripts/wiki-lint.sh`, and `git diff --check` — `.postmaster/verify/final-pass/pass13-wiki-fix.txt`
- The per-criterion scratch commands and their individual outputs and exits are recorded in the evidence transcripts below.

The first pinned gate attempt exited 2 because `wiki-lint.sh --self-test` copies only `wiki/` and the new relative links to `skills/postmaster/coachman.md` were absent in that fixture. The links now stay within the wiki. The fix is in `d0aa1e2`; the final pinned gate and wiki self-test pass. The first attempt is preserved at `.postmaster/verify/final-pass/pinned-gate.txt`.

## Evidence

- **AC1:** `.postmaster/verify/final-pass/pass12-ac1-planning-walk.txt` — planning walk, one synthesis commit, one byte-identical review copy, no lane specs; all commands exit 0.
- **AC2:** `.postmaster/verify/run-170-checks/pass7-ac2-review-walk.txt` — approval, changes in the user's words, dropped stop, and fixture sign-off; all expected command exits are recorded.
- **AC3:** `.postmaster/verify/run-170-checks/pass8-ac3-shared-spec.txt` — both lane commits match the approved spec and their brief contains no planning stop or template; all commands exit 0.
- **AC4:** `.postmaster/verify/pass11-ac4-template-level.txt` and `.postmaster/verify/run-170-checks/pass8-ac4-template-level.txt` — template and planning language stay at the decisions, build and tests level; exit 0.
- **AC5:** `.postmaster/verify/run-170-checks/pass8-ac5-package-times-log.txt` — one review entry, `.spec-review-ready`, `SPEC` status, planning timing, one spec-targeted action, and legacy two-lane count; expected exits are recorded.
- **AC6:** `.postmaster/verify/pass11-bun-test-scripts.txt`, `.postmaster/verify/pass11-spec-decisions-self-test.txt`, `.postmaster/verify/pass11-spec-review-link-self-test.txt`, and `.postmaster/verify/pass10-ac6-negative-controls-1.txt` / `pass10-ac6-negative-controls-2.txt` — tests and script controls pass, each targeted break fails, and each restored behavior passes. The final Bun run is `.postmaster/verify/final-pass/pass14-bun-test.txt`; the pinned gate transcript records all gate self-tests.
- **AC7:** `.postmaster/verify/pass11-ac7-wiki.txt` records the page's diversity measures and policy. `.postmaster/verify/final-pass/pass13-wiki-fix.txt` shows the final wiki lint and its isolated self-test both exit 0.
- **AC8:** `.postmaster/verify/run-170-checks/pass8-ac8-briefs.txt` covers briefs with and without preferences; `.postmaster/verify/run-170-checks/pass8-ac8-approvals.txt` covers unchanged, edited and refused approvals; `.postmaster/verify/final-pass/pass12-ac8-no-host.txt` checks the current runbook's no-host path, exit 3, and absence of a launch action. `.postmaster/verify/run-170-checks/pass8-ac8-spawn-none.txt` records the earlier spawn control. A real interactive tab is not shown because that would open a session on the user's machine, as the criterion's check specifies.

## Decisions

- Kept `approved`, `changes`, and `dropped`; `dropped` stops the run. Changes preserve the user's words for the coachman, which revises and pauses again.
- Recorded the new decision as one `## spec` stanza and kept counting old per-lane decision files. Approval stores the synthesis commit on each lane's manifest entry so existing audit readers keep working.
- Kept the planning stage span and `.spec-review-ready` marker. Each review package has one spec entry, and the review action targets `spec`.
- Opened the spec-session editor on the review folder when the configured link has `{path}`; without a template, the script returns the file path.
- Gave the session only the ticket, review copy, any lane drafts, machine preferences and its runbook. Approval commits only the copy and refuses unrelated synthesis changes. With no interactive host, the postmaster continues in its own conversation and does not send or log a nonexistent session launch.
- Left `scripts/runs-status.sh` unchanged. Its comment still describes per-workhorse specs; updating that shell script would require copying its #109 TypeScript port, a shared script change for a comment. The runbook behavior and live `SPEC` status are covered by AC5.

## Not done

- No real interactive session was launched because it would open on the user's machine; the no-host control and runbook path are recorded under AC8.
- No fixture run was dispatched and scored. A clean fixture score remains required before this coachman-contract change merges.
- Nothing was pushed, per the workhorse instruction.

## Verdicts

- **AC1:** Met. The coachman commits one spec and publishes only that spec for review.
- **AC2:** Met. Approval, user-worded changes, stop, and fixture sign-off follow one-spec rules.
- **AC3:** Met. Each lane starts with the approved same spec and no other lane's work.
- **AC4:** Met. The template and planning instructions leave implementation choices to each lane.
- **AC5:** Met. Package, marker, timing, action log and legacy decision counting follow their run's spec model.
- **AC6:** Met. One-spec, changes, approval and pre-change controls pass, including targeted negative controls.
- **AC7:** Met. The planning wiki page describes the change and the lane-share and fixture-score evidence; lint passes.
- **AC8:** Met. The spec session has the required brief, approval controls and no-host behavior. A real interactive tab is not shown for the reason above.
