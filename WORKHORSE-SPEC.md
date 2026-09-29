# Workhorse spec: #158 Measure what each lane contributed to the synthesis

## Summary

The SYNTHESIS line's `took=` is the coachman's own claim and nothing measures it; this workhorse
adds a script that counts, from git, how much of the synthesis's added text appears in each
lane's diff only, in both, and in neither, and keeps those shares on the checkpoint card beside
the SYNTHESIS line and in the run's records.

## Technical context

- **Language and version**: Bash with Python 3 in a heredoc, the project's script idiom
  (`build: none: shell scripts with Python in heredocs, run in place`). Python stdlib and git
  only.
- **Dependencies used or added**: none. `raw/trials/2026-09-29-synthesis-audit/measure.py` is
  the prior art for the measure; the production script is written for one live synthesis, not
  for that trial's hard-coded run table.
- **Testing**:
  - `scripts/synthesis-shares.sh --self-test` — the four AC3 controls and the exclusion
    control, each read back exactly (exit 0).
  - `bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'` from the worktree root — the project gate.
  - `scripts/synthesis-shares.sh --self-test` again after any edit, since the stand-in gate
    lists only the 40 scripts that had a self-test at BASE.
- **Constraints**:
  - Direction: measure text shares by matching runs of words, as the audit did.
  - Direction: the measurement informs the ranking; it does not decide it.
  - AC4: `took=` stays; the measurement sits beside it and does not replace the coachman's
    reasons.
  - Project rule 3: the measure lives in `scripts/`, not in prose.
  - Project rule 5: every count needs a control; the self-test's four cases are those controls.
  - Project rule 1: nothing repo-specific; the script takes commits and paths as arguments.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Match runs of words, as the audit did | Six consecutive words, a word anything between whitespace (`K=6`, the audit's choice). Each run in the synthesis's added lines is counted once per occurrence and classified first-only / second-only / both / neither against the two lanes' added-line word-run sets. |
| Unless a simpler measure gives the same answers on the audit's runs | Not departed from. The audit's lane branches live outside this worktree and the brief forbids reading other branches, so a comparison on those runs cannot be made here. Sticking to the audit's measure is the direction's default. |
| Counting code and docs separately | Two kinds, as AC1 names them: *docs* (`.md`, `.txt`, or under `wiki/` or `raw/`) and *code* (the rest). Test files are product and count as code. |
| Leave out oracle and spec files | On every side: the files the oracle/blind-tests commit added, and any path matching `WORKHORSE-SPEC.md`, `WORKHORSE-SUMMARY.md`, `BASE-CONTROLS`, `oracle` or `acceptance` — the audit's exclusions. |
| From git at the end of synthesis | The script diffs real commits (`--base`, `--ranked name:head,name:head`, `--synthesis from..to`, optional `--oracle`). The coachman runs it after the synthesis commits, before the checkpoint card. |
| Checkpoint card shows shares beside the SYNTHESIS line | The script prints one greppable `SHARES:` line; `coachman.md` puts that line on `checkpoint-1.md` beside the SYNTHESIS line. |
| Run's records keep them, auditable without re-running the script | `--record <dispatch>` writes `<dispatch>/shares.json` with the pinned commits, `k`, exclusions, and exact counts and shares per kind. |
| `took=` stays; measurement sits beside it | `coachman.md` keeps the SYNTHESIS line and `took=` unchanged and adds the SHARES line beside it. |
| Measurement informs ranking, does not decide it | `coachman.md` says so where the shares are used. |
| Self-test controls: wholly one lane, split, identical in both, coachman alone | Four git fixtures in `--self-test`, each with known word counts so the four categories are read back as exact integers. |
| Deterministic work in `scripts/` | The measure is one script; `coachman.md` only runs it and copies its output. |
| Every count needs a control | The four self-test cases are positive and negative controls through the identical command. |
| Nothing harness-specific / repo-specific | The script takes a repo path and commits; no lane names, harnesses or paths are hard-coded (ranked lane names are arguments). |

## Structure

Create:

- `scripts/synthesis-shares.sh` — measure, record, and `--self-test`.

Change:

- `skills/postmaster/coachman.md` — at the end of synthesis, run the script, put the `SHARES:`
  line on the checkpoint card beside the SYNTHESIS line, keep `took=`, record `<dispatch>/shares.json`;
  add `shares.json` to the paths table.

## Complexity tracking

No departure from the ticket's direction or the project's rules.

## Decisions

1. **Word-run length is six**, as the audit used. Lines miss re-wrapped prose (the audit's
   #106 case); words alone are too coarse. Not compared to a simpler measure on the audit's
   runs: those lane branches are not readable from this worktree.
2. **Two kinds, code and docs.** AC1 names those two. The audit also split out *tests* for the
   fixture runs; a test file is product, so it counts as code here. One `kind()` function would
   add tests later if a ticket asks.
3. **Shares are reported by rank (`first` / `second`) and by lane name in the JSON.** The
   card sits beside `ranked=` on the SYNTHESIS line, so first/second matches the audit's
   tables; the JSON keeps the names so an audit is not forced to re-read the ranking.
4. **The record is `<dispatch>/shares.json`**, beside `checks.json` and `run.json`: one JSON
   object, written once by `--record`, holding the pinned commits and exact integer counts
   (and the percentage strings). An audit reads it without git and without this script.
5. **The script prints a single greppable `SHARES:` line** for the card and `run-log.md`, in
   the spirit of the SYNTHESIS line. Exact counts live in the JSON, not on the card.
6. **CLI is explicit commits**, not a discovery from the dispatch manifest: the manifest does
   not record harvested lane heads, and the coachman already knows the four commits at the end
   of synthesis. `measure` prints; `record` also writes the JSON; `--self-test` is the controls.
7. **This change edits `coachman.md`**, so the merge rule for a coachman-contract change
   applies: a fixture run scored clean is required before merge. That is a ship-side duty; this
   workhorse runs the gate and its own self-test and will note the fixture rule in the summary.
8. **The stand-in gate does not name the new script's self-test** (its list is frozen at BASE's
   40). The script still carries `--self-test`, and `bash -n` covers it under `scripts/*.sh`.

## Tasks

- [ ] T001 [P] [AC1] Write `scripts/synthesis-shares.sh`: from git, count the synthesis's added
      runs of six words as first-only / second-only / both / neither against each lane's added
      words, split into code and docs, leaving out oracle and spec files.
- [ ] T002 [P] [AC3] Add `scripts/synthesis-shares.sh --self-test` with the four controls
      (synthesis wholly from one lane, split between both, identical text in both lanes, text
      written by the coachman alone), each read back exactly, plus the exclusion control.
- [ ] T003 [AC2] Add `--record <dispatch>` to `scripts/synthesis-shares.sh`, writing
      `<dispatch>/shares.json` with the pinned commits and exact counts a later audit can read
      without re-running the script.
- [ ] T004 [AC2] [AC4] Edit `skills/postmaster/coachman.md`: run the script at the end of
      synthesis, put the `SHARES:` line on checkpoint-1 beside the SYNTHESIS line, keep `took=`
      and the coachman's reasons, and say the measurement informs the ranking and does not
      decide it.
- [ ] T005 [AC1] [AC2] [AC3] [AC4] Run the project gate and
      `scripts/synthesis-shares.sh --self-test` clean from the worktree root.
