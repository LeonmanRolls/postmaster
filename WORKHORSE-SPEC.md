# Workhorse spec: #105 Show run and launch identity in session labels

## Summary

Put each run's ticket name on its Herdr space and give every launch a short role, lane, model, and leg or review-round label, with all run launches placed under that space.

## Technical context

- **Language and version**: Bash, with Python 3 for JSON and waybill parsing, matching the existing scripts.
- **Dependencies used or added**: Existing `herdr`, `git`, and `scripts/host.sh` dependencies; no new dependency.
- **Testing**: `scripts/host.sh --self-test` for isolated label and placement controls; `scripts/host.sh --live-test` for Herdr and Moshi-visible placement on this machine; the requested project gate through `scripts/verify.sh run .`.
- **Constraints**: Preserve the documented host forms and harness adapter. Keep runbook script references through `<tool>`. Keep the ticket title on the run space and out of launch labels. Keep all changes in this worktree and do not push.

## Direction check

Each tree level adds one identity: the project space keeps the project name, the synthesis worktree space carries the ticket number and title, and each tab and pane carries its launch identity. `host.sh` will use the dispatch waybill and its recorded `run.json` config rather than hardcoded project, tracker, host, or model values. Labels remain arguments to Herdr and harness launch metadata, never shell code. The script will keep the naming and placement controls together with the host adapter documentation, and its self-test will include positive and negative controls.

## Structure

- Change `scripts/host.sh` to build concise launch labels, associate a launch with its dispatch, place every run launch in the run's Herdr space, and strengthen its self-test and live-test.
- Change `skills/postmaster/hosts.md` to document the updated `name` and `run` forms, the run-space tree, and postmaster label.
- Change `skills/postmaster/coachman.md` and `skills/postmaster/postmaster.md` to pass the run identity and role details at all host launch sites.
- Change `skills/postmaster/SKILL.md` so the project-level postmaster launch label is just its role.

## Decisions

- Use the synthesis worktree's Herdr workspace as the run level, labeled from `Dispatch.name`; place coachman, workhorse, and reviewer launch tabs there, each with its actual working directory. This matches the existing runbook's one synthesis worktree per ticket and keeps the ticket visible once above the launches.
- Use the immutable config in `run.json` for launch model names. Workhorses and reviewers get their lane first; a coachman gets its role first. Add the leg number or review round last where applicable.
- Place a security-review clone in a tab under its run's workspace. Do not open the clone as a separate workspace.
- Reuse the root tab and pane returned when `host.sh` opens a project or run workspace, and rename the tab to the launch label before starting the launch.
- Label the project-scoped interactive postmaster `postmaster`; the containing project space already supplies the project identity and no run ticket belongs on that launch.
- Keep launch labels on tmux windows and harness thread names consistent with the new role-first labels; the run-level Herdr workspace carries the ticket identity.

## Tasks

- [ ] T001 [AC1] [P] Update `scripts/host.sh` name construction to use the recorded lane or role model and explicit leg or review-round identity, without ticket text in launch labels.
- [ ] T002 [AC2] [AC3] [AC4] Update `scripts/host.sh` Herdr placement so a dispatch's synthesis worktree is the ticket-labeled run space, all launch tabs including security clones sit under it, and the first tab is used by a launch rather than left empty.
- [ ] T003 [AC5] Add `scripts/host.sh --self-test` controls for coachman legs, workhorses, style/bug/security review rounds, postmaster labels, and the ticket-bearing run space.
- [ ] T004 [AC6] Extend `scripts/host.sh --live-test` to verify role-first labels and run nesting end to end on this machine.
- [ ] T005 [AC1] [AC2] [AC3] [AC4] Update `skills/postmaster/hosts.md`, `skills/postmaster/coachman.md`, `skills/postmaster/postmaster.md`, and `skills/postmaster/SKILL.md` to document and call the new forms.
