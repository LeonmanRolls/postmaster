# Workhorse summary: #105 Show run and launch identity in session labels

## Commits

- `36f1bef` — #105, specify run and launch labels
- `ebf3efd` — #105, group launches under ticket run spaces

## Checks

- `/home/brindlewick/postmaster/scripts/verify.sh run .` exited 2. It printed this result line for the named check:

  ```text
  gate: fail, exit 1, 1461s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
  ```

  The gate log identifies one failing control in `scripts/verify.sh --self-test`: “a workhorse's in its worktree.” The shell syntax, skill references, wiki lint, and earlier script self-tests completed before that failure.
- `scripts/host.sh --self-test` — exit 0; all controls behaved.
- `scripts/host.sh --live-test` — exit 0; all controls behaved against the live Herdr server, plus the no-host and tmux controls.
- `git diff --check && bash -n scripts/host.sh && scripts/skill-refs.sh` — exit 0.

## Decisions

- The synthesis worktree space is the run level because each dispatch has one synthesis worktree. Its Herdr label comes from the waybill; launch labels come from the dispatch's recorded `run.json` models.
- Coachmen lead with `coachman`, workhorses and reviewers with their lane. Model and leg or review round follow.
- The old `host.sh name` forms remain supported. Runbooks use explicit role, lane, leg or lens and round forms.
- Dispatch launches share the ticket-labeled Herdr space. Placement records let `close` remove a review clone's owned tabs while preserving that shared space.
- The project-level postmaster label is `postmaster`; when host.sh opens the project space, it reuses the first tab for that launch.
- No tasks were added or dropped.

## Not done and why

- I left `scripts/verify.sh` unchanged. The required gate fails in that script's worktree-isolation self-test, outside the host-label changes in #105; its failure is recorded above.
- I did not verify the sidebar on a phone. The live test confirmed the labels and nesting through Herdr on this machine; the final Moshi visual check remains for the user as the ticket specifies.
- I did not push, per the brief.

## Acceptance criteria

- AC1: Met. Coachman, workhorse, style, bug and security labels lead with the role or lane and include recorded model and leg or round without ticket text.
- AC2: Met. The ticket number and title label the run space; launch labels omit them.
- AC3: Met. Self-test and live-test confirm a security-review clone opens as a launch tab under its run and closes without closing the run space.
- AC4: Met. Self-test and live-test confirm the first project and run launches take their spaces' initial tabs, leaving no empty shell tab beside them.
- AC5: Met. `host.sh --self-test` checks each launch kind and the ticket-bearing run space; all its controls passed.
- AC6: Machine-side verification is met: `host.sh --live-test` passed with live Herdr placement and role-first labels. The user's Moshi sidebar check on a phone remains outstanding.
