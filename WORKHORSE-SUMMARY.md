# Workhorse summary: 132 Hotfix skill and the reach of a fix to runs in flight

## Commits

| commit | what |
|---|---|
| `6e3b35a` | `WORKHORSE-SPEC.md`, the record of intent |
| `d79434a` | `scripts/hotfix-reach.sh`: `report`, `apply`, `--self-test` with the AC5 control |
| `591673b` | `skills/hotfix/SKILL.md`, and `skill-refs.sh` checks it alongside postmaster |
| `a63796e` | `run-meta.sh check` accepts the fix commits `hotfix-reach.sh` records on a pin |
| `3774b73` | `postmaster.md` Stage C carries hotfix notes into the next leg's prompt; gate runs `hotfix-reach` |
| `371edc7` | spec tasks ticked |

## Checks

`/home/brindlewick/.postmaster/tool-pins/07b463ddf46bbc841cf0aeff2a959f70d181cfae/scripts/verify.sh run .`
printed:

```
gate: pass, exit 0, 727s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

- gate [declared:project] `bash -c '…'` (the brief's gate, 33 self-tests): exit 0.

Other commands run, with exit:

- `scripts/hotfix-reach.sh --self-test`: exit 0 (the AC5 control: a run that needs the fix
  commit and one that does not, told apart by the same `report` command).
- `scripts/skill-refs.sh`: exit 0 (default now covers `skills/postmaster/*.md` and
  `skills/hotfix/*.md`).
- `scripts/skill-refs.sh --self-test`: exit 0.
- `scripts/run-meta.sh --self-test`: exit 0 (includes the new controls: a pin carrying only
  recorded fix commits passes `check`; one carrying an unrecorded commit fails).
- `scripts/log-action.sh --self-test`: exit 0.
- `scripts/stage.sh --self-test`: exit 0.
- `bash -n scripts/*.sh`, `scripts/wiki-lint.sh`: exit 0.

## Decisions (within-brief questions this workhorse settled)

1. **Reach modes are mutually exclusive**, in precedence order: `next-leg` (a fixed file is a
   runbook and a leg is in progress) beats `branch` (some fixed file exists in the run's
   branch tree) beats `checkout` (otherwise). A run whose branch changed the same lines of a
   fixed file is `conflict` and is left untouched. The ticket lists three ways; this order
   makes one line per run, which is what a report the user reads needs.
2. **"Carries its own copy of the fixed file" is existence on the branch**
   (`git cat-file -e <branch>:<path>`). A postmaster-as-target run always does; a run against
   another project never does. That is the clean test the historical cases share.
3. **`checkout` means nothing is done to the run's branches.** For a pinned tool checkout the
   fix commit is cherry-picked onto the pin and recorded beside it; for the live main
   checkout the pull already put the fix there.
4. **Branch fix commits land on the synthesis branch and every lane branch that carries the
   fixed file**, at a leg boundary only (`apply` reports `wait` mid-leg). The historical
   hand-applied fixes went on several branches; this covers them.
5. **The fix commit's message is `Main's fix <short-sha>: <subject>`** with a body that says
   it is main's fix and not a merge of main. The next leg's prompt is told through
   `<dispatch>/hotfix-notes.md` and a line in the prompt file when one exists.
6. **Hotfix skill actions log under `<runs>/hotfix/`** (like `<runs>/postmaster/`) so they
   reach the project ledger; `apply` logs to each run's dispatch and the ledger.
7. **The fix commit is identified by its sha in the postmaster repo** and exported as a
   patch so it can land on a target that shares no object store with `$TOOL`.
8. **`skill-refs.sh` checks `skills/hotfix/*.md` alongside `skills/postmaster/*.md`** and not
   `skills/wiki/`, whose bare paths are its own convention (it works in a checkout).
9. **`run-meta.sh check` accepts a pin whose HEAD is the dispatch commit plus only the shas
   `hotfix-reach.sh` recorded in `<commit>.fixes`.** Without this a fix commit on a pin would
   make `check` refuse the checkout at every later leg.

## What I did not do

- **Listed `hotfix-reach.sh` in `skills/postmaster/controls.md`?** No. A control's fault
  stops the leg; `hotfix-reach.sh` runs outside a leg (from the hotfix skill) and must not
  stop one. The script's own `--self-test` is the control AC5 names.
- **A wiki page for the hotfix flow?** No. The ticket does not ask for one, and the wiki is
  claims backed by evidence; nothing has been promoted yet.
- **A fixture run?** The coachman-contract rule applies to changes to `coachman.md`. This
  change touches `postmaster.md` (one prompt line) and adds a skill and a script; it does
  not change the coachman contract.

## Verdict on the acceptance criteria

1. **A skill reaches by name from every harness with a skills folder, and takes a described
   fault to a merged fix: ticket, worktree from `origin/main`, fix with a control that fails
   before and passes after, PR titled `#<ticket>, <title>`, merge under
   `ship.merge_authority`, pull of the main checkout.** Met. `skills/hotfix/SKILL.md`
   (`name: hotfix`) is linked by `link-skills.sh` like every other `skills/*/` directory and
   walks each step in order.
2. **A script reports, for every run in flight, how the fix reaches it.** Met.
   `scripts/hotfix-reach.sh report` prints one line per in-flight run with `checkout`,
   `branch`, `next-leg` or `conflict`.
3. **A run that needs the fix commit gets it alone at the next stop between legs, never
   mid-leg, never a merge of main; the commit message and the next leg's prompt say it is
   main's fix.** Met. `apply` waits mid-leg, cherry-picks alone, writes
   `Main's fix <sha>: <subject>`, and puts the note in `hotfix-notes.md` and the prompt.
4. **A run whose branch changed the same lines is left untouched and named.** Met. The
   report says `conflict` and `apply` leaves the branch alone.
5. **Every step is logged through `log-action.sh`, per run and per project, and the report
   has a control.** Met. `apply` logs an `apply` per fix commit and `note`s otherwise, to
   the run and the ledger; the self-test shows one run that needs the commit and one that
   does not, told apart by the same `report` command.
