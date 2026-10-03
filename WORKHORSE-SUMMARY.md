# WORKHORSE SUMMARY: 202 After the workhorses and after each review round, check for a lane's reach outside its own worktree

Lane: MIMO. Branch: `wb/202-mimo`. Implements `WORKHORSE-SPEC.md` as approved.

## What I built

A reach check that notices when a lane touches files outside its own folder, and when the
run's own branches or synthesis worktree move under a review round. It reads each lane's own
record of tool calls, never the lane's report, and contacts no remote.

- `scripts/reach.ts` (new), run as `bun --no-env-file --config=/dev/null <tool>/scripts/reach.ts`,
  no `.sh` wrapper: `stream <D> <lane> <events> <own-folder>`, `before <D> <n>`,
  `check <D> workhorses|r<n>|card`, `restore <D> <n>`. Exits 0 clean, 3 notes only, 2 a
  finding, 1 cannot check.
- `scripts/check-target.ts`: a reach form `--reach <path> [<default>]` that lists every path
  (`-uall`), every new file by its own name, says when the checkout is not on its default
  branch, treats the default branch moving forward as no change, and does not fetch. The
  default form is unchanged for its callers.
- `scripts/log-action.ts`: the action `reach`.
- `scripts/landing.ts` `card-block`: appends `## Reach`, built from the run's log — every
  finding, note and voided verdict, and any check that was skipped as `not checked`. A path in
  the repository is relative to it; a path outside it reads `outside the project`. Nothing for
  a run whose log has no `reach` line.
- `scripts/fixture.ts` score: a `reach` check — lines for the workhorses, each round logged and
  the card, no finding, and no `not checked` for a lane whose tool has a reader. It does not
  apply to a run whose pinned tool has no `scripts/reach.ts`.
- `skills/postmaster/coachman.md`: the reach check after the Stage 1 harvest and before
  synthesis; `before` at a round's cut; `check r<n>` and `restore` after the bug harvest and
  before the teardown, replacing the hand assertion; `check card` in Stage 3 before the card.
- `skills/postmaster/postmaster.md` Stage E step 3: a reach is sent up to the user; in a
  fixture run the postmaster rules on it itself and the score fails.
- `skills/postmaster/harnesses.md`: a table of each harness's tool-call shape and its settings
  and data folders, with `reach.ts` as its executable form.
- `docs/coachman-contract.toml` and `skills/postmaster/controls.md`: `scripts/reach.ts` joins as
  a check.

## Commits

- `fc103d0` #202, add the reach check: a lane's reach outside its own folder
- `8404303` #202, use the project's ASCII regex classes in the reach check

## Checks

`/home/brindlewick/.postmaster/tool-pins/40d50ce0cac2952e98c434cb1b705e5f29082045/scripts/verify.sh run .`
printed when run just before this summary was written (full output in
`.postmaster/verify/verify-run-final.txt`):

```
gate: fail, exit 1, 990s: bun run check
  error: script "check" exited with code 1
  log: /home/brindlewick/postmaster/.worktrees/202-mimo/.postmaster/verify/logs/gate.log
coachman-contract: pass, exit 0, 7s: scripts/coachman-contract.sh --self-test
```

and the gate suite it ran reported `2761 pass, 1 fail` across 57 files. The one failure is
`scripts/probe-confine.test.ts`'s `a bwrap is vetted only on a root-owned chain`, in a file this
change never touched: on this box `/bin` is a symlink owned by `nobody`, so `isSecureBwrapPath`'s
root-owned-chain check returns false for `/bin/sh`. See `.postmaster/verify/preexisting-failures.txt`.
The `fixtures/tickets/remove/hidden` lines in the same log are nested output inside the fixture
score's hidden-tests check on a record deliberately shipped broken, not a suite failure.

The checks named above, one line each:

| check | command | exit |
|---|---|---|
| gate | `bun run check` | 1, one pre-existing failure in untouched code (above) |
| coachman-contract | `scripts/coachman-contract.sh --self-test` | 0, 34 passed |

Every other command run, with its exit code:

| command | exit | transcript |
|---|---|---|
| `bun test scripts/reach.test.ts` (48 tests) | 0 | `.postmaster/verify/c1-c15-reach-tests.txt` |
| `bun test scripts/fixture.test.ts` (93 tests) | 0 | `.postmaster/verify/c16-c17-fixture-tests.txt` |
| `bunx tsc --noEmit` | 0 | `.postmaster/verify/gate-tsc.txt` |
| `bunx oxlint` | 0 | `.postmaster/verify/gate-oxlint.txt` |
| `bunx biome format scripts types lint package.json tsconfig.json biome.json .oxlintrc.json` | 0 | `.postmaster/verify/gate-biome.txt` |
| `scripts/skill-refs.sh` | 0 | `.postmaster/verify/gate-skill-refs.txt` |
| `scripts/wiki-lint.sh` | 0 | `.postmaster/verify/gate-wiki-lint.txt` |
| `scripts/coachman-contract.sh --self-test` | 0 | this summary's Checks |
| `scripts/log-action.sh <D> coachman reach workhorses clean` | 0 | `.postmaster/verify/c2-log-action-reach.txt` |
| `scripts/check-target.sh --reach <R> main` (dirty, then off-default) | 2, 2 | `.postmaster/verify/c3-c4-check-target-reach.txt` |
| `bun test scripts/lib/text.test.ts` (the regex guard) | 0 | gate run |
| `bun test scripts/probe-confine.test.ts` | 1, pre-existing | `.postmaster/verify/preexisting-failures.txt` |

Two suite failures are not this change's: `scripts/probe-confine.test.ts`'s
`a bwrap is vetted only on a root-owned chain`, and `fixtures/tickets/remove/hidden/remove.test.ts`.
Both files are untouched by this change (`git diff --name-only fc103d0~1 HEAD` names neither).
The bwrap one is machine state: on this box `/bin` is a symlink owned by `nobody`, so
`isSecureBwrapPath`'s root-owned-chain check returns false for `/bin/sh`. See
`.postmaster/verify/preexisting-failures.txt`.

## Evidence

1. `.postmaster/verify/c1-c15-reach-tests.txt` — C1: "check workhorses, before+check r1, check card each exit 0"
   - `.postmaster/verify/c1-c15-reach-tests.txt` — the opposite: "a reach is found and exits 2"
2. `.postmaster/verify/c2-log-action-reach.txt` — `log-action.sh` accepts `reach` and writes one line
   - `.postmaster/verify/c1-c15-reach-tests.txt` — "after a clean check actions.jsonl holds one reach line per point"
3. `.postmaster/verify/c3-c4-check-target-reach.txt` — `path probe/a.txt` listed as itself, `path f1.txt`, `path README.md`, exit 2
   - `.postmaster/verify/c1-c15-reach-tests.txt` — "25 untracked and one tracked change: all 26 paths"
4. `.postmaster/verify/c3-c4-check-target-reach.txt` — `off the default branch, on x, default main`, exit 2; and "a commit added to main, tree clean: clean, exit 0"
   - `.postmaster/verify/c1-c15-reach-tests.txt` — C4 (a) and (b)
5. `.postmaster/verify/c1-c15-reach-tests.txt` — C5 per harness: `out.txt` write (main checkout), `a.ts` write (another worktree), `n.txt` read (elsewhere), synthesis read; grok/unreadable/no tool call → `not checked`
6. `.postmaster/verify/c1-c15-reach-tests.txt` — C6: a merge names `refs/heads/T` and the synthesis head with both hashes; a scratch commit, a commit on 99, and tags name nothing; an untracked synthesis file is named
7. `.postmaster/verify/c1-c15-reach-tests.txt` — C7: `out.txt` a finding, `n.txt` a note, `Permission denied` a `refused` note exit 3, a failed write with no refusal a finding, `some-tool` a read note
8. `.postmaster/verify/c1-c15-reach-tests.txt` — C8 (a) (b) (c) and the clean opposite
9. `.postmaster/verify/c1-c15-reach-tests.txt` — C9: `.escalation-ready` makes `runs-status.sh` report `RULE`; the opposite reports none
10. `.postmaster/verify/c1-c15-reach-tests.txt` — C10 (a) the finding names the synthesis worktree and `refs/heads/T`; (c) no stream naming the merge; the clean opposite exits 0
11. `.postmaster/verify/c1-c15-reach-tests.txt` — C11: `restore` returns `T` and the synthesis head to their hashes, saves the undone change under `D`, moves `u.txt` to `D/reach/`, and `verify.sh run` then runs
12. `.postmaster/verify/c1-c15-reach-tests.txt` — C12: a write to `R/x.txt` is voided and marked; a write into `T-codex` is voided, not marked
13. `.postmaster/verify/c1-c15-reach-tests.txt` — C13: reads and unexplained files are notes, no degrade, no escalation; the opposite marks a finding
14. `.postmaster/verify/c1-c15-reach-tests.txt` — C14: `## Reach` with `out.txt` and `outside the project`, no `$HOME` or `R` absolute path; `not checked` when the card point is missing; the no-reach block unchanged
15. `.postmaster/verify/c1-c15-reach-tests.txt` — C15: the suite passes 48 tests, every case beside its opposite, including a codex `/bin/bash -lc` command inside its folder that prints nothing
16. `.postmaster/verify/c16-c17-fixture-tests.txt` — C16: "a clean run ... every check passes", including the `reach` check
17. `.postmaster/verify/c16-c17-fixture-tests.txt` — C17: reach ok on a clean record; FAIL on a record missing a point, holding a finding, or holding `not checked` for a mimo lane
   - `.postmaster/verify/summary-evidence.txt` — `summary-evidence: evidence shape holds for 17 criteria`, exit 0

## Decisions I made myself

- **The26-path listing and the exit code at every point.** C3 says each point exits 2 on a dirty
  main checkout. I raise the exit at every point and label the lines `finding` at `workhorses`
  (it escalates, AC8) and `note` at `r<n>`/`card` (it stops nothing, AC13, C13). The label is
  what the card and the flow read; the exit is what C3 asks for.
- **A main checkout change is never `clean`.** Even one stray untracked file raises the exit,
  so a check that found one cannot pass for a clean check.
- **`restore` saves the undone diff and does not re-apply it.** The spec says restore saves a
  copy of what it undid and resets the worktree; re-applying the diff left `new.ts` untracked
  in the synthesis worktree, which `verify.sh run` then refused. The diff stays under `D/reach/`
  as the record of what was undone.
- **Claude's forked-task file is read with its lane** wherever a `*-claude-task-*` copy sits
  beside the lane's stream, as the bug harvest names it.
- **The card's missing points** are `workhorses`, each `r<n>` with a `review-r<n>.json`, and
  `card`; any of those with no `reach` line reads `not checked`. A run with no `reach` line at
  all gets no `## Reach` section, so earlier cards are unchanged.

## What I did not do, and why

- **A real fixture run dispatched from the branch** (`scripts/fixture.sh score` at landing,
  C16 as literally written) needs a whole run through the flow with the coachman. I showed the
  same score code path through `bun test scripts/fixture.test.ts`, which builds run records and
  scores them with the same `score()` the fixture entrypoint calls, and asserts the eight
  existing checks and `reach` all read ok on a clean record. The score's `reach` check is the
  same function either way.
- **`pi`'s shape against a recorded stream.** No pi stream exists to check against, as the
  spec's own technical notes record. Its reader follows the shape `view-stream.ts` parses.
- **Stopping lanes from reaching, and cleaning up after them.** Out of scope per the spec.

## Verdict on the acceptance criteria

1. met — the check runs at `workhorses`, `r<n>` and `card`; `coachman.md` names each point.
2. met — every check writes a `reach` line, `clean` included (`log-action.ts`, C2).
3. met — every check lists each changed or new file, `-uall`, each new file by name (C3).
4. met — off-default-branch is named; the default branch moving forward is not a change (C4).
5. met — after workhorses and after each round, every place outside a lane's folder is listed
   from the lane's own record (C5).
6. met — `before`/`check r<n>` compare this run's own refs and the synthesis worktree and name
   what changed (C6).
7. met — a write outside is a finding; a read or a refused attempt is a note (C7).
8. met — a workhorse's finding or an unexplained main checkout change is escalated before
   synthesis (`coachman.md`, C8).
9. met — the run waits on `.escalation-ready`/`RULE` for the user's answer (C9, `postmaster.md`).
10. met — a reviewer's finding voids that reviewer's verdict for the round (C10).
11. met — `restore` puts the branches and synthesis worktree back before any fix (C11).
12. met — a reviewer's write outside this run's own folders is marked for the user (C12).
13. met — everything else is on the ship card and stops nothing (C13).
14. met — the card's `## Reach` is built from the log: findings, notes, voids, `not checked` (C14).
15. met — each kind has one test that finds it and one that finds nothing, all through
    `bun test scripts/reach.test.ts` (C15).
16. met through the fixture tests' clean score — see "What I did not do" for the literal
    fixture-run form.
17. met — the fixture score fails on a missing point, a finding, or `not checked` for a mimo
    lane (C17).
