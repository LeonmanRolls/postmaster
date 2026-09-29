# Workhorse spec: 106 Tell the user to say hi

## Summary

Update the README and AGENTS.md so a user opening an agent in a clone knows to say hi and the first message starts the documented flow.

## Technical context

- **Language and version**: Markdown
- **Dependencies used or added**: None
- **Testing**: Review the README Getting started and the session-opening passage in AGENTS.md against all three acceptance criteria; run the required project gate.
- **Constraints**: Keep the edit minimal and in the files' own voice. This ticket covers the clone only. Do not change the postmaster command or other flow.

## Direction check

- The README Getting started will tell the user to open the agent in the clone and say hi.
- The AGENTS.md session-opening passage will say the user opens the agent in this folder and says hi, and that any first message starts the flow.
- Both files will be reviewed for wording that suggests the agent starts without a user message.
- Only the two named passages will change. No script paths or deterministic checks are involved, and the required gate includes wiki linting.

## Structure

- Change `README.md` Getting started.
- Change the session-opening passage in `AGENTS.md`.
- Add `WORKHORSE-SPEC.md` and `WORKHORSE-SUMMARY.md` as required workhorse records.

## Decisions

- Use “say hi” in both entry points, as requested.
- Keep the instructions for setup and project selection after the first-message trigger in AGENTS.md.
- Add no scripts or tests; run the required gate and review the two edited passages.

## Tasks

- [ ] T001 [P] [AC1] Update the clone instructions in `README.md` Getting started to say open the agent in the clone and say hi.
- [ ] T002 [P] [AC2] Update the session-opening passage in `AGENTS.md` to name hi as the first message and state that any first message starts the flow.
- [ ] T003 [P] [AC3] Sweep all of `README.md` and `AGENTS.md` for wording that says or implies the agent starts on its own.
