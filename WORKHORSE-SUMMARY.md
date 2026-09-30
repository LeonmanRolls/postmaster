# Workhorse summary: #159 A fixture run scores each lane's own branch against the hidden tests

## Built

- Added `scripts/fixture-lanes.ts` to collect lane names from the run manifest, audit files, waybill and retained `wb/<ticket>-<lane>` branches; export each kept branch; run `fixture.sh hidden`; and report counts or an explicit missing/build-failure status.
- Updated `scripts/fixture.sh score` to append lane results to the existing hidden-tests line. The merged result alone still determines the check and exit status. Bun runs the scorer with `--no-env-file`.
- Added `scripts/fixture-lanes.test.ts` with pure-function tests and end-to-end score controls for passing, failing, missing and unbuildable branches, including both directions showing that lane results do not change the merged verdict.

## Commits

- `a6b97bd` 159: plan fixture lane scoring
- `57d9e12` 159: adopt the coachman's shared workhorse spec (planning round 2)
- `066208b` 159: adopt the user's approved shared workhorse spec (planning round 3)
- `d342d8b` 159: score fixture lane branches
- `17875f0` 159: keep fixture test scratch ignored

## Checks

- `/home/brindlewick/.postmaster/tool-pins/73fca4e4a513d8915bf067723d54871b4b8ba728/scripts/verify.sh run .` — exit 0; printed: `gate: pass, exit 0, 762s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'`
- `bun test scripts/fixture-lanes.test.ts` — exit 0; 3 pass, 0 fail, 13 expect calls.
- Initial `bun test scripts/fixture-lanes.test.ts` — exit 1 because the end-to-end score control exceeded Bun's default 5-second test timeout. Set that test's timeout to 120 seconds; subsequent and final runs passed.
- `git diff --check` — exit 0.

## Decisions

- Use the waybill's `# Waybill: <ticket>` value, or the dispatch directory name if it is absent, to match retained `wb/<ticket>-<lane>` branches. Pass the fixture ticket name separately to `fixture.sh hidden`.
- Score the union of lanes in the manifest, audit files and waybill workhorse line, plus retained branches for this ticket. This reports record lanes with no branch as missing and does not silently omit a retained branch.
- Report `N pass, M fail` whenever `fixture.sh hidden` prints counts. Report `missing` when a named lane has no branch, and `failed to build` when export or hidden-test execution produces no counts.
- If the waybill identifies no single fixture ticket, do not score lanes. If the TypeScript scorer fails, append `lanes not scored` and leave the merged-result verdict unchanged.
- Keep test repositories and score scratch under the worktree's ignored `.postmaster/` directory during the Bun test, so the worktree remains clean while verification runs.

## Not done

- No dependencies, package manifest, TypeScript config or lint config were added; Bun runs the TypeScript directly as specified.
- No push or pull request was made, per the workhorse instructions.

## Acceptance criteria

- AC1: met. `fixture.sh score` runs the hidden suite on each retained lane branch and shows each lane's counts beside main's on the hidden-tests line.
- AC2: met. Missing branches and branches that cannot be exported or yield no hidden-test counts are reported as `missing` or `failed to build`, never as passing counts.
- AC3: met. The adjacent Bun tests cover passing, failing and missing lane branches, plus a failed-to-build branch and merged-verdict controls, by reading `fixture.sh score` output.
