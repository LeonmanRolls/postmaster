# Workhorse summary: #163 Define the coachman contract

## Built

- `44aa5ef` — #163 plan coachman contract change
- `a588c98` — #163 refine contract implementation plan
- `89ce604` — #163 clarify final branch fixture decision
- `19a1e19` — #163 define and detect coachman contract
- `740dbec` — #163 report contract line ranges

The contract index in `docs/coachman-contract.toml` defines markers and their writers, the
waybill fields, turnpikes, legs and stages, leg completion detection, and the fixture decision
rule. It maps each part to delimited runbook and script sections. `scripts/coachman-contract.sh`
compares base and head revisions, reports changed parts with file and line ranges, and has
positive, negative, and main-merge controls. The existing fixture self-test runs these controls.
The postmaster records the fixture status as pending at dispatch, then sets yes or no at the
final branch check. A positive result requires a clean fixture score; later branch changes are
checked against the last clean score to decide whether it repeats.

## Checks

- **gate** [declared:project]: `/home/brindlewick/.postmaster/tool-pins/601bfd9cccd1b2980be60a5be183c89cd0e734d1/scripts/verify.sh run .` — exit 0. It printed: `gate: pass, exit 0, 794s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'`
- `scripts/coachman-contract.sh --self-test` — exit 0; 10 controls passed, including the fixture self-test invoked by the gate.
- `scripts/coachman-contract.sh 601bfd9cccd1b2980be60a5be183c89cd0e734d1 HEAD` — exit 1 as expected for a contract change; it named the touched parts and file line ranges.

## Decisions and limits

- The canonical definition is TOML so the detector can read it with Python's standard library. Explicit source markers keep unrelated edits in mixed-purpose files out of the decision.
- The final branch does not exist at dispatch. The waybill records `pending` then, and the postmaster replaces it with yes or no after the final branch check.
- Consecutive changed lines are reported as compact file line ranges.
- I did not run a full fixture dispatch and score. `scripts/fixture.sh new` creates a separate repository outside this worktree, which the workhorse instructions prohibit. The synthetic fixture controls and the project's fixture self-test passed.
- Nothing was pushed.

## Acceptance

- **AC1 — Met.** The contract index defines the covered parts and maps each to its runbook and script sections.
- **AC2 — Met.** The detector returns 0 for no contract change and 1 for yes, with changed part and file line ranges; it reads no ticket prose.
- **AC3 — Met in the flow.** The waybill records pending at dispatch, the postmaster sets yes or no after checking the final branch, and a changed merge range controls whether a clean fixture repeats. A full fixture run was not performed for the confinement reason above.
- **AC4 — Met.** All five positive controls, three negative controls, and both main-merge controls pass.
- **AC5 — Met.** `AGENTS.md` points to the canonical definition instead of restating its parts.
