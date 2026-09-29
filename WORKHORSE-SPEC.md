# Workhorse spec: 132 Hotfix skill and the reach of a fix to runs in flight

## Summary

A fault in postmaster found while runs are in flight is fixed by hand today; this adds a
`hotfix` skill that takes the fault to a merged fix (ticket, worktree, fix with a control,
PR, merge under `ship.merge_authority`, pull of main) and a `hotfix-reach.sh` script that
reports how the fix reaches every run in flight and applies it as a lone fix commit where
the run's branch carries its own copy of the fixed file — never as a merge of main.

## Technical context

- **Language and version**: bash with Python 3.11 heredocs, matching every other script in
  `scripts/`; no new dependencies.
- **Dependencies used or added**: `git`, `log-action.sh`, `run-meta.sh`, `ticket-check.sh`,
  `github.sh` / `local.sh` (existing trackers). None added.
- **Testing**: the gate (`bash -c '…'` in `.postmaster/project.toml`) including
  `scripts/hotfix-reach.sh --self-test`; that self-test is the control AC5 names (a run
  that needs the fix commit and one that does not, told apart by the same `report`
  command). AC1 is shown by the skill file existing, being linked by `link-skills.sh`
  like every other `skills/*/` directory, and naming every step in order.
- **Constraints**: never merge main into a run's branch; fix commits only between legs;
  every step through `log-action.sh`; a conflicting run is left untouched and named;
  PR titles are `#<ticket>, <title>`; merge only under `ship.merge_authority`; script
  paths in skills go through `<tool>`; deterministic steps belong in `scripts/`.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| A fix reaches a run through the checkout it calls where it can, and as the fix commit alone where it cannot, never as a merge of main | `hotfix-reach.sh report` classifies each run as `checkout`, `branch` or `next-leg`; `apply` cherry-picks the fix commit alone onto the run's branches and pins; no `git merge main` anywhere |
| The user's word: a hotfix skill that opens a PR, merges to main and pulls, then tells the flows | `skills/hotfix/SKILL.md` is exactly that journey, ending in `hotfix-reach.sh report` + `apply` |
| Every count needs a control | `hotfix-reach.sh --self-test` builds a run that needs the fix commit and one that does not, and shows the same `report` command tells them apart |
| Every action logged through `log-action.sh` | `apply` logs an `apply` line per fix commit per run and a `note` per report; the skill logs `ticket-create`, `verify`, `merge`, `note` |
| A prompt lives in argv; deterministic work in `scripts/` | reach/apply is a script; the skill is prose that runs scripts and git/gh commands |
| Script paths in skills go through `<tool>` | `skills/hotfix/SKILL.md` uses `<tool>/scripts/…`; `skill-refs.sh` is widened to check every `skills/*/` markdown file so this holds |
| Nothing harness-specific outside an adapter | the skill names no harness; `link-skills.sh` links every `skills/*/` directory automatically |
| PR title `#<ticket>, <title>`; merge under `ship.merge_authority` | the skill spells both out and checks the config's `ship.merge_authority` before merging |

## Structure

- `skills/hotfix/SKILL.md` — the hotfix skill: fault to merged fix, then reach.
- `scripts/hotfix-reach.sh` — `report`, `apply`, `--self-test` (AC2–AC5).
- `scripts/run-meta.sh` — `check` accepts a pin carrying recorded fix commits.
- `skills/postmaster/postmaster.md` — Stage C carries hotfix notes into the next leg's prompt.
- `skills/postmaster/controls.md` — lists `hotfix-reach.sh` as a control.
- `scripts/skill-refs.sh` — checks every `skills/*/` markdown file, not only `postmaster`.
- `.postmaster/project.toml` — the gate runs `hotfix-reach.sh --self-test` (34 self-tests).

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| `run-meta.sh check` accepts recorded fix commits | `apply` puts the fix commit on a run's pin so the checkout serves the fix; without this `check` would refuse the pin at every later leg | never touching pins would leave pinned runs on the broken version, which is what this ticket exists to change |
| `skill-refs.sh` default covers all skills | `skills/hotfix/` references scripts; the gate would not check them otherwise | leaving the default would let a broken reference ship |

## Decisions

1. **Reach modes are mutually exclusive**, in precedence order: `next-leg` (a fixed file is a
   runbook and a leg is in progress) beats `branch` (some fixed file exists in the run's
   branch tree) beats `checkout` (otherwise). A run whose branch changed the same lines of a
   fixed file is `conflict` and is left untouched.
2. **"Carries its own copy" is existence on the branch**: `git cat-file -e <branch>:<path>`
   in the target repo. A postmaster-as-target run always has a copy of every postmaster
   file; a run against another project never does.
3. **`checkout` means nothing is done to the run's branches.** For a pinned tool checkout the
   fix commit is cherry-picked onto the pin (recorded beside it); for an unpinned checkout
   that is the main checkout the pull already put the fix there. Either way the report line
   says so.
4. **Branch fix commits land on the synthesis branch and on every lane branch that carries
   the fixed file**, at a leg boundary only (`apply` skips and reports `wait` mid-leg).
5. **The fix commit's message says it is main's fix**: `Main's fix <short-sha>: <subject>`
   with a body line naming the hotfix ticket. Never a merge.
6. **The next leg's prompt carries the fix**: `apply` writes `<dispatch>/hotfix-notes.md`
   and appends a pointer into the next leg's prompt file when it exists; `postmaster.md`
   Stage C includes the notes when it writes a prompt.
7. **Hotfix skill actions are logged under `<runs>/hotfix/`** (like `<runs>/postmaster/`),
   so they reach the project ledger; `apply` logs to each run's dispatch and the ledger.
8. **The fix commit is identified by its sha in the postmaster repo** (`$TOOL`); the script
   exports it as a patch so it can land on a target repo that shares no object store.
9. **The skill is `skills/hotfix/`**, linked like every other skill; the reach script is
   `hotfix-reach.sh`, one script as AC2–AC5 describe.

## Tasks

- [x] T001 [P] [AC1] Write `skills/hotfix/SKILL.md`: fault to merged fix (ticket, worktree
  from `origin/main`, fix with a control that fails before and passes after, PR titled
  `#<ticket>, <title>`, merge under `ship.merge_authority`, pull of main) and then the
  reach report and apply; script paths through `<tool>`.
- [x] T002 [P] [AC2] Write `scripts/hotfix-reach.sh report <runs-root> <fix-commit>`:
  one line per in-flight run with reach `checkout`, `branch`, `next-leg` or `conflict`.
- [x] T003 [AC2] [AC3] Implement `scripts/hotfix-reach.sh apply <runs-root> <fix-commit>`:
  fix commit alone on the run's branches at a leg boundary, never mid-leg, never a merge of
  main; commit message and next-leg prompt say it is main's fix.
- [x] T004 [AC4] Detect a run whose branch changed the same lines of a fixed file, leave it
  untouched, and name it in the report.
- [x] T005 [AC5] Log every apply/report step through `log-action.sh`, and write the
  self-test control: a run that needs the fix commit and one that does not, told apart by
  the same `report` command.
- [x] T006 [AC2] [AC3] Extend `scripts/run-meta.sh check` so a pin carrying recorded fix
  commits still serves its run, and record applied pin fixes beside the pin.
- [x] T007 [AC3] Extend `skills/postmaster/postmaster.md` Stage C so the next leg's prompt
  carries hotfix notes.
- [x] T008 [AC1] Widen `scripts/skill-refs.sh` to check `skills/hotfix/*.md` alongside
  `skills/postmaster/*.md`. (Dropped: listing `hotfix-reach.sh` in `controls.md`. A fault
  in it runs outside a leg and must not stop one; the script's own self-test is the control
  AC5 names.)
- [x] T009 [AC1] Add `hotfix-reach` to the gate's self-test list in
  `.postmaster/project.toml` and keep the `shows` count true.
