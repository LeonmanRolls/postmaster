# Workhorse summary: #113 Allow runs to change overlapping files

## Built

Implementation commits before this summary:

- `116d76d` — `#113, write workhorse spec`
- `b5412c7` — `#113, allow overlapping runs`
- `ff7b2b0` — `#113, isolate journey path self-test`

Stage A step 6 now orders tickets by dependencies only. `postmaster.md` limits in-flight runs
only by `team.max_runs`. The coachman concurrency note permits overlapping file changes and
says the run merging second resolves conflicts at its merge by merging, never rebasing. The
gate exposed an inherited `POSTMASTER_VERIFY` value in one self-test; the existing default-path
assertion now clears it so it checks its fixture worktree.

## Checks

- Required check, run just before writing this summary:

  ```text
  gate: pass, exit 0, 686s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
  ```

- Earlier `/home/brindlewick/postmaster/scripts/verify.sh run .`: process exit 2; its gate
  reported exit 1 after 436 seconds. `scripts/verify.sh --self-test` failed only the
  “a workhorse's in its worktree” control because the gate runner's `POSTMASTER_VERIFY` value
  overrode the fixture path. Commit `ff7b2b0` isolates that assertion; the required rerun passed.
- `git diff --check`: exit 0.
- Search `rg -n -i -e 'overlap' -e 'same files?' -e 'file surfaces?' -e 'disjoint files?' -e 'shared (files?|surfaces?|modules?)' -e 'file safety' skills AGENTS.md README.md wiki`: exit 0. Matches: `skills/postmaster/harnesses.md:262,314` (ambient context), `skills/postmaster/hosts.md:78` (append-only log stream), `skills/postmaster/coachman.md:691` (review overlap) and `:831-832` (the intended concurrency note); review-overlap discussion at `wiki/concepts/review-convergence.md:123,127,150,285,287,346,354,406`, `wiki/sources/index.md:24`, and `wiki/sources/petersson-2004-capture-recapture.md:13-14,25,28`; and `wiki/concepts/run-config.md:45` (an env-file update reaching a run). No other scheduling restriction appeared.
- Search `rg -n -i -e 'two[[:space:]]+(tickets|runs).*?(same|shared|overlap|file|surface)' -e '(same|shared|overlap).*?(files?|surfaces?).*?(tickets?|runs?)' -e 'tickets?.*?(disjoint|overlap|shared|same).*(files?|surfaces?)' -e 'prefer sequencing' -e 'do not run at the same time' -e 'never .*runs?.*(same|overlap|file)' -e 'must not .*same.*(file|surface)' skills AGENTS.md README.md wiki`: exit 0. Matches: `wiki/log.md:14` (a log explanation), `wiki/concepts/run-config.md:45` (env-file behavior), `skills/postmaster/coachman.md:831-832` (the intended policy), and `skills/postmaster/coachman.md:949` (diagnosing a contaminated gate before changing shared lint config). None requires same-file tickets to wait.
- Search `rg -n -i -e 'max_runs' -e 'runs? (in flight|at once|in parallel|concurrent)' -e 'run ceiling' -e 'file surface' -e 'overlap' skills/postmaster/postmaster.md`: exit 0. It returned only `postmaster.md:94` (the `team.max_runs` run ceiling) and `:389` (the corresponding hard rule).

## Decisions

- Keep dependency ordering: a ticket that needs another ticket's change waits for it to land.
- Leave the configured `team.max_runs` value and default unchanged.
- Keep the existing merge-conflict mechanics; state that the second run resolves conflicts at its merge by merging, never rebasing.
- Make the one self-test change required by the failing gate, and clear `POSTMASTER_VERIFY` only for its default-path fixture assertion.

## Not done and why

- No other AC4 search hits were changed: they describe reviewer overlap, harness context, log appending, env-file behavior, or diagnosing a red gate, rather than a rule against overlapping ticket runs.
- No scripts, gate commands, self-tests or configured run limits were changed except the single gate-forced assertion fix above.
- No push was made, as required for this lane.

## Acceptance criteria

- AC1: Met. Stage A step 6 orders by dependencies only, and the hard rule no longer prohibits overlapping file surfaces.
- AC2: Met. `team.max_runs` is the only in-flight run limit in `postmaster.md`.
- AC3: Met. The concurrency note permits same-file runs in parallel and says the second merge resolves conflicts at its merge, by merging and never rebasing, without sequencing advice.
- AC4: Met. The full requested scope was searched; remaining matches are unrelated to prohibiting two runs from changing the same files.
