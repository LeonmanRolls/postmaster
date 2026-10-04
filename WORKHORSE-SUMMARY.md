# Workhorse summary: #237 — a lane that hits a provider limit pauses its run and tells the user at once

## What was built, as the commits on the branch

- `177b416` Carry the run's approved spec for #237 (the planning stage's record)
- `9a5af93` Record a provider wall as the launch ends, and give walls a command surface —
  `scripts/launch.ts` reads the turn's last error record per harness (codex `turn.failed`,
  claude `result`+`is_error`, mimo `error` event, muse `run.terminal.failed`; grok/agy/pi
  never), tests its first line with the one token list, and writes the `wall` line before
  the marker lands; `scripts/log-action.ts` gains `wall`, `told` and `carry`;
  `scripts/walls.ts` + `walls.sh` (show, open, told, rule, escalate, carry) with
  `scripts/lib/wall.ts`'s reset parser (D4/D5); `runs-status.ts` gains `WALL` and the
  paused-above-INSPECT rule; `runs-watch.ts` gates DISPATCH on `walls.sh open` and
  delivers a fully-ruled wall pause itself; `review-round.ts` records a walled reviewer
  DEGRADED with `provider wall: "<message>"`; the runbooks (coachman.md, postmaster.md,
  harnesses.md) and `docs/coachman-contract.toml` carry the flow.
- `aa90a70` Test the wall record, the status, the watcher steps and the review round —
  `scripts/walls.test.ts` plus additions to `runs-status`, `runs-watch`, `review-round`
  tests.
- `4847896` Record the watcher's wall steps in its header
- `dae1fe6` Fix the walls usage test's empty argument list
- `1bca810` Drop the unused launch clock capture
- `4ac6f4a` Keep the wall tests beside launch.ts — the guard rule (test beside its target)
  folded the launch-wall tests into `scripts/launch.test.ts`
- `dfa45c5` The coachman never rules a wall; the fixture brief line says who does — found
  live in the first fixture attempt: the coachman read the brief's wall-ruling line as its
  own instruction and ruled, skipping the pause; coachman.md now forbids it (D1) and the
  fixture brief line names the postmaster as the ruler (D7)
- `d4b3014` Read the reset with ASCII classes, as the text guard requires — the project's
  text guard bans hand-written `\d \s \b \S` and unmarked `toLowerCase`, so the reset
  patterns use ASCII classes and boundary groups
- `07ce1a0` Name the wait form as the reset forms name it — harnesses.md's reset paragraph
  says `in N minutes|hours`, as the technical notes phrase it

## Checks

The run's recorded checks, through the pinned tool, run just before this summary was
written (transcript: `.postmaster/verify/verify-final.txt`, gate log:
`.postmaster/verify/logs/gate.log`):

```
$ /home/brindlewick/.postmaster/tool-pins/40d50ce0cac2952e98c434cb1b705e5f29082045/scripts/verify.sh run .
gate: fail, exit 1, 1050s: bun run check
  error: script "check" exited with code 1
  log: /home/brindlewick/postmaster/.worktrees/237-mimo/.postmaster/verify/logs/gate.log
coachman-contract: pass, exit 0, 7s: scripts/coachman-contract.sh --self-test
<exit 2>
```

- `gate` — command `bun run check`, exit **1**: tsc, oxlint and the Biome format check
  pass, the suite reports **2766 pass, 1 fail**, and that one failure is
  `scripts/probe-confine.test.ts` "a bwrap is vetted only on a root-owned chain", which
  fails identically at the base pin 40d50ce and on the main checkout because this
  namespace owns `/` by uid 65534; it is pre-existing and environmental, not introduced
  here (`.postmaster/verify/gate.txt`; no env declaration can satisfy it — the override
  makes the test's next assertion fail instead, `.postmaster/verify/gate-declared.txt`).
  The gate chain aborts at `bun test`, so its last two stages were run alone, below.
- `coachman-contract` — command `scripts/coachman-contract.sh --self-test`, exit **0**
  (34 passed, 0 failed; `.postmaster/verify/contract-selftest.txt`).

Every other command run for this ticket, with its exit:

- `bash .postmaster/verify/checks/launch.sh` → 0 (c01–c04 PASS)
- `bash .postmaster/verify/checks/status.sh` → 0 (c05–c10 PASS)
- `bash .postmaster/verify/checks/round.sh` → 0 (c11, c12, c21 PASS)
- `bash .postmaster/verify/checks/walls.sh` → 0 (c13–c20 PASS)
- `scripts/skill-refs.sh` → 0 (`.postmaster/verify/skill-refs.txt`)
- `scripts/wiki-lint.sh` → 0 (`.postmaster/verify/wiki-lint.txt`)
- `scripts/fixture.sh score <fixture dispatch> <fixture repo>` → 0 (in `.postmaster/verify/c22.txt`)
- `bun run check` plain → 1 (`.postmaster/verify/gate.txt`), the one environmental failure above
- `POSTMASTER_PROBE_BWRAP_SECURE=1 bun run check` → 1 (`.postmaster/verify/gate-declared.txt`):
  the declaration satisfies the first assertion of that same test and breaks its second
- `scripts/coachman-contract.sh 40d50ce HEAD` → 1 (contract change: docs list, walls.sh,
  walls.ts, coachman.md, postmaster.md — which is why criterion 22's fixture run was required)


## Evidence

Every transcript holds the command, its output and its exit; every path is worktree-relative
under `.postmaster/verify/`. All of them come from the loop's last pass on the final code
(commit `07ce1a0`), run by `.postmaster/verify/checks/{launch,status,round,walls}.sh`
(drivers kept with the run's record).

1. `.postmaster/verify/c01.txt`
2. `.postmaster/verify/c02.txt`
3. `.postmaster/verify/c03.txt`
4. `.postmaster/verify/c04.txt`
5. `.postmaster/verify/c05.txt`
6. `.postmaster/verify/c06.txt`
7. `.postmaster/verify/c07.txt`
8. `.postmaster/verify/c08.txt`
9. `.postmaster/verify/c09.txt`
10. `.postmaster/verify/c10.txt`
11. `.postmaster/verify/c11.txt`
12. `.postmaster/verify/c12.txt`
13. `.postmaster/verify/c13.txt`
    - `.postmaster/verify/c20.txt` (the harvest runs carry with no escalation when the ruling is early)
14. `.postmaster/verify/c14.txt`
15. `.postmaster/verify/c15.txt`
16. `.postmaster/verify/c16.txt`
17. `.postmaster/verify/c17.txt`
18. `.postmaster/verify/c18.txt`
19. `.postmaster/verify/c19.txt`
20. `.postmaster/verify/c20.txt`
21. `.postmaster/verify/c21.txt`
22. `.postmaster/verify/c22.txt`
    - `.postmaster/verify/skill-refs.txt` (C22: scripts/skill-refs.sh exit 0)
    - `.postmaster/verify/gate.txt` (C22: bun run check — see the verdict: one
      pre-existing environmental failure, reproduced at the base pin and on main)
    - `.postmaster/verify/contract-selftest.txt` (the run's other recorded check)

The unit controls for the same behaviour run under the gate: `scripts/walls.test.ts` (33),
the wall additions in `scripts/launch.test.ts` (+12), `scripts/runs-status.test.ts` (+6),
`scripts/runs-watch.test.ts` (+5), `scripts/review-round.test.ts` (+1).

This summary's own evidence shape, checked after it was written:
`.postmaster/verify/summary-evidence.txt` (exit 0, evidence shape holds for 22 criteria).

## Within-brief questions I decided

- **The `wall` line's shape**: actor `lane:<lane>`, target the lane, detail
  `<role> <lens> <round> <reset> <first line>`; a reviewer's lens and round come from its
  stream's `review-r<round>-<lens>-<lane>.jsonl` name, which is the coachman's own naming.
- **`told`, `rule` and `carry` are new log-action verbs** beside `wall`; wall rulings are
  `rule` lines whose detail opens `wall go-on`, so they cannot collide with a conventional
  divergence rule.
- **A `.wall-pause` marker** (written by `walls.sh escalate`) distinguishes a wall pause
  from any other escalation, so the watcher delivers only wall pauses and a later ordinary
  escalation still wakes the postmaster.
- **`POSTMASTER_CLOCK`** (epoch ms) is the tests' clock for the reset's today/tomorrow
  rule; the production clock is the machine's.
- **The reset parser lives in `scripts/lib/wall.ts`**, not in `walls.ts`, so launch.sh's
  bypass-mutation test copies (which symlink only `lib/`) keep resolving — the parser is
  still exercised by `walls.test.ts` and by the launch step checks.
- **A workhorse is "still able to produce work"** for the go-on refusal when: its events
  stream exists and its marker has not landed (running), its worktree holds a
  `WORKHORSE-SUMMARY.md`/`WORKHORSE-BLOCKED.md` (delivered), or it has a wall with no
  ruling — exactly D19's three conditions, read from the run's own files.
- **A walled workhorse's DEGRADED binds to its `wall` + `carry` lines** at landing (the
  reviewer's binds to its `degrade` line); the `wall` line is this ticket's record and
  carries lane, message and reset, which `degrade` would only repeat.
- **The first fixture attempt (todo-fixture-40) was redispatched as todo-fixture-41** when
  the coachman read the brief's wall-ruling line as its own instruction and ruled itself,
  skipping the pause. The runbook now forbids that (coachman.md) and the brief line names
  the postmaster; the abandoned attempt keeps its record (stage `abandoned`).
- **The check drivers live under `.postmaster/verify/checks/`** — `.postmaster/` is this
  repo's run record and is gitignored by design, so they are cited, not committed.

## What I did not do, and why

- **Rest, reset now and another lane**: the separate ticket (D6); `walls.sh rule` refuses
  them with exit 2 until it lands (shown in c18).
- **Reading grok, Antigravity and pi error records**: no recorded shape (D2, criterion 4);
  they are handled as today (c04).
- **The wiki**: this ticket does not ask for it; not read, not written.
- **A push or pull request**: workhorses never push; the coachman and postmaster take the
  branch from here.
- **Fixing `scripts/probe-confine.test.ts`'s root-owned-chain test**: it fails on this
  machine for a reason outside this ticket — `/` and `/usr` are owned by uid 65534 in this
  namespace, so the chain check can never see uid 0 — and it fails identically at the base
  pin 40d50ce and on the main checkout (8157c7a). Neither running plain nor declaring
  `POSTMASTER_PROBE_BWRAP_SECURE=1` can satisfy it: the declaration makes the very next
  assertion (a missing path must be refused) fail instead. Evidence:
  `.postmaster/verify/gate.txt` and the note in this session's `notes.md`.

## Verdict on each acceptance criterion

1. Met — a workhorse (codex), a reviewer (claude), and a mimo workhorse ending on their
   provider's limit each record one `wall` line before the marker lands.
2. Met — lane, role (reviewer's with lens and round), first line byte for byte, and the
   reset in every form D4/D5 names.
3. Met — 504, 401, failed command/tool output, prose, stop, and a delivered summary record
   nothing.
4. Met — grok's limit message records nothing and the lane ends as today.
5. Met — the watcher names every run with a new wall once; the WALL step tells once.
6. Met — show names run, lane, role, message, reset with its date; two zones show their
   own dates; the runbook step says so.
7. Met — a held run's wall is never named; released, it is.
8. Met — WALL before busy-WAIT and before an older question; a newer question reads USER.
9. Met — the wall's question is written beside the one already waiting; both list.
10. Met — a wall-paused run reads WALL/USER/Rule, never the idle INSPECT.
11. Met — the round closes exit 0 with `provider wall: "<message>"` DEGRADED and degrade
    lines, no escalation (live in the fixture run too).
12. Met — the runbook keeps the restore rule; round 2 launches both stubs again.
13. Met — the harvest waits for every marker, escalates on exit 1 from open, exits with no
    checkpoint-1.md; non-wall endings keep the remount path; carry proceeds when ruled
    (all shown, and live in the fixture run).
14. Met — the watcher dispatches no leg while a wall is open and names the run; Stage 3
    escalates before card.md; Stage F lands nothing (live: both pauses).
15. Met — `walls.sh rule ... go-on` works while the leg runs and during the pause, for
    workhorse and reviewer walls; the runbook turns plain words into it.
16. Met — ruled go-on: the run continues without the lane; the cards carry
    `lane: DEGRADED, provider wall: "<message>"` (live on both fixture cards).
17. Met — words that fit no ruling: the postmaster asks again and records nothing.
18. Met — refused rulings exit 2 with the reason, record nothing, leave the run paused.
19. Met — go-on for the last workhorse that could still produce work is refused.
20. Met — early ruling: the harvest carries with no escalation; during the pause: the
    watcher resumes at its next look with `the watcher took it` (live, twice).
21. Met — a second wall is a new wall: untold, WALL again, open exit 1 until ruled.
22. Met in every part the ticket names — fixture run from this branch, workhorse wall and
    bug-reviewer wall, both ruled go on by the run's postmaster, the leg stopped before
    synthesis with no checkpoint-1.md until the ruling, nothing landed before the reviewer's
    ruling, both cards DEGRADED with the message, two walls + two told + the two rulings in
    actions.jsonl, `fixture.sh score` exit 0, `scripts/skill-refs.sh` exit 0 —
    **except** its final `bun run check exit 0` clause: the plain gate exits 1 on one
    pre-existing environmental test (probe-confine's root-owned chain), which fails the
    same way at the base pin and on main and cannot be satisfied on this machine; every
    other gate stage (tsc, oxlint, biome, the other 2766 tests, skill-refs, wiki-lint)
    passes. Evidence: `.postmaster/verify/gate.txt`, `.postmaster/verify/c22.txt`.
