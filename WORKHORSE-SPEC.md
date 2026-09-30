# Workhorse spec: 92 Report missing skill links at setup and at the postmaster start

## Summary

#15 installed `scripts/link-skills.sh`, but setup and the postmaster start never check whether
the links are in place, so a machine can finish setup with no `/postmaster` skill. This
workhorse adds a read-only `--check` to the existing link script, wires that check into
`AGENTS.md` step 1 and into `skills/postmaster/SKILL.md`'s precondition, and makes the setup
conversation install only on the user's word.

## Technical context

- **Language and version**: bash (the project's scripts), markdown runbooks
- **Dependencies used or added**: none; reuses `scripts/link-skills.sh` and its `plan`/`report`
- **Testing**:
  - AC1: `AGENTS.md` setup section names `scripts/link-skills.sh --dry-run`, showing the
    user, and install only on the user's word; `bash -n scripts/link-skills.sh` and
    `scripts/link-skills.sh --self-test` still pass
  - AC2: `AGENTS.md` step 1 runs `scripts/link-skills.sh --check` as part of "is this
    machine set up?"
  - AC3: `skills/postmaster/SKILL.md` runs `<tool>/scripts/link-skills.sh --check` in its
    preconditions and names missing links plus the one install command;
    `scripts/skill-refs.sh` stays clean
  - AC4: `scripts/link-skills.sh --self-test` has a positive control (missing link is
    reported, non-zero) and a negative control (complete set passes, zero) through the
    identical `--check` command
  - Gate: `bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in … link-skills …; do scripts/$n.sh --self-test || exit 1; done'`
    from the worktree root
- **Constraints**:
  - Direction: reuse `scripts/link-skills.sh` as it is — links only, never copies, nothing
    replaced. The check reports; installing stays on the user's word.
  - Design rule 3: the deterministic check belongs in `scripts/`, not prose.
  - Design rule 5: the check's count has a positive and a negative control through the
    identical command.
  - `skills/postmaster/` script paths go through `<tool>` (`scripts/skill-refs.sh`).
  - `scripts/link-skills.sh` is already in the project gate's self-test list; a new script
    would not be, and this run is held to the checks recorded at dispatch.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Reuse `scripts/link-skills.sh` as it is | The installer is not rewritten. `--check` is a read-only mode over the existing `plan` verdicts (`linked`, `link`, `in-the-way`, …). `make_links` and `remove_links` keep their current behaviour: links only, never copies, nothing replaced. |
| Links only, never copies, nothing replaced | Unchanged code paths. `--check` never calls `ln`, `rm` or `mkdir`. |
| The check reports | `--check` prints each missing or blocked path and exits non-zero when any is found; it never installs. |
| Installing stays on the user's word | `AGENTS.md` and `SKILL.md` say to show the dry run and install only when the user agrees. No script auto-installs on a check. |
| Deterministic work in `scripts/` | The check is `scripts/link-skills.sh --check`; the runbooks call it. |
| Every count needs a control | Self-test: a complete set exits 0; a removed link exits 1 and names the path; same `--check` command both times. |
| Script paths in `skills/postmaster/` go through `<tool>` | `SKILL.md` names `<tool>/scripts/link-skills.sh`. |

## Structure

| File | Change |
|---|---|
| `scripts/link-skills.sh` | Add `--check` (report missing/blocked links, exit 1 if any). Extend `--self-test` with the two controls. Update the usage line. |
| `AGENTS.md` | Step 1 runs `scripts/link-skills.sh --check` and reports missing links as part of "is this machine set up?". Setup installs on the user's word after the dry run. |
| `skills/postmaster/SKILL.md` | Preconditions run `<tool>/scripts/link-skills.sh --check`, name any missing link, and name `<tool>/scripts/link-skills.sh` as the one install command. |
| `README.md` | Command list and "Installing the skills" mention `--check`. |

## Complexity tracking

No departures.

## Decisions

1. **Where the check lives.** `scripts/link-skills.sh --check`, not a new script. The
   direction says reuse that script; the project gate already runs its `--self-test`, and a
   new script would not be in the gate this run is held to.
2. **What counts as a problem.** Verdicts `link` (would be made) and `in-the-way` fail the
   check. `linked`, `shared`, `absent` and `no-folder` pass: an uninstalled harness or one
   with no skills folder is not a missing link.
3. **Check output.** Reuse `report()` for each problem line, then a single line naming
   `scripts/link-skills.sh` (or `<tool>/scripts/link-skills.sh` in `SKILL.md`) as the
   install command. On a complete set, one short line and exit 0. The check never installs.
4. **Setup vs a present config.** Missing config means the whole setup conversation,
   including the link dry-run and an install on the user's word. Config present with a
   failing check is a report plus that same offer, never a silent install.
5. **Wiki.** No wiki claim is changed by a check mode; `wiki/concepts/skill-links.md` is
   left alone rather than restating a runbook rule.

## Tasks

- [ ] T001 [P] [AC4] Add `--check` to `scripts/link-skills.sh`: report `link` and `in-the-way` lines via `report()`, name the install command, exit 1 on any problem and 0 on a complete set; extend `--self-test` with a positive control (missing link reported) and a negative control (complete set passes) through the identical command; update the usage line.
- [ ] T002 [AC1] In `AGENTS.md`, make the setup conversation run `scripts/link-skills.sh --dry-run`, show the user what it would link, and install with `scripts/link-skills.sh` only on the user's word.
- [ ] T003 [AC2] In `AGENTS.md` step 1 ("is this machine set up?"), run `scripts/link-skills.sh --check` beside the config check and report missing links as part of the answer; when the config is present and the check fails, offer the install on the user's word.
- [ ] T004 [AC3] In `skills/postmaster/SKILL.md` preconditions, run `<tool>/scripts/link-skills.sh --check`, name any missing or blocked link, and name `<tool>/scripts/link-skills.sh` as the one command that installs them; leave `scripts/skill-refs.sh` clean.
- [ ] T005 [P] In `README.md`, list `--check` on the `link-skills.sh` line and in "Installing the skills".
- [ ] T006 [AC1] [AC2] [AC3] [AC4] Run the project gate from the worktree root and confirm every self-test, including the new `link-skills.sh` controls, passes.
