# Workhorse summary: #108 Keep the front-door session as postmaster

## Commits

- `09aedc4` #108 Record front-door session approach
- `4e376ab` #108 Add postmaster session routing
- `c2a5cb6` #108 Continue front-door session as postmaster
- This commit records the workhorse summary.

## Verification

- `scripts/postmaster-route.sh --self-test` — exit 0; controls cover each spawn reason and a real Git repository root.
- `scripts/skill-refs.sh --fix` — exit 0.
- `scripts/skill-refs.sh` — exit 0.
- `bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for f in $(grep -l -- --self-test scripts/*.sh); do "$f" --self-test || exit 1; done'` — exit 0.
- `git diff --check 0b02eefc3066806598bf8089d71271e0d2c93094..HEAD` — exit 0.
- Stale front-door claim search across `AGENTS.md`, `README.md`, `skills/postmaster/SKILL.md`, and `skills/postmaster/postmaster.md` — exit 1, no matches.

## Decisions

- The route script compares reported harness and model values exactly with `team.postmaster`, and compares the Git top-level directories for the session and target. A session in a target subdirectory qualifies.
- The session reports whether a person is at the terminal. The script does not infer it from a TTY.
- The launch card includes every applicable spawn reason. After confirmation, either route writes the same brief and logs `note launch` before continuing or starting another session.
- Un-ticketed work stays in the stream paragraph until launch confirmation; Stage A handles its first ticket after confirmation, matching the user journey.

## Not done

- The waybill, coachman dispatch, and headless postmaster escalations were left unchanged because the ticket lists them as out of scope.
- No push was made, per the workhorse rules.

## Acceptance criteria

- AC1 — Met. A qualifying session continues in the current conversation and starts Stage A without opening another session.
- AC2 — Met. Harness or model mismatch, a different target repository, or no person at the terminal selects `spawn`.
- AC3 — Met. The launch card carries the route result and its reason or reasons.
- AC4 — Met. `scripts/postmaster-route.sh` makes the choice and its self-test has positive and negative controls for all four spawn reasons.
- AC5 — Met. Both routes write the confirmed context to `<runs>/postmaster/brief.md` and log the first postmaster action there through `log-action.sh`.
- AC6 — Met. The four entry-flow docs describe the same-session route and no longer contain the spawned-only claim.
