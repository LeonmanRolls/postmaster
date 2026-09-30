---
title: A run keeps the config it started with
type: concept
standing: claimed
sources: []
updated: 2026-09-29
---

# A run keeps the config it started with

**Claim.** Every launch and resume inside a run takes its harness, model, effort and env file
from the config the run recorded at dispatch, never from the live config. That keeps every lane
and every coachman leg the same for the whole run. It costs one thing: a change to the config
reaches the next run, not one already in flight.

**Standing: claimed.** This is a decision taken on reasoning in
[issue #46](https://github.com/brindlewick/postmaster/issues/46), which the code review of
[pull request #39](https://github.com/brindlewick/postmaster/pull/39) found, before any run
bears on it.

## The reasoning

- **A lane is its harness, model, effort and backend.** The flow ranks lanes against each
  other and counts the findings each one makes ([combining models](combining-models.md)). A
  lane whose model changes part-way through a run is two lanes under one name, and its rank
  and its findings describe neither. A coachman leg is the same: a resume on another model
  continues the thread under a model that did not write it.
- **A thread id belongs to one harness.** A resume hands the recorded thread id to the harness
  the config names. If the config names another harness by then, the id goes to a harness that
  never issued it.
- **The record already exists.** `scripts/run-meta.sh` writes the config in force into the
  run's `run.json` at dispatch, and nothing edits it afterwards. Making it the run's config of
  record needs no new state.
- **The live config still serves what is not a run.** The postmaster's own spawn, and the
  check of the config before a run is dispatched, read the live config. A run reads its record
  from its first launch to its last.

## What it costs

- **A fix to the config waits for the next run.** A lane that hits a wall cannot be pointed at
  a new env file or another model part-way through a run. It stays DEGRADED for what it misses.
  The coachman's fallback, recorded at dispatch like everything else, is the one switch a run
  can make.
- **An env file is named in the record, not copied.** Its contents are read at every launch.
  A key rotated in the same file reaches a run in flight. So does an endpoint changed in it,
  which is the one way a lane's backend can still change part-way through a run.
- **A record that fails a check stops the run.** The checks on the coachman's legs and models
  apply to the record as they do to the live config. The record never changes, so a run whose
  record fails one cannot launch its next leg, and the refusal goes to the user.

## What would change it

- Runs where a lane was DEGRADED by a wall: whether the user's fix was to the config, and so
  waited for the next run, or to the env file or the provider account, which reached the run in
  flight. If fixes to the config are common, and the lanes they would have restored change
  results, a run could take an amended config through a logged step of its own.
- A lane whose transcript shows more than one model within one run would show that the env
  file is a real gap. Recording a digest of each env file at dispatch, and refusing a launch
  when it no longer matches, would close it.

## What changed because of it

`scripts/launch.sh` takes `--run <dispatch>`. With it, the script reads the config from that
run's `run.json`, applies the same checks, and never opens the live config. A run whose
`run.json` is missing or unreadable is refused, and nothing runs. Every launch and resume in
`skills/postmaster/postmaster.md` and `skills/postmaster/coachman.md` passes it, and the
script's self-test fails if one does not. The waybill's team, the spec-review link template and
the ship card's review link come from the record too.
