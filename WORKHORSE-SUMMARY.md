# Workhorse summary: #159 A fixture run scores each lane's own branch against the hidden tests

## What this branch is

| Commit | What it did |
|---|---|
| `ee4929f` | Add the workhorse spec for #159 (record of intent) |
| `93820f2` | Adopt the coachman's shared workhorse spec (planning round 2) |
| `15260f8` | Adopt the user's approved shared workhorse spec (planning round 3) — the authoritative plan |
| `ea1b9d0` | Score each lane's harvested branch beside the merged result: `scripts/fixture-lanes.ts`, `scripts/fixture-lanes.test.ts`, and one call from `scripts/fixture.sh`'s score path |
| `2da67e6` | Tick the workhorse spec's tasks |

## Checks

`/home/brindlewick/.postmaster/tool-pins/73fca4e4a513d8915bf067723d54871b4b8ba728/scripts/verify.sh run .`, run from the worktree root just before this summary:

| Check | Command | Exit | Result |
|---|---|---|---|
| gate [default:gate] | `bash -c 'for f in scripts/*.sh; do bash -n "$f" \|\| exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test \|\| exit 1; done'` | 0 | pass (791s) |

`verify.sh run .` printed: `gate: pass, exit 0, 791s: bash -c 'for f in scripts/*.sh; …'`

Other commands, with their exit codes:

| Command | Exit | Result |
|---|---|---|
| `bun --no-env-file test scripts/fixture-lanes.test.ts` | 0 | 13 pass, 0 fail, 55 expect() calls, 45.77s |
| `bun --no-env-file test scripts/fixture-lanes.test.ts -t "pure core"` | 0 | 11 pass (during development) |
| `bun --no-env-file test scripts/fixture-lanes.test.ts -t "score controls"` | 0 | 2 pass (during development; earlier run found the export-directory bug and failed) |
| `bash -n scripts/fixture.sh` | 0 | parses |
| `git worktree add -f --detach …/tool-pins/73fca4e… 73fca4e…` | 0 | the named pin was registered but missing; recreated so the summary's command exists |

## Decisions

- **`ticketIdFromWaybill` reads only the first line.** A `# Waybill:` line further down the ticket is not the run's id; the header is.
- **Export creates its destination directory first.** `git archive | tar -x -C dest` fails when `dest` is missing; that made every lane `failed to build` until fixed.
- **Lane names are the union of the run's records and its kept branches** (manifest `lanes`, plain `audit/<lane>.md`, waybill `workhorses:`, `wb/<TICKET>-*`), sorted; a named lane with no branch is `missing`, a kept branch no record names is still scored.
- **Status words.** Counts only when `fixture.sh hidden` prints them; `missing` when the ref is gone; `failed to build` when export fails, hidden refuses the tree, or it prints no counts. Those two never show pass counts.
- **The verdict is the merged result's alone.** Lane counts extend the hidden-tests line and do not change its ok/FAIL or the exit code.
- **When the waybill carries no single fixture ticket, or the script fails**, the line fails or says `lanes not scored` as the spec's decision 7 has it; no lane is invented.

## What I did not do

- **Did not add anything to `fixture.sh --self-test`.** The approved spec puts every new test in `scripts/fixture-lanes.test.ts`.
- **Did not make the gate run `bun test`.** The gate is bash self-tests; the spec says to run both and record both, which the Checks table does.
- **Did not change wiki or runbooks.** Nothing the lanes see changes; the measurement is for score's record.

## Verdict on the acceptance criteria

1. **Met.** `fixture.sh score` runs the ticket's hidden tests against each lane's harvested `wb/<TICKET>-<lane>` branch via `scripts/fixture-lanes.ts` (which reuses `fixture.sh hidden`) and reports each lane's `N pass, M fail` beside the merged result's counts on the hidden-tests line.
2. **Met.** A lane with no branch is reported `missing`; one that will not export, is refused by `fixture.sh hidden`, or yields no counts is reported `failed to build`. Neither ever prints pass counts (unit tests and the score control both assert this).
3. **Met.** `scripts/fixture-lanes.test.ts`, run by `bun test`, has pure-core tests and score controls for a lane branch that passes, one that fails, and one that is missing (plus failed-to-build and "the verdict follows the merged result alone").
