---
name: hotfix
description: 'Repair a fault in postmaster through a ticket, a controlled fix from origin/main, a pull request, and safe propagation to runs in flight.'
---

# /hotfix: repair postmaster

Use this skill when a postmaster script, self-test, adapter or runbook fails. It keeps the fix
on its own branch and carries only that fix to runs that need it.

## Find the postmaster checkout

`<tool>` is the postmaster checkout this skill is linked from. Resolve it once:

```sh
t=$(CDPATH= cd -P -- "<skill>/../.." 2>/dev/null && pwd) && test -f "$t/scripts/hotfix.sh" && echo "$t" || { echo "hotfix: this skill is not linked into a postmaster checkout" >&2; false; }
```

Use the printed path as `<tool>`. Stop if the command fails. The skill must be linked, not
copied.

## Record the fault and open its ticket

If the fault came from an active run, make sure the run recorded it first with
`<tool>/scripts/log-action.sh ... tool-fault`. A coachman stops on a faulty control and never
edits postmaster from the ticket branch. The supervising postmaster may fix the recorded fault
now with this skill; the run still finishes on its own work.

Use `<tool>/.postmaster/runs/postmaster` as the hotfix session's log. Create the directory if
needed. Log each action as it happens, including the fault summary, ticket check, ticket write,
worktree, controls, commit, pull request, merge, main checkout pull, and propagation report.
Use `<tool>/scripts/log-action.sh` with actor `postmaster`; tracker writes use `ticket-create`
or `ticket-state`, checks use `verify`, branch integration uses `merge`, and other steps use
`note`. The script logs propagation actions in each affected run and its project ledger.

Write the ticket using the normal ticket shape from
`<tool>/skills/postmaster/trackers.md`. Keep it about the postmaster fault: what failed, the
cause, the failing control, and the fix. Do not publish target project names, paths, code,
ticket text, run IDs, machine details or credentials from the affected run. Check the draft:

```sh
<tool>/scripts/ticket-check.sh --body <ticket-file> --title "<title>" --project <tool>
```

Use `<tool>/scripts/tracker-kind.sh <tool>` and the matching adapter in
`<tool>/skills/postmaster/trackers.md` to create the ticket on postmaster's tracker. Read its
number and title back, set it in progress, and log both writes. If the tracker cannot create a
ticket, stop and report the adapter's error.

## Cut a hotfix branch from main

The main checkout must be clean and on `main`. Fetch the main branch, then make a new worktree
from `origin/main`; do not branch from the current ticket branch or merge main into a run:

```sh
git -C <tool> status --short --branch
git -C <tool> fetch origin main
mkdir -p <tool>/.worktrees
git -C <tool> worktree add -b hotfix/<ticket> <tool>/.worktrees/hotfix-<ticket> origin/main
```

Log the worktree. Run the exact regression control once before changing code. It must fail.
Log its command and exit. If it passes, check whether the fault is already fixed or whether
the control is wrong; do not proceed with a false control. Make the smallest fix and add the
regression control alongside it. Run the same command again; it must pass. Then run the
postmaster repository gate and the checks its project profile declares. Log every exit.

Commit the fix as one commit. Its subject starts `#<ticket>, <title>` so the propagation script
can identify it. Use the configured author:

```sh
git -C <hotfix-worktree> -c user.name=brindlewick -c user.email=332054101+brindlewick@users.noreply.github.com commit -m "#<ticket>, <title>"
```

The fix commit must contain only the files for this fault. Log the commit through
`log-action.sh`.

## Open and merge the pull request

Push the hotfix branch and open a pull request titled exactly `#<ticket>, <title>`:

```sh
git -C <hotfix-worktree> push -u origin hotfix/<ticket>
gh pr create --title "#<ticket>, <title>" --body-file <pull-request-file>
```

Include the failing and passing control commands, their exits, the gate result, and the ticket
link in its body. Wait for required checks and review. Do not merge a failing or unreviewed
change.

Read `[ship].merge_authority` from `~/.postmaster/config.toml`:

- `user`: give the user the pull request and wait for their merge word. Do not infer it from
  review approval or from a check passing.
- `postmaster`: merge only after the controls, gate, required checks and review pass. Use the
  repository's available merge method that preserves the single fix commit, for example
  `gh pr merge <pull-request> --rebase`. If it creates a merge commit, use the one commit that
  changes the files, not the merge commit, for propagation.

Log the merge. Confirm that the pull request is merged, then make sure `<tool>` is clean and on
`main` and fast-forward it:

```sh
git -C <tool> pull --ff-only origin main
```

Log the pull. Identify the single, non-merge commit on main that contains the fix. Confirm it
is an ancestor of `<tool>`'s `HEAD`. The propagation script refuses a merge commit or a fix
that has not landed on main.

## Report and queue propagation

Report how every in-flight run receives the fix, then queue only the work it needs:

```sh
<tool>/scripts/hotfix.sh report <tool> <fix-commit>
<tool>/scripts/hotfix.sh queue <tool> <fix-commit>
```

The report has one line per run. A run in another project gets the fix through postmaster's
main checkout, with no branch change. A run whose branch carries the changed postmaster file
gets one commit with this fix alone at its next leg. A runbook fix that the active leg already
read is named for the next leg. A same-line conflict is named and left untouched; report that
run to the user so whichever change merges second can resolve it. Never merge main into a run.

The queue logs each action in the run and its project ledger. It does not change any branch.
Between legs, after writing the next leg's prompt and before launching it, run:

```sh
<tool>/scripts/hotfix.sh next-leg <tool> <dispatch> <leg> <dispatch>/leg-<leg>-prompt.txt
```

The script requires an unstarted next leg and the previous leg's completed hand-off. It applies
each queued fix commit alone, gives the new commit a `main fix` message, and adds the source
commit and runbook instructions to the prompt. A runbook note tells the next leg to read the
updated file from `<tool>`. It does not pull or merge main into the run branch. If it names a
conflict, a dirty branch, or a missing worktree, leave the branch alone and report the reason.

Set the ticket to done after the pull request is merged and main has been pulled. Log the state
change. The session ends with the merged commit, the control exits, the gate result, the pull
request, the main pull, the propagation report, and any run left for the user's conflict
resolution.
