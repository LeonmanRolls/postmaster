# Workhorse summary: #132 hotfix workflow

## Commits

- `13089e2` Write workhorse spec for #132.
- `d2fe2e6` Add hotfix propagation control.
- `9511a2e` Add postmaster hotfix skill.

## Checks

Just before this file was written, `/home/brindlewick/.postmaster/tool-pins/07b463ddf46bbc841cf0aeff2a959f70d181cfae/scripts/verify.sh run .` printed:

- `gate [declared:project]` — `bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'` — exit 0; verifier output: `gate: pass, exit 0, 648s`.

Other verification commands:

- `scripts/hotfix.sh --self-test` — exit 0, all 11 controls behaved.
- `bash -n scripts/hotfix.sh` — exit 0.
- `scripts/skill-refs.sh` — exit 0.
- `scripts/skill-refs.sh --fix` — exit 0.
- `scripts/skill-refs.sh --self-test` — exit 0.
- `scripts/link-skills.sh --self-test` — exit 0.
- `scripts/wiki-lint.sh --self-test` — exit 0.
- `scripts/wiki-lint.sh` — exit 0.
- `git diff --check` — exit 0.
- An initial verifier run with `TMPDIR` inside this repository exited 2 because fixture repositories must be outside a Git repository. The required verifier was rerun with its normal temporary directory and exited 0.
- An initial hotfix self-test exited 1 because its fixture branch was already checked out. The fixture setup was corrected; the final self-test exited 0. An initial skill-link self-test exited 1 because its temporary directory parent did not exist; after creating it, the self-test exited 0.

## Decisions

- Put the named skill at `skills/hotfix/SKILL.md`. The skill installer discovers top-level `skills/*/SKILL.md` directories. This changes T001's planned path from `skills/postmaster/hotfix/SKILL.md`.
- Keep the operations separate: `report` classifies runs, `queue` records pending work, and `next-leg` applies queued changes after a completed hand-off and before launch.
- Use configured project roots plus the postmaster checkout when searching for active runs.
- Apply one main fix commit only to a matching run branch. Use a merge-tree preflight to identify overlap and leave conflicts unchanged for the second merger.
- For runbook changes, add an explicit instruction to the next prompt to read the updated main file. Do not merge main into run branches.
- Follow `ship.merge_authority`: the user merges when authority is `user`; the postmaster may merge only after required checks and review when authority is `postmaster`.

## What I did not do

- I did not create a live ticket, pull request, merge, or push. This workhorse implemented the workflow, and the ticket did not describe a separate live postmaster fault to repair. The workhorse instructions also prohibit pushing.
- I did not run `scripts/fixture.sh new` and `score`. That check requires creating a separate fixture repository outside this worktree, which the workhorse instruction forbids. `skills/postmaster/coachman.md` was updated, so the fixture run and clean score remain required before merge.

## Acceptance criteria

- AC1 — Met in `skills/hotfix/SKILL.md`: ticket, `origin/main` worktree, failing and passing control, titled PR, authority-gated merge, and main checkout pull.
- AC2 — Met: `scripts/hotfix.sh report` classifies in-flight runs and its self-test distinguishes a run needing a branch commit from one served by the main checkout through the same command.
- AC3 — Met: `next-leg` requires an unstarted leg and completed hand-off, applies only the fix commit, and adds the main-fix note to the prompt.
- AC4 — Met: merge-tree detects overlapping edits; the report names the run, and queue leaves its branch unchanged.
- AC5 — Met: report, queue, notes, and applications go through `log-action.sh`; self-tests verify run and project ledgers.
