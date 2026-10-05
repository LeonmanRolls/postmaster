# WORKHORSE-SUMMARY

## What I built

Commits on `wb/270-mimo`, oldest first:

1. `7f5bc3a` Record each run's dispatch mode and refuse a waybill that names another
2. `fed1ea0` State the bwrap vetting control by the machine's own ownership
3. `e134dd7` Spell out the boundary and staging rules for the acceptance tests
4. `1b7eda6` Name the workhorse branch the worktree is cut on
5. `3bacfa3` Account for the worktree shell block in the coachman block controls
6. `9792b04` Hold Stage F to a gate line for every review round
7. `1d0a234` Hold Stage F to the acceptance tests' boundary and their commit isolation
8. `dc4a564` Give the ship card one heading set and the stage line one writer
9. `b609cb2` Log each review launch in the launch block and keep both action logs append-only

What they do:

- **The setting and the record (C1–C5, D2–D4).** `setup` asks for `mode` beside `max_runs`
  (`synthesis` default, `single-thread`, `alternate`; anything else exits 1 naming the three)
  and writes it under `[team]`; `config.example.toml` documents it. `run-meta` resolves the
  mode at dispatch — the user's `--mode` (only `synthesis` or `single-thread`; anything else
  exits 1 naming those two) beats the setting; `alternate` flips against the project's latest
  run under the dispatch's parent by `run.json`'s `written` (a latest run with no mode counts
  as synthesis; a project with no run starts at single-thread) — and records `mode`,
  `mode_source` (`user`/`setting`) and `mode_setting` as top-level keys beside `confinement`.
  Its wrote-line ends `mode=<...>` so the postmaster's note carries the mode into
  `actions.jsonl`; the new `run-meta mode <dispatch>` verb prints the three values; a config
  whose `team.mode` is anything else refuses the dispatch naming the three.
- **The guard (C16).** `run-meta check` also compares the waybill Team section's `mode:` line
  with the record: both present and different fails naming both; a run with neither, or only
  one, passes, so pre-change dispatches are unaffected. Stage C and the watcher already run
  `check` before every leg, so a mismatched waybill stops the leg.
- **The runbooks (C6–C15).** `coachman.md` gains "The run's mode: synthesis or single-thread"
  (what single-thread skips, its leg-1 steps, the `SYNTHESIS: mode=single-thread` line, no
  mode in any reviewer-facing text) and "Acceptance tests, in every run" (boundary rule with
  browser/library/CLI forms and an anti-example; tests-first; a code commit never touches
  them — the formatter trap named; test changes in their own commit that says why; a check
  that cannot pass is an escalation naming it, never a changed test). Stage 0 cuts each
  workhorse worktree with `-b wb/<TICKET>-<lane>`; the review block logs `review-launch` per
  lane as it launches; the ship card gains `Mode:` and one ten-heading set; the audit-log
  section declares both action logs append-only. `postmaster.md` passes `--mode` when the
  user names one, pastes the `mode:` line into the waybill (and omits `workhorses:` in
  single-thread), refuses legs on a mode mismatch, and Stage F claims a `gate` line per
  review round, the acceptance tests' boundary and commit isolation, and an `actions.jsonl`
  still matching the ledger. `SKILL.md`'s waybill template carries the `mode:` line.
- **The score (C12, C17, D14).** `fixture score` gains a `mode` check beside
  `premises-order`: single-thread wants no coachman dispatch and no `refs/heads/wb/` branch;
  synthesis wants one dispatch and one `wb/<ticket>-<lane>` per configured workhorse; no mode
  reads as synthesis, an unknown one fails. The stages check skips `workhorses-running` only
  when `run.json` records single-thread. The fixture tests grew matching controls (a
  single-thread record built through `--mode`, its three tamper negatives, the synthesis
  negatives) and the score's line counts moved for the tenth check.
- **Necessary surroundings.** `probe-confine.test.ts`'s root-owned-chain control now states
  the rule against the machine's own ownership of `/` (it failed at the base commit in this
  container, where `/` is uid 65534 — proven at 393f263 before this change); `skill-refs.test.ts`
  counts the new twelfth shell block and its shifted block indices; `runs-watch`'s refusal
  message names the mode as a possible cause.

The evidence runs (both fixtures made by `scripts/run fixture new`, both scored clean):

- **Single-thread:** `~/Code/fixtures/270-single4`, dispatched from `9792b04`, merged as
  `9083695`, stage `done`.
- **Synthesis:** `~/Code/fixtures/270-synth4`, dispatched from `b609cb2`, merged as
  `2950486`, stage `done`.

Four earlier fixture runs were abandoned when the runbook let a coachman deviate; each
abandonment produced one of the commits above (v1 single: acceptance tests importing
`src/` and a formatter-folded commit; single2: no `gate` line per round; single3: an
acceptance test importing `USAGE` from `src/`; synth v1: worktrees cut without `-b`, so no
`wb/` branches; synth2: a hand-written second `stage done` line and a four-heading card;
synth3: a coachman that rewrote `actions.jsonl` in place). The final runs were dispatched
from the branch after those rules landed.

## Checks

Run just before this summary was written, on the final tree (`b609cb2`):

```
$ $TOOL/scripts/run verify run .
gate: pass, exit 0, 1426s: bun run check
coachman-contract: pass, exit 0, 8s: scripts/run coachman-contract --self-test
exit=0
```

Other commands run for this ticket, with their exits:

- `scripts/run fixture score <270-synth4 dispatch> <270-synth4>` → exit 0 (all ten checks ok)
- `scripts/run fixture score <270-single4 dispatch> <270-single4>` → exit 0 (all ten checks ok)
- `scripts/run fixture score` on each tampered copy (single: +dispatch line, +wb branch,
  +workhorses-running stage; synthesis: −dispatch lines, −workhorses-running stage) → exit 2,
  failing the named check
- `scripts/run coachman-contract --self-test` → exit 0 (34 passed; also inside verify run)
- `bun test scripts/fixture.test.ts` → exit 0 (108 pass)
- `bun test scripts/run-meta.test.ts` → exit 0 (118 pass)
- `bun test scripts/setup.test.ts` → exit 0 (37 pass)
- `bun test scripts/skill-refs.test.ts` → exit 0 (19 pass)
- `bun test scripts/probe-confine.test.ts` → exit 0 (16 pass, the ownership-stated control)
- `scripts/run skill-refs` → exit 0
- the runbook-statements sweep (`.postmaster/verify/runbook-statements.txt`) → exit 0,
  every named statement found on the final runbooks
- `.postmaster/verify/verify-run.txt` keeps the verify-run transcript above

## Evidence

1. `.postmaster/verify/c1-setup-mode-key.txt`
   - `.postmaster/verify/summary-evidence.txt`
   - `.postmaster/verify/verify-run.txt`
2. `.postmaster/verify/c2-c5-c16-run-meta-mode.txt`
   - the alternate setting's five cases are in the same transcript under `=== C3 ===`
3. `.postmaster/verify/c2-c5-c16-run-meta-mode.txt` (`=== C3 ===`)
4. `.postmaster/verify/c2-c5-c16-run-meta-mode.txt` (`=== C4 ===`)
5. `.postmaster/verify/c2-c5-c16-run-meta-mode.txt` (`=== C5 ===`)
6. `.postmaster/verify/c6-single.txt`
   - `.postmaster/verify/c6-synth.txt`
7. `.postmaster/verify/c7-single.txt`
   - `.postmaster/verify/c7-synth.txt`
8. `.postmaster/verify/c8-single.txt`
   - `.postmaster/verify/c8-synth.txt`
   - `.postmaster/verify/runbook-statements.txt`
9. `.postmaster/verify/c9-single.txt`
   - `.postmaster/verify/c9-synth.txt`
   - `.postmaster/verify/runbook-statements.txt`
10. `.postmaster/verify/runbook-statements.txt`
11. `.postmaster/verify/c11-single.txt`
    - `.postmaster/verify/runbook-statements.txt`
12. `.postmaster/verify/c12-c14-c15-single.txt`
    - `.postmaster/verify/c12-c17-single.txt`
    - `.postmaster/verify/c12-c17-c18-synth.txt`
13. `.postmaster/verify/c13-single.txt`
    - `.postmaster/verify/c12-c13-c14-c15-synth-cross.txt`
14. `.postmaster/verify/c12-c14-c15-single.txt`
    - `.postmaster/verify/c12-c13-c14-c15-synth-cross.txt`
15. `.postmaster/verify/c12-c14-c15-single.txt`
    - `.postmaster/verify/c12-c13-c14-c15-synth-cross.txt`
16. `.postmaster/verify/c16-single.txt`
17. `.postmaster/verify/c12-c17-single.txt`
    - `.postmaster/verify/c12-c17-c18-synth.txt`
18. `.postmaster/verify/c12-c17-c18-synth.txt`

## Decisions I made within the brief

- The answers-file/config key is `mode` under `[team]` (C1's "such as `team.mode`");
  `--mode` accepts only the two run modes, and `alternate` stays a setting-only value.
- Record keys are `mode`, `mode_source`, `mode_setting` (top-level, beside `confinement`).
- The read verb prints `mode:`/`mode source:`/`mode setting:` lines; a pre-mode record prints
  `mode: synthesis` with both sources `unrecorded`.
- `run-meta check` compares only when both sides name a mode (one-sided accepts), so every
  old dispatch stays green; the mismatch message names both values.
- Invalid `team.mode` refuses the dispatch naming the three values rather than defaulting.
- A single-thread waybill omits the `workhorses:` line entirely: `workhorses: none` would
  parse as a lane named `none`.
- The score's mode check fails an unknown recorded mode; counts coachman dispatch lines only
  (the postmaster's own `dispatch` lines for legs do not count); and requires one
  `wb/<ticket>-<lane>` per configured workhorse in synthesis.
- Stage F claims (gate line per round, acceptance boundary and commit isolation, ledger
  match) were added instead of more prose alone: the flow withholds the merge and resumes the
  last leg, which is how single2's missing `review-launch` lines were corrected in-flight.
- `probe-confine.test.ts`'s positive control is restated against the machine's ownership of
  `/` rather than skipped: the security rule itself is untouched, and the base commit's
  version of the test fails in this container (checked at 393f263 before any of this work).
- The skill-refs shell-block control moved from eleven to twelve and its indexed assertions
  from blocks[8]/[9] to [9]/[10], because Stage 0 gained a real `sh` block.
- Fixture repositories live at `~/Code/fixtures` (outside the worktree — `fixture new`
  refuses a destination inside a git repository); abandoned runs are kept as records.
- Evidence runs were dispatched from branch commits `9792b04` (single) and `b609cb2`
  (synthesis), both commits of this change's branch.

## What I did not do

- Out of scope by the ticket: per-project modes, a one-lane mode, changing the default,
  changing the reviewers or models, #264's shared fix loop, #280's lane-owned interfaces.
- No wiki edits (the wiki is the project's knowledge base, not required by this ticket).
- No scripted append-only checker: Stage F compares `actions.jsonl` with `ledger.jsonl` as a
  claim; a deterministic script for it would be a separate ticket.
- The legacy ship leg and pre-change runs are untouched by design.

## Verdicts

1. Met — a `mode` key with the three values and default is listed by `setup --keys`, written
   under `[team]`, and a bad value exits 1 naming the three.
2. Met — with no key, `run.json` records `synthesis`/`setting`/`synthesis` and the synthesis
   fixture run has dispatch lines, `wb/` branches and `lanes` entries per workhorse.
3. Met — all five alternate cases behave as specified (no run, no-mode latest, single-thread
   latest, synthesis latest, latest-by-written).
4. Met — `--mode single-thread` wins under `synthesis`; `--mode two-lanes` exits 1 naming
   both run modes; a user-named run counts as its project's latest.
5. Met — `run-meta mode` prints mode, source and setting for each; the postmaster's note
   carries `mode=<...>` into `actions.jsonl`.
6. Met — the single-thread run's manifest has empty `lanes`, no `wb/` refs, no workhorse
   streams, no coachman dispatch line, and the ticket branch carries the implementation.
7. Met — both runs' acceptance-test commits are first and tests-only, fail at base and pass
   at head; Stage F checks the first-commit claim.
8. Met — both runs' acceptance tests spawn the `todo` command and import nothing from `src/`;
   the runbook states the boundary rule for every run with browser and library forms.
9. Met — the runbook requires a test's own commit with its reason; both runs' later commits
   touching the acceptance files touch nothing else and say why.
10. Met — the runbook makes an unpassable check an escalation naming it, never a changed test.
11. Met — the single-thread steps give the workhorse loop; the run's `verify` lines before
    checkpoint-1 all pass (the last group green).
12. Met — single-thread stage lines are exactly the seven-stage schedule; both scores report
    stages ok; both tamper copies fail stages with exit 2.
13. Met — same reviewers and lens reviewers, identical `review-launch` pairs, a `gate` line
    per round, `review-decide` decided both rounds of both runs, same ten card headings.
14. Met — `grep -il -e single-thread -e 'synthesis mode'` over both runs' `review-*` files
    prints nothing, exit 1.
15. Met — both runs say their mode in `run.json`, in an `actions.jsonl` line, and as
    `Mode:` on the card.
16. Met — flipping the single run's waybill mode fails `run-meta check` naming both; the
    unchanged run and a pre-change dispatch pass.
17. Met — unchanged copies score ok; each tamper (single: dispatch line, `wb/` branch,
    `workhorses-running` stage; synthesis: removed dispatch lines, removed stage) fails the
    named check with exit 2.
18. Met — `fixture score` on both runs: every check ok, exit 0; the single run's
    hidden-tests line reports the merged result with no lane.
