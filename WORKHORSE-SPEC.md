# Workhorse spec: 108 The front door runs the stream when it can

## Summary

The front door must carry on as the postmaster in the session the user opened whenever that
session is already on `team.postmaster`'s harness and model, in the target repo, with the user
at the terminal; a separate postmaster is spawned only when one of those fails. This workhorse
adds `scripts/front-door.sh`, which makes that choice from the session's own report of itself,
the target and the config, and rewrites `SKILL.md`, `postmaster.md`, `AGENTS.md` and `README.md`
so nothing still says the front door never runs the stream.

## Technical context

- **Language and version**: bash with a Python 3.11 heredoc for config parsing, matching the
  other scripts in `scripts/`.
- **Dependencies used or added**: none beyond what the scripts already use (`tomllib`, `git`).
- **Testing**: `bash -n scripts/*.sh`; `scripts/front-door.sh --self-test`; the project gate
  `bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for f in $(grep -l -- --self-test scripts/*.sh); do "$f" --self-test || exit 1; done'`;
  `grep` over `AGENTS.md`, `README.md`, `skills/postmaster/SKILL.md` and
  `skills/postmaster/postmaster.md` for the phrases the ticket retires.
- **Constraints**: the entry flow only — the waybill template in `SKILL.md`, the markers, the
  turnpike table and completion detection stay as they are. Deterministic work goes in
  `scripts/`, not prose. Script paths in runbooks go through `<tool>`. Nothing
  harness-specific or repo-specific in the flow.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| The session the user opens is the postmaster when it can be | `front-door.sh` prints `self` when the session's harness and model match `team.postmaster`, the target is the repo of its cwd, and it reports a person at the terminal; `SKILL.md` then carries on in this conversation and starts `postmaster.md` |
| A separate postmaster is spawned only when it has to be | `front-door.sh` prints `spawn` on exactly one of: harness differs, model differs, target is another repo, nobody at the terminal; `SKILL.md` keeps today's spawn path only then |
| A session that only opens another session adds complexity for no gain | the `self` path adds no second session, no brief hand-off between tabs, and no new contract |
| Deterministic work goes in `scripts/` | the self/spawn choice and its controls live in `scripts/front-door.sh`, not in the runbook's prose |
| Nothing harness-specific in the flow | the script takes the session's harness and model as a report; the runbooks name no harness when stating the rule |
| Script paths in runbooks go through `<tool>` | every new reference is `<tool>/scripts/front-door.sh` |
| Out of scope: the waybill, coachman dispatch, a headless postmaster's escalations | those files and sections are not changed beyond the entry wording the ticket names |
| This changes the entry flow, not the coachman contract | `SKILL.md`'s waybill template, `coachman.md`, markers and turnpike tables are untouched |

## Structure

- `scripts/front-door.sh` — new. `front-door.sh <harness> <model> <cwd> <at-terminal> <target>
  [--config <path>]` prints `self` or `spawn <reason>`; `--self-test` with a positive and a
  negative control for each reason it can print.
- `skills/postmaster/SKILL.md` — Stage 0 runs the decision, the launch card names the outcome
  and the reason, the `self` path carries on as the postmaster with the same records a spawned
  one keeps, the spawn path stays; opening paragraph, frontmatter description and hard rules
  drop "never runs the stream".
- `skills/postmaster/postmaster.md` — the opening no longer assumes it was spawned; the brief
  and `<runs>/postmaster/` records are what a front-door postmaster writes and reads.
- `AGENTS.md` — "Launch the postmaster" becomes "carry on or launch"; the role table and the
  front-door paragraph stop saying `SKILL.md` always spawns.
- `README.md` — "launches a postmaster" becomes "is the postmaster, or launches one"; the
  scripts list gains `front-door.sh`.

## Complexity tracking

None.

## Decisions

1. **Harness and model are separate reasons.** AC2 lists "harness or model differs" as one
   case, but a launch card that says which of the two differs is more useful, and each gets its
   own positive and negative control. The script prints `spawn harness …` or `spawn model …`.
2. **"The repo it runs in" is the git repository, not the path.** A session in a worktree of
   the target is in the target's repo. The script compares `git rev-parse --path-format=absolute
   --git-common-dir` of the session's cwd and of the target.
3. **Model ids are compared as written.** No stripping of `[1m]` suffixes or provider prefixes:
   the session reports the model it is on, and the config names the model the postmaster should
   run on. A mismatch is a real mismatch; representation is the caller's to get right.
4. **Reasons are checked in AC2's order**: harness, model, target, terminal. The first mismatch
   is the reason printed, so a launch card names one cause, not a pile.
5. **`at-terminal` is a word the session reports**, `yes` or `no`. The script does not probe
   for a tty: a headless launch on a tty is still nobody at the terminal, and an interactive
   session reached over a socket still has the user.
6. **The decision script is not a control.** `controls.md` lists scripts whose faults stop a
   leg. A fault in `front-door.sh` is put to the user as any other script's would be; the
   choice can be made by hand and the ticket does not ask for this change.
7. **Output is one line**, `self` or `spawn`, then a space and the reason text. The first word
   is the machine-readable choice; the rest is for the launch card.

## Tasks

- [ ] T001 [P] [AC4] Write `scripts/front-door.sh`: decide from session harness, model, cwd,
      at-terminal, target and config; print `self` or `spawn <reason>`; `--self-test` with a
      positive and a negative control for each reason (harness, model, target, terminal).
- [ ] T002 [AC1] [AC2] [AC3] [AC5] Rewrite `skills/postmaster/SKILL.md` Stage 0: run the
      decision, put the outcome and reason on the launch card, carry on as the postmaster when
      it prints `self` (writing `<runs>/postmaster/brief.md` and logging from the first action
      as a spawned one does), spawn only when it prints `spawn`. Drop "You do not run the
      stream yourself" and the hard rule that says bootstrap never runs the stream.
- [ ] T003 [AC6] Update `skills/postmaster/postmaster.md` so it does not assume it was
      spawned; note that a front-door postmaster keeps the same `<runs>/postmaster/` records.
- [ ] T004 [AC6] Update `AGENTS.md` and `README.md`: nothing says the front door never runs
      the stream or always spawns a postmaster; the scripts list gains `front-door.sh`.
- [ ] T005 [AC1] [AC2] [AC4] [AC6] Run the project gate and a phrase grep over the four
      documents the ticket names.
