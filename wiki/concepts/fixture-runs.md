---
title: A fixture run tests the flow end to end, which the gate cannot
type: concept
standing: claimed
sources: []
updated: 2026-10-01
---

# Fixture runs

**Claim.** A run dispatched against a small app whose tickets have a known outcome, and scored
from the run's own records, catches two failures that the repository's gate cannot: a change to
the flow that breaks the contract between its roles, and a run that ships code failing its own
ticket.

**Standing: claimed.** No fixture run has been recorded yet. The first runs, one per ticket, are
the test ([issue #37](https://github.com/brindlewick/postmaster/issues/37), criterion 8).

## What the gate cannot see

The gate ([issue #17](https://github.com/brindlewick/postmaster/issues/17)) checks this
repository offline, in under a minute, with no model. It can show that a script parses, a link
resolves and a runbook names a script that exists. It cannot run the flow, because the flow is
models following runbooks. Two failures are invisible to it.

- **A broken contract between roles.** The postmaster, each coachman leg and the lanes agree
  through files: the stages, the markers, the hand-offs, `run.json`, the ship card. A runbook
  edit that renames a marker, drops a hand-off section or skips a stage change is prose, and
  every script still passes. The break shows only in a run, when a leg waits for a marker
  nobody writes, or starts from a hand-off missing what the leg before it knew.
- **A run that ships the wrong thing.** A run's ship card says the gate passed and the criteria
  are met. That is the run's account of itself. Whether it is true takes a test the run never
  saw.

A fixture run exercises the whole path: the postmaster reads and checks the ticket, writes the
waybill and dispatches each leg, and the legs carry the ticket to a merge. The score then checks
what the run left behind against what was known before it started.

## Why the tests are hidden

- **They are the only oracle the run did not write.** The coachman's blind acceptance tests
  come from the same ticket the lanes read, written by a model inside the run. A lane that has
  seen the tests can shape its code to them. Tests written before any run, and never shown to
  it, measure whether the run did the ticket rather than whether it passed its own checks.
- **They stay fixed across runs.** The same suite scores every run of a ticket, which is what a
  comparison between runs needs: the trials in
  [issue #9](https://github.com/brindlewick/postmaster/issues/9),
  [issue #12](https://github.com/brindlewick/postmaster/issues/12) and
  [issue #16](https://github.com/brindlewick/postmaster/issues/16).
- **They test at the ticket's interface.** They drive the app through its command and never
  import its code, so any design that meets the ticket passes, and the open-design ticket stays
  open.

They live in this repository, beside the app and outside it, and only the app is copied into a
run's repository. That keeps them out of every worktree. It is not a wall: lanes run
unrestricted, and the waybill gives the coachman this repository's path, so an agent that went
looking could find them. Nothing records yet whether one did. The score says whether a run
passed the hidden tests, not whether it saw them.

## Why the score reads records, not the report

The card, the hand-offs and the narrative are what a run says about itself, and a broken run can
say it succeeded. The score reads what the run could not dress up: the hidden tests and the gate,
run fresh on the merged result; the stage changes in `actions.jsonl`, logged as they happened;
the marker files; each hand-off through `scripts/handoff-check.sh`; `run.json`; the card. The
stages and the hand-off rules come from the scripts that define them, and the number of legs
from the run itself, so the score keeps working when the contract changes.

## How a fixture run gets its ticket

The flow reads tickets through a tracker, and a fresh repository has none. Three ways were open.

- **A waybill written straight from the ticket file.** Rejected: it skips the postmaster's own
  reading and checking of the ticket, which is part of what a fixture run should exercise.
- **A GitHub repository kept for fixture tickets.** Built first, then rejected by the user on
  2026-09-26: a fixture should not live in a separate repository. It needed the network, a `gh`
  login and a board the user linked once.
- **The tracker that needs no service and no login**
  ([issue #11](https://github.com/brindlewick/postmaster/issues/11)). Chosen once it landed. The
  fresh repository gets its own ticket store, and the ticket is filed there through
  `scripts/local.sh`. A repository whose store exists uses that tracker whatever the config names,
  so the postmaster finds and checks the ticket like any other, offline, and nothing leaves the
  machine.

## What would settle it

Supported, when recorded fixture runs show the score doing what is claimed: at least one run
failing a check because of a contract change that the gate passed, and clean runs scoring clean.
Refuted, when fixture runs miss contract changes that later break real runs, or when a run that
scores clean is found to have shipped something its ticket did not ask for.

## What changed because of it

`scripts/fixture.sh` makes a run's repository and files its ticket (`new`), scores a finished
run (`score`), and runs a ticket's hidden tests against any copy of the app (`hidden`). The app
and its tickets are in `fixtures/`. `new` puts a copy under `~/Code/fixtures` unless it is given a
path, so every copy is in one place, and marks the copy as a fixture in its own git config. A
fixture run's postmaster runs headless on every host, in the form `hosts.md` gives under none, so
it never meets Claude Code's trust question: a headless session does not ask. Trusting the
fixtures folder never spared a copy the prompt. Claude Code 2.1.283 looks for a trusted folder
from the working folder upward and stops at the top of the git repository, so a trusted parent
covers plain folders only; every copy is its own repository, and the search never reaches the
parent. In the observed controls, Claude Code asked for a new repository inside a trusted folder,
and did not ask for the trusted folder itself. `AGENTS.md` holds a change to the coachman contract back
from merging until a fixture run dispatched from its branch scores clean. What the contract is
is defined in `docs/coachman-contract.toml`, and `scripts/coachman-contract.sh` says whether a
change touches it — so a fixture run is required when the change touches a listed file,
and not for a change to files the list does not name.
