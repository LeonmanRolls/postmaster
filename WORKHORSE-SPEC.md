# Workhorse spec: #75 Dispatch refuses a run directory or branch that already exists

## Summary

Stage B names a run's directory and branches after its ticket id and makes them without
checking what is already there, so a re-run or a reused number silently reuses the old run
and then fails at `git worktree add`. This spec adds one read-only check, written in
TypeScript and run by Bun, that refuses such an id before Stage B writes anything, names
every clash, and leaves the old run to the user; Stage B runs it through Bun and puts any
refusal to them.

## Technical context

- **Language and version**: TypeScript run by Bun (1.4.2 on this machine), in a functional
  style: no mutation unless truly necessary, a pure core with side effects at the edges.
- **Dependencies used or added**: Bun only. No package.json, tsconfig.json or bunfig.toml:
  Bun's defaults run the script and its tests directly, and the change stays self-contained
  so whichever of this branch and #158's merges second can absorb the other.
- **Testing**: `bun test scripts/run-clash.test.ts` (AC3) with a throwaway git repo under
  `mktemp -d` as both the clean pass and each planted clash; the project gate via
  `<tool>/scripts/verify.sh run .` from the worktree root just before the summary (AC4's
  prose is read-checked; the gate covers the new tests and every path the runbooks name).
- **Constraints**: the guard is read-only and runs at Stage B before the run directory is
  made (and before the `.git/info/exclude` write, so before Stage B writes anything). On a
  clash the user decides: archive the old run, rename it, or pick another id. The postmaster
  renames or removes nothing itself. Local ids stay plain numbers (#11); moving a repository
  between tracker kinds stays out of scope.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| A check in a script, not prose | New `scripts/run-clash.ts` holds the check; `postmaster.md` only calls it, through Bun |
| The user's standing preference for a new script | TypeScript on Bun, Bun the only dependency, functional style, tests beside it |
| Run at Stage B before the run directory is made | A new Stage B step after the base pre-flight and before exclude-worktrees / create-run-directory |
| On a clash the user decides | The refusal names what exists and lists archive / rename / pick another id; Stage B stops and asks |
| The postmaster renames or removes nothing itself | Stage B text says so explicitly |
| Local ids stay plain numbers | The script takes the id as given; no id scheme change |
| Moving between tracker kinds is out of scope | Not touched |
| Deterministic work goes in `scripts/` | The check is entirely in `run-clash.ts` |
| Every count needs a control | Tests: clean pass (zero clashes) and each planted clash (non-zero), same argv |
| Script paths in runbooks go through `<tool>` | Stage B cites `<tool>/scripts/run-clash.ts`, run with `bun` |

No departure from the ticket's direction or the project's own rules.

## Structure

| Path | Change |
|---|---|
| `scripts/run-clash.ts` | new. `bun scripts/run-clash.ts <repo> <ticket-id>` |
| `scripts/run-clash.test.ts` | new. `bun test` tests beside the script: the AC3 self-test |
| `.postmaster/project.toml` | declared gate runs the new tests; `shows` updated to say so |
| `skills/postmaster/postmaster.md` | Stage B: new clash-check step after the base pre-flight, calling the script through Bun; later steps renumbered; refusal goes to the user |
| `README.md` | one line in the script list beside the other run checks |

## Complexity tracking

None.

## Decisions

1. **TypeScript on Bun, Bun the only dependency.** The user's standing preference for a new
   script. No config files: `bun scripts/run-clash.ts` and `bun test
   scripts/run-clash.test.ts` run on Bun's defaults. #158 adds TypeScript too, on its own
   branch; with no shared infrastructure in this change, whichever merges second absorbs
   the other at its merge.
2. **Functional style.** A pure core (what counts as a clash, how a refusal reads) with
   side effects at the edges (reading the run directory, listing branches, printing).
   No mutation unless truly necessary.
3. **The tests beside the script are the AC3 self-test.** `scripts/run-clash.test.ts`, run
   by `bun test`, shows a clean pass, each refusal (run directory, ticket branch, `wb/`
   branch, several at once) naming what it refused, and the near-miss control (ticket `7`
   against `70` / `wb/70-*`) through the identical command. No `--self-test` flag: the
   test file is the self-test, and the declared gate runs it.
4. **Script name `run-clash`.** Beside `run-meta.sh` / `run-log.sh` / `run-times.sh`: it is
   about a run's identity clashing with what is already in the project. `*-check.sh` was
   considered (`ticket-check`, `handoff-check`) but those check an artifact's shape; this one
   reports a clash.
5. **CLI is `<repo> <ticket-id>`.** Matches `ticket-check.sh <repo> <id>`. The run root is
   `<repo>/.postmaster/runs/` as `postmaster.md` defines it; the script derives it and does
   not take a second path.
6. **What is checked, exactly the acceptance criteria:** `<runs>/<TICKET>/` (a directory or a
   file at that path), local branch `<TICKET>`, and local branches matching `wb/<TICKET>-*`.
   Not a leftover worktree directory, not remote-tracking branches: `git worktree add -b`
   fails on a local branch clash, the silent reuse is the run directory, and merged branches
   lingering on the remote would refuse ids that are actually free. Near-misses are out:
   ticket `7` must not refuse `70` or `wb/70-lane`.
7. **Exit codes:** `0` free; `1` usage or `<repo>` is not a git repository; `2` one or more
   clashes. Mirrors `check-target.sh` (0 usable, 1 cannot look, 2 must ask). Bun propagates
   the process exit code to the caller.
8. **Output:** on success one line naming the id as free; on clash one line per clash, naming
   the full run-directory path or the branch name, so the postmaster can put each to the user
   and the tests can assert names. A closing line offers the three user choices.
9. **Ticket id shape:** empty, or containing `/`, is refused as usage. It becomes a single
   path component and a branch name; a traversal would make the check meaningless. Local ids
   are plain numbers and GitHub ids are issue numbers, so this does not constrain real ids.
10. **Stage B placement:** a new numbered step after the base pre-flight (today's step 2) and
    before exclude-worktrees (today's step 3, the first write), calling
    `bun <tool>/scripts/run-clash.ts <repo> <TICKET>`. Later steps renumber; nothing
    in-repo cites a Stage B step number today.
11. **The script does not log.** `ticket-check.sh` does not log either; the postmaster logs the
    action. A `note` naming the refusal is enough and is not required by the acceptance criteria.
12. **No wiki page.** `wiki/concepts/local-tracker.md` already names this cost. A wiki claim
    needs promoted evidence; this change is the mechanism, not a finding from a run.

## Tasks

- [x] T001 [P] [AC1] [AC2] Write `scripts/run-clash.ts` in a functional style: refuse and name `<repo>/.postmaster/runs/<ticket-id>/` when it exists, and refuse and name local branch `<ticket-id>` and every `wb/<ticket-id>-*`; exit 0 free, 1 usage/not a repo, 2 clash.
- [x] T002 [AC3] Tests in `scripts/run-clash.test.ts`, run by `bun test`: a clean pass, each refusal (run directory, ticket branch, `wb/` branch, several at once) naming what it refused, and a near-miss control (ticket `7` against `70` / `wb/70-*`) through the identical command.
- [x] T003 [AC4] In `skills/postmaster/postmaster.md` Stage B, run `bun <tool>/scripts/run-clash.ts <repo> <TICKET>` after the base pre-flight and before the run directory is made; put any refusal to the user (archive, rename, or pick another id); state that the postmaster renames or removes nothing itself; renumber the later steps; run the new tests in the gate declared in `.postmaster/project.toml` and update its `shows`; list `scripts/run-clash.ts` in `README.md`.
