# Workhorse spec: #158, Measure each lane's share of the shipped synthesis from git, beside the coachman's own account

_Shared spec written by the coachman per the user's word; identical in both lanes' worktrees.
Both lanes implement from this spec, in blinkers as before._

## Summary

The SYNTHESIS line's `took=` is the coachman's own claim and nothing measures it; this change
adds a TypeScript script on Bun that counts, from git at the end of synthesis, how much of the
synthesis's added text appears only in each lane's diff, in both, and in neither, split into
code and docs, and shows those shares on the checkpoint card beside the SYNTHESIS line and in a
run record a later audit can read without re-running the script.

## Technical context

- **Language and version**: TypeScript, run on Bun (1.4.2 on this machine). Bun runs
  TypeScript natively, so there is no build step and no `tsconfig.json`.
- **Dependencies used or added**: Bun only. No packages, no `package.json`, no lint config:
  one script and its test on Bun's defaults, so this branch and #109's TypeScript port can
  absorb each other whichever merges second.
- **Testing**:
  - `bun test scripts/synthesis-shares.test.ts` — the AC3 controls as colocated bun tests:
    synthesis wholly from one lane, split between both, identical text in both lanes, and
    coachman-only text, each read back as exact integers, plus an exclusion control.
  - The project gate from the worktree root. The stand-in gate is shell-only and its script
    list is frozen at BASE's 40, so it does not run the new test; run `bun test` explicitly
    and record both. The gate's `skill-refs.sh` must resolve the new
    `<tool>/scripts/synthesis-shares.ts` reference the runbook names.
- **Constraints**:
  - From git at the end of synthesis: diffs of real commits, never lane logs.
  - Match runs of words, as the audit did (`raw/trials/2026-09-29-synthesis-audit/measure.py`,
    prior art, not a dependency).
  - Count code and docs separately; leave out oracle and spec files.
  - `took=` stays; the measurement sits beside it and does not replace the coachman's reasons.
  - The measurement informs the ranking; it does not decide it.
  - Functional style: a pure core with side effects at the edges, no mutation unless truly
    necessary.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Match runs of words, as the audit did | The audit's rule, stated plainly in Decisions: every window of 6 consecutive whitespace-separated words in the synthesis's added lines, counted once per occurrence, classified by exact membership in each lane's run set. No simpler measure is substituted: the lane branches the audit ran on are not readable from a lane worktree, so no comparison can be made here, and the audit's rule is the direction's default. |
| New script in TypeScript on Bun (user's word) | `scripts/synthesis-shares.ts`, Bun the only dependency, no config files. |
| Tests colocated `<name>.test.ts` (user's word) | `scripts/synthesis-shares.test.ts` beside its target, run by `bun test`. |
| Linter enforcement of that placement (user's word) | Proposed, not implemented: when the project adopts a TypeScript linter, it gains a rule that a test file must be a sibling of its target named `<target>.test.ts`. This change adds no lint config; the rule belongs to the TypeScript-adoption work. |
| Functional style, no mutation unless necessary (user's word) | Pure core (tokenize, run, classify, count) with git, argv and file writes at the edges. |
| Code and docs separately | The audit's `kind()`: docs is `.md` / `.txt` or under `wiki/` / `raw/`; the audit's third kind, tests, folds into code, since a test file is product. |
| Oracle and spec files left out | On every side: the files the oracle commit added (none when the run wrote no oracle), and the audit's exclusion pattern plus `WORKHORSE-BLOCKED.md`. |
| Card shows shares beside SYNTHESIS; records keep them auditable | The script prints one greppable `SHARES:` line for the card and `run-log.md`; `--record` writes `<dispatch>/shares.json` with the pinned commits and exact counts. |
| `took=` stays; informs, does not decide | `coachman.md` keeps the SYNTHESIS line and `took=` unchanged, adds the SHARES line beside it, and says the measurement informs the ranking. |
| Near-matches and lane logs (user's question) | Answered in Decisions: exact runs only, so slight changes get partial attribution through surviving runs; lane logs do not feed the measure. |
| Self-contained against #109 (user's word) | Two new files plus runbook prose; no existing script is touched, so the port absorbs this change by adding two files. |

## Structure

Create:

- `scripts/synthesis-shares.ts` — measure from git, print the `SHARES:` line, `--record` the
  JSON, all new logic here.
- `scripts/synthesis-shares.test.ts` — the AC3 controls as bun tests with git fixtures.

Change:

- `skills/postmaster/coachman.md` — at the end of synthesis, run the script, put the `SHARES:`
  line on checkpoint-1 beside the SYNTHESIS line, keep `took=` and the coachman's reasons,
  record `<dispatch>/shares.json`, add it to the paths table, and say the measurement informs
  the ranking and does not decide it.

## Decisions

1. **What "word-run matching" means.** Take the diff's added lines per file. A word is a
   maximal run of non-whitespace characters. Slide a window of 6 consecutive words over each
   file's added words; every window is one run. Each run in the synthesis's added lines counts
   once per occurrence: in the first lane's run set only, the second lane's only, both, or
   neither. Matching is exact, with no case or punctuation normalization, as the audit did.
2. **Six words, as the audit used.** Fewer words match boilerplate by accident; more words
   miss short shared passages. The audit's `K = 6` stands.
3. **Near-matches get partial attribution, and that bias is documented.** Code taken from one
   lane with slight changes attributes only through its surviving exact 6-runs; the changed
   words fall in `neither` and read as coachman-only. Editing therefore inflates the
   coachman's share. This is inherent to an exact text measure and is why the measurement
   informs the ranking rather than deciding it: the coachman's `took=` reasons carry the
   "slight changes" provenance the numbers cannot see.
4. **Lane logs do not feed the measure.** AC1 says from git. Lane logs live in harness
   stores outside the repo, differ by harness, and would make the number unreproducible from
   the run's git record. Git only; provenance stays in `took=`.
5. **Two kinds, code and docs.** AC1 names those two. The audit's `tests` kind folds into
   code: a test file is product. One `kind()` function keeps docs for a later ticket to widen
   if asked.
6. **Exclusions are the audit's, plus the blocked file.** The audit's case-insensitive
   pattern (`WORKHORSE-SPEC.md`, `WORKHORSE-SUMMARY.md`, `BASE-CONTROLS`, `oracle`,
   `acceptance`) plus `WORKHORSE-BLOCKED.md`, which the audit predates; and the files the
   oracle commit added, skipped on every side. Nothing in this widens or narrows the audit's
   answers on its own runs.
7. **The record is `<dispatch>/shares.json`.** One JSON object, written once by `--record`,
   holding the pinned commits (base, both lane heads, synthesis range, oracle if any), `k`,
   the exclusions, and exact integer counts and shares per kind. An audit reads it without
   git and without this script. It sits beside `checks.json` and `run.json`, which are
   already structured records outside the action log.
8. **The card line is `SHARES:`.** One greppable line carrying, per kind, the denominator and
   the four shares; exact counts live in the JSON. Its exact layout is the implementation's
   choice. No existing script is touched to persist anything: the new script writes the JSON
   itself, which is what keeps this change to two new files plus runbook prose.
9. **CLI takes explicit commits.** The manifest does not record harvested lane heads, and the
   coachman knows the base, both lane heads, the synthesis range and the oracle commit at the
   end of synthesis, so those are arguments. Exact flag spelling is the implementation's
   choice.
10. **This change edits `coachman.md`, so the fixture-run merge rule applies**: a run
    dispatched from this branch against a fixture repo, scored clean, before merge. That is
    ship-side duty; implementation notes it in the summary.

## Tasks

- [ ] T001 [P] [AC1] Write `scripts/synthesis-shares.ts`: from git, count the synthesis's added
  6-word runs as first-only / second-only / both / neither against each lane's added runs,
  split into code and docs, leaving out oracle and spec files; functional style, pure core,
  effects at the edges.
- [ ] T002 [P] [AC3] Write `scripts/synthesis-shares.test.ts`: the four controls (wholly one
  lane, split between both, identical in both, coachman alone) as bun tests over git
  fixtures, each read back as exact integers, plus the exclusion control; run with `bun test`.
- [ ] T003 [AC2] Add `--record`: write `<dispatch>/shares.json` with the pinned commits, `k`,
  exclusions, and exact counts and shares per kind; print the greppable `SHARES:` line.
- [ ] T004 [AC2] [AC4] Edit `skills/postmaster/coachman.md`: run the script at the end of
  synthesis, put `SHARES:` on checkpoint-1 beside SYNTHESIS, keep `took=` and the coachman's
  reasons, and say the measurement informs the ranking and does not decide it.
- [ ] T005 [AC1] [AC2] [AC3] [AC4] Run the project gate and `bun test
  scripts/synthesis-shares.test.ts` clean from the worktree root; note the stand-in gate's
  frozen script list and the fixture-run merge rule in the summary.
