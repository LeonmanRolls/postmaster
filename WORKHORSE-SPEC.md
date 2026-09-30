# Workhorse spec: #98 Trust fixture copies for the postmaster harness

## Summary

Record trust for each new fixture repository through the configured postmaster harness adapter, using Claude Code's locked and atomic project-config update when Claude Code asks.

## Technical context

- **Language and version**: Bash and Python 3.11 or newer, using the standard library.
- **Dependencies used or added**: None.
- **Testing**: `scripts/launch.sh --self-test` covers harness dispatch and safe config updates; `scripts/fixture.sh --self-test` covers a newly made copy and an untouched control path using scratch config only; the supplied gate runs both scripts' checks and `scripts/wiki-lint.sh`.
- **Constraints**: Trust only the absolute path of the copy made by `fixture.sh new`; add harness-specific behavior through `skills/postmaster/harnesses.md` and `scripts/launch.sh`; preserve Claude Code's config under its lock and replace it atomically; do not touch files outside this worktree, push, or open a PR. Follow the planning stop: commit this spec alone and wait for approval before implementation.

## Direction check

- Record trust per fixture copy at creation time. `fixture.sh new` will call the postmaster harness adapter after creating and filing the ticket, before it reports success.
- Keep harness behavior behind the adapter in `skills/postmaster/harnesses.md` and invoke it through `scripts/launch.sh`. Claude Code receives a trust form; harnesses without a trust prompt have no form and cause no config write.
- Pass only the new repository's resolved absolute path. Do not trust `~/Code/fixtures` or any parent directory.
- For Claude Code, take its `<config>.lock`, reread the current JSON under lock, change only `projects[<copy>].hasTrustDialogAccepted`, and write a same-directory temporary file followed by an atomic replace. An interruption before replacement leaves the prior JSON intact.
- Keep the self-test isolated from the real user config. Use a scratch home or `CLAUDE_CONFIG_DIR`, assert the made copy is trusted, and assert a separate path remains unchanged.
- Keep deterministic behavior in scripts and explain fixture trust semantics in the wiki. Use only the standard library.

## Structure

- `scripts/fixture.sh`: invoke trust recording after the fixture repo and ticket are successfully made; add scratch-config positive and negative controls to `--self-test`.
- `scripts/launch.sh`: add a trust operation that resolves `team.postmaster`, dispatches the registered harness form, and tests lock handling, preservation, and atomic replacement in `--self-test`.
- `skills/postmaster/harnesses.md`: document Claude Code's trust form and state that harnesses with no trust prompt have no form.
- `wiki/concepts/fixture-runs.md`: explain that each copy is trusted when made and that a trusted parent does not cover a git repository.

## Decisions

- Use `scripts/launch.sh trust postmaster <folder>` as the adapter entry point so the trust target follows the configured harness that starts the postmaster.
- Claude Code is the only harness with a trust form for this ticket's reported prompt. Other harnesses have no form and record nothing.
- Set only `hasTrustDialogAccepted` on the exact new copy's project entry, preserving all other config and project-entry fields.
- Perform trust recording after ticket filing succeeds. If the trust update fails, fail `new` and remove the incomplete fixture copy.
- Resolve Claude Code's config using its normal `CLAUDE_CONFIG_DIR` behavior, with a scratch config directory in tests.

## Tasks

- [ ] T001 [P] [AC2] Add the Claude Code trust form and the no-form behavior for other harnesses to `skills/postmaster/harnesses.md` and `scripts/launch.sh`.
- [ ] T002 [AC4] Implement Claude Code's locked, reread-before-update, single-field JSON mutation and atomic replacement in `scripts/launch.sh`; cover preservation, lock contention, and interrupted replacement in its self-test.
- [ ] T003 [AC1] Call the adapter from `scripts/fixture.sh` after ticket filing and before success, so a Claude Code postmaster starts with the new copy trusted.
- [ ] T004 [AC3] Ensure the adapter receives only the resolved absolute fixture copy path and add checks that no parent is written in `scripts/fixture.sh` and `scripts/launch.sh` self-tests.
- [ ] T005 [AC5] Add scratch-config controls to `scripts/fixture.sh --self-test` for the newly made copy and an unrelated path that must remain unchanged.
- [ ] T006 [P] [AC6] Update `wiki/concepts/fixture-runs.md` to describe per-copy trust and why a trusted parent does not cover a git repository.
