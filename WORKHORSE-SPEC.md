# Workhorse spec: #110 Keep a project's gate from reading a run's working copies

## Summary

A run's working copies live under the target repository (`.worktrees/`), so a project tool that
walks the whole folder (Biome, a formatter, a test runner) reads them and the gate on main fails
after a merge. This workhorse moves every run working copy outside the project folder, so
project tools never see them, records why in the wiki, and proves it with a positive and a
negative control.

## Technical context

- **Language and version**: bash with Python in heredocs, run in place; no build step.
- **Dependencies used or added**: none. `git worktree add` already accepts an absolute path
  outside the repository.
- **Testing**:
  - `scripts/worktree-path.sh --self-test` — path rule, the AC3 control pair, and that the root
    is outside the project folder.
  - `bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && …'`
    (the project gate), including the new script's self-test once it is in `.postmaster/project.toml`.
  - `scripts/wiki-lint.sh` after the wiki page lands.
  - `scripts/fixture.sh --self-test` still passes (no change expected to its score path).
  - Manual shape of AC4: after a fixture run's merge, `npm run check` on the fixture app's main
    checkout passes with the run's worktrees still present at the outside root (the self-test
    control is the same shape).
- **Constraints**:
  - Ticket direction: keep tools from ever seeing working copies through a change in the flow,
    not by asking projects to ignore `.worktrees/`.
  - Design rules: nothing repo-specific; deterministic path work in `scripts/`; every count
    needs a control (positive non-zero, negative zero, identical command).
  - A coachman cannot remove its own worktree; the synthesis worktree outlives the merge until
    the postmaster tears it down. The gate must be clean while that worktree still exists.
  - In-flight runs stay on their pinned tool; this change reaches the next dispatch.
  - Never push; never read other branches or `.worktrees/`; never edit outside this worktree.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Keep project tools from ever seeing run working copies (ticket direction) | Working copies are cut outside the project folder. Nothing is written under `<repo>/.worktrees/` at run time. |
| Change the flow, not each project's ignore rules (ticket direction) | The flow's cut/teardown paths move; no project config is required or requested. |
| Record the way and the reason in the wiki (AC2) | New concept page under `wiki/concepts/`, indexed, linted. |
| Control with positive and negative (design rule 5; AC3) | `worktree-path.sh --self-test` runs one check twice: pass with copies only outside, fail when a copy is left under `.worktrees/` where a folder-walking tool would read. |
| Gate on main after a merge never reads working copies (AC1) | Nothing lives under the project tree during a run, so the gate on main cannot read a run's copies even before teardown. |
| Fixture app's gate passes on main right after merge (AC4) | Same mechanism: the synthesis worktree may still exist; it is outside the fixture repo, so `npm run check` on main is clean. |
| Nothing repo-specific (AGENTS.md design rule 1) | The worktree root is derived from the repository's own path, not from a hardcoded host or name. |
| Deterministic work in `scripts/` (design rule 3) | Path computation lives in `scripts/worktree-path.sh`, not in prose. |
| Script paths in `skills/postmaster/` go through `<tool>` (AGENTS.md) | New references use `<tool>/scripts/worktree-path.sh`. `scripts/skill-refs.sh` must pass. |
| Workhorses never push; one change per branch | Local commits only on `wb/110-mimo`. |

## Structure

| Path | Change |
|---|---|
| `scripts/worktree-path.sh` | **New.** `root <repo>` prints the outside worktree root; `--self-test` carries the AC3 control. |
| `skills/postmaster/postmaster.md` | Cut/teardown the synthesis worktree at the outside root, not `<repo>/.worktrees/`. |
| `skills/postmaster/coachman.md` | Workhorse worktrees and reviewer scratches at the outside root; path table; teardown lines. |
| `scripts/review-round.sh` | `scratch()` and the comment that names the scratch path use `worktree-path.sh root`. |
| `.postmaster/project.toml` | Add `worktree-path` to the gate's self-test list. |
| `wiki/concepts/working-copies-outside.md` | **New.** The claim, the reason (folder-walking tools; fixture runs 4 and 5), standing. |
| `wiki/index.md` | One-line entry for the new concept. |
| `wiki/log.md` | Append the ingest line. |

Scripts that only exercise `.worktrees/` inside a disposable temp repo (`host.sh`, `verify.sh`,
`local.sh`, `link-skills.sh`, `spec-review-link.sh`, `fixture.sh`) keep those paths: they are
self-tests of the tools, not of project layout, and a temp repo has no folder-walking gate.

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| Worktree root moves outside the project, rather than only gating after teardown | AC4 needs the gate clean *right after the merge*, while the synthesis worktree still exists (the coachman sits in it; only the postmaster removes it in Stage G). Teardown-then-gate cannot cover that instant. | Gating after teardown is the ticket's other example, but it leaves the live gate red for the whole window the ticket calls out, and still fails for a sibling run's copies under `.worktrees/`. |
| New `scripts/worktree-path.sh` rather than a hardcoded relative path in prose | Design rule 3: path logic must be a script so every caller agrees. | A documented constant is re-derived per runbook and drifts. |

## Decisions

1. **Where the copies live.** `worktree-path.sh root <repo>` prints
   `<parent-of-repo>/.postmaster-worktrees/<basename-of-repo>/` (physical paths). Outside the
   project folder, beside it, named for the repo so two projects never share a root. No config
   key; discovery of the repo path is enough (design rule 1). `POSTMASTER_WORKTREES`, when set,
   replaces the parent directory (`$POSTMASTER_WORKTREES/<basename>`), matching how
   `POSTMASTER_TOOL_PINS` overrides tool pins.
2. **Same names under the new root.** Synthesis is `<root>/<TICKET>`, workhorse
   `<root>/<TICKET>-<lane>`, reviewer scratch `<root>/<TICKET>-rev-<lens>-<lane>`. Only the root
   moves; every relative name stays, so teardown and `host.sh close` arguments change by one
   prefix.
3. **Legacy `.worktrees/` stays gitignored.** `postmaster.md` and `coachman.md` keep the
   exclude line so a stray copy from an old run is never committed. Nothing new is cut there.
4. **AC3 control shape.** One identical command (the project's check: fail if any entry exists
   under `.worktrees/`):
   - Positive (must pass after the fix): copies only at the outside root; check exits 0.
   - Negative (must fail): leave a copy under `<repo>/.worktrees/`; the same check exits non-zero.
   The self-test asserts both exits through the same function.
5. **Wiki standing.** `claimed` at first, citing fixture runs 4 and 5 as the observation the
   ticket carries; no `raw/` promotion exists in-repo for those runs yet, so the page says so
   rather than inventing a citation.
6. **Gate list.** `worktree-path` is added to `.postmaster/project.toml`'s self-test loop so
   the stand-in gate runs the new control. The gate string is the project's declared check; the
   waybill copies it from there.
7. **Scope of path edits.** Only production path constructors and the runbooks that name
   `<repo>/.worktrees/…` as the place a run's copies are cut. Reviewer scratch is included,
   because those copies are also under the project folder today and Biome would read them too.

## Tasks

- [ ] T001 [P] [AC1] [AC3] Add `scripts/worktree-path.sh`: `root <repo>` and `--self-test` with the AC3 positive/negative control pair (identical check; pass with copies only outside; fail when a copy is left under `.worktrees/`).
- [ ] T002 [AC1] Point synthesis worktree cut/teardown in `skills/postmaster/postmaster.md` at `<tool>/scripts/worktree-path.sh root <repo>`, not `<repo>/.worktrees/`.
- [ ] T003 [AC1] Point workhorse worktrees and reviewer scratches in `skills/postmaster/coachman.md` at the same outside root (path table, Stage 0 cut, review scratch destinations, teardown).
- [ ] T004 [AC1] Change `scratch()` in `scripts/review-round.sh` (and its header comment) to resolve the scratch under `worktree-path.sh root`.
- [ ] T005 [AC2] Write `wiki/concepts/working-copies-outside.md` (claim, reason, standing, what would settle it) and add a one-line entry to `wiki/index.md`; append to `wiki/log.md`; `scripts/wiki-lint.sh` clean.
- [ ] T006 [AC3] [AC4] Add `worktree-path` to the gate self-test list in `.postmaster/project.toml`; run the full project gate and `scripts/fixture.sh --self-test`.
- [ ] T007 [AC1] [AC4] Run the gate from this worktree root; confirm skill-refs and wiki-lint clean after the runbook edits (`scripts/skill-refs.sh` and the stand-in gate).
