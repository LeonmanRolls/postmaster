# Workhorse spec: #92 Check skill links during setup

## Summary

Make skill-link setup visible and verifiable by reusing `scripts/link-skills.sh` for a dry run, an explicit install on the user's word, and checks from machine setup and the postmaster start.

## Technical context

- **Language and version**: Bash, with Python in heredocs where the existing script uses it.
- **Dependencies used or added**: Existing shell scripts and harness skill directories; no new dependencies.
- **Testing**: Run `scripts/link-skills.sh --self-test` for missing-link and complete-set controls, then run the project gate with `/home/brindlewick/.postmaster/tool-pins/ffe37821779aa7cc77275860573a8fdd43cd6e2d/scripts/verify.sh run .`.
- **Constraints**: Preserve the installer’s links-only behavior; never copy or replace existing entries. A check reports missing links without installing them. Show the dry run before asking the user whether to install.

## Direction check

- Reuse `scripts/link-skills.sh`; preserve its links-only, no-replacement behavior and add a report-only check for the setup and postmaster start.
- Keep installation on the user's word: show `scripts/link-skills.sh --dry-run` first and run the installer only after the user agrees.
- Report each missing skill link and the installation command from machine setup and `skills/postmaster/SKILL.md`.
- Add positive and negative self-test controls: a missing link is reported, and a complete set passes.
- Follow the repository rule that deterministic checks belong in scripts and keep harness-specific details behind the existing skill-link script.

## Structure

- `scripts/link-skills.sh`: add a report-only link check and self-test controls for missing and complete link sets.
- `AGENTS.md`: make machine setup check link status, show the dry run, and install after the user's agreement.
- `skills/postmaster/SKILL.md`: check link status at startup and report the install command for missing links.

## Decisions

- Add a report-only mode to `scripts/link-skills.sh` and exercise it through the script's self-test; this keeps path discovery and link validation beside the existing installer.
- Keep the installation prompt in setup instructions. The check and dry run do not create links.
- Treat a complete set as success and a missing set as a reported, non-installing result so setup can state what needs action.

## Tasks

- [ ] T001 [P] [AC1] Update `AGENTS.md` setup instructions to show `scripts/link-skills.sh --dry-run` and run installation only after the user's agreement.
- [ ] T002 [P] [AC2] Add a link-status check to step 1 of `AGENTS.md` and include its result in the setup answer.
- [ ] T003 [P] [AC3] Add a startup link check and missing-link install command to `skills/postmaster/SKILL.md`.
- [ ] T004 [P] [AC2] [AC3] Add report-only missing-link checks to `scripts/link-skills.sh` for setup and postmaster startup.
- [ ] T005 [P] [AC4] Add self-test controls in `scripts/link-skills.sh` proving missing links are reported and a complete set passes.
