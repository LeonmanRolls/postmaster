# Workhorse spec: #98 Fixture copies are trusted when they are made, so a fixture run starts without a prompt

_One spec written by the coachman from the two lane specs, per the user's word;
both workhorses implement from it._

## Summary

`fixture.sh new` records the copy it just made as trusted by the postmaster's
harness, through a per-harness trust form in `skills/postmaster/harnesses.md`
run by `scripts/launch.sh`, before any session starts in it.

## Technical context

- **Language and version**: Bash with Python in heredocs (the repo's standing
  shape). Python 3, stdlib only, for the config write.
- **Dependencies used or added**: none.
- **Testing**:
  - `scripts/launch.sh --self-test` — trust-form controls on a scratch config:
    the one entry is set, every other key and project entry is kept, the file
    stays valid, the write waits on the lock and replaces atomically, a
    non-absolute or missing folder is refused, a harness with no form records
    nothing and succeeds.
  - `scripts/fixture.sh --self-test` — a control on a scratch config: the new
    copy is recorded trusted and a folder `fixture.sh` did not make is left
    untouched. Never the real config.
  - `scripts/skill-refs.sh` — new script references in `harnesses.md` go
    through `<tool>`.
  - `scripts/wiki-lint.sh` — the fixture-runs page still lints.
  - The run's gate, via `verify.sh run .` as the brief gives it.
- **Constraints**: Only the absolute path of the copy `fixture.sh new` just
  made is trusted (AC3). Harness behavior lives in `harnesses.md` and runs
  through `launch.sh` (AC2); `fixture.sh` names no harness. The Claude Code
  write takes `<config>.lock`, re-reads, changes one entry, keeps the rest,
  and leaves a valid file if interrupted (AC4).

## Direction check

- Record trust per copy, at the moment `fixture.sh new` makes it:
  `make_and_file` calls the adapter after the repo and ticket are ready and
  before it prints success.
- Through the harness adapter: the form lives in `harnesses.md`;
  `launch.sh trust` is its executable form, as launch/resume/review already are.
- Never widen to `~/Code/fixtures` or any parent: the form receives only the
  absolute `$dest` the script just created, and refuses anything else.
- Deterministic work in scripts: lock, re-read, one-entry edit and atomic
  replace are code in `launch.sh`, not prose.

## Structure

- `skills/postmaster/harnesses.md`: a trust-form section — the contract, the
  claude form, and which harnesses have no form and why.
- `scripts/launch.sh`: the `trust` subcommand, the claude form, and self-test
  controls.
- `scripts/fixture.sh`: call the adapter from `make_and_file`; failure unmakes
  the copy; header comment and self-test updated.
- `wiki/concepts/fixture-runs.md`: copies are trusted when made, and why the
  parent never covered them. One entry appended to `wiki/log.md`, as past
  revisions of this page did.

## Decisions

- **Interface: `launch.sh trust <name> <folder>`.** `<name>` is a lane or role,
  resolved from the config exactly as launch/resume already resolve it.
  `fixture.sh` calls `launch.sh trust postmaster <dest>`, so trust follows the
  harness that will run the postmaster (AC1) while `fixture.sh` names no
  harness. No run-every-form mode: AC1 names one harness, and writing trust
  bits for tools that will never open the folder is unasked scope with
  security meaning.
- **Which harnesses get a form.** Claude Code has one: it is the reported
  prompt. Codex has none: its launch form already marks the worktree trusted
  at every launch, so a fixture-time write would be redundant; `harnesses.md`
  says so. muse (`--yolo` trusts the workspace for the run only), pi
  (`--approve` is a per-run flag), agy, grok and mimo (no recorded
  folder-trust store) have none. A harness with no form is not guessed at.
- **No form means success with no write.** AC2's "records nothing" is the
  specified behavior, not an error: `trust` exits 0 and touches nothing.
- **Trust is recorded after the ticket is filed, before the success lines.**
  If it fails, the copy is unmade and `new` fails, like a ticket that cannot
  be filed: a fixture that would stall at a prompt is not a usable fixture.
- **The claude write.** Take `<config>.lock`, re-read the config under it,
  set only `projects["<folder>"].hasTrustDialogAccepted` (creating the entry
  if absent), keep every other key and entry, write a same-directory temp
  file and replace atomically, so an interruption leaves the old valid file.
  Running it twice is safe. The config file is the one Claude Code itself
  reads and writes (default `~/.claude.json`; honor `CLAUDE_CONFIG_DIR`);
  confirm the path by trial, and touch only `hasTrustDialogAccepted`, never
  any other prompt's key.
- **The form refuses a non-absolute or missing folder**, so it cannot be
  pointed at a parent or at something `new` did not make.
- **Config resolution.** There is no run yet at `new` time, so `trust`
  resolves `<name>` from the machine config as any `launch.sh` invocation
  does; a machine that can dispatch has `team.postmaster`.
- **Self-test isolation.** Every trust control runs against a scratch config
  (a temp `CLAUDE_CONFIG_DIR`, a scratch home), never the real one.

## Tasks

- [ ] T001 [P] [AC2] Add the trust-form section to
  `skills/postmaster/harnesses.md`: the contract, the claude form, and the
  no-form harnesses with reasons. Paths through `<tool>`.
- [ ] T002 [AC2] [AC3] [AC4] Implement `launch.sh trust <name> <folder>` in
  `scripts/launch.sh`: resolve the name's harness, run its form or record
  nothing, refuse a non-absolute or missing folder.
- [ ] T003 [AC4] Self-test controls for the claude write in
  `scripts/launch.sh --self-test`, scratch config only: one entry set, rest
  kept, valid file, lock waited on, atomic replace, idempotent.
- [ ] T004 [AC1] [AC3] Call `launch.sh trust postmaster "$dest"` from
  `make_and_file` after filing; on failure unmake and fail. Update the header
  comment (no more "the user answers it once per copy").
- [ ] T005 [AC5] Add the scratch-config control to
  `scripts/fixture.sh --self-test`: the new copy recorded trusted, a folder
  `fixture.sh` did not make left untouched, never the real config.
- [ ] T006 [P] [AC6] Update `wiki/concepts/fixture-runs.md`: copies are
  trusted when made, and trusting the parent never covered them because the
  trust search stops at the git root and every copy is its own repository.
  Append one entry to `wiki/log.md`.
- [ ] T007 [AC1] [AC2] [AC3] [AC4] [AC5] [AC6] Run the run's gate via
  `verify.sh run .` and fix what fails.
