# Workhorse summary: 106 Tell the user to say hi

## Built

- `652ffc2 Add workhorse spec for #106` records the plan before implementation.
- `60bc430 Clarify clone startup instructions for #106` updates the README Getting started and the AGENTS.md session-opening passage.

## Checks

- `/home/brindlewick/postmaster/scripts/verify.sh run .` — exit 2. The check printed:

  ```text
  gate: fail, exit 1, 557s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane review-decide review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
    self-test: 1 control(s) misbehaved
    log: /home/brindlewick/postmaster/.worktrees/106-luna/.postmaster/verify/logs/gate.log
  ```

- The failing control is `scripts/style-findings.sh`'s “just runs its first recipe” self-test. The ticket's retry exception names timing controls in `review-round.sh` and `host.sh`; this failure is not one of them, so the gate was not rerun.
- `git diff --check` — exit 0.
- The full-file wording sweep with `rg` — exit 0. Its remaining “on its own” matches concern merge authority, not session startup.

## Decisions

- Used “say hi” in both entry points and stated in AGENTS.md that any first message starts the flow.
- Kept setup, target selection and launch guidance after that first-message instruction.
- Added no scripts or tests; this is a documentation change.
- Left the unrelated `scripts/style-findings.sh` failure unchanged.

## Not done

- Did not change the `postmaster` command or other flow, as #106 covers opening a clone.
- Did not fix the failing style-findings self-test because it is outside this documentation ticket.

## Acceptance criteria

- AC1: Met. README Getting started tells the user to open the agent in the clone and say hi.
- AC2: Met. AGENTS.md says the user opens the agent in this folder and says hi, and that any first message starts the flow.
- AC3: Met. Neither file implies the agent starts without a user message; remaining “on its own” language refers to merge authority.
