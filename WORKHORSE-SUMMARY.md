# Workhorse summary: #75 Dispatch refuses a run directory or branch that already exists

## Commits on this branch

- `82c4cf1` 75: workhorse spec for refusing a ticket id that already names a run or a branch
- `12decd2` #75 shared workhorse spec (planning round 2, coachman-composed)
- `2cfbc31` #75 shared workhorse spec, round 3: TypeScript on Bun (coachman-composed) — the approved spec
- `7fbae1f` 75: run-clash refuses a ticket id that already names a run or a branch
- `feae9b2` 75: Stage B runs the clash check before it writes; gate runs its tests

## Checks

`/home/brindlewick/.postmaster/tool-pins/ffe37821779aa7cc77275860573a8fdd43cd6e2d/scripts/verify.sh run .`
from the worktree root, just before this summary (detached, waited for):

```
gate: pass, exit 0, 816s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

| Check | Command | Exit |
|---|---|---|
| gate [default:gate] | the waybill gate above, via `verify.sh run .` | 0 (816s) |

That gate is the dispatch-time gate the waybill names (the 40 BASE self-tests, `bash -n`, skill-refs, wiki-lint). It is not rewritten by this change; `verify.sh run` reports that gate as the run's check. Other commands run for this work, with their exits:

| Command | Exit |
|---|---|
| `bun test scripts/run-clash.test.ts` | 0 — 17 pass, 0 fail, 53 expect() calls |
| `scripts/skill-refs.sh` | 0 — `bun <tool>/scripts/run-clash.ts` in Stage B resolves |
| `git status` after the two implementation commits | clean |

The first `verify.sh run` attempt was started in the foreground and the harness's longest
command timed out at 600s with the gate still in `host.sh --self-test`; that process died
with the tool's shell and left no output. The run above was started with `nohup`, waited on,
and completed cleanly. No timing flake of `host.sh` or `review-round.sh` was seen on the
successful run.

## Within-brief decisions

1. **CLI surface of the script** is `bun scripts/run-clash.ts <repo> <ticket-id>` (no
   `--self-test` flag): the test file is the self-test, as the approved spec's decision 3
   says. `import.meta.main` keeps the CLI from running when the tests import the pure core.
2. **`wb/<id>-*` is a prefix match on `wb/<id>-`.** Bare `wb/7` is not a clash for ticket `7`;
   `wb/7-` and `wb/7-lane` are. That is the acceptance criterion's pattern, and the near-miss
   (`7` vs `70`) falls out of the prefix.
3. **Run-directory clash is any filesystem entry at the path** (`existsSync`), not only a
   directory: a leftover file would fail Stage B just as hard.
4. **Ticket id is refused when empty or when it contains `/`**, as usage (exit 1). It becomes
   a path component and a branch name.
5. **Branches are listed once with `git for-each-ref refs/heads/` and filtered in the pure
   core**, so the near-miss rule is testable without git and remote-tracking branches are
   never considered (they do not block `git worktree add -b`).
6. **Tests drive the real CLI** (`bun scripts/run-clash.ts <repo> <id>`) against throwaway
   git repos under `mktemp -d`, so every refusal is shown through the identical command Stage
   B uses.
7. **The gate in `.postmaster/project.toml` now ends with `bun test scripts/run-clash.test.ts`**
   and its `shows` says so. The waybill's gate for *this* run is the dispatch-time one and was
   left alone; the project file is what the next dispatch records. AC3 is also shown directly
   by the `bun test` line above.
8. **`.postmaster/project.toml` is committed with `git add -f`**, as the project's one shared
   settings file.

## What I did not do

- **No wiki page.** The cost is already named in `wiki/concepts/local-tracker.md`; a wiki
  claim needs promoted evidence from a run, and this change is the mechanism.
- **The script does not log.** Same as `ticket-check.sh`: the postmaster logs. Stage B says
  the refusal goes to the user; it does not require a log line.
- **No leftover-worktree or remote-branch check.** Outside the acceptance criteria; local
  branches are what `git worktree add -b` refuses on, and the silent reuse is the run
  directory.
- **Did not rewrite the dispatch-time gate string** that `verify.sh run` executed. It is the
  waybill's check for this run. The updated gate lives in `.postmaster/project.toml` for the
  next dispatch.
- **Did not push.** The branch is local only, per the brief.

## Verdict on the acceptance criteria

1. **Before Stage B writes anything, a script refuses when `<runs>/<TICKET>/` already exists,
   and names it.** Met. `scripts/run-clash.ts` refuses and prints
   `run-clash: run directory already exists: <full path>`; Stage B step 3 runs it before the
   exclude write and before the run directory is made. Shown by the test "an existing run
   directory is refused and named" (and the file-at-that-path case).
2. **It refuses when branch `<TICKET>` or any `wb/<TICKET>-*` branch already exists in the
   repo, and names each one.** Met. Each matching local branch is printed as
   `run-clash: branch already exists: <name>`, and several are named in one refusal. Shown by
   the ticket-branch, `wb/`-branches, and several-at-once tests.
3. **Its self-test shows each refusal and a clean pass.** Met. `bun test
   scripts/run-clash.test.ts`: 17 pass, including a clean pass, each refusal (run directory,
   file, ticket branch, `wb/` branches, several kinds together), and the near-miss control
   (ticket `7` against `70` / `wb/70-*`) through the identical command. The project's declared
   gate now runs these tests.
4. **Stage B in `postmaster.md` runs the script and puts any refusal to the user; the
   postmaster renames or removes nothing itself.** Met. Stage B step 3 is the clash check;
   on exit 2 or 1 it puts the named clashes to the user (archive, rename, or pick another id)
   and stops. The step states that the postmaster renames or removes nothing itself.
