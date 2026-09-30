# Workhorse summary: 110 A project's gate never sees the run's own working copies

## Commits

- `e76e11d` Specify #110 postmerge gate isolation
- `57c7f20` Shared coachman spec for #110
- `543b0e2` Shared coachman spec for #110, revision 2
- `a01e81b` Add isolated clean checkout runner
- `01ab6ad` Verify the merged branch from a clean checkout
- `f0398df` Run fixture gates from clean checkouts
- `a27509d` Document clean-checkout gates
- `d2fc68a` Keep temporary checkout cleanup scoped
- `7af3d35` Check clean checkout registration is removed

## Checks

- Required pinned command: `/home/brindlewick/.postmaster/tool-pins/ffe37821779aa7cc77275860573a8fdd43cd6e2d/scripts/verify.sh run .` — exit 0.
- Its output for the recorded gate: `gate: pass, exit 0, 744s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'`.
- The pinned command also passed earlier: gate exit 0 in 778s.
- Current declared gate from `.postmaster/project.toml`, including `bun test scripts/clean-checkout.test.ts`: exit 0.
- `bun test scripts/clean-checkout.test.ts`: final run exit 0, 2 tests passed and 8 assertions passed. The first run exited 1 because the test omitted the `realpathSync` import; fixed and rerun.
- `bash scripts/verify.sh --self-test`: exit 0, including the gate-only result and action-log controls.
- `bash scripts/fixture.sh --self-test`: final run exit 0, all controls passed. The first run exited 1 because one expected detail still named the old gate location; updated and rerun.
- `scripts/wiki-lint.sh`: exit 0.
- `scripts/skill-refs.sh`: exit 0.

## Decisions

- Keep run worktrees under `.worktrees/` and move the postmerge gate to a temporary detached checkout outside the target folder. This also isolates the gate from concurrent runs.
- Route the ship leg through `verify.sh gate` so it runs only the dispatch's recorded gate and logs the result against the merged commit.
- Fixture scoring installs dependencies and runs the discovered gate inside the clean checkout.
- The caller survey found exactly two postmerge default-branch gates: the ship leg and fixture scoring. Both now use `clean-checkout.ts`.

## What I did not do

- I did not launch a live multi-lane fixture run. The lane may not create or edit a fixture repository outside this worktree. `fixture.sh --self-test` scores synthetic merged runs and exercises the real fixture app gate through the new clean-checkout helper; the coachman contract still requires a live fixture run before merge.

## Acceptance

- AC1: met. The ship leg runs its recorded gate from a detached checkout outside the target folder; fixture scoring uses the same helper.
- AC2: met. The wiki records the worktree reason, the mechanism, and the limit for tools run manually from the main checkout.
- AC3: met. The colocated control fails in the project root with a `.worktrees/lane` copy and passes in the external checkout; success and failure both remove the checkout and its git registration.
- AC4: met in fixture scoring controls. The fixture app's discovered gate passes on merged `main` from the external checkout.
