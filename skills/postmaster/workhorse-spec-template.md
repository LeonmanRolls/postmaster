# Workhorse spec template

The coachman copies the block below to `WORKHORSE-SPEC.md` at the synthesis worktree root,
fills it in once per run at this level — what to build, the decisions that matter and the
tests, not the code, so the lanes still choose their own implementation — and commits it
before any code. The user reviews it before implementation: revise it from their words in
a later commit when they ask, and write no code until it is approved. The format is adapted
from GitHub Spec Kit's plan and tasks templates, in one file.

```markdown
# Workhorse spec: <ticket id> <ticket title>

## Summary

<The ticket's requirement in one sentence, and the approach the run will take.>

## Technical context

<Only the lines that apply.>

- **Language and version**:
- **Dependencies used or added**:
- **Testing**: <the commands that will show each acceptance criterion is met>
- **Constraints**: <from the ticket's direction and the project's own rules>

## Direction check

<Each constraint in the ticket's direction and in the project's own rules (its AGENTS.md or
equivalent), and how this plan meets it. A departure goes in the table under Complexity
tracking.>

## Structure

<The files and directories the work will create or change.>

## Complexity tracking

<Only if the direction check has a departure.>

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|

## Decisions

<Each choice the ticket left open, and what this spec chose. There is no one to ask during
the run: decide, and record it here.>

## Showing each criterion

For each acceptance criterion, copy its full wording from the ticket and specify the check that
shows it working the way it will really be used: the command, input and expected output, or the
steps through the user surface and what each should show.

| # | Criterion, as the ticket words it | Check (command and input) | Expected output |
|---|---|---|---|
| AC1 | <the criterion in full, word for word from the ticket> | <the command and the input, or the steps through the user surface> | <what the command prints and its exit, or what each step should show> |

## Tasks

Format: `- [ ] T<n> [P] [AC<n>] <description, with exact file paths>`.
`[P]` marks a task that depends on no other. `[AC<n>]` names the acceptance criterion the
task serves. Every acceptance criterion has at least one task.

- [ ] T001 [AC1] <description>
```

Tasks may be ticked in later commits as they are done. A task dropped or added along the way
is noted in `WORKHORSE-SUMMARY.md`. The commit that first adds `WORKHORSE-SPEC.md` is the record of intent
and is not rewritten.

`## Showing each criterion` is how the lanes check their work: for each acceptance criterion,
the check that shows it working the way it will really be used — the command, the input and the
expected output, or the steps through the user surface and what each should show. The user
reviews those checks with the rest of the spec.
