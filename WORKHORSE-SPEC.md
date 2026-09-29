# Workhorse spec: #124 The review leg ends with the run ready for the user's merge, with no separate ship leg

## Summary

A run is at most two coachman legs, `synthesis` and `review`; the last leg writes the ship
card and ends the run ready for merge, and the postmaster opens the pull request or merges on
the word and does aftercare. The approach is to fold the ship leg's card work into the end of
the review leg (or of synthesis when there is no review turnpike), move the merge and aftercare
to the postmaster, teach `turnpikes.sh legs` a two-leg model with a waybill `legs:` line that
old three-leg waybills lack, and give every changed script self-test controls for a two-leg, a
one-leg and a pre-change three-leg run.

## Technical context

- **Language and version**: bash with Python 3.11 heredocs, as the rest of `scripts/`.
- **Dependencies used or added**: none.
- **Testing**: the project gate (`scripts/verify.sh run .`), which runs each changed script's
  `--self-test`; the turnpikes self-test walks a two-leg run, a one-leg run and a legacy
  three-leg run through the poll and the stages; fixture.sh's self-test scores two-leg, one-leg
  and three-leg records.
- **Constraints**: the ticket's direction (review ends the run; no separate ship leg); this is
  a coachman-contract change so it merges only after a fixture run from its branch scores
  clean (the postmaster's merge gate, not this workhorse's); a run dispatched before the
  change keeps its three legs; nothing harness-specific outside `harnesses.md`; deterministic
  behaviour lives in scripts.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Review leg ends the run once no P1 or P2 remains and the gates pass, by writing the ship card and its hand-off and touching the card's marker; it merges nothing | `coachman.md`: the review leg's last step is the old Stage 3 card work, then the hand-off and `.card-ready`; the merge and old Stage 4 leave the runbook |
| The card carries what the ship leg's card carries today | The card requirements move verbatim to the end-of-run step the last leg runs |
| A run with no review turnpike ends the same way at the end of synthesis | `coachman.md` Stage 1 ends with the same end-of-run step when `turnpikes.sh legs` lists one leg |
| Postmaster verifies, opens the PR or merges on the word, then aftercare and teardown | `postmaster.md` Stage F grows the PR/merge step; Stage G grows old Stage 4 |
| `turnpikes.sh legs` lists synthesis and review only; `runs-status.sh`, `stage.sh` and the runbooks follow; a run dispatched before the change keeps its three legs | `turnpikes.sh` two-leg model from a waybill `legs:` line; no such line is the pre-change three-leg model. Runbooks and poll comments follow |
| Self-tests have controls for a two-leg run, a one-leg run, and a three-leg run dispatched before the change | Every script this change touches gets those three controls |
| A prompt lives in argv; every count has a control; every action is logged | Unchanged; the postmaster logs `merge`, `teardown`, `ticket-state` as the coachman did |
| Fix an open pull request instead of deferring gaps | No open PR covers this; this is ticket work |
| Lanes do not read `wiki/` | Not read |

## Structure

- `scripts/turnpikes.sh` — two-leg `LEGS`/`ALWAYS`; waybill `legs:` line; legacy fallback; self-test
- `scripts/runs-status.sh` — comments and self-test controls for 2-leg, 1-leg, 3-leg
- `scripts/stage.sh` — comments; self-test controls for the stage walks those leg counts take
- `scripts/fixture.sh` — `check_stages` allows a skipped `review`; `record` takes a leg count; self-test controls
- `scripts/launch.sh` — comment: `ship` is kept for a run dispatched before the change
- `skills/postmaster/coachman.md` — at most two legs; end-of-run card step; no merge, no aftercare
- `skills/postmaster/postmaster.md` — Stage F opens the PR or merges; Stage G does aftercare and teardown
- `skills/postmaster/SKILL.md` — waybill template: `legs:` under the title, `landing:` in the profile
- `README.md`, `AGENTS.md`, `config.example.toml` — the role table and leg lists

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| A `legs:` line in the waybill | A run keeps the version it was dispatched from; scripts are live while a pre-change run is in flight, so `legs <dispatch>` must still print three legs for it | Deriving legs from `run.json`'s postmaster commit is brittle and `legs --line` runs before `run.json` exists |

## Decisions

- **How a pre-change run is recognised:** the waybill has no `legs:` line. New waybills carry
  `legs: synthesis` or `legs: synthesis review`, written by the postmaster from
  `turnpikes.sh legs --line`. Absent means the three-leg model, as before.
- **Stage names stay** (`shipping`, `shipped`): the last leg sets `shipping` when it starts the
  card work; the postmaster sets `shipped` after the merge (or after the user merges the PR),
  then `done`. A one-leg run simply never enters `review`.
- **Who writes the style sort:** the postmaster, as part of aftercare (old Stage 4), since no
  coachman is alive after the card. `style-findings.sh` comments follow.
- **PR vs local merge:** the waybill's project profile carries `landing: pull-request` or
  `landing: local`. PR: the postmaster pushes the ticket branch and opens the PR, then waits
  for the user to merge it (the PR is the user's merge surface; `MERGE_AUTHORITY` does not
  open a second door). Local: the postmaster asks for the merge word when `MERGE_AUTHORITY`
  is `user`, merges itself when it is `postmaster`.
- **`launch.sh` still accepts `--leg ship`** so a pre-change run can resume its ship leg.
- **`handoff-check.sh` section names stay** (`Next leg` on the last hand-off carries what the
  postmaster picks up); changing the contract of the check is not needed to meet the ticket.

## Tasks

- [ ] T001 [P] [AC5] `scripts/turnpikes.sh`: two-leg model, waybill `legs:` line, legacy three-leg fallback when the line is absent; self-test controls for two-leg, one-leg and legacy three-leg runs
- [ ] T002 [P] [AC5] [AC6] `scripts/runs-status.sh`: comments follow the two-leg model; self-test controls for a two-leg card, a one-leg card and a legacy three-leg run
- [ ] T003 [P] [AC5] [AC6] `scripts/stage.sh`: comments and self-test controls for the stage walks a two-leg and a one-leg run take, and that a three-leg walk still sets the same stages
- [ ] T004 [P] [AC5] [AC6] `scripts/fixture.sh`: `check_stages` allows a skipped `review`; `record` takes a leg count; self-test scores a two-leg, a one-leg and a three-leg record
- [ ] T005 [AC1] [AC2] [AC3] `skills/postmaster/coachman.md`: at most two legs; the last leg ends with the ship card and its hand-off and `.card-ready`, merging nothing; a no-review run ends the same way at the end of synthesis; the card carries what it carries today
- [ ] T006 [AC4] `skills/postmaster/postmaster.md`: Stage F verifies then opens the PR or asks for the merge word and merges; Stage G does the aftercare and teardown the ship leg did
- [ ] T007 [AC5] `skills/postmaster/SKILL.md`: waybill template gains `legs:` and `landing:`; `config.example.toml`, `README.md`, `AGENTS.md`, `scripts/launch.sh`, `scripts/style-findings.sh` comments follow
- [ ] T008 [AC1] [AC5] [AC6] Run the gate through `scripts/verify.sh run .` and record what it printed
