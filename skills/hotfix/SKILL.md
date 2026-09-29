---
name: hotfix
description: 'Fix a fault in postmaster itself while runs are in flight: a ticket, a worktree from origin/main, the fix with a control that fails before it and passes after, a pull request titled #<ticket>, <title>, the merge under ship.merge_authority, a pull of the main checkout, and then — for every run in flight — how the fix reaches it: through the checkout it calls postmaster from where it can, and as the fix commit alone where it cannot, never as a merge of main. Use when a run met a fault in a script, a self-test or a runbook and the user says fix it now.'
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

`<tool>` in this skill is the postmaster repo this skill lives in. The skill is installed as
a link into it, never as a copy. Find it once, from `<skill>`: the absolute path of the
directory your harness loaded this file from, or `skills/hotfix` when `AGENTS.md` sent a
session in the repo here.

```sh
t=$(CDPATH= cd -P -- "<skill>/../.." 2>/dev/null && pwd) && test -f "$t/scripts/hotfix-reach.sh" && echo "$t" || { echo "hotfix: <skill> is not a link into a postmaster checkout" >&2; false; }
```

It prints `<tool>`. Write that absolute path wherever this skill says `<tool>`. If it prints
the error instead, stop and tell the user: the skill was copied, or its link points
somewhere else.

## What you are fixing

Postmaster itself: a script in `<tool>/scripts/`, a runbook under `skills/`, a check in the
gate, a self-test that lies. Not a target project's code — that is a run's own ticket. The
fault comes from a run's `tool-fault` line (`<tool>/scripts/tool-faults.sh harvest`), from
the user, or from anything this repo's own gate shows.

**Confirm the fault with the user before you start**, in one short paragraph: what ran, what
failed, and the fix you propose. A hotfix is a change to the tool every live run calls; it
gets a ticket and a control like any other.

## The journey

Every step below is logged through `<tool>/scripts/log-action.sh` as it happens. The
hotfix session's own actions go under `<tool>/.postmaster/runs/hotfix/` (create the
directory first; the script needs it). Later steps log to each affected run's dispatch as
well, and every line lands in the project ledger too.

```sh
mkdir -p <tool>/.postmaster/runs/hotfix
```

### 1. A ticket

Draft it in the ticket shape (`<tool>/scripts/ticket-check.sh` judges it): a title,
`## Problem / feature`, numbered `## Acceptance criteria` each answerable yes or no,
`## Direction` (the user's word, or the fix you propose and they approved),
`## Turnpikes` (`default` for a change to the flow itself). Keep it about the postmaster
fault: what failed, the cause, the failing control, and the fix. Do not publish target
project names, paths, code, ticket text, run ids, machine details or credentials from the
affected run. Check it before you file it:

```sh
<tool>/scripts/ticket-check.sh --body <draft-file> --title "<title>" --project <tool>
```

Log `ticket-check`. File it on this repo's tracker the way
`<tool>/skills/postmaster/trackers.md` says (GitHub Issues on the board, or the local store
when there is one). Read its number and title back, set it in progress, and log both
writes. If the tracker cannot create a ticket, stop and report the adapter's error.

### 2. A worktree from `origin/main`

The main checkout must be clean and on `main`. Fetch, then cut the hotfix worktree from
`origin/main`; never from a run's branch:

```sh
git -C <tool> status --short --branch
git -C <tool> fetch origin main
git -C <tool> worktree add <tool>/.worktrees/hotfix-<ticket> -b hotfix/<ticket> origin/main
```

That worktree is where you work. Log `note` with the worktree and branch.

### 3. The fix, with a control that fails before it and passes after

This is the judgment part. The fix is yours to write; the control is not optional.

A **control** is a command that could have come out the other way: a self-test assertion, a
`bash -n`, a script's own `--self-test`, a check that reproduces the fault. **Write the
control first. Run it. It must fail** on the broken code, for the reason the fault names —
not for some unrelated error. If it passes, check whether the fault is already fixed or the
control is wrong; do not proceed with a false control. Then write the fix. **Run the
control again. It must pass.** Then run the postmaster gate from the worktree's root, and
log every exit.

Keep the hotfix branch to **one commit**, amending as you go. Its subject starts
`#<ticket>, <title>`, so the propagation script can verify it is the one fix commit. The
fix commit must contain only the files for this fault. Log the commit.

### 4. A pull request titled `#<ticket>, <title>`

```sh
git -C <tool>/.worktrees/hotfix-<ticket> push -u origin hotfix/<ticket>
gh pr create --title "#<ticket>, <title>" --body-file <pr-body>
```

The title is `#<ticket>, <title>`: the ticket number first, then the ticket's title. The
body says what was wrong, what the control showed before and after, the gate result, and
links the ticket. Log `note` with the PR number.

### 5. The merge under `ship.merge_authority`

Read `ship.merge_authority` from `~/.postmaster/config.toml` (the shape is
`<tool>/config.example.toml`).

- `user`: put the PR in front of the user and wait for their word. Do not infer it from
  review approval or from a check passing.
- `postmaster`: merge only after the control, the gate, the required checks and review
  pass.

Merge preserving the single fix commit, for example `gh pr merge <number> --rebase`. If
the merge creates a merge commit instead, the fix commit is the one commit that changes
the files, not the merge commit. Log `merge` with the PR number.

### 6. A pull of the main checkout

Confirm the PR is merged, then make sure `<tool>` is clean and on `main` and
fast-forward it:

```sh
git -C <tool> pull --ff-only origin main
```

The live main checkout now serves the fix. Log the pull. Identify the single, non-merge
commit on main that carries the fix and confirm it is an ancestor of `<tool>`'s `HEAD`.
The propagation script refuses anything else. Set the ticket to done and log the state
change.

### 7. How the fix reaches every run in flight

`<tool>/scripts/hotfix-reach.sh` is the deterministic half. **Report first**, so you and
the user see what is needed before anything moves:

```sh
<tool>/scripts/hotfix-reach.sh report <fix-commit>
```

With no roots it covers the machine config's projects plus this checkout: one line per run
in flight, with one of four reaches:

- **`checkout`** — through the checkout the run calls postmaster from, with nothing on its
  branches. A managed pin that does not yet serve the fix gets the fix commit alone at
  queue time, the way the pulled main checkout already serves it.
- **`branch`** — as the fix commit alone on the run's synthesis and lane branches that
  carry their own copy of a fixed file, at the run's next stop between legs.
- **`next-leg`** — the fix is to a runbook the current leg has already read; it takes
  effect at the next leg, whose prompt is told.
- **`conflict`** — a branch changed the same lines of a fixed file. That branch is **left
  untouched and named** to the user. Whichever merges second resolves the conflict, as the
  user ruled; do not resolve it here.

Then **queue**:

```sh
<tool>/scripts/hotfix-reach.sh queue <fix-commit>
```

It serves the pins and records the branch work in each dispatch, without touching a
branch, and logs every step to the run and the project ledger. Branch commits land when
the postmaster runs `hotfix-reach.sh next-leg` before launching each leg — never mid-leg,
never as a merge of main — and the next leg's prompt says the commit is main's fix. Show
the user the report and what `queue` did.

Remove the hotfix worktree once the fix has landed everywhere it needs to, and log its
removal:

```sh
git -C <tool> worktree remove <tool>/.worktrees/hotfix-<ticket>
```

That is the end of the hotfix: the merged commit, the control exits, the gate result, the
PR, the main pull, the propagation report, and any run left for the user's conflict
resolution.

## Hard rules

- **Never merge main into a run's branch.** A fix reaches a run as the fix commit alone or
  not at all.
- **Never apply a fix commit mid-leg.** Branch commits land at a run's next stop between
  legs, checked against the completed hand-off.
- **A branch that changed the same lines is left untouched**, and the user is told which
  run. The conflict belongs to whichever merges second.
- **The commit message says it is main's fix.** `Main's fix <sha>: <subject>` and a body
  that says so. The next leg's prompt says so too.
- **A control that fails before and passes after is mandatory.** No control, no merge.
- **Every step is logged** through `<tool>/scripts/log-action.sh`, per run and per project.
- **The merge word comes from `ship.merge_authority`**, never from this skill's own
  judgment.
- **Script paths in this skill go through `<tool>`.** A path written without it resolves
  only from the repo's own root and will not work from an installed skill.
