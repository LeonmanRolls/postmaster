# Workhorse spec: #92 Setup installs the skill links, and the postmaster checks them

*Shared spec, written by the coachman from the two lane specs on the user's word
(spec-decisions.md, round 1: changes 2, approved 0). Both lanes implement from this
one spec, in blinkers as before.*

## Summary

Setup finishes without the skill links and nobody says so. This change adds a
read-only check to `scripts/link-skills.sh`, wires it into machine setup and the
postmaster's start, and keeps every install on the user's word.

## Technical context

- **Language and version**: bash for the script, markdown for the runbooks.
- **Dependencies used or added**: none; reuses `scripts/link-skills.sh` and the
  harness skills folders it already knows.
- **Testing**:
  - AC1: read the setup section of `AGENTS.md`: it shows the user the
    `scripts/link-skills.sh --dry-run` output and installs only on their word.
  - AC2: `AGENTS.md` step 1 runs `scripts/link-skills.sh --check`; with a link
    removed under a scratch HOME the check names it and exits non-zero, and a
    complete set exits 0.
  - AC3: `skills/postmaster/SKILL.md` preconditions run
    `<tool>/scripts/link-skills.sh --check`, name any missing link and the one
    install command; `scripts/skill-refs.sh` stays clean.
  - AC4: `scripts/link-skills.sh --self-test` passes, with a control showing a
    missing link reported and a complete set passing.
  - Gate: the waybill's gate from the worktree root.
- **Constraints**: links only, never copies, nothing replaced; the check reports
  and never installs; installing stays on the user's word.

## Direction check

- Reuse `scripts/link-skills.sh` as it is: the check is a read-only mode of that
  script, over the plan it already computes; the install and remove paths keep
  their links-only, no-replacement behaviour.
- The check reports; installing stays on the user's word: the runbooks show the
  check or dry-run output first, and no script installs on a check.
- Deterministic work in `scripts/` (project rule 3): runbooks call the check,
  they do not re-derive it.
- Every count needs a control (project rule 5): missing and complete sets go
  through the identical check command.
- Script paths in `skills/postmaster/` go through `<tool>`
  (`scripts/skill-refs.sh`).

## Structure

- `scripts/link-skills.sh`: add `--check` (report-only) and the AC4 self-test
  controls; update the usage line.
- `AGENTS.md`: setup installs on the user's word after showing the dry run
  (the dry-run-then-install lines already exist; the change is gating the
  install on the user's word); step 1 reports the check result as part of "is
  this machine set up?".
- `skills/postmaster/SKILL.md`: preconditions run the check and name missing
  links with the one install command.
- `README.md`: the `link-skills.sh` command line and "Installing the skills"
  mention `--check`.

## Decisions

1. **Where the check lives.** `scripts/link-skills.sh --check`, not a new
   script: the direction says reuse that script, and the gate already runs its
   self-test, which is where the AC4 controls belong.
2. **Read-only.** The check never creates, replaces or removes anything. It
   exits non-zero when a link is missing or a path is in the way, and zero when
   the set is complete. Exact output wording is the implementer's choice; it
   must name each missing or blocked link and the one command that installs them.
3. **What fails.** A link the installer would have to make, or a path in the
   way of one. An uninstalled harness, a harness with no skills folder, and a
   folder shared with another harness are not missing links and pass.
4. **Setup vs a present config.** Missing config means the whole setup
   conversation, including the link dry run and an install on the user's word.
   Config present with a failing check is a report plus that same offer, never
   a silent install.
5. **Wiki.** No wiki claim changes; `wiki/concepts/skill-links.md` is left
   alone rather than restating a runbook rule.

## Tasks

- [x] T001 [P] [AC4] Add `--check` to `scripts/link-skills.sh`: read-only, names each missing or blocked link and the install command, exits non-zero on any problem and zero on a complete set; extend `--self-test` with a missing-link-reported control and a complete-set-passes control through the identical `--check` command, hermetic like the existing controls; update the usage line.
- [ ] T002 [AC1] In `AGENTS.md`, make the setup conversation show the user the `scripts/link-skills.sh --dry-run` output and run `scripts/link-skills.sh` only on the user's word.
- [ ] T003 [AC2] In `AGENTS.md` step 1 ("is this machine set up?"), run `scripts/link-skills.sh --check` beside the config check and report missing links as part of the answer; when the config is present and the check fails, offer the install on the user's word.
- [ ] T004 [AC3] In `skills/postmaster/SKILL.md` preconditions, run `<tool>/scripts/link-skills.sh --check`, name any missing or blocked link, and name `<tool>/scripts/link-skills.sh` as the one command that installs them; leave `scripts/skill-refs.sh` clean.
- [ ] T005 [P] In `README.md`, mention `--check` on the `link-skills.sh` command line and in "Installing the skills".
- [ ] T006 [AC1] [AC2] [AC3] [AC4] Run the project gate from the worktree root and confirm every self-test, including the new `link-skills.sh` controls, passes.
