# Round 5 bug report: mimo (hand-read)

Raw report: final `text` event in `logs/review-r5-bug-mimo.jsonl`
(thread ses_ffe5ef19c8be3ffeARt67JpDg6).

The normalizer merged this report's six numbered items into one JSON
finding with severity `not provided`
(`logs/review-r5-bug-mimo-findings.json`); that artifact is unusable and
triage reads this file instead.

Verdict: **no high or medium bugs found**.

Verification the reviewer ran (their words): switch-offs suite 67 pass;
landing/log-action/refresh-parser suites 197 pass; tsc, oxlint, biome
format, skill-refs, wiki-lint clean; oracle-268.sh 55/55; full
`bun run check` timed out at 10 min so whole-suite completion unverified.

Findings, all info-level:

1. Housekeeping — the reviewer's interrupted gate run left
   `scripts/.host-self-test-sItlTk/` behind; deleted, tree clean.
2. `scripts/refresh-parser.ts:46-48` — `assertSelfContained` only matches
   the literal `require(`. A future bundle using `import(...)` or
   `require (` would slip past the guard (fails loudly at import time,
   not at refresh). Low risk today: the pinned 7.29.9 bundle contains no
   `require(`.
3. Spec-accepted scope gaps — switch-offs in non-JS/TS files
   (`# shellcheck disable`, `# noqa`) and dependency-only `package.json`
   edits are invisible to the check. The spec defers these (D5, C2).
4. Merge prerequisite — `scripts/run coachman-contract af47492 HEAD` says
   yes for all three contract files, so per AGENTS.md a fixture run
   dispatched from this branch must score clean before merge. No
   fixture-run record was visible to the reviewer.
5. Expected held state on this branch — `landing switch-offs` exits 2
   (held) on `.oxlintrc.json` and `biome.json` (the branch's own
   vendor-exclusion changes). Design working as intended.
6. Conservative-by-design behaviors confirmed — renames re-list, edits
   inside `@ts-nocheck` files re-ask, refusal wins over approval. Every
   probed edge fails toward held.
