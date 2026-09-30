# Workhorse summary: #110 A project's gate never sees the run's own working copies

## Commits

| Commit | What |
|---|---|
| `b11bef5` | First draft workhorse spec (move copies outside); superseded by the shared coachman spec |
| `eb84067`, `f4dd418` | Shared coachman spec and its revision 2 (this workhorse implements from `f4dd418`) |
| `c1cd636`, `6963402`, `ffef0b6` | A first implementation that moved working copies outside the project folder (`worktree-path.sh`) |
| `74acc7c`, `c80aa72`, `d99740b` | Reverts of those three: the approved spec keeps the copies under `.worktrees/` and moves the gate instead |
| `1f9477b` | `scripts/clean-checkout.ts` and `scripts/clean-checkout.test.ts`: the helper and the control pair |
| `c75a7c3` | Ship leg post-merge gate through the helper (`coachman.md` Stage 3 step 6); `fixture.sh` scoring's gate the same way; `wiki/concepts/clean-checkout-gates.md`; gate runs the Bun tests |
| `a570004` | Ticks the shared spec's tasks |

## Checks

`/home/brindlewick/.postmaster/tool-pins/ffe37821779aa7cc77275860573a8fdd43cd6e2d/scripts/verify.sh run .`, just before this summary:

```
gate: pass, exit 0, 764s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

That is the waybill's one check, `gate [default:gate]`: the project's gate passed.

Other commands, each on this worktree:

| Command | Exit |
|---|---|
| `bun test scripts/clean-checkout.test.ts` | 0 (5 pass, 0 fail) |
| `scripts/fixture.sh --self-test` | 0 |
| `scripts/wiki-lint.sh` | 0 |
| `scripts/skill-refs.sh` | 0 |
| `bash -n` over `scripts/*.sh` | 0 |
| `scripts/clean-checkout.test.ts` also run from the declared gate string in `.postmaster/project.toml` (the gate verify.sh ran is the one recorded at dispatch, without that line; the line is in the project's declared gate for the next dispatch) | 0 when run alone, as above |

## Decisions

1. **Implements the shared coachman spec at `f4dd418`, not the first draft.** On resume the
   worktree already held the shared spec; the approval named that commit. The draft that moved
   working copies outside was reverted, because the approved spec keeps them under `.worktrees/`
   (the machine's convention) and moves the gate.
2. **`clean-checkout.ts` unpacks `git archive` of the branch into a temp directory** under the
   system tmpdir (`clean-checkout-*`), the same content fixture scoring already used, rather
   than a full clone: the checkout holds only the branch's tracked files, so it cannot see
   `.worktrees/` even if someone planted one later in the main tree.
3. **One composed command for fixture scoring's gate** (`npm ci`/`npm install` then the gate,
   `set -e`) through the helper, so install and gate share the same clean checkout. Hidden
   tests keep their own archive export: they need a directory to point `FIXTURE_APP` at and
   are not a gate on the default branch.
4. **T008 survey.** The flow runs a project gate on the default branch after a merge in exactly
   two places: the ship leg's new Stage 3 step 6, and fixture scoring's `check_gate`. Postmaster
   Stage G only runs `git log -1`; Stage F and Stage 3 step 1 gate the synthesis worktree before
   the merge word. Hand-run tools are outside the flow and are the wiki page's stated
   non-coverage.
5. **Helper is TypeScript on Bun, functional, tests beside it**, per the shared spec's
   constraint on new scripts.

## What I did not do

- **No end-to-end fixture run** (dispatch, merge, `fixture.sh score` on a live run). That is
  the coachman's and postmaster's work; this workhorse's control pair and fixture self-test
  cover the mechanism the score uses.
- **Hand-run tools in the main checkout still see `.worktrees/`.** The shared spec accepts
  that; the wiki page states it rather than hiding it.
- **Did not change any worktree path, exclude, or placement line.** The reverts restored them.

## Acceptance criteria

1. **The gate the flow runs on main after a merge never reads a run's working copies.** Met.
   Both post-merge gates run through `scripts/clean-checkout.ts`, whose checkout is outside the
   project folder and holds only the branch content. T008 found no third caller.
2. **The way this is done is recorded in the wiki with the reason.** Met.
   `wiki/concepts/clean-checkout-gates.md`, indexed, logged, lint clean.
3. **A self-test control.** Met. `scripts/clean-checkout.test.ts`: the identical check passes
   from the clean checkout and fails in the main checkout when a copy is left under
   `.worktrees/`, through the helper both ways.
4. **The fixture app's gate passes on main right after a fixture run's merge.** Met, by the
   same mechanism: fixture scoring's gate runs on `main` through the helper, on a checkout that
   never contained `.worktrees/`. `scripts/fixture.sh --self-test` is green, including "a type
   error shipped: gate alone fails".
