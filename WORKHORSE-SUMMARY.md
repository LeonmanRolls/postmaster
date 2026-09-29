# Workhorse summary: #135 Scan committed changes for private data

## Built

- Added `scripts/scrub-check.sh`. It scans added lines in each commit in a range, reports only commit, repository-relative path, line and kind, and returns 1 for unruled suspects.
- Added shape and context patterns for sensitive fields, email, account IDs, organization IDs, private paths, private networks, credentials, assistant attributions and private-instruction-like text. Output paths redact matched values too.
- Added exact-value and exact-line suppression through an empty `scripts/scrub-check.allow`. No allowance was added.
- Added `--history [ref]`, defaulting to `main`, and `--self-test` controls using synthetic values and temporary Git repositories.
- Declared the `scrub` check in `.postmaster/project.toml`, scanning from the merge base of `HEAD` and `main` through `HEAD`. The verification runner adds its configured gate separately.
- Updated `raw/README.md` with the scrub check and history command.

## Commits

- `7a550df` — `#135 record workhorse plan`
- `17ac09d` — `#135 add committed-history scrub check`
- `b1c6545` — `#135 mark implementation tasks complete`
- `#135 record workhorse summary` — this final commit

## Checks

The final `/home/brindlewick/postmaster/scripts/verify.sh run .` run printed:

```text
gate: pass, exit 0, 407s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

Other verification commands:

- `scripts/scrub-check.sh --self-test` — exit 0.
- `scripts/scrub-check.sh 7a550df b1c6545` — exit 0; the implementation range is clean.
- `scripts/verify.sh checks . --gate <ticket gate> --lines` — exit 0; it resolved both `gate` and `scrub`.
- `scripts/review-round.sh --self-test` — exit 0 after the machine load eased.
- `scripts/front-door-acceptance.sh --self-test` — exit 0.
- `bash -n scripts/scrub-check.sh` — exit 0.
- `git diff --cached --check` — exit 0.
- An earlier full-gate run exited 2 on the `front-door-acceptance.sh` stale-AGENTS control; its direct self-test passed, and a later full gate passed.
- A full-gate run exited 2 on `review-round.sh`'s deadline timing control under high load. The direct self-test passed after load eased, followed by the final passing full gate.
- `git fetch origin wb/135-luna` — exit 128; the remote had no such ref.

The final `verify.sh run .` used the spec already armed when this worktree started, which contained only `gate`. The committed project declaration is picked up by `verify.sh checks` and future verification arms. The scanner was also run directly over this lane's implementation range.

## Decisions

- Compared each commit with its first parent using a zero-context Git diff. Scanned every commit returned by `git rev-list`; root commits use the empty tree. This keeps additions visible when later commits delete them.
- Used standard-library Python to parse added hunk lines and their new-file line numbers. The stable kinds are `sensitive-field`, `email`, `account-id`, `organization-id`, `private-path`, `private-network`, `credential`, `assistant-attribution` and `private-instructions`.
- Matched named fields only when populated; account and organization ID field context is sufficient to flag a non-empty value. Email matching exempts recognized public no-reply forms. Credential patterns cover common service token prefixes, private-key headers and long secret-field values. Network matching covers private, loopback and link-local IPs plus local-network hostnames.
- Matched private-instruction headings and personal directives as text patterns. The scanner source is assembled so its own patterns do not match it; the self-test checks that source in fixture history.
- Read allowlist entries from the scanned repository's `scripts/scrub-check.allow`. A line suppresses an exact value span or the exact added line. The shipped file has no entries.
- The project check uses `git merge-base HEAD main` as its base. History mode scans all commits reachable from the chosen ref against their first parents.
- Fixture data uses synthetic values only. No private values file was created or consulted.

## Not done

- Did not run `scripts/scrub-check.sh --history main` against the actual `main` ref because the worktree instruction forbids reading other branches. The default and selected-ref history modes passed on fixture history.
- Did not push.

## Acceptance verdict

- AC1 — Met. The scanner checks each commit's additions for the named private-data patterns and reports full commit IDs with path, line and kind.
- AC2 — Met. Patterns rely on value shapes and field context; no real private values are stored or consulted.
- AC3 — Met. The scanner never prints matched values or rules on them; an unallowed match returns 1 through the declared change check.
- AC4 — Met. Exact value and whole-line allowances suppress repeat reports; the shipped allowlist is empty.
- AC5 — Met. `.postmaster/project.toml` declares the scan beside the verification runner's gate. This worktree's pre-armed final run had only the gate, so the branch scan was also run directly.
- AC6 — Met. Self-test controls cover every kind, clean inputs, deleted additions, pending and allowed matches, path redaction, source cleanliness and history reporting.
- AC7 — Met. `raw/README.md` names the scanner as the scrub check.
- AC8 — Met in the script. History mode defaults to `main` and reports without values; the actual `main` history was not read under the worktree constraint.
