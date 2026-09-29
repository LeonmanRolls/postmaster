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
- `project.example.toml`: declare the scanner in the project's change checks, following the existing schema.
- `raw/README.md`: document the enforced scrub check.
- `WORKHORSE-SUMMARY.md`: final implementation and verification record.

## Decisions

- Enumerate commits with `git rev-list` and compare each commit against its first parent, so additions deleted later remain visible. Root commits compare against an empty tree.
- Use standard-library Python for byte-safe Git invocation, line-range calculation, pattern matching, exact allowlist suppression, and safe output formatting.
- Give each pattern family a stable kind name. Print only `<commit>:<path>:<line>: <kind>` and keep notices on stderr.
- Match common secret-bearing field names only when followed by a value, and use context plus value shapes for account and organization identifiers. Recognize public GitHub no-reply email forms as exceptions.
- Build isolated fixture repositories at runtime for per-kind positive and clean controls, history deletion, allowlist suppression, and a pending match.
- For history mode, scan the selected ref's reachable commits against their first parents and report existing suspects with the same value-free format.
- Wire the scan through the project's declared check mechanism, using the current change's base and head refs supplied by that mechanism.

## Tasks

- [ ] T001 [P] [AC1] Implement shape and context patterns for private-data classes in `scripts/scrub-check.sh`.
- [ ] T002 [P] [AC2] Ensure patterns use no real values and add no private-value inventory anywhere in the repository.
- [ ] T003 [P] [AC3] Emit value-free suspects and leave all ruling to the postmaster and user.
- [ ] T004 [P] [AC4] Read exact match and whole-line decisions from `scripts/scrub-check.allow`.
- [ ] T005 [AC5] Wire `scripts/scrub-check.sh` into the project's change checks through `project.example.toml`.
- [ ] T006 [AC6] Add self-test controls for each pattern, clean lines, deleted additions, and allowlist decisions.
- [ ] T007 [AC7] Document the enforced scrub check in `raw/README.md`.
- [ ] T008 [AC8] Implement value-free existing-history reporting for `main` or a selected ref.
