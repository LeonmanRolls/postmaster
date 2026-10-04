# Workhorse summary: 252 — aftercare, the one command that takes a landed run to done

## What I built

Commits on `wb/252-mimo`:

- `adebf4f` 252: one command takes a landed run to done, saving every folder first
- `d19184f` 252: Stage G runs aftercare, the blind-test scratch is named, the contract lists it
- `91f9b9e` 252: Stage G names each flagged folder for the user
- `1fe0d34` 252: format the command and its tests

`scripts/aftercare.ts` alone, with no `.sh` wrapper, run as
`bun --no-env-file --config=/dev/null <tool>/scripts/aftercare.ts <dispatch> [--dry-run]
[--json] [--comment <text>] [--run-log <text>]` from the live checkout of the tool. It
derives the run's folders from the records plus every `<TICKET>-` entry of the project's
`.worktrees` (so the blind-test scratches go too), checks readiness (stage shipped or done on
a rerun, the last leg exited, the style findings sorted), saves each folder's leftovers into
`<dispatch>/stray/` (status, diffs, untracked files as a tar, commits no branch holds as
patches), flags saved work no branch's commits have, closes the folder's windows through
`host.sh close` before removing it, leaves a folder it cannot clean in place and named while
the rest go on, stops the preview's recorded process group first, sweeps the run's spaces
with `host.sh close-run`, and only once every folder is gone writes the run-log line, moves
the ticket to done (leaving a cancelled ticket as it is) and posts the closing comment
through the tracker adapter, marks the run done and releases the pin. Every action goes
through `log-action.sh` the moment it happens; a refusal writes nothing; every stop prints a
line naming the step and a line saying what to do next; the summary is plain lines or, with
`--json`, one record.

- `scripts/aftercare.test.ts` — six tests beside the command on a built record, each count
  with a control: foreign worktrees kept, a refusal that changes nothing, dry run versus
  missing words, flagged versus a branch's content, the JSON shape, a rerun that repeats
  nothing. herdr and tmux are stubs on `PATH`; host state lives under the temp folder.
- `scripts/host.ts` — `main()` guarded by `import.meta.main`, and `runWorktreePaths`,
  `dispatchInfo` and the launch-registry readers exported, so the folder derivation has one
  implementation and `host.sh`'s behaviour is unchanged (its self-tests pass; every
  At-the-base comparison runs against it).
- `skills/postmaster/postmaster.md` — Stage G (contract 2) becomes the judgment steps (the
  style sort, the closing words) plus the command as a dry run and then for real, with
  exit 2/3 handled by doing the step it prints and running it again, flagged folders and
  faults put to the user; the merge confirmation and the hand `host.sh close-run`,
  `git worktree remove` and `stage.sh <dispatch> done` steps are gone; tool faults, style
  proposals and archiving threads stay.
- `skills/postmaster/coachman.md` — the blind-test scratch is named
  `<repo>/.worktrees/<TICKET>-oracle-<lane>` in the harvest step and in the table of where
  things live.
- `skills/postmaster/controls.md` — the command listed as a check.
- `docs/coachman-contract.toml` — `scripts/aftercare.ts` added to the contract's file list.

## Checks

`/home/brindlewick/.postmaster/tool-pins/93d8b86215075f3b3a3391287a8f607805953edc/scripts/verify.sh run .`
→ exit 2 (`.postmaster/verify/verify-run.txt`):

- `gate` (`bun run check`) → fail, exit 1, 1038s: 2716 of 2717 tests pass; the one failure is
  `scripts/probe-confine.test.ts > a bwrap is vetted only on a root-owned chain`, which needs
  uid-0 system files while this environment maps them to uid 65534. It fails identically at
  the base tool, so it is not this change's (control: `.postmaster/verify/gate-env-control.txt`;
  log: `.postmaster/verify/logs/gate.log`). tsc, Oxlint, Biome, `skill-refs.sh` and
  `wiki-lint.sh` in the same run all pass.
- `coachman-contract` (`scripts/coachman-contract.sh --self-test`) → pass, exit 0, 8s:
  34 passed, 0 failed (log: `.postmaster/verify/logs/coachman-contract.log`).

Other commands, with exits:

- `bun test scripts/aftercare.test.ts` → exit 0, 6 pass, 0 fail
  (`.postmaster/verify/aftercare-test.txt`).
- `bash .postmaster/verify/cN.sh` for N = 1 … 17, the criterion loop's final pass on the
  final code → 140 PASS lines across the seventeen transcripts, none FAIL
  (`.postmaster/verify/checks-summary.txt`).
- `scripts/skill-refs.sh` → exit 0 (also inside the gate, and inside `c16.txt`).
- `bun --no-env-file --config=/dev/null <tool>/scripts/summary-evidence.ts
  WORKHORSE-SUMMARY.md .` → exit 0 (`.postmaster/verify/summary-evidence.txt`).

## Evidence

1. `.postmaster/verify/c1.txt`
2. `.postmaster/verify/c2.txt`
3. `.postmaster/verify/c3.txt`
4. `.postmaster/verify/c4.txt`
5. `.postmaster/verify/c5.txt`
6. `.postmaster/verify/c6.txt`
7. `.postmaster/verify/c7.txt`
8. `.postmaster/verify/c8.txt`
9. `.postmaster/verify/c9.txt`
10. `.postmaster/verify/c10.txt`
11. `.postmaster/verify/c11.txt`
12. `.postmaster/verify/c12.txt`
13. `.postmaster/verify/c13.txt`
14. `.postmaster/verify/c14.txt`
15. `.postmaster/verify/c15.txt`
16. `.postmaster/verify/c16.txt`
17. `.postmaster/verify/c17.txt`
    - the fixture run itself is dispatched and scored by the coachman on the synthesis, which
      a workhorse cannot dispatch; `c17.txt` runs the command end to end on a realistic run
      record of my own making and shows the states the fixture's after-merge steps leave.
    - `.postmaster/verify/summary-evidence.txt` — this summary's own evidence check, 17
      criteria, exit 0.

## Within-brief questions I decided for myself

1. **Folder order: classify, close, save, flag, remove.** C14's "only `7-sol`'s save, close
   and removal" on the rerun follows only if a folder left by a failing close is not saved
   until a later run; a folder saved and then left by a failing removal is not saved again,
   which is what the technical note about an unchanged save describes.
2. **Host's helpers are exported, not ported.** `host.ts`'s `main()` sits behind
   `import.meta.main` and aftercare imports `runWorktreePaths` and the registry readers, so
   the folder derivation has one implementation (design rule 3). `host.sh`'s CLI behaviour is
   unchanged; its self-tests and every base comparison pass.
3. **Logging is exactly C13's enumeration**: the style-sort note, a note per folder that
   saved something, a note per folder left and why, one `teardown` per folder removed
   (carrying the flag and its files), the run-log note, `ticket-state` when changed,
   `ticket-comment`, the `stage done` line `stage.sh` writes, and the pin's `teardown`.
   Closing a folder, `close-run` and the preview stop add no log line, because C13's list of
   what C1's run gains does not name them; all three are in the summary.
4. **Stop lines go to stderr in both output modes** (C15: "the stop lines still go to
   stderr"); the plain summary or the one JSON object goes to stdout.
5. **Closing words are required while any closing step remains** (stage not `done`, or no
   closing comment in the record); a fully done rerun needs none.
6. **The folder list is the records' folders ∪ `<TICKET>-` entries ∪ paths this command
   already logged as removed**, so a rerun shows a removed blind-test scratch as
   `already removed`, while a records-named folder that never existed (`7-rev-bug-mimo`) is
   never listed.
7. **A preview pid no launch record names is never signalled.** The synthesis folder is left
   in place, the rest are cleaned, the command stops with 3 — "a preview that outlives its
   stop leaves the synthesis folder in place".
8. **C1's "At the base" close-run line was measured at ede70e2, before #227.** The dispatch
   base `93d8b86` holds #227's fix, as D14 directed, where `host.sh close-run $D` on record R
   exits 0 with its three folder lines; `c1.txt` shows that actual result with the note. The
   base still has no such command, and its hand route still refuses the dirty folders
   (`c5.txt`).

## What I did not do, and why

- **The fixture run of C17**: a workhorse cannot dispatch a fixture run; `c17.txt` runs the
  command end to end on a realistic record of my own making — dry run, real run, then no
  worktree named for the ticket and the pin released — and says so. The fixture run from this
  branch's final head is the coachman's check on the synthesis.
- **The wiki** is untouched: lanes do not read it and no claim there is mine to make.
- **README's script list** does not gain the command: no check reads that list, and the
  command is invoked by the runbook rather than by hand.

## Verdicts

1. met — `c1.txt` (with `c17.txt`): one command takes the landed run to done in place of
   the hand steps.
2. met — `c2.txt`: stage, leg and style stops, exit 2, R unchanged, reason named.
3. met — `c3.txt`: the dry run lists the steps in order with each folder and its would-save,
   changes nothing; without words exit 1.
4. met — `c4.txt`: five folders cleaned (clone scratch included), foreign worktrees untouched,
   a plain folder left and named; the scratch named in `coachman.md`.
5. met — `c5.txt`: status, staged diff that applies, tar of exactly the three untracked
   files, commit patch that `git am` takes; nothing for `7` or `7-mimo`, no empty file, no
   `node_modules`; the base's `git worktree remove` refusals shown.
6. met — `c6.txt`: `export const a = 9;` flags `src/a.ts`, the other three variants do not.
7. met — `c7.txt`: with `probe` running the folder stays, the launch still runs, the output
   names both, the rest are cleaned; after `host.sh stop` the rerun finishes.
8. met — `c8.txt`: the recorded preview's group is stopped with the folder removed; no pid
   file means no stop step; an unrecorded pid is never signalled and the process still runs.
9. met — `c9.txt`: each closing word once, still once on a rerun.
10. met — `c10.txt`: the closing lines follow the last folder's teardown; after a stop
    nothing closing has happened and the pin remains.
11. met — `c11.txt`: the pin and claims gone with a `teardown` naming the pin; a second
    claiming run keeps it and the summary says so.
12. met — `c12.txt`: every stop prints its step and its next step, with exits 2, 1, 3, 3, 1,
    1, 3 and 3, and the base controls shown.
13. met — `c13.txt`: actions and ledger gain the same eleven lines in order, actor
    `postmaster`; the flag and the left-folder note carried; dry run and refusals add none.
14. met — `c14.txt`: a rerun changes nothing and shows every step already done; after a stop
    the rerun does only `7-sol`'s save, close and removal, then the closing steps, with no
    second teardown for another folder.
15. met — `c15.txt`: `--json` is one object with the six keys and the folder/step fields,
    `dry_run` true on the dry run, the flag named on C6's run, `stopped` and a `next` on
    C7's, stop lines still on stderr.
16. met — `c16.txt`: Stage G carries the judgment steps and the command and none of the hand
    steps, keeps tool faults, style proposals and archiving; the contract lists the command;
    `controls.md` lists it as a check; `skill-refs.sh` exits 0; the contract detector answers
    1 for `40d50ce` … final head.
17. met as far as a workhorse can show it — `c17.txt`: the command end to end on a realistic
    record, leaving no worktree named for the ticket and a released pin; the fixture run from
    this branch's final head stays the coachman's check.
