# Workhorse spec: 237 A lane that hits a provider limit pauses its run and tells the user at once

## Problem / feature

On the night of 2026-10-02 the Codex usage limit ran out twice while [#200, Run every lane in its own process space, so it cannot kill processes it did not start](https://github.com/brindlewick/postmaster/issues/200) was running. A workhorse stopped with nothing written, and the run built its synthesis from the other workhorse alone. Later a reviewer ended a round with no verdict. Nobody was told, because the flow marks such a lane as degraded and carries on.

Done: a lane that stops because its provider's usage limit ran out (a wall) is recorded when it stops, and the user hears at once. A walled workhorse pauses its run before the synthesis, and no run moves on to its next leg until the user has ruled on every wall in it. Here the one ruling is go on; resting, resetting and replacing a lane come with a separate ticket.

## Acceptance criteria

1. A workhorse or reviewer whose turn ends on its provider's error saying the usage limit ran out is recorded as walled as soon as it stops.
2. The record holds the lane, its role, the provider's message word for word, and the time the limit resets, when the message gives one (D4, D5).
3. A lane that stops for another reason, is stopped, or had delivered its result first is not recorded as walled.
4. A lane on a tool whose errors the flow cannot read yet, today grok, Antigravity and pi, is handled as today.
5. At the watcher's next look, the postmaster tells the user about each new wall once, all walls of that look in one message.
6. The telling names the run, the lane and its role, the message, and the reset time with its date, in the machine's time zone.
7. A wall on a run the postmaster holds is told when the hold ends.
8. Until the user has been told, the run's status shows the wall, even while the run is busy or already waiting on the user.
9. A question already waiting on the user stays open beside the wall's.
10. A run paused for a wall is never reported as stalled.
11. A walled reviewer counts as degraded for that round, and the round closes without waiting for it.
12. A walled reviewer takes part in the next round, if the run has one, as today.
13. The coachman lets the other workhorses finish, then pauses before the synthesis until every walled workhorse has a ruling (D1).
14. The run does not move on to its next leg, or to landing after its last, while a wall has no ruling (D8).
15. The user rules on each wall by telling the postmaster in plain words, at any time after being told.
16. The one ruling is go on: the run continues without the lane, which the cards show as degraded, with the provider's message (D6).
17. When the user's words fit no ruling, the postmaster asks again.
18. A ruling the flow refuses records nothing, the user is told why, and the run stays paused.
19. Go on is refused for the last workhorse that could still produce work.
20. A ruling given before the pause takes effect when it begins, and one given during it at once.
21. A lane that hits a wall again has a new wall, told and ruled like the first.
22. A fixture run where a workhorse and a reviewer each wall once, both ruled go on, finishes clean with each wall and ruling recorded (D7).

## Decisions

- **D1 (given by the user)** A walled workhorse stops the run until the user rules: they said it "should be a fatal error for a run". Why: the user decides what happens to a lane, not the flow. Instead of: going on without the lane by itself, as today.
- **D2 (proposed)** A wall is recognized only from the error the provider ends the turn with. Why: today's check also reads what the lane's own commands printed, and in past runs most endings it called walls were not. Instead of: that check as it is.
- **D3 (proposed)** An ending error with one of the flow's limit words counts as a wall even when it is about something else, such as a request that was too long; the user then says go on. Why: the flow keeps one list of limit words. Instead of: a second, narrower list.
- **D4 (proposed)** A message that gives only a time, like "2:29 AM", means 2:29 today, or tomorrow if that was over five minutes ago, in the message's time zone, else the computer's. Why: a reset that has just passed must count as passed. Instead of: the next 2:29 to come, which reads a reset that passed a minute ago as tomorrow's.
- **D5 (proposed)** The flow understands a reset time only in the shapes providers have used so far, such as "2:29 AM", "Oct 5th, 2026 2:29 AM", "resets 3am (UTC)" or "in 20 minutes"; for anything else it says the message gave no reset time. Why: a wrong time is worse than none. Instead of: guessing at any time found in the message.
- **D6 (given by the user)** The work is split: this ticket's one ruling is go on, and resting, resetting and replacing a lane come with a separate ticket. Why: the user's word, "ok split it". Instead of: one ticket with all four choices.
- **D7 (proposed)** In a fixture run, the run's postmaster makes the ruling itself, as the fixture's brief says. Why: fixture runs ask nobody, as for their specs and merges. Instead of: waiting for the user in the middle of a fixture run.
- **D8 (given by the user)** After a wall, the run does not move on to its next leg, or to landing, until the user has ruled on it: "the run should not progress to the next leg without confirmation from the user about what they want to do". Why: the user decides after every wall. Instead of: a walled reviewer pausing nothing.

## Out of scope

- Rest, reset now and another lane, for workhorses and reviewers: the separate ticket (D6).
- A lane whose login expired: not a usage limit, handled as today.
- A wall the coachman hits itself, which its fallback already handles.
- Runs started before this lands.

## Direction

Linux and macOS, in the language and runtime of the project's other scripts. It changes the coachman's steps, so it lands only after a fixture run from its branch finishes clean (criterion 22). The words that mark a wall stay one list, shared with the watcher. It builds on #200, which has landed.

## Turnpikes

default

## For the agents

*Everything above is what the user signed off. This part follows from it and adds nothing to it.*

### Checks

Every check uses stub harnesses first on PATH, as the launch tests make them, counting their calls; a temporary run root holding run `T` with dispatch `D`, whose `run.json` gives workhorses `stub` (codex) and `mimo`, and a configured lane `sec` (claude, security reviewer) that is not a workhorse; a pinned time zone; and a clock the tests set. The launch step is the coachman's own: `host.sh run … --role lane|reviewer --run D --out … --err … --marker … -- launch.sh launch|review <lane> … --run D`.

- **C1** The launch step, as a workhorse and as a bug and a security reviewer, with Codex ending on the Codex wall below (exit 1), Claude on the Claude limit result below, and MiMo on a limit `error` event with exit 0 → one new `wall` line in `D/actions.jsonl` per launch, written before the marker lands. **At the base:** `log-action.sh D lane:stub wall …` exits 1, not an action in the set.
- **C2** Each `wall` line from C1 holds the lane, its role (a reviewer's with its lens and round), the message's first line byte for byte, and the reset: `2:29 AM` → 02:29 that day in the machine's zone, or the next day once it is more than five minutes past; `3am (UTC)` → 03:00 UTC; `Oct 5th, 2026 2:29 AM` and `Oct 5, 2026 2:29 AM` → as written; `in 20 minutes` → 20 minutes after the stop; two times → the later; no time, or `3am (PST)` → `none`. **At the base:** no `wall` line can be written.
- **C3** The launch step ending on a `504 Gateway Timeout`, on a 401, after a failed command whose output says `usage` and `limit` (a Codex `command_execution` with status `failed`, a MiMo tool part with status `error`), on a final message in prose that mentions a usage limit, stopped mid-run with `host.sh stop`, or after the workhorse committed `WORKHORSE-SUMMARY.md` or `WORKHORSE-BLOCKED.md` → no `wall` line. **At the base:** `launch.sh transient` prints `provider-wall` for both failed-command streams, as it does for the real Codex wall.
- **C4** A `grok` lane ending on a limit message → no `wall` line, and the lane ends as today. **At the base:** no lane records a wall.
- **C5** With a new workhorse wall on a busy run `T1` and one on `T2`: `runs-watch.sh <root> --timeout 5` → `needs T1 WALL` and `needs T2 WALL`, exit 0; after `walls.sh told D <lane>` for each → exit 3. `postmaster.md`'s `WALL` step tells the user once, every new wall of the look in one message. **At the base:** `WAIT`, exit 3.
- **C6** `walls.sh show D` names the run, the lane, its role, the message and the reset with its date in the machine's zone; with `TZ` set to two zones, each shows its own local date. `postmaster.md` tells these. **At the base:** no wall can be shown.
- **C7** With `T` in `<root>/postmaster/held`: no `needs` for its wall; after removing the line → `needs T WALL`. **At the base:** a held run is never named.
- **C8** `runs-status.sh <root>` → NEXT `WALL` for an untold wall, also while the leg's lock is held and with a `.waiting-on-user` older than the wall; with one newer → `USER`. **At the base:** `WAIT`, or `USER` whatever the wall.
- **C9** With a question already in the run's question file, the postmaster writes the wall's question beside it, and `host.sh leg waiting list <root>` shows both. **At the base:** `host.sh leg waiting add` for a run already listed replaces its question.
- **C10** A run paused for walls, idle 31 minutes → not `INSPECT`. **At the base:** a run idle 31 minutes with no marker reads `INSPECT`.
- **C11** `review-round.sh start D 1`, the launch step for `stub` (bug) and `sec` (security) ending on walls, `review-round.sh wait D 1 <repo> bug:stub security:sec` → `run-log.md` has `<lane> <lens>: DEGRADED, provider wall: "<message>"` and a `degrade` line for each, exit 0, and no `.escalation-ready`. **At the base:** `wait` records only timeouts.
- **C12** Round 2's launch calls both reviewer stubs again, with the reset still ahead. **At the base:** the runbook restores a DEGRADED lane on the next round.
- **C13** After C1's workhorse wall with no ruling, `walls.sh escalate D` → `D/ESCALATION.md` naming each walled workhorse with its message and its reset or `no reset time`, and the ruling go on, and `D/.escalation-ready`. `coachman.md` waits for every workhorse marker, then escalates before `stage.sh D synthesis`, with no `checkpoint-1.md`; an ending that is not a wall keeps the remount path. **At the base:** `coachman.md` records the lane DEGRADED and composes from the rest.
- **C14** With a wall that has no ruling: `.leg-1-done` present → `runs-watch.sh` dispatches no leg 2 and names the run; at the review leg's end `coachman.md` escalates before `card.md`; `postmaster.md` lands nothing while `walls.sh open D` exits 1. With every wall ruled → `open D` exits 0, and dispatch and landing go ahead. **At the base:** the watcher dispatches leg 2 once the hand-off checks out.
- **C15** `walls.sh rule D stub go-on` while the leg still runs, and after the pause, and `rule D sec go-on` for a reviewer wall → exit 0, recorded. `postmaster.md` turns the user's words into `walls.sh rule`. **At the base:** no ruling exists.
- **C16** `rule D stub go-on`, `carry D stub` → no harness call, the harvest goes on to the synthesis, and `walls.sh show D` prints `stub: DEGRADED, provider wall: "<message>"`, which `coachman.md` puts on `checkpoint-1.md` and `card.md`; for `sec`, `show` prints `sec security: DEGRADED, provider wall: "<message>"` for `card.md`. **At the base:** the cards say DEGRADED with no set wording.
- **C17** `postmaster.md` asks the user again when their words fit no ruling, and records nothing. **At the base:** no such step.
- **C18** A refused `rule` (`rest`, `reset-now` or `substitute`, which the separate ticket adds, and go on as in C19) → exit 2 with the reason, nothing recorded, the run still paused; `postmaster.md` passes the reason on. **At the base:** no ruling exists.
- **C19** With `mimo` walled too: `go-on` for `stub` while `mimo` has no ruling → accepted; `go-on` for `mimo` after that → exit 2. **At the base:** no ruling exists.
- **C20** A ruling recorded before the harvest → the harvest runs `walls.sh carry` with no escalation; one recorded during the pause → the watcher delivers it at its next look (`POSTMASTER_WATCH_TEST_MODE` records one leg resume, logged with `the watcher took it`). **At the base:** no ruling exists.
- **C21** `sec` walling again in round 2 → a new `wall` line, `WALL` again, and a new ruling needed before landing. **At the base:** no wall is recorded.
- **C22** At landing, a fixture run from the branch whose workhorse stub lane walls on its first call and whose bug reviewer walls once, both ruled `go-on` by the run's postmaster → the leg stops before synthesis with no `checkpoint-1.md` until the ruling, nothing is landed before the reviewer's ruling, the cards show both DEGRADED with the message, `actions.jsonl` shows the two walls, each told, and the two rulings, and `fixture.sh score` exits 0; `scripts/skill-refs.sh` and `bun run check` exit 0. **At the base:** a walled workhorse is DEGRADED.

### Technical notes

- A wall is read from the turn's last error record, per harness, as `harnesses.md` will name it: Codex `turn.failed` (`error.message`); Claude `result` with `is_error: true` (`result`, `api_error_status`); MiMo its last `error` event (it exits 0 on a failed turn); Muse `run.terminal.failed`. grok, agy and pi have no recorded shape and are not read. A final message in prose is not an error record. Its first line is tested with the token stems and the 429 and 402 codes in [`launch.ts` L643-L694](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/launch.ts#L643-L694), the one list; the two messages below join its quote corpus. A workhorse whose root holds a `WORKHORSE-SUMMARY.md` or `WORKHORSE-BLOCKED.md` written during the launch is not read. [`classifyTransient`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/launch.ts#L945-L992) stays as the watcher uses it: over the 254 lane and reviewer ends in this project's past runs it says `provider-wall` 84 times, 3 of them walls, while the last error record finds those 3 and none of the other 6 final errors (five 401s, one 529). (C1, C3, C4, D2, D3)
- The line is written as the launch ends, before `host.sh` lands its marker: `host.sh run` gives the launch `POSTMASTER_EVENT_STREAM` ([`host.ts` L2107](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/host.ts#L2107)) and owns `--err`; a resumed stream is read past the lines it held when the launch started. In #200 the coachman logged the Codex wall at 01:02:11Z, 21 minutes after it landed at 00:40:44Z, and the reviewer's at 05:42:26Z, 59 minutes after 04:43:35Z. (C1, C5)
- [`log-action.ts`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/log-action.ts#L45-L46) gains the action `wall` (lane, role, lens and round for a reviewer, message, reset as an ISO time with offset or `none`), a `told` line, and a line for each ruling and each carry-out. (C2, C15, C22)
- Reset forms: Codex 0.157.1 writes a same-day reset as `%-I:%M %p` and another day's as `%b %-d<st|nd|rd|th>, %Y %-I:%M %p`, in the machine's zone; Claude writes `resets 3am (UTC)`. Also read: the same date without its suffix, and a wait `in N minutes|hours`, counted from when the lane stopped; of two times, the later counts. A zone is an IANA name or UTC; an abbreviation such as PST makes the time unreadable. A time alone is its first occurrence no earlier than five minutes before the `wall` line. The user is told the reset in the machine's zone, with its date. (C2, C6, D4, D5)
- [`runs-status.ts`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/runs-status.ts#L243-L261): `WALL` when a `wall` line has no later `told` line, after `-` and before everything else, except `USER` when `.waiting-on-user` is newer than the newest untold wall. A run paused for walls sits above the idle `INSPECT` rule. [`runs-watch.ts`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/runs-watch.ts#L1278-L1290) wakes on `WALL`, skips held runs as today, and delivers a wall pause whose walls are all ruled itself, through `host.sh leg resume` with a prompt naming the rulings, logged with `the watcher took it`. Its `DISPATCH` step dispatches no next leg while `walls.sh open D` exits 1, and names the run instead. (C5, C7, C8, C10, C14, C20, D8)
- [`host.sh leg waiting add`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/host.ts#L4542-L4558) keeps one entry per run and replaces it, so the postmaster writes a wall's question beside the earlier one in the run's question file and adds that file. (C9)
- `walls.sh`, new, with `walls.ts` and `walls.test.ts`: `show D`, `open D` (exit 1 while any wall has no ruling, listing them), `told D <lane>`, `rule D <lane> go-on`, `escalate D`, `carry D <lane>`; exit 0 done, 1 usage, 2 refused with the reason. `rule` with `rest`, `reset-now` or `substitute` exits 2 until the separate ticket adds them. A reviewer's wall is keyed by its lane and lens. The latest ruling recorded before the carry-out counts, and one after it is refused. `carry` records each go-on once. The postmaster logs `told` once it has told the user, then writes `.waiting-on-user` until the ruling. (C5, C8, C13, C14, C15, C16, C18, C20, D6, D8)
- Go on is refused for a workhorse when no other workhorse is running, has a summary, or is walled with no ruling. (C19)
- Runbooks: [`coachman.md`](https://github.com/brindlewick/postmaster/blob/40d50ce/skills/postmaster/coachman.md#L615-L618) pauses for a wall and keeps the degrade rule for other failures, and the Stage 1 harvest runs `carry` or `escalate`; the [DEGRADED rule](https://github.com/brindlewick/postmaster/blob/40d50ce/skills/postmaster/coachman.md#L1323-L1340) keeps a walled reviewer DEGRADED for its round, and a style lane is not rerun ([L967](https://github.com/brindlewick/postmaster/blob/40d50ce/skills/postmaster/coachman.md#L967)); [Stage 3](https://github.com/brindlewick/postmaster/blob/40d50ce/skills/postmaster/coachman.md#L1000) writes no card while `walls.sh open D` exits 1. `postmaster.md` Stage D gains `WALL`; [Stage E step 2](https://github.com/brindlewick/postmaster/blob/40d50ce/skills/postmaster/postmaster.md#L436-L438) no longer lets the postmaster drop a walled workhorse; [Stage F](https://github.com/brindlewick/postmaster/blob/40d50ce/skills/postmaster/postmaster.md#L455) and any leg the postmaster dispatches itself wait for `walls.sh open D` to exit 0. [`harnesses.md`'s walls section](https://github.com/brindlewick/postmaster/blob/40d50ce/skills/postmaster/harnesses.md#L681-L686) names each harness's last error record and the reset forms. Script paths go through `<tool>`; run `scripts/skill-refs.sh` after. (C5, C6, C11, C13, C14, C17, C18, D1, D8)
- [`review-round.ts` `wait`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/review-round.ts#L378-L381) records a walled reviewer as it records a timeout, with the cause `provider wall`. (C11, C12, C21)
- The fixture's stub lane is a config lane whose env file puts a wall stub first on PATH, as [`launch.test.ts`](https://github.com/brindlewick/postmaster/blob/40d50ce/scripts/launch.test.ts#L95-L111) does; the fixture's brief tells the run's postmaster to rule go on. The score's checks stay as they are; the postmaster reads the walls and rulings from the action log at landing. `walls.sh` and `walls.ts` join [`docs/coachman-contract.toml`](https://github.com/brindlewick/postmaster/blob/40d50ce/docs/coachman-contract.toml). (C22, D7)
- The walls, verbatim. Codex, exit 1: `{"type":"turn.failed","error":{"message":"You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 2:29 AM."}}`. Claude: `{"type":"result","subtype":"success","is_error":true,"result":"You've hit your weekly limit · resets 3am (UTC)","api_error_status":429}`. (C1, C2, D4)

### Verified at 40d50ce

- #200 landed at 266aeda and changed `launch.ts`, `launch.test.ts`, `run-meta.ts`, `coachman.md` and `harnesses.md`; since then only the ticket rules changed. Every file and line range above reads as cited at 40d50ce.
- `launch.sh transient` on stub streams: the Codex wall and the Claude limit → `provider-wall`; a failed Codex command and a failed MiMo tool printing `usage` and `limit` → `provider-wall`; a 504 → `gateway failure`; a 401 → `not-transient`. `log-action.sh` refuses `wall`, exit 1. On a run with no `wall` line `runs-status.sh` reads `WAIT` and `runs-watch.sh --timeout 5` exits 3. `scripts/skill-refs.sh` exits 0.
- `host.sh leg waiting add` drops a run's earlier entry before adding the new one. `runs-watch.sh` leaves a held run alone, and its `DISPATCH` step starts the next leg once the hand-off checks out.
- MiMo Code exits 0 on a failed turn ([trial](https://github.com/brindlewick/postmaster/blob/40d50ce/raw/trials/mimo-headless-forms/method.md#L84-L85)).
- The past-run counts and #200's times come from this project's run records.

