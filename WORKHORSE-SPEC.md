# Workhorse spec: #135 Scan committed changes for private data

## Summary

Add a shape-based scanner for suspect data in every added line across a commit range, report matches without their values for user ruling, and wire it into the project's change checks.

## Technical context

- **Language and version**: Bash with Python 3 from the standard library.
- **Dependencies used or added**: Git and Python 3; no added packages.
- **Testing**: `scripts/scrub-check.sh --self-test`; project gate via `/home/brindlewick/postmaster/scripts/verify.sh run .`.
- **Constraints**: Scan committed additions across all commits, never consult private values, never print a suspect value, keep user decisions in a repository allowlist, and make no changes outside this worktree.

## Direction check

- The ticket requires shape and context matching rather than a private-values database; patterns will classify common identifiers, addresses, paths, network hosts, credentials, assistant attribution, and private-instruction-like text.
- The project requires deterministic checks in scripts, no repository-specific values, quoted paths, and one action per branch; this change adds one scanner and declares it through the project's check mechanism.
- Self-test fixtures will be generated only in temporary scratch Git repositories and use obviously synthetic values.
- The script will only read Git history and the repository allowlist; user ruling remains with the postmaster.

## Structure

- `WORKHORSE-SPEC.md`: this implementation plan.
- `scripts/scrub-check.sh`: scanner, history report, and self-test.
- `scripts/scrub-check.allow`: empty shipped allowlist for future user rulings.
- `.postmaster/project.toml`: declare the scanner as a check for changes to this repository, following the schema in `project.example.toml`.
- `raw/README.md`: document the enforced scrub check.
- `WORKHORSE-SUMMARY.md`: final implementation and verification record.

## Decisions

- Enumerate commits with `git rev-list` and compare each commit with its first parent using a zero-context Git diff; parse the new-line hunk numbers and added lines. Root commits compare against an empty tree.
- Use standard-library Python for byte-oriented Git subprocess results, hunk parsing, matching, exact allowlist suppression, and safe output formatting.
- Use these kinds: `sensitive-field` for populated `userEmail`, `session_context`, and `credential_org` fields; `email` for addresses other than recognized public no-reply forms; `account-id` for shaped values under `accountId`, `accountUuid`, and snake-case equivalents; `organization-id` for shaped values under `organizationUuid`, `organizationId`, `orgId`, and UUID or snake-case equivalents; `private-path` for home and known harness scratch paths; `private-network` for private, loopback and link-local IP addresses plus hostnames ending in local-network suffixes; `credential` for common AWS, GitHub, OpenAI, Slack and Google token prefixes, private-key headers, or long values under secret-bearing fields; `assistant-attribution` for assistant authorship trailers and generated-by lines; and `private-instructions` for private-instruction headings and personal directives.
- Print only `<commit>:<path>:<line>: <kind>` on stdout, keep notices on stderr, and redact any suspect value that also appears in an output path.
- Match named sensitive fields and account or organization ID fields only when they have non-empty values; the field context supplies the signal for IDs. Exempt GitHub `users.noreply.github.com` addresses and the `noreply`/`no-reply` forms at recognized public domains.
- Build isolated fixture repositories at runtime for per-kind positive and clean controls, history deletion, allowlist suppression, and a pending match.
- For history mode, scan the selected ref's reachable commits against their first parents and report existing suspects with the same value-free format; the default ref is `main`.
- Declare a `scrub` project check in `.postmaster/project.toml`. It scans from the merge base of `HEAD` and `main` through `HEAD`; the verification runner adds its configured gate separately.

## Tasks

- [ ] T001 [P] [AC1] Implement shape and context patterns for private-data classes in `scripts/scrub-check.sh`.
- [ ] T002 [P] [AC2] Keep `scripts/scrub-check.sh` shape-based and add no private-value inventory anywhere in the repository.
- [ ] T003 [P] [AC3] Make `scripts/scrub-check.sh` emit value-free suspects and leave all ruling to the postmaster and user.
- [ ] T004 [P] [AC4] Read exact match and whole-line decisions from `scripts/scrub-check.allow`.
- [ ] T005 [AC5] Wire `scripts/scrub-check.sh` into the project's change checks through `.postmaster/project.toml`.
- [ ] T006 [AC6] Add controls to `scripts/scrub-check.sh --self-test` for each pattern, clean lines, deleted additions, and allowlist decisions.
- [ ] T007 [AC7] Document the enforced scrub check in `raw/README.md`.
- [ ] T008 [AC8] Implement value-free existing-history reporting in `scripts/scrub-check.sh` for `main` or a selected ref.
