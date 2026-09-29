# The coachman contract

**This file is the one definition of the coachman contract.** The postmaster, every coachman
leg and the lanes agree on these parts through files. A change that touches any part below
merges only after a fixture run scores clean; `<tool>/scripts/contract.sh` decides whether a
change touches it, and never a ticket's prose. `AGENTS.md` points here instead of restating
the contract.

Each part is implemented in the runbooks and the scripts those names. Exactly those
passages are marked in place with `<!-- contract:part=NAME -->` … `<!-- /contract:part=NAME -->`
(a `# ` comment prefix in shell). Prose outside the markers is not the contract: a wording
fix in `coachman.md` is not a contract change, and a change to the hand-off rules is.

## markers

<!-- contract:part=markers -->
The marker files roles touch and read, and who writes each. A marker is how one role tells
another a fact without waiting in process.

| marker | written by | read by | means |
|---|---|---|---|
| `.leg-<n>-done` | the coachman, leg `n`, once its hand-off passes `<tool>/scripts/handoff-check.sh` | the postmaster (`runs-status.sh`) | the leg is finished and the next may start |
| `.leg-<n>-exited` | `host.sh`, when leg `n`'s process exits, whatever its exit | the postmaster (`runs-status.sh`) | the process is gone; with no `-done` beside it, the leg is spent |
| `.card-ready` | the coachman, when `card.md` is complete | the postmaster | the ship card may be gated |
| `.escalation-ready` | the coachman, with `ESCALATION.md` | the postmaster | the leg needs a ruling and has stopped |
| `.checkpoint-<n>-ready` | the coachman, with `checkpoint-<n>.md` | the postmaster | a checkpoint card is waiting |
| `.waiting-on-user` | the postmaster, with a question on `postmaster/ESCALATION.md` | the postmaster | the run waits for the user |
| `logs/<lane>.done` and its siblings under `logs/` | `host.sh`, on process exit | the coachman, `wait-for-markers.sh` | a launch finished |

Implemented in `coachman.md` (Where things live; Coachman lifecycle), `runs-status.sh` (what
the poll reads), and `host.sh` (that `--marker` is cleared at start and touched on exit).
<!-- /contract:part=markers -->

## waybill

<!-- contract:part=waybill -->
The waybill (`<dispatch>/brief.md`) is the only thing that travels between the postmaster and
a coachman. Its shape: a `# Waybill:` title, the one `turnpikes:` line under it, then `##
Ticket` (the ticket verbatim), `## Project profile`, `## Team`, `## Dispatch`. Each section's
fields are named in the template; a field the template names is on every waybill. `## Dispatch`
carries `fixture run: <yes|no>`, the script's answer for whether this run's change touches the
contract.

Implemented in `SKILL.md` (the template), and read by `turnpikes.sh legs` (the `turnpikes:`
line), `reviewers.sh` (the team lines) and every leg.
<!-- /contract:part=waybill -->

## turnpikes

<!-- contract:part=turnpikes -->
The turnpike table: the checks a run must pass through before it ships, one row per turnpike
with its name, whether it is in `default`, the leg that runs it, and what it checks. A ticket
names its run's turnpikes; `default` stands for the table's default set (or the project's
declared one). The project's gate is not a turnpike; it runs on every run.

Implemented in `turnpikes.sh` (the table and what `default` stands for).
<!-- /contract:part=turnpikes -->

## legs

<!-- contract:part=legs -->
A run is up to three legs, `synthesis` (1), `review` (2) and `ship` (3), each a fresh
coachman thread. The review leg runs only when the waybill names a turnpike that runs in it;
without one, ship follows synthesis. `turnpikes.sh legs` prints the run's legs and the
turnpikes each runs.

Implemented in `turnpikes.sh` (the leg list and how a waybill's line yields legs) and
`coachman.md` (what each leg covers and how it ends).
<!-- /contract:part=legs -->

## stages

<!-- contract:part=stages -->
The stages a run moves through, in order: `dispatched`, `bootstrapped`, `workhorses-running`,
`synthesis`, `checkpoint-1`, `review`, `shipping`, `shipped`, `done`, `abandoned`. Only
`stage.sh` changes a stage; only the postmaster sets `done` or `abandoned` or moves a run out
of one.

Implemented in `stage.sh` (the stage list and the rules for who sets what).
<!-- /contract:part=stages -->

## completion

<!-- contract:part=completion -->
How a leg's end is detected. A leg ends by writing `handoff-<n>.md` in exactly these
sections, none empty — `Decisions`, `Deferred findings`, `Verified by execution`,
`Unverified`, `Branches and lanes`, `Open questions`, `Next leg` — with
`<tool>/scripts/handoff-check.sh` exiting 0 before `.leg-<n>-done` is touched. The marker is
the end; a process that exits without its hand-off is spent, not finished.

Implemented in `handoff-check.sh` (the required sections), `coachman.md` (the hand-off shape
and the end-of-leg rule), and `runs-status.sh` (how `-done` and `-exited` are read).
<!-- /contract:part=completion -->
