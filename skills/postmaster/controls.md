# Controls

A control is a part of postmaster that decides whether something was checked: a check, the
gate, a marker, a wait, or the action log. This file is the one list of them. The runbooks
read it to know which faults stop a leg; `<tool>/scripts/run log-action` and `<tool>/scripts/run tool-faults`
read its tables.

A fault in a control stops the leg and goes to the user, and is never worked around. A fault
in any other part of postmaster may be worked around, and the workaround is logged with the
fault (`coachman.md`, Tool faults).
[Why faults become tickets, and why a control is never worked around](../../wiki/concepts/tool-faults.md)

## Scripts

A fault in one of these is a fault in a control, whatever the step that ran it.

| part | kind | what it decides |
|---|---|---|
| `<tool>/scripts/run ticket-check` | check | a ticket has its shape before it is accepted or dispatched |
| `<tool>/scripts/run check-target` | check | the target is a clean git repository before anything is cut from it |
| `<tool>/scripts/run handoff-check` | check | a leg ends only on a complete hand-off |
| `<tool>/scripts/run wiki-lint` | check | the wiki's citations, links and standings hold |
| `<tool>/scripts/run discover-project` | gate | which command is the project's gate |
| `<tool>/scripts/run wait-for-markers` | wait | a round is collected only when every marker is in |
| `<tool>/scripts/run review-round` | wait | a review round is collected by its deadline, its reviewers that miss it are recorded and stopped, and its scratches are removed only once nothing of it runs there |
| `<tool>/scripts/run review-findings` | check | native bug-review output is normalized, and an unrecognized report cannot count as clean |
| `<tool>/scripts/run runs-status` | marker | the next action from each run's markers and outcome record; the waiting list it reports is kept by `run host leg waiting` |
| `<tool>/scripts/run runs-watch` | wait | a run needs the postmaster only when its NEXT is not WAIT, USER or `-`, and never when its ticket is on the held list |
| `<tool>/scripts/run host leg` | marker | launch, resume and takeover lifecycle, including the recorded attempt outcome |
| `<tool>/scripts/run launch` | marker | whether the harness started; a preflight or env-file failure remains refused |
| `<tool>/scripts/run log-action` | action-log | every action is recorded as it happens |
| `<tool>/scripts/run stage` | action-log | every stage change is recorded, and the run is timed from the record |
| `<tool>/scripts/run run-meta` | action-log | what a run started from, and the pinned checkout it runs on |
| `<tool>/scripts/run tool-faults` | action-log | every fault a run met reaches a ticket or the run's records |

## Steps within a file

The rest of these files is not a control. A fault in one of these steps names the file, the
step in `--ran`, and the kind in `--control`.

| step | kind |
|---|---|
| `coachman.md`: the blind acceptance tests, and running them on each lane | check |
| `coachman.md`: verifying a workhorse's claims, and a reviewer's findings, against the code | check |
| `coachman.md`: the scratch assert, and the integrity check after each round | check |
| `coachman.md`: classifying a lane REVIEWED or DEGRADED | check |
| `coachman.md`: running the project's gate, unpiped | gate |
| `postmaster.md`: Stage F, verifying the card against the code | gate |
| `coachman.md`, `postmaster.md`: touching or reading a marker | marker |
| `<tool>/scripts/run host`: clearing and landing a leg's done/exited markers and recording its outcome | marker |
| `coachman.md`: the wait in the same command as the launch, and the stall cutoffs | wait |
| `coachman.md`, `postmaster.md`: a `run log-action` line a step writes | action-log |
