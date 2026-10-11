# Round 6 bug report: mimo (hand-read)

Raw report: final `text` event in `logs/review-r6-bug-mimo.jsonl`
(thread ses_0002).

The normalizer merged this report's five items into one JSON finding
with severity `not provided`
(`logs/review-r6-bug-mimo-findings.json`); that artifact is unusable and
triage reads this file instead.

Verified clean (their words): blind oracle 55/55; tsc/oxlint/biome/
skill-refs/wiki-lint exit 0; changed test files 276/276; full suite
2832 pass / 1 fail (pre-existing, environmental); per-tool
directive-parsing asymmetries probed against real tools, all matching.

Findings:

1. Low severity bug — `scripts/lib/switch-offs.ts:668`: for
   `scope === "open"`, `covered = code.slice(d.line, stop)` starts on
   the line after the comment, while `line`/`next` scopes start at the
   comment's line. Oxlint suppresses same-line trailing code after an
   inline block directive, but the approval window excludes it: run
   adds inline block disable, user approves, later commit edits
   same-line code after the comment, check does not re-ask. Full-line
   disables unaffected. Suggested fix: start the open window at
   `d.line`.
2. Not a bug in this range — `scripts/probe-confine.test.ts` fails
   here because `/bin/sh` is owned by `nobody:nogroup` mode 777;
   pre-existing at base, so the gate cannot go green on this machine.
3. Before merge — range touches three coachman-contract files, so a
   clean fixture run is required per AGENTS.md; no fixture records in
   this checkout, needs confirmation.
4. Suggestion — consider adding `scripts/lib/switch-offs.ts` to
   `docs/coachman-contract.toml` (same as luna's round-5 P3).
5. Very edge, fails closed — ledger path uses `resolve` vs `realpath`
   mismatch; stays held, never clear.
