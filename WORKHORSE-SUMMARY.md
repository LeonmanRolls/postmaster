# Workhorse summary: #81

## Commits

- `3f7f927` Add workhorse spec for planning review
- `a4cab8c` Extend workhorse spec source index
- `7e97634` Plan deterministic spec review links
- `52ab711` Include spec link command in plan
- `80acc3e` Add planning review controls
- `ebaaff4` Run workhorses through spec review
- `09c1d35` Document user review of workhorse specs

## Checks

- `/home/brindlewick/postmaster/scripts/verify.sh run .` — exit 0. It printed:

  ```text
  gate: pass, exit 0, 724s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane review-decide review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
  ```
- Earlier full gate attempt — exit 1 after 527s. Its three failures were in `review-round.sh` timing controls and their teardown cascade while host load was high; the clean rerun above passed.
- `for f in scripts/*.sh; do bash -n "$f" || exit 1; done` — exit 0.
- `scripts/skill-refs.sh` — exit 0.
- `scripts/wiki-lint.sh` — exit 0.
- `scripts/stage.sh --self-test` — exit 0.
- `scripts/run-times.sh --self-test` — exit 0.
- `scripts/log-action.sh --self-test` — exit 0.
- `scripts/setup.sh --self-test` — exit 0.
- `scripts/spec-review-link.sh --self-test` — exit 0.
- `git diff --check` — exit 0.

## Decisions

- Store the optional code-server template at `planning.review_link`, parallel to `ship.review_link`. Substitute the absolute spec path; print that path when no template is set.
- Reuse the coachman's existing escalation and resume flow so only the postmaster's interactive session handles user review.
- Decide every spec before implementation resumes, and require two approved specs. Record each decision with its reviewed commit, and pass the user's exact wording back for revisions or drops.
- Keep the wiki decision at `claimed`: Anthropic's playbook supports review before code generation, but does not establish that this flow improves results. Update issue #9's own-spec measure to include user review and spec convergence.
- Capture only the article passages relied on in `raw/articles/`; the article was fetched from the URL in the ticket on 2026-09-29.

## Not done

- Did not push or open a pull request, as instructed.
- Did not run a fixture dispatch. The repository requires a clean fixture score before this coachman-contract change merges; this lane was restricted to its own worktree, so the supervising postmaster must run that check before merge.
- A diagnostic process listing briefly displayed command lines and worktree paths for other runs. No files in those worktrees were opened; subsequent load checks used `uptime` only.

## Acceptance criteria

- AC1: Met. Workhorses draft and commit their own spec, stop before code, and resume only after approval.
- AC2: Met. The postmaster presents one spec at a time in its interactive session and logs approval, exact requested changes, or drop.
- AC3: Met. Requested revisions return to the same workhorse thread, each committed for another review; implementation follows approval.
- AC4: Met. The user may drop a workhorse; fewer than two approvals closes the run and reports why implementation did not start.
- AC5: Met. Each decision uses `spec-review`; approved commit SHAs are recorded in the manifest and audit.
- AC6: Met. `stage.sh` accepts `planning` with controls, and `run-times.sh` measures the planning interval.
- AC7: Met. The playbook is captured under `raw/articles/`; the workhorse-spec page and wiki index now describe reviewed planning at standing `claimed`.
- AC8: Met. `planning.review_link` resolves the spec path from captured machine config, falls back to the absolute file path, and is regenerated for each revision.
