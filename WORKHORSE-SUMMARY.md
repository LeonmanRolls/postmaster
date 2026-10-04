# WORKHORSE-SUMMARY — 227 Teardown closes a run's spaces when its logs hold review findings lists

Branch `wb/227-mimo`.

## What I built

- `3441b47` `227: approved workhorse spec` — the run's approved spec (already on the branch).
- `cb49a62` `227: teardown reads only the round records and names what it refuses`
  - `scripts/host.ts` — `runWorktreePaths` selects the round records by their name
    (`REVIEW_ROUND_FILE`), so findings lists, usage records and any other file in
    `logs/` are no longer read as state (D1). The two silent `hostError("", 2)`
    refusals now carry one line each: a round record that is not a mapping names
    its resolved path, and an action-log line that is not a mapping names the
    resolved `actions.jsonl` path and `line N`, counted over every `pySplitLines`
    line (D2, D3). The first refusal still ends the function before anything is
    stopped or closed (D4). Every other skip and every pre-existing message is
    unchanged. `REVIEW_STATE_GLOB` and its `DOT_ALL` import went with the match
    they served.
  - `scripts/host-self-test.ts` — new section `teardown reads only the round
    records`, 16 controls over record R run through `execHost` with the self-test
    stub `herdr` and `tmux` (D6).
  - `scripts/host.test.ts` — the new section and the true control count, 337.
  - `skills/postmaster/hosts.md` — notes that the refusal names the record.

## Checks

What `/home/brindlewick/.postmaster/tool-pins/40d50ce0cac2952e98c434cb1b705e5f29082045/scripts/verify.sh run .`
printed, just before this summary was written:

```
gate: fail, exit 1, 1087s: bun run check
  error: script "check" exited with code 1
  log: /home/brindlewick/postmaster/.worktrees/227-mimo/.postmaster/verify/logs/gate.log
coachman-contract: pass, exit 0, 7s: scripts/coachman-contract.sh --self-test
```

One line per check named for this run:

- `gate` (`bun run check`) — exit 1. The suite reports 2710 pass, 1 fail. The one
  failure is `scripts/probe-confine.test.ts` › `a bwrap is vetted only on a
  root-owned chain`: `isSecureBwrapPath("/bin/sh")` returns false here because
  `/bin` and `/bin/sh` are owned by `nobody`, not `root`. That test and its
  subject are untouched on this branch (`git diff 40d50ce HEAD --name-only` lists
  only the four files above) and it fails the same way on a scratch copy with the
  base tree. Not this ticket.
- `coachman-contract` (`scripts/coachman-contract.sh --self-test`) — exit 0, 34
  passed, 0 failed.

Then, any other command run with its exit code:

- `bash .postmaster/verify/checks.sh` — exit 0 (C1 to C5, both teardown commands).
- `bun test scripts/host.test.ts` — exit 0, 34 pass, 0 fail.
- `bun test scripts/host.test.ts` on a scratch copy with the base `scripts/host.ts`
  — exit 1, 32 pass, 2 fail (the new section and the zero-failures assertion).
- `bun scripts/host-self-test.ts` section dump on that scratch copy — the 16 new
  controls: 5 ok, 11 FAIL.
- `bun test scripts/probe-confine.test.ts` — exit 1 (the pre-existing gate failure).
- `bun test scripts/probe-confine.test.ts` on the base scratch copy — exit 1, same.
- `bunx tsc --noEmit` — exit 0. `bunx oxlint` — exit 0 (warnings only, all
  pre-existing). `bunx biome format scripts types lint package.json tsconfig.json
  biome.json .oxlintrc.json` — exit 0.

## Evidence

1. `.postmaster/verify/c1-c5.txt`
2. `.postmaster/verify/c1-c5.txt`
3. `.postmaster/verify/c1-c5.txt`
4. `.postmaster/verify/c1-c5.txt`
5. `.postmaster/verify/c1-c5.txt`
6. `.postmaster/verify/c6-fixed.txt`
   - `.postmaster/verify/c6-base-scratch.txt`
   - `.postmaster/verify/c6-base-controls.txt`
   - `.postmaster/verify/c1-c5.txt`

`.postmaster/verify/checks.sh` is the script the C1 to C5 transcript is from;
`.postmaster/verify/repro-base.txt` is the refusal before the change, and
`.postmaster/verify/repro-after-fix.txt` the same record after it.
`.postmaster/verify/summary-evidence.txt` is `summary-evidence.ts` on this summary.

## Decisions I made within the brief

- **Message wording** (D2 and D3 leave it open): `run review record is not a
  mapping: <path>` and `run action log line is not a mapping: <path> line <n>`.
  One line each, printed as `host: <message>` like the other refusals, naming the
  resolved path the function already holds. `<path>` is spelled the way teardown
  spells the worktrees it lists.
- **Line counting** (D3): 1-based over every line `pySplitLines` yields, blank and
  unparseable ones included, so the number in the message is the number a reader
  sees in the file.
- **C3's controls also fail when the fix is taken out.** Check 3's own "At the
  base" line says so: record R carries the findings list, and the base aborts on
  it before it can demonstrate a skip. Check 6 names the controls for checks 1, 2
  and 4 as those that fail on the base copy; that holds (every control for 2 and 4
  fails, and the first two for 1). The third control for check 1, R without its
  `logs/` folder, passes on the base, which the check also says. No control that
  exists at the base fails on the base copy.
- **The first control is the reproduction** the implementation notes ask for: a
  record whose `logs/` holds a round record beside a findings list and a usage
  record. It is built as record R, which is that plus the notes list and the full
  directory set.
- **Worktree order in C1** is asserted as the exact sequence the function emits —
  lanes sorted, then reviewers sorted, then synthesis — not as a set.
- **`REVIEW_STATE_GLOB` and `DOT_ALL`** were removed with the match they served
  rather than left unused.
- **`hosts.md`** took the optional sentence the technical notes allow.

## What I did not do

- The two silent failures named in D5 (Herdr cannot list a space's panes; a
  damaged placement record leaves the run's spaces open) stay out of scope.
- No fixture run: the direction says this needs none.
- `coachman.md` and `postmaster.md` are contract files and are unchanged.
- `scripts/probe-confine.test.ts` and its root-ownership expectation are
  untouched. The gate's one failure is that test failing on this machine's
  `/bin` ownership; rewriting it would be a different ticket.

## Verdict

1. met — both teardown steps finish on R and cover exactly `227-mimo`, `227-sol`, `227-rev-bug-mimo` and `227`, whatever else is in `logs/`.
2. met — a round record that is not a mapping still stops teardown, on exit 2, and the message names the record's resolved path.
3. met — an unreadable or unusable round record, in whole or in part, is still passed over without a word, and so is an unusable action log.
4. met — an action-log line that is not a mapping still stops teardown, and the message names the log and `line 4`; lines it skips are still skipped.
5. met — `host: run waybill has no synthesis worktree`, `host: synthesis worktree is not under .worktrees` and `host: run lane records unreadable` still print word for word.
6. met — `bun test scripts/host.test.ts` covers 1 to 5, and the controls for what this ticket changes fail on a copy with the base `scripts/host.ts` while no pre-existing control does.
