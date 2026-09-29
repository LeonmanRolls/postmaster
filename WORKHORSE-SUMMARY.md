# Workhorse summary: #80 Review loop stop rule

## Commits

- `54f936b` — #80, Define review-loop approach.
- `1e1b5df` — #80, Set P1/P2 review loop rule.

## Checks

- `/home/brindlewick/postmaster/scripts/verify.sh run .` — exit 0. Printed: `gate: pass, exit 0, 403s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'`
- `scripts/review-loop.sh --self-test` — exit 0; all six positive and negative controls passed.
- `scripts/skill-refs.sh` — exit 0.
- `scripts/skill-refs.sh --fix` — exit 0; no path fixes were needed.
- `scripts/wiki-lint.sh` — exit 0.
- `bash -n scripts/review-loop.sh` — exit 0.
- `git diff --check` — exit 0.

## Decisions

- P1 means severe harm, irreversible loss, or loss of a critical capability; P2 means material impairment to an important capability or protection with bounded impact; P3 means limited impact without material impairment of normal use.
- The Style lens keeps its existing residue handling. Round 1 applies every verified finding from gating lenses at P1, P2, or P3.
- `apply` details start with the round and list the finding targets, so the decision script can scope fixes by round using the existing action log.
- The fetch of `origin/wb/80-luna` failed because that remote ref does not exist. Work continued from the supplied clean base commit `7e6a7151661ee61511ca908fdc0fa76459410e7c`.

## Not done

- Nothing was pushed and no pull request was opened, as directed for this lane.
- No fixture dispatch and score was run. `AGENTS.md` requires a clean fixture score before merging coachman-contract changes; this lane does not merge, so that check remains for the supervising leg before merge.

## Acceptance criteria

- AC1: Met. Round 1 applies every verified finding from a gating lens at P1, P2, or P3; findings needing a ruling are escalated, and unfixable findings retain their reason in deferred findings.
- AC2: Met. The script runs round 2 after a round-one apply and later rounds only after a P1/P2 finding; the runbook logs an unclosed P1/P2 fix at the same severity in its checking round.
- AC3: Met. Later-round P3 findings remain unfixed and travel to deferred and ship-card open findings with lens and originating round.
- AC4: Met. Every lens brief receives one-line, project-independent P1, P2, and P3 definitions, with verified severity recorded on the `finding` line.
- AC5: Met. `scripts/review-loop.sh` reads the round-scoped `finding` and `apply` actions, prints the decision, and its self-test covers positive and negative controls for the continuation and cap rules.
- AC6: Met. The three-round cap and repeated-class escalation remain in the runbook; a round-three P1/P2 decision reaches the cap and escalates.
- AC7: Met. The review checkpoint card records the ending round and reason and lists deferred P3 findings carried to the ship card.
- AC8: Met. Both wiki concepts record the new stop rule; the convergence decision preserves the user's 2026-09-27 wording and the backstop.
