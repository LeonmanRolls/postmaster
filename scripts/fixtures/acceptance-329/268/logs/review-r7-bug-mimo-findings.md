# Round 7 bug report: mimo (hand-read)

Raw report: final `text` event in `logs/review-r7-bug-mimo.jsonl`
(thread ses_0001).

The normalizer kept the three items but dropped every severity
(`logs/review-r7-bug-mimo-findings.json`); triage reads this file for
the reviewer's own severities.

Verification passed (their words): 82 + 197 tests, lint, typecheck,
format, skill-refs, wiki-lint, 55/55 oracle, and a live e2e
`landing switch-offs` holding at exit 2 on the branch's own settings.

Findings:

1. Symlinked settings entries show no diff (low-moderate) —
   `settingsChanges` diffs the listed path, but for an unchanged link
   whose target changed that path is byte-identical, so the user sees
   `(no textual diff)` and approves with no evidence. Reproduced in a
   scratch repo. Same defect as luna's round-7 P2. Fix: diff the
   resolved target blobs.
2. One edit listed twice under two ids (low) — a file reachable under
   two scannable names (e.g. `b.ts` symlinked as `a.ts`) yields two
   approval gates for one edit. Safe direction (over-asks), possibly
   unintended; the spec does not say the target lists too.
3. `assertSelfContained` misses ESM-form bundles (low, hypothetical) —
   only `require(` is rejected; a future ESM-format bundle would land
   half-vendored. Current bundle verified fine.
4. Merge-gate note — `coachman-contract` reports yes (touches
   `scripts/landing.ts` and both runbooks), so a fixture run from the
   branch must score clean before merge; no such evidence in the diff.

Reviewer's verdict: no safety-direction bugs; the two worth acting on
before merge are #1 and the fixture-run gate check.
