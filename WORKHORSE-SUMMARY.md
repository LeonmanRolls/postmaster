# Workhorse summary: #124 The review leg ends with the run ready for the user's merge, with no separate ship leg

## Built

- `9d29fcc Add #124 workhorse spec`
- `b0c3b49 Implement #124 two-leg ready-card flow`

New dispatches record coachman contract 2 and use synthesis plus optional review. The final
active leg writes the ready-to-merge card and hand-off. Runs without the contract marker retain
the three-leg schedule and legacy ship behavior. The postmaster runbook verifies the card,
follows the project's pull-request or local-merge route, and owns current-run aftercare.

## Checks

- Gate: `/home/brindlewick/postmaster/scripts/verify.sh run .` — exit 0; printed `gate: pass, exit 0, 389s` for the required shell, reference, wiki-lint, and script self-test command.
- `scripts/turnpikes.sh --self-test` — exit 0; one-leg, two-leg, and pre-change three-leg controls passed.
- `scripts/runs-status.sh --self-test` — exit 0; one-leg, two-leg, and legacy card and dispatch controls passed.
- `scripts/stage.sh --self-test` — exit 0; current one- and two-leg stages and legacy three-leg stages passed.
- `scripts/run-meta.sh --self-test` — exit 0; current contract marker control passed.
- `scripts/fixture.sh --self-test` — exit 0; clean-record scoring and negative controls passed.
- `scripts/skill-refs.sh` — exit 0.
- `scripts/skill-refs.sh --fix` — exit 0; no references needed rewriting.
- `git diff --check` — exit 0.
- Earlier `/home/brindlewick/postmaster/scripts/verify.sh run .` attempt — exit 1 because the worktree changes had not yet been committed; the final committed run above passed.

## Decisions

- `run.json.coachman_contract: 2` identifies new runs. Missing metadata or version 1 keeps the old three-leg flow.
- The waybill records the landing route and documented pull-request tool. A remote alone does not determine the route.
- Pull-request projects are merged by the user in their review surface. Local merges follow `ship.merge_authority`, with the postmaster performing the merge after authorization.
- `launch.sh` continues to accept `ship` for old runs.

## Not done

- I did not dispatch a fixture project and score that run. The workhorse rules prohibit writing outside this worktree, while a fixture dispatch needs a separate repository and run directory. `fixture.sh --self-test` passes, but the coachman must run and score a real fixture from this branch before the contract change merges.
- I did not touch the tracker, push a branch, or open a pull request, as required for this workhorse lane.
- T008's actual fixture dispatch and score remain for the coachman; the implementation keeps the fixture scoring controls compatible with both contracts.

## Acceptance criteria

- AC1: Met. The final synthesis or review leg writes its card and hand-off, touches its markers, and does not merge a current run.
- AC2: Met in the card contract. It covers final-HEAD check results, browser suite and QA when present, turnpikes, findings, branches and states, and the review link.
- AC3: Met. A no-review current run completes the card in synthesis.
- AC4: Met in the postmaster runbook. It verifies the card, follows the documented pull-request or local-merge route, then handles aftercare and teardown.
- AC5: Met. Current schedules use one or two legs; runs dispatched without contract 2 keep all three.
- AC6: Met. Script self-tests cover current one- and two-leg runs and a pre-change three-leg run.
