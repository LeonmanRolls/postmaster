# Workhorse summary: #92 Setup installs the skill links, and the postmaster checks them

## Commits

- `4cf0bfa` — add the report-only `--check` mode and missing, blocked, and complete controls to `scripts/link-skills.sh`.
- `5d5f2e7` — wire the check and user-approved install into setup and postmaster instructions; document `--check` in `README.md`.

## Checks

- AC1: reviewed the `AGENTS.md` setup flow; it shows the dry-run output and runs the installer only after the user's agreement.
- AC2: `scripts/link-skills.sh --self-test` — exit 0; its missing and complete controls invoke the same `--check` command with a scratch HOME.
- AC3: `scripts/skill-refs.sh` — exit 0; the postmaster skill's script path goes through `<tool>`.
- AC4: `scripts/link-skills.sh --self-test` — exit 0; the missing, blocked, and complete controls pass.
- Gate: `/home/brindlewick/.postmaster/tool-pins/ffe37821779aa7cc77275860573a8fdd43cd6e2d/scripts/verify.sh run .` — exit 0. It printed: `gate: pass, exit 0, 827s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'`.
- Other checks: `bash -n scripts/link-skills.sh` — exit 0; `scripts/skill-refs.sh` — exit 0; `git diff --check` — exit 0.
- Self-test iterations: an initial `scripts/link-skills.sh --self-test` exited 1 because its scratch links interfered with later controls; after isolating its HOME it passed (exit 0). Adding the blocked-path control exposed a missing scratch parent (exit 1); creating that parent fixed it, and the final self-test passed (exit 0).

## Decisions

- Put the report-only check in `scripts/link-skills.sh --check`; keep installation as running the same script without `--check`.
- Exit non-zero and name every missing or blocked link when the planned set is incomplete; exit zero when complete. Print the script's absolute path as the install command.
- Treat uninstalled harnesses, harnesses without a skills folder, and shared skills folders as complete; they do not require links of their own.
- In setup, show the dry run and ask before installing. A present config with incomplete links gets the same offer. The check itself never installs.
- Leave the wiki unchanged because this work does not change a wiki claim.

## Not done

- No real user-level skill links were installed or changed. The self-test used a temporary HOME, and setup keeps installation on the user's word.
- No external dependencies were added.

## Acceptance verdict

- AC1: met — setup shows `--dry-run` and runs installation only after the user agrees.
- AC2: met — step 1 checks and reports missing or blocked links, and offers installation when config is already present.
- AC3: met — the postmaster start checks link status, names missing or blocked links, and gives `<tool>/scripts/link-skills.sh` as the install command.
- AC4: met — the self-test proves a missing link is reported and a complete set passes through the same check command.
