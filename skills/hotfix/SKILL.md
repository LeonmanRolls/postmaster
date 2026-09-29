---
name: hotfix
description: 'Fix a fault in postmaster itself while runs are in flight: a ticket, a worktree from origin/main, the fix with a control that fails before it and passes after, a pull request titled #<ticket>, <title>, the merge under ship.merge_authority, a pull of the main checkout, and then — for every run in flight — how the fix reaches it: through the checkout it calls postmaster from where it can, and as a lone fix commit where it cannot, never as a merge of main. Use when a run met a fault in a script, a self-test or a runbook and the user says fix it now.'
---

# /hotfix: a fault in postmaster to a merged fix, and to every run in flight

A run never fixes postmaster; it records the fault and works around it (`coachman.md`,
Tool faults). This skill is what happens when the user says to fix one now: the fix goes
through the same shape as any change — a ticket, a worktree, a control, a pull request, the
merge word — and then reaches every run already in flight. It never tells a run to pull the
latest main, which would bring unrelated changes into its branch mid-run. A fix reaches a
run through the checkout it calls postmaster from where it can, and as the fix commit alone
where it cannot.

## First: find the postmaster repo

`<tool>` in these runbooks is the postmaster repo this skill lives in. The skill is installed
as a link into it, never as a copy. Find it once, from `<skill>`: the absolute path of the
directory your harness loaded this file from, or `skills/hotfix` when `AGENTS.md` sent a
session in the repo here.

```sh
t=$(CDPATH= cd -P -- "<skill>/../.." 2>/dev/null && pwd) && test -f "$t/scripts/hotfix-reach.sh" && echo "$t" || { echo "hotfix: <skill> is not a link into a postmaster checkout" >&2; false; }
```

It prints `<tool>`. Write that absolute path wherever these runbooks say `<tool>`. If it
prints the error instead, stop and tell the user: the skill was copied, or its link points
somewhere else.

## What you are fixing

Postmaster itself: a script in `<tool>/scripts/`, a runbook under `skills/`, a check in the gate, a
self-test that lies. Not a target project's code — that is a run's own ticket. The fault
comes from a run's `tool-fault` line (`<tool>/scripts/tool-faults.sh harvest`), from the
user, or from anything this repo's own gate shows.

**Confirm the fault with the user before you start**, in one short paragraph: what ran, what
failed, and the fix you propose. A hotfix is a change to the tool every live run calls; it
gets a ticket and a control like any other.

## The journey

Every step below is logged. The postmaster's own actions go under `<runs>/hotfix/`, where
`<runs>` is this repo's `.postmaster/runs` (create the directory first; `<tool>/scripts/log-action.sh`
needs it). Later steps log to each affected run's dispatch as well.

```sh
mkdir -p <tool>/.postmaster/runs/hotfix
```

### 1. A ticket

Draft it in the ticket shape (`<tool>/scripts/ticket-check.sh` judges it): a title, `## Problem / feature`,
numbered `## Acceptance criteria` each answerable yes or no, `## Direction` (the user's word
or the fix you propose and they approved), `## Turnpikes` (`default` for a change to the
flow itself). Check it before you file it:

```sh
<tool>/scripts/ticket-check.sh --body <draft-file> --title "<title>" --project <tool>
```

Log `ticket-check`. File it on this repo's tracker the way `skills/postmaster/trackers.md`
says (GitHub Issues on the board, or the local store when there is one). Log `ticket-create`
with the ticket's id. The ticket is the record of what was wrong and what changed.

### 2. A worktree from `origin/main`

```sh
git -C <tool> fetch origin main
git -C <tool> worktree add <tool>/.worktrees/hotfix-<ticket> -b hotfix/<ticket> origin/main
```

That worktree is where you work. The main checkout stays clean. Log `note` with the
worktree and branch.

### 3. The fix, with a control that fails before it and passes after

This is the judgment part. The fix is yours to write; the control is not optional.

A **control** is a command that could have come out the other way: a self-test assertion, a
`bash -n`, a script's own `--self-test`, a check that reproduces the fault. **Write the
control first. Run it. It must fail** on the broken code, for the reason the fault names —
not for some unrelated error. Then write the fix. **Run the control again. It must pass.**
Run the project's gate on the worktree too:

```sh
cd <tool>/.worktrees/hotfix-<ticket>
# the control, before the fix: must fail
# …the fix…
# the control, after the fix: must pass
(cd scripts && for f in *.sh; do bash -n "$f" || exit 1; done)   # every script parses
```

Record what the control was, what it printed before and what it prints after; the pull
request carries that evidence. A fix with no control is not a hotfix, it is a guess.

Commit the fix in the worktree. One change per commit is fine; the PR is the unit.

### 4. A pull request titled `#<ticket>, <title>`

```sh
git -C <tool>/.worktrees/hotfix-<ticket> push -u origin hotfix/<ticket>
gh pr create --repo <owner/postmaster> --base main --head hotfix/<ticket> \
  --title "#<ticket>, <title>" --body-file <pr-body>
```

The title is `#<ticket>, <title>`: the ticket number first, then the ticket's title. The
body says what was wrong, what the control showed before and after, and links the ticket.
Log `note` with the PR number.

### 5. The merge under `ship.merge_authority`

Read `ship.merge_authority` from `~/.postmaster/config.toml` (the shape is
`<tool>/config.example.toml`). **`user`:** put the PR in front of the user and wait for
their word; deliver it to `gh pr merge` verbatim. **`postmaster`:** the word is yours to
give. Either way, merge as a merge commit on main — the PR is reviewed like any other
change; a hotfix is not a back door around the gate.

```sh
gh pr merge <number> --merge   # or the user's word, recorded
```

Log `merge` with `granted` and the PR number.

### 6. A pull of the main checkout

```sh
git -C <tool> checkout main && git -C <tool> pull --ff-only origin main
```

The live main checkout now serves the fix. This is what "through the checkout it calls
postmaster from" means for any run whose tool *is* this checkout. A run whose tool is a
pinned checkout at an earlier commit gets the fix another way — the reach step below.

### 7. How the fix reaches every run in flight

`<tool>/scripts/hotfix-reach.sh` is the deterministic half. **Report first**, so you and the
user see what is needed before anything moves:

```sh
<tool>/scripts/hotfix-reach.sh report <tool>/.postmaster/runs <fix-commit>
```

One line per run in flight, with one of four reaches:

- **`checkout`** — through the checkout the run calls postmaster from, with nothing more to
  do on its branch. Its tool is the main checkout that was just pulled, or a pin; when the
  pin does not yet serve the fix, `apply` puts the fix commit there alone.
- **`branch`** — as the fix commit on the run's branch, because the branch carries its own
  copy of a fixed file (a postmaster-as-target run always does). `apply` puts the commit on
  the branch at the run's next stop between legs — never mid-leg — and never merges main in.
- **`next-leg`** — the fix is to a runbook the current leg has already read; it takes effect
  at the next leg, which reads the runbook again. `apply` notes it in the next leg's prompt.
- **`conflict`** — the run's branch changed the same lines of a fixed file. That run is
  **left untouched and named** to the user. Whichever merges second resolves the conflict,
  as the user ruled; do not resolve it here.

Then **apply**:

```sh
<tool>/scripts/hotfix-reach.sh apply <tool>/.postmaster/runs <fix-commit>
```

It commits the fix alone where a run needs it, writes `<dispatch>/hotfix-notes.md` and tells
the next leg's prompt that the commit is main's fix, and logs every step through
`<tool>/scripts/log-action.sh` to the run and to the project ledger. It never merges main
into a run's branch. A run mid-leg is left for its next boundary; run `apply` again then,
or when the postmaster next polls (`skills/postmaster/postmaster.md`, Stage C).

Show the user the report and what `apply` did. That is the end of the hotfix.

## Hard rules

- **Never merge main into a run's branch.** A fix reaches a run as the fix commit alone or
  not at all.
- **Never apply a fix commit mid-leg.** `apply` waits for a run's next stop between legs.
- **A run whose branch changed the same lines is left untouched**, and the user is told
  which run. The conflict belongs to whichever merges second.
- **The commit message says it is main's fix.** `Main's fix <sha>: <subject>` and a body
  that says so. The next leg's prompt says so too.
- **A control that fails before and passes after is mandatory.** No control, no merge.
- **Every step is logged** through `<tool>/scripts/log-action.sh`, per run and per project.
- **The merge word comes from `ship.merge_authority`**, never from this skill's own
  judgment.
- **Script paths in this skill go through `<tool>`.** A path written without it resolves
  only from the repo's own root and will not work from an installed skill.
