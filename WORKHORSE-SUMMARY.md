# Workhorse summary: 57 A leg's launch, resume and takeover are run by a script that records how each ended

## What I built

- `55140a2` — Workhorse spec for #57: one script for a leg's launch, resume and takeover
- `31c0645` — `scripts/leg.sh`: one script for a leg's launch, resume and takeover, recording
  how each ended. `scripts/launch.sh` writes `refused`/`started` to `POSTMASTER_OUTCOME_FILE`
  and refuses cleanly when an env file fails to load.
- `c83bd1a` — `scripts/runs-status.sh` reports the next action from the leg's outcome record.
  `ASK`, `TAKEOVER` and `RESUME` replace the blanket `REMOUNT`.
- `5e616d7` — `postmaster.md` dispatches a leg through `leg.sh`; the REMOUNT rules become the
  outcome record's next action. A refused resume names the prompt it carries for after the
  user answers. The waiting list is written through `leg.sh waiting`.
- `b7e18cf` — `leg.sh` clears a stale done marker when an attempt starts.

## Checks

`/home/brindlewick/postmaster/scripts/verify.sh run .` from the worktree root, just before
this summary:

```
gate: pass, exit 0, 692s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
VERIFY_EXIT=0
```

The waybill's gate, run from the worktree's root (the same command `verify.sh` ran, with
`review-decide` and `runs-watch` in the list as the waybill names them):

```
bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

exit 0. 36 self-tests printed `self-test: all controls behaved`; zero `FAIL` lines
(`/tmp/gate-57c.log`). An earlier run of the same gate on a busy machine failed four of
`host.sh`'s timing controls (a pane closed mid-run, a space close, a worktree close, a
tab_id shape); `host.sh` is untouched on this branch and the brief names those as load
flakes. The clean run above is the one to judge by.

Other commands:

- `bash scripts/leg.sh --self-test` — exit 0, all controls behaved (positive and negative
  control per outcome, the env-file-fails and resume-refused-after-thread-id shapes, answer,
  waiting).
- `bash scripts/runs-status.sh --self-test` — exit 0, all controls behaved (ASK, TAKEOVER,
  RESUME, USER-on-fallback, plus the previous NEXT states).
- `bash scripts/launch.sh --self-test` — exit 0, all controls behaved (env-file refusal,
  outcome file `refused`/`started`, and the existing forms).
- `bash scripts/skill-refs.sh` — exit 0.
- `bash -n scripts/*.sh` — exit 0.

## Decisions

1. **Scope: coachman legs.** The ticket names "a leg" and the REMOUNT rules. Lane and review
   launches keep their `host.sh run` + `launch.sh` form in `coachman.md`.
2. **Outcome record path:** `<dispatch>/logs/coachman-leg-<n>-outcome.json`, beside the leg's
   stream and `.err`. Latest attempt is what `runs-status.sh` reads.
3. **Outcome strings:** `refused`, `no-thread`, `walled`, `spent`, `finished`.
4. **Mechanical refused:** `launch.sh` writes `{"state":"refused"}` on `die` and
   `{"state":"started"}` before the harness runs, when `POSTMASTER_OUTCOME_FILE` is set. An
   env file that fails to load (unset variable under `set -u`, `exit`, a `PATH` that loses the
   harness) is a clean `die`, so it records `refused` and is never a spent thread resumed at
   every poll.
5. **Wall detection:** host cap notices (`host: memory cap reached`, `host: process cap
   reached`) and a known indicator list checked once in `leg.sh` against the attempt's `.err`
   (`402 Payment Required`, `usage limit`, `usage-limit`, `quota wall`, `spawn misfire`,
   `stale session lock`). This is the one place text is read, and only to classify; nothing
   downstream reads `.err`. A wall is classified independently of the thread id, so a wall
   before the first event is `walled`, not `no-thread`.
6. **`finished` means the done marker is present** when the attempt ends, and it beats a stale
   `refused` state. A fresh attempt clears a stale done marker first.
7. **`no-thread`** means the harness started and the stream holds no thread id and the attempt
   is not `walled`. On-answer: `relaunch`.
8. **On-answer actions:** `refused` → `deliver-prompt` (the prompt file the attempt was
   carrying); `no-thread` → `relaunch`; `walled` on the fallback → `none`. `spent` and
   `finished` never go to the user from an attempt outcome. `leg.sh answer` prints the action
   and the prompt.
9. **`walled` next action:** `TAKEOVER` when the leg's manifest name is `coachman`, `ASK` when
   it is already `coachman_fallback`. `runs-status.sh` maps `refused`/`no-thread`/`walled-on-
   fallback` to `ASK` (the postmaster puts the question to the user); `.waiting-on-user` still
   wins as `USER` once it is there.
10. **Waiting list:** `<runs>/postmaster/ESCALATION.md`, written only through `leg.sh waiting
    add|remove|list`. One `## <ticket>` block per run. `runs-status.sh` keeps printing the
    pending line from that file.
11. **Takeover** writes the takeover prompt, moves the stream to
    `logs/coachman-leg-<n>-walled-events.jsonl`, and launches `coachman_fallback` — all inside
    `leg.sh takeover`.
12. **`leg.sh` returns as `host.sh run` does** — once the attempt has started. Outcome
    classification runs in the wrapped command after `launch.sh` exits, so it sees the done
    marker if the leg wrote one.
13. **Wiki pages read:** `wiki/schema.md` and `wiki/index.md`, as the waybill's docs-to-read
    named them. `schema.md` says a lane does not read the wiki; the waybill overrode that for
    these two pages. I read no other wiki page.

## What I did not do

- **Lane and review launches in `coachman.md` still write their own markers and stream
  paths.** The ticket's direction says "the runbooks call one script and never write a marker,
  a redirect or a stream path themselves"; I read that as scoped to the leg launch/resume/
  takeover the ticket is about (the REMOUNT rules). Extending `leg.sh` to every lane and
  review launch is a follow-on if the reviewer wants the direction read wider.
- **`leg.sh` is not in the gate's named self-test list** (the list is fixed in the waybill).
  `bash -n` covers it in the gate, and I ran `leg.sh --self-test` myself as a named check.
  Adding it to the gate list is a one-word change to the gate command when #17 lands a real
  gate.
- **No fixture run.** The ticket's turnpikes are `default` (style, bug, security reviews),
  which run in the review leg, not in a workhorse. The gate is this run's named check.

## Verdict on the acceptance criteria

1. **One script launches, resumes and takes over a leg: clears and lands markers, starts or
   appends the stream, records how the attempt ended.** — Met. `leg.sh launch|resume|takeover`
   wraps `host.sh run` + `launch.sh`; the outcome is recorded after the attempt ends.
2. **How an attempt ended is one of a fixed set, recorded mechanically and never read from the
   text of `.err`.** — Met. Five outcomes; `refused`/`started` come from `launch.sh`'s
   side-channel; the rest from markers, stream thread id and a one-place wall check. Decision
   paths (`runs-status.sh`, the runbook) read the record, never `.err`.
3. **`runs-status.sh` reports the postmaster's next action from that record, and it replaces
   the REMOUNT rules in `postmaster.md`.** — Met. `ASK`/`TAKEOVER`/`RESUME` from the record;
   `postmaster.md`'s REMOUNT bullet is now those three plus a legacy fallback.
4. **Every outcome that goes to the user has a stated action for when the user answers. A
   refused resume, once answered, delivers the prompt it was carrying.** — Met. The outcome
   record carries `on_answer` and the prompt path; `leg.sh answer` prints them; Stage E step 3
   says to act on it.
5. **A wall is taken over on the fallback whether it came before or after the stream's first
   event, and a wall on the fallback goes to the user.** — Met. `walled` is classified
   independently of thread id (self-test: "a wall before the first event is walled, not
   no-thread"); `runs-status.sh` maps it to `TAKEOVER`, or `ASK` on the fallback.
6. **The list of runs waiting on the user is kept by a script, not edited by hand.** — Met.
   `leg.sh waiting add|remove|list` owns `<runs>/postmaster/ESCALATION.md`.
7. **The script's self-test has a positive and a negative control for every outcome, including
   an env file that fails to load and a resume refused after the leg has a thread id.** — Met.
   `leg.sh --self-test` covers all five outcomes both ways, those two named shapes, `answer`,
   and `waiting`.
