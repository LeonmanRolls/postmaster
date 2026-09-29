# Workhorse spec: 57 A leg's launch, resume and takeover are run by a script that records how each ended

## Summary

The postmaster decides what to do with a leg whose process exited without finishing from prose
rules that match text in the leg's `.err`; every launch, resume and takeover writes its own
marker handling by hand. This change replaces that with one script that launches, resumes and
takes over a leg, records how the attempt ended as one of a fixed set, and lets `runs-status.sh`
report the next action from that record. The runbooks call the script and never write a marker,
a redirect or a stream path themselves, and no decision reads error text.

## Technical context

- **Language and version**: bash with Python 3.11 heredocs, matching the existing scripts.
- **Dependencies used or added**: none. `host.sh` and `launch.sh` stay the host and harness
  adapters; the new script wraps them.
- **Testing**: `scripts/leg.sh --self-test` (positive and negative control per outcome),
  `scripts/runs-status.sh --self-test` (outcome→NEXT mapping), the project gate from the
  worktree root, and `scripts/verify.sh run .`.
- **Constraints**: the ticket's direction — one script, no marker/redirect/stream path in the
  runbooks, no decision reads error text, lives in `host.sh` or beside it, not a second launcher.
  AGENTS.md design rules: deterministic work in `scripts/`, every count has a control, a prompt
  lives in argv. Script paths in `skills/postmaster/` go through `<tool>`.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| One script launches, resumes and takes over a leg | `scripts/leg.sh` with `launch`, `resume`, `takeover` subcommands; each clears and lands markers, starts or appends the stream, and records the outcome |
| It lives in `host.sh` or beside it, not a second launcher | `leg.sh` sits beside `host.sh` and calls `host.sh run` + `launch.sh`; it does not re-implement host placement or harness forms |
| Runbooks never write a marker, a redirect or a stream path | `postmaster.md` Stage C and the takeover paragraph call `leg.sh`; paths are computed inside it |
| No decision reads error text | the outcome is recorded once as an enum; `runs-status.sh` and the postmaster read the enum, never `.err` |
| Fixed set of outcomes, recorded mechanically | `refused`, `no-thread`, `walled`, `spent`, `finished`; classified in one place from exit status, a started/refused side-channel from `launch.sh`, markers, thread id in the stream, and host cap events |
| Every outcome that goes to the user has a stated on-answer action | the outcome record carries `on_answer`; `runs-status.sh` prints it and `leg.sh answer` names the prompt to deliver |
| A wall is taken over on the fallback before or after the first event | `walled` is classified independently of thread id; `runs-status.sh` maps it to `TAKEOVER` (or `USER` on the fallback) |
| The waiting-on-user list is kept by a script | `leg.sh waiting add\|remove\|list` writes `<runs>/postmaster/ESCALATION.md` |
| Self-test has a positive and a negative control per outcome | `leg.sh --self-test` builds a fixture dispatch per outcome, including an env file that fails to load and a resume refused after a thread id |

## Structure

- `scripts/leg.sh` (new): launch / resume / takeover a coachman leg; classify and record the
  outcome; `answer` names the on-answer action and the prompt to deliver; `waiting` keeps the
  list of runs waiting on the user; `--self-test`.
- `scripts/launch.sh`: write `refused` to `POSTMASTER_OUTCOME_FILE` on every `die`, and `started`
  just before the harness runs; refuse cleanly (exit 1, `launch:` prefix) when an env file fails
  to load, so that case is `refused` rather than a spent thread resumed at every poll.
- `scripts/runs-status.sh`: when the current leg's process has exited and an outcome record
  exists, report the next action from that record (`RESUME`, `TAKEOVER`, `RELAUNCH`, `USER`
  with the on-answer action) instead of a blanket `REMOUNT`.
- `skills/postmaster/postmaster.md`: Stage C launch/resume become `leg.sh` calls; the takeover
  paragraph becomes `leg.sh takeover`; the REMOUNT bullet is replaced by a pointer to
  `runs-status.sh` and `leg.sh answer`.
- `skills/postmaster/hosts.md` / `harnesses.md`: one line each noting that a leg's attempt goes
  through `leg.sh`, which calls `host.sh run` and `launch.sh`.

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| Classification may consult wall indicators in the attempt's `.err` | provider walls leave their only signal there before the first stream event; host cap events cover resource walls but not `402`/quota | putting wall strings in the runbook is the defect this ticket removes; grepping `.err` at every poll is what produced a new shape each review round. One classifier with controls is the design rule ("a script gets it wrong once and is fixed"). The decision path never reads `.err`. |

## Decisions

1. **Scope: coachman legs.** The ticket names "a leg" and the REMOUNT rules under replacement.
   Lane and review launches keep their `host.sh run` + `launch.sh` form in `coachman.md`.
2. **Outcome record path:** `<dispatch>/logs/coachman-leg-<n>-outcome.json`, beside the leg's
   stream and `.err`. One JSON object per attempt; the latest attempt is what `runs-status.sh`
   reads.
3. **Outcome set (exact strings):** `refused`, `no-thread`, `walled`, `spent`, `finished`.
4. **Mechanical refused:** `launch.sh` writes `refused` to `POSTMASTER_OUTCOME_FILE` on `die`
   and `started` just before the harness runs. An env file that fails to load is made a clean
   `die`, so it records `refused`.
5. **Wall detection:** host cap events (mechanical) and a known indicator list checked once in
   `leg.sh` against the attempt's `.err` (`402 Payment Required`, `usage limit`, `quota`,
   `spawn misfire`, `stale session lock`, `host: memory cap reached`, `host: process cap
   reached`). This is the one place text is read, and only to classify; nothing downstream
   reads `.err`.
6. **`finished` means the done marker is present** when the attempt ends. A clean exit with no
   done marker is `spent`.
7. **`no-thread` means the harness started and the stream holds no thread id** and the attempt
   is not `walled`. Its on-answer action is `relaunch`.
8. **On-answer actions:** `refused` → `deliver-prompt` (the prompt file the attempt was
   carrying); `no-thread` → `relaunch`; `walled` on the fallback → `none` (the user decides).
   `spent` and `finished` never go to the user from an attempt outcome.
9. **`walled` next action:** `TAKEOVER` when the leg's manifest name is `coachman`, `USER` when
   it is already `coachman_fallback`. Thread id presence does not change this.
10. **Waiting list file:** `<runs>/postmaster/ESCALATION.md`, written only through `leg.sh
    waiting`. Format: one `## <ticket>` block per run, holding the question. `runs-status.sh`
    keeps printing the pending line from that file.
11. **Takeover moves the stream aside** (`logs/coachman-leg-<n>-walled-events.jsonl`) before
    starting, as today; `leg.sh takeover` does it.
12. **`leg.sh` returns as `host.sh run` does** — once the attempt has started — so the postmaster
    still waits on markers. Outcome classification runs in the wrapped command after
    `launch.sh` exits, so it sees the done marker if the leg wrote one.

## Tasks

- [ ] T001 [P] [AC1] [AC2] Create `scripts/leg.sh` with `launch`, `resume`, `takeover`: path
      computation, marker clear/land via `host.sh`, stream start/append, outcome recording
      after the attempt ends.
- [ ] T002 [P] [AC2] [AC7] In `scripts/launch.sh`, write `refused`/`started` to
      `POSTMASTER_OUTCOME_FILE`; make an env-file load failure a clean refusal. Extend its
      self-test controls.
- [ ] T003 [AC2] [AC3] [AC5] Outcome classifier in `scripts/leg.sh`: map exit, started/refused,
      done marker, thread id, cap events and wall indicators to the five outcomes. Self-test
      with a positive and a negative control each, including an env file that fails to load and
      a resume refused after a thread id.
- [ ] T004 [AC3] [AC5] [AC4] Update `scripts/runs-status.sh` to report `RESUME`, `TAKEOVER`,
      `RELAUNCH`, `USER` from the outcome record and on-answer action; replace the blanket
      `REMOUNT` path; extend its self-test.
- [ ] T005 [AC4] `leg.sh answer`: given the outcome record, print the on-answer action and the
      prompt file to deliver. Controls in the self-test.
- [ ] T006 [AC6] `leg.sh waiting add|remove|list` keeping `<runs>/postmaster/ESCALATION.md`.
      Controls in the self-test.
- [ ] T007 [AC1] [AC3] Rewrite `skills/postmaster/postmaster.md` Stage C launch/resume and the
      takeover paragraph as `leg.sh` calls; replace the REMOUNT bullet with the outcome
      record's next-action rule and `leg.sh answer`; point the waiting list at `leg.sh waiting`.
- [ ] T008 [AC1] Note in `skills/postmaster/hosts.md` and `harnesses.md` that a leg's attempt
      goes through `leg.sh`. Run `scripts/skill-refs.sh`.
- [ ] T009 [AC2] [AC7] Adjust `scripts/launch.sh`'s runbook-calls self-test for the new
      `postmaster.md` forms (or keep `--run` coverage through `leg.sh`'s own check).
- [ ] T010 [AC1]–[AC7] Run `leg.sh --self-test`, `runs-status.sh --self-test`, `launch.sh
      --self-test`, `host.sh --self-test`, the gate, and `scripts/verify.sh run .`; write
      `WORKHORSE-SUMMARY.md`.
