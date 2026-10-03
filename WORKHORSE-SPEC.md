# Workhorse spec: 237 A lane that hits a provider limit pauses its run and tells the user at once

## Summary

A workhorse or reviewer that ends on a provider usage-limit or quota message is recorded
as walled, a walled workhorse pauses its run with an escalation instead of being silently
degraded, and the user hears at once through a new `WALL` run state. One new script,
`lane-wall.sh` (`record`, `pause`, `ruling`), holds the deterministic half; the runbooks
hold the judgment half. The wall classifier in `launch.sh transient` stays the one
authority and is called, never copied.

## Technical context

- **Language and version**: TypeScript on Bun 1.4.2 or newer, as the repo's other scripts:
  each `scripts/<name>.sh` a one-line wrapper handing its arguments to `scripts/<name>.ts`.
- **Dependencies used or added**: none. Reuse only: `launch.sh transient` (subprocess),
  the TOML reader in `scripts/lib/data.ts`, `scripts/lib/proc.ts`, `log-action.sh`,
  `host.sh`, `launch.sh launch`/`resume`, `verify.sh`, and a new pure query module
  `scripts/lib/wall.ts`.
- **Testing**: Bun tests beside every script (`bun run check` runs them); stub lane logs
  (events `.jsonl` streams plus `.err` files in real harness shapes, including the codex
  `turn.failed` shape quoted in D19); stub harness binaries on `PATH` with invocation
  counters for launched-once checks (the pattern `launch.test.ts` already uses);
  `POSTMASTER_WATCH_TEST_MODE` for watcher steps; a fixed `TZ` for clock-time tests.
- **Constraints**: no new Python; works on Linux and macOS 13 or newer with pure
  TypeScript and no platform branches; `launch.ts`'s classifier untouched (the one
  authority; [#200](https://github.com/brindlewick/postmaster/issues/200) merges clean
  either way); `log-action.sh` verbs stay a fixed enforced set, extended by two;
  runbook script references go through `<tool>`.

## Direction check

- The substitute starts from the run's base, never the walled lane's branch, and no
  partial work carries over: the ruling cuts a fresh worktree at BASE (D4) and the
  walled branch is never read for code. Lanes still cannot see each other.
- TypeScript in the scripts the watcher and the coachman already use, tests beside
  them, stub lanes as the launch tests have: new `lane-wall` script plus small edits
  to `runs-status`, `runs-watch`, `log-action` and `launch` (config resolution only);
  tests beside each; stubs as above.
- No new Python: every new file is TypeScript, shell wrappers, or runbook prose.
- Linux and macOS: no shell-outs with platform-specific flags, no `/proc`, no
  GNU-only tools; time math in TypeScript against the machine-local zone.
- The `launch.ts` classifier is the one authority; lane streams and `.err` lines are
  read the way the watcher reads a coachman's: `record` passes `(err, stream, skip)`
  to `launch.sh transient` and treats only its `provider-wall` verdict as a wall. No
  wall-token matching exists anywhere else; message selection is positional (D2).
- The reset time is whatever the provider's message names; when it names none, the
  escalation says so and the ruling decides: D2 parses the named time or records
  `none`; D5 says how a ruling with no time, or a past time, behaves.
- Deterministic work goes in scripts, not prose: record, pause, ruling, WALL
  derivation and the timed rest step are all scripted and tested; the runbooks say
  when to run them.
- Nothing harness-specific in the flow: harness wall shapes are documented in
  `harnesses.md`; the scripts read generic record shapes and the one classifier.

## Structure

New:

- `scripts/lane-wall.sh`, `scripts/lane-wall.ts`, `scripts/lane-wall.test.ts`:
  `record`, `pause`, `ruling`.
- `scripts/lib/wall.ts`, `scripts/lib/wall.test.ts`: pure queries over action-log
  lines (un-ruled workhorse walls, rulings, pending rests).

Changed (implementation plus the tests beside each):

- `scripts/log-action.ts`: two new verbs, `wall` and `wall-ruling`, shape-enforced.
- `scripts/runs-status.ts`: the `WALL` state.
- `scripts/runs-watch.ts`: wake on `WALL`; silence plus a timed resume step for
  rest-awaiting runs.
- `scripts/launch.ts`: config resolution only — a lane missing from `run.json` falls
  back to the run manifest's ruled-in entry. The classifier is untouched.
- `skills/postmaster/coachman.md`: classify at harvest, pause-and-ask for walls,
  ruling forms, card words (`replaced` vs `degraded`).
- `skills/postmaster/postmaster.md`: the `WALL` poll entry, immediate user notice,
  rest-awaiting resumes.
- `skills/postmaster/harnesses.md`: attested wall shapes, the one recognition path.

Deliberately untouched: `review-round.sh` (the coachman classifies reviewers at
harvest with the identical command); stages (a pause is a stop inside the current
stage, not a stage); markers (no new marker); `run.json` (never edited).

## Decisions

### D1. One new script, one shared lib, classifier untouched

`lane-wall.sh` holds `record`, `pause` and `ruling`. `lib/wall.ts` holds the pure
queries `runs-status.sh`, `runs-watch.sh` and `lane-wall.sh` share. `launch.sh
transient` decides every wall; nothing else matches wall tokens. `#200` touches the
harness-command construction in `launch.ts`; this ticket touches config resolution
there only, so the two merge in either order.

### D2. `record`: classify one lane end through the one classifier

```
lane-wall.sh record <dispatch> <lane> <role> <events> <err>
```

`<role>` is `workhorse` or `reviewer`. The command shells to `launch.sh transient
<err> <events> <skip>`, where `<skip>` is the `stream-skip` on the lane's latest
rest ruling, or 0 when there is none (attempt 1 has no earlier attempt; a rested
lane's earlier attempts keep their history in the appended stream, and the skip
reads past them exactly as the watcher's skip does for coachman legs).

- Verdict `provider-wall`: select the message, parse the reset (D17), and append
  `wall <lane> "<role> reset <ISO|none> <message>"` via `log-action.sh`, unless the
  lane already has an un-ruled wall line, in which case record nothing. Print `wall`
  (recorded) or `duplicate` (already recorded).
- Any other verdict: record nothing, print `none`.
- Exit 0 whenever the verdict was obtained; exit 1 on usage or unreadable inputs.
  Callers branch on the printed word, so the common case stays `set -e` safe.

Message selection is positional and matches no tokens: the last error-record text
in the post-skip stream, preferring values under `message`, then `error_message`,
then `reason`, then the first string depth-first excluding `type` and `name`;
failing that, the last non-empty non-`host:` `.err` line; failing that, the last
non-JSON stream line. First line only, capped at 500 characters. The reset parse
runs on the selected message only.

### D3. `pause`: write the pause state and stop

```
lane-wall.sh pause <dispatch> [--note <text>]
```

Collects the run's un-ruled workhorse walls plus its pending rests (D10) from the
action log. When there are neither, print `none` and change nothing. Otherwise
write `<dispatch>/ESCALATION.md` with one section per walled lane (lane, role, the
provider's message verbatim, the reset moment or the words `no reset time named`),
one section per pending rest (lane, `resume after <moment>`), the four ruling
choices with their meanings, the one-lane-per-ruling rule, and the `--note` text
as `Last ruling refused` when given; touch `.escalation-ready`; log one `escalate`
line per un-ruled walled lane (target the lane, detail `provider wall: ruling
needed, rest | reset-now | substitute | go-on`); print `paused <lane>...`. No guard against
re-running: every call is a genuine new pause (initial, post-refusal, or
rest-awaiting), and the coachman never re-pauses an unchanged pause.

### D4. `ruling`: carry out one ruling for one lane

```
lane-wall.sh ruling <dispatch> rest <lane> [--time <clock>]
lane-wall.sh ruling <dispatch> reset-now <lane>
lane-wall.sh ruling <dispatch> substitute <walled> <sub> --brief <file>
lane-wall.sh ruling <dispatch> go-on <lane>
```

Every form first requires an un-ruled workhorse wall for the named lane and
otherwise refuses with exit 2 and a message. Validation passed, the ruling is
logged (`wall-ruling`, D9) at accept time, before acting, and the copy or timing
it carries is in that line. Every form prints `remaining <n>`, the un-ruled
workhorse walls left; the coachman runs `pause` while any remain. Exit 2 is a
refusal (run stays paused, `WALL` still shows); exit 1 is usage or IO.

- `rest`: effective resume-after per D5. When it is now, measure the stream's line
  count N, then resume the lane through the run's standard resume form (`host.sh
  run` with `launch.sh resume --run`, `--append`, the lane's own `--out`/`--err`/
  `--marker` paths); with no recorded thread id (a pre-thread wall) launch fresh
  in the same worktree instead, whose approved spec is already committed. The
  ruling line carries `stream-skip N`. Print `restored <lane>`. The coachman then
  waits and harvests as for any lane.
- `reset-now`: the user asserts the limit is already reset. Resume at once
  through the same standard resume form (or a fresh launch in the same worktree
  with no recorded thread id), regardless of the stated reset time. The ruling
  line carries the stated moment overridden (`stated <ISO|none>`) plus
  `stream-skip N`, so a lane that walls again immediately shows why it was
  resumed early. Print `resumed <lane>`. Never parks. The coachman then waits
  and harvests as for any lane.
- `substitute`: read `[lanes.<sub>]` from the live machine config
  (`POSTMASTER_CONFIG`, else `~/.postmaster/config.toml`) with the TOML reader in
  `scripts/lib/data.ts`. Refuse with exit 2 when the config has no such lane, or
  when the run manifest already has the lane (no second worktree for one lane
  name). Otherwise copy `{harness, model, effort, env_file}` (whichever keys exist;
  values only, never key contents) into a new manifest entry `lanes.<sub> =
  {thread_id: null, outcome: "staged", spec_commit: <the run's approved spec
  commit>, substitute_for: <walled>, config: {...}}` in place; cut
  `<repo>/.worktrees/<TICKET>-<sub>` at BASE on branch `wb/<TICKET>-<sub>`; arm it
  (`verify.sh arm`); commit the approved spec at its root byte-identical (read at
  `spec_commit` from the synthesis worktree); launch it through the standard
  launch form with the coachman-written `--brief`. The ruling line carries the
  copied `harness/model/effort`. Print `substituted <walled> <sub>`. The
  substitute is launched and resumed thereafter exactly like any workhorse (D14);
  the coachman records its thread id, waits, harvests and audits it as any lane's.
- `go-on`: nothing further to run. Print `go-on <lane>`; the coachman synthesizes
  without the lane and records it degraded with the cause on both cards.

### D5. The effective resume-after, and rulings with no time or a past time

For `rest`, the effective resume-after is the ruling's `--time` when given,
else the wall line's reset moment, else none. `--time` takes the D17 clock
shapes, parsed against now. None, or a moment not in the future, means now:
resume on delivery. A future moment means park: log the ruling with
`resume-after <moment>` and print `parked <lane> <moment>`; the coachman runs
`pause` and exits, and the timed step (D10) resumes the leg after the moment.
Nothing sleeps. A ruling `--time` overrides the message's time; the user's word
is fresher. `reset-now` bypasses this rule entirely: it always resumes at once.

### D6. When the coachman classifies a lane end

Workhorses, at harvest, for exited lanes only: a summary present means harvested,
with no classification (a finished lane did not end on a wall, whatever its
stream holds mid-flight). Otherwise run `record`: a wall wins over `BLOCKED`
(the run never auto-resumes into a possibly exhausted allowance; the coachman
attaches the blocked question with `pause --note`). No wall means today's paths:
blocked handling, or the unchanged remount path. Stalled and still-running lanes
are never classified; stall handling is unchanged.

Reviewers, at harvest, for finished non-timeout reviewers only: a reviewer the
wait recorded as timed out keeps its timeout degradation with no classification;
a reviewer that returned a verdict is `REVIEWED` with no classification;
otherwise run the identical `record` command with role `reviewer`. A wall is
recorded as a `wall` line as well as degraded, and the lane is restored by being
launched again in the next round, which the round mechanics do for every lane.

### D7. `WALL` means an un-ruled workhorse wall

A `wall` line with role `workhorse` and no later `wall-ruling` line for the same
lane raises `WALL`. Reviewer walls never raise it: no ruling is owed for them
(the standing disposition is degraded plus restore), and paging the user over a
fully automatic restore would be noise that can stick past the loop's last round.
The tell-user message still names the role.

### D8. Status precedence

`WALL` sits after `USER` and before `RULE`; everything else keeps its order. A
paused run reads `WALL`, which is waiting for the postmaster: the escalation
marker beside it does not win. `USER` still wins once the ruling question is
with the user, so a parked ruling question never re-wakes.

### D9. Line grammars, enforced at write time

`log-action.sh` gains two verbs. Their details are shape-checked like `finding`
and `spec-review`, because `runs-status.sh` and `runs-watch.sh` compute from
them and a malformed line must fail at write time, never misread later.

- `wall <lane> "<workhorse|reviewer> reset <ISO-moment|none> <message>"`: role
  first, then the literal `reset`, the ISO moment in machine-local offset or
  `none`, then the provider's message.
- `wall-ruling <lane> "<rest|reset-now|substitute|go-on> ..."`: `rest
  resume-after <ISO-moment|now> stream-skip <N>`; `reset-now stated
  <ISO-moment|none> stream-skip <N>`; `substitute <sub>
  <harness>/<model>/<effort>`; `go-on degraded`.

### D10. Rest-awaiting runs: silence until the moment, then a mechanical resume

`pause` covers pending rests (a rest ruling with no later `resume` line for the
lane) as well as un-ruled walls, so one command re-pauses every pause. A
`reset-now` ruling never pends: it resumes at once. On `RULE`
with a pending rest and no un-ruled wall, the watcher stays silent while the
moment is future and, once it passes, takes the timed step itself: remove
`.escalation-ready`, resume the leg on its recorded thread with prompt
`Carry out the recorded rest ruling for <lane>; the reset time (<moment>) has
passed.`, and log the step with `the watcher took it`. The coachman then re-runs
the ruling, which resumes the lane. Without a watcher, the postmaster does the
same on reading the rest-awaiting escalation with a past moment.

### D11. Several walls, one lane per ruling

A ruling names its lane, always (substitute names both). After each carried-out
ruling the coachman waits for and harvests any lane it launched, then runs
`pause`: output `paused` means exit; `none` means continue. Launches outlive the
coachman through `host.sh`, so exiting paused with a substitute running is safe;
the next resume harvests it.

### D12. Pre-thread workhorse walls

A workhorse that walled before printing a thread id is recorded and paused like
any workhorse wall. Rest and reset-now launch it fresh in its own worktree
(the approved spec is already committed there); substitute and go-on behave as
usual.

### D13. Walls recurse with no special rule

A substitute, a rested lane, or a lane resumed early by reset-now, that walls
again gets a new wall line (its earlier wall was ruled) and pauses again. The
record shows the whole chain.

### D14. Substitutes launch through the standard forms

`launch.sh` resolves a lane missing from `run.json` from the dispatch manifest's
`lanes.<name>.config`, falling back only there and dying as today when neither
has it. No new flags; launch and resume both work; the coachman uses the
standard forms unchanged. Only config resolution changes; the classifier,
attempt phases and refusal behavior are untouched.

### D15. Cards and the synthesis line

The checkpoint-1 card's per-workhorse outcomes and the ship card's lane outcomes
gain `replaced`: the walled lane is recorded as replaced with the cause and the
substitute's name, never as degraded, and both cards name the substitute. A
go-on lane is recorded degraded with the cause, as today. Rest and reset-now
leave no card mark beyond the wall and ruling lines: the lane continues as any
lane's does. The `SYNTHESIS` line
ranks the lanes that produced work the synthesis considered, the substitute
under its own name; a replaced lane is named on the cards, not ranked. The
substitute is audited (`audit/<sub>.md`, `audit/<sub>-verify/`) as any
workhorse.

### D16. What this does not add

No new stage (a pause stops inside the current stage), no new marker, no
sleeping process, no `run.json` edit, no `review-round.sh` change.

### D17. Reset-time shapes and the reference moment

Parsed shapes, in machine-local zone: `h:MM AM/PM` (`2:29 AM`), `HH:MM` 24-hour
(`14:29`), and relative `in N minutes|hours`. The reference is the mtime of the
file the selected message came from (stream or `.err`). A clock time becomes
the next occurrence strictly after the reference; a relative time is reference
plus delta. First match wins; absent or unparseable means `none`. Strictly
after, never early: a skewed reading waits too long rather than resuming into
the wall, and the escalation shows the computed moment so the user can rule
otherwise.

### D18. The substitute comes from the live machine config

Validation and the entry copy read the live config at ruling time, so a lane
added after dispatch (the ticket's own sonnet example) can step in. The manifest
copy plus the ruling line freeze what ran for the audit. Only the four entry
keys are copied; key contents never enter the repo.

### D19. Stub lanes and controls

Stub lane logs reuse real shapes: the codex wall exactly as the run met it,
`{"type":"turn.failed","error":{"message":"You've hit your usage limit. Upgrade
to Pro (https://chatgpt.com/explore/pro), visit
https://chatgpt.com/codex/settings/usage to purchase more credits or try again
at 2:29 AM."}}`, plus one prose/`.err` shape and the gateway-timeout negative
through the identical command. Launched-once checks use stub harness binaries
with invocation counters. Every check below runs its positive control to a
non-zero reading and its negative control to zero through the identical command.

### D20. Runbook references and the contract check

Every new script reference in runbook prose goes through `<tool>` and names a
script the repo has, so `skill-refs.sh` passes. This changes the coachman
contract (`coachman.md`, `postmaster.md`, `runs-status.sh`, `runs-watch.sh`,
`launch.sh`), so it lands after a fixture run from its final head scores clean;
that fixture is the postmaster's at landing, not a lane task.

## Showing each criterion

| # | Criterion, as the ticket words it | Check (command and input) | Expected output |
|---|---|---|---|
| AC1 | A lane ending on a provider wall is recorded as one. When a workhorse or a review launch ends on a usage-limit or quota message from its provider, the action log gets a `wall` line naming the lane, its role (workhorse or reviewer), the provider's own message and the reset time when the message names one. The same classifier that tells the watcher a wall from a transient ending decides ([`scripts/launch.ts`](https://github.com/brindlewick/postmaster/blob/c74d9b3/scripts/launch.ts#L640-L680)); there is no second one. Check, through the identical command for a workhorse launch and for a review launch: a stub lane ending with a usage-limit message that names a reset time records the line with that time, and the same stub ending with a gateway timeout records none. | `lane-wall.sh record <dispatch> stub workhorse stub-events.jsonl stub.err` with the D19 codex wall stream, then the same with role `reviewer`; then both roles with a gateway-timeout stream and `.err`. | Wall streams print `wall` and append `wall stub "<role> reset <next 2:29 after the stream mtime> You've hit your usage limit..."`; timeout streams print `none` and the log gains no line. `launch.sh transient` is the only classifier invoked; `wall-tokens`/`wall-quotes` output is unchanged. |
| AC2 | A workhorse wall pauses the run and asks. The coachman does not synthesize from the other lanes by itself: it writes an escalation that names the lane, the provider's message and the reset time and lists the choices of criterion 3, and stops, with its usual escalation marker. Check: a run whose stub workhorse hits a wall reaches the escalation and writes no checkpoint card, and its status reads as waiting for the postmaster; with the stub's message transient, the existing resume path is unchanged. | `record` on the D19 wall stub, then `lane-wall.sh pause <dispatch>`; `runs-status.sh <runs>`; `record` on the gateway-timeout stub. | `pause` prints `paused stub`, writes `ESCALATION.md` naming the lane, the provider message, the reset moment and the four choices, touches `.escalation-ready`, and logs `escalate`; no `checkpoint-1.md` exists; status shows `WALL`. The timeout stub prints `none`; the remount prose in `coachman.md` is byte-identical except for the added wall branch. |
| AC3 | The user's ruling has four forms and the flow carries out each. **Rest:** the lane's own session is resumed in its own worktree, only after the reset time, and its result joins the synthesis as any lane's does. **Reset now:** the user has reset the limit themselves, which is sometimes possible, and says so; the lane's session is resumed at once, without waiting for the stated reset time, in its own worktree, and its result joins the synthesis as any lane's does. **Use a different model:** the ruling names another lane from the machine config, for example a Claude Sonnet lane; that lane takes the walled lane's place on the same spec, in a worktree of its own cut from the run's base, so the walled lane's partial work is not carried over and the lanes still cannot see each other's work. Its entry is copied into the run's record at the moment of the ruling and the copy is logged, so the record shows what ran. Its result joins the synthesis as any workhorse's does. The walled lane is recorded as replaced, with the cause and the substitute's name, on the checkpoint card and the ship card, not as degraded, and the cards name the substitute. A ruling that names a lane the machine config does not have is refused with a message and the run stays paused. **Go on without it:** the lane is recorded degraded on both cards, as today. Check against the stub lanes: after a rest ruling the lane is launched once, not before the stated time, and its result reaches the synthesis; after a reset-now ruling the lane is launched once at once, with the stated time still in the future, and its result reaches the synthesis; after a substitute ruling that names a configured stub lane that lane is launched once in its own worktree, its result reaches the synthesis, the run's record gains its entry, and both cards name both lanes; a substitute ruling that names an unknown lane is refused and the run stays paused; after a go-on ruling the cards name the lane as degraded and the cause. | `ruling <dispatch> rest stub` with the reset past (stub harness on `PATH`), and with the reset future; `ruling <dispatch> reset-now stub` with the reset future (stub harness on `PATH`); `runs-watch.sh` with a pending rest past its moment under `POSTMASTER_WATCH_TEST_MODE=1`; `ruling <dispatch> substitute stub sonnet --brief <file>` with a stub `sonnet` lane in a test config, and with an unknown lane; `ruling <dispatch> go-on stub`. | Past rest launches the stub harness exactly once in the lane's worktree and logs the ruling with `resume-after` and `stream-skip`; future rest prints `parked`, launches nothing, and the staged watcher resumes the leg after the moment. Reset-now with the reset future launches the stub harness exactly once at once and logs the ruling with the stated moment overridden. Substitute launches the stub lane once in `<TICKET>-sonnet` cut at BASE with the approved spec committed and none of the walled lane's files, gains the manifest entry plus the ruling line carrying `harness/model/effort`; unknown lane exits 2 with a message naming it, logs no ruling, and the run still shows `WALL`. Go-on logs the ruling and prints `go-on`. Which lane each synthesis part came from, and the replaced/degraded card words, are runbook prose, read against this criterion. |
| AC4 | A reviewer wall does not pause the run. It is recorded as a `wall` line as well as degraded, and the lane is restored on the next round, as the runbook says today. Check: a stub reviewer that hits a wall in round 1 is launched again in round 2, and the round-1 record carries the degraded word and the `wall` line. | `record` with role `reviewer` on the D19 wall stub (the AC1 identical command); read the review-harvest prose. | The round-1 record carries the `wall` line; the degraded word, the no-verdict classification and the round-2 restore are the runbook's existing round mechanics, read against this criterion, with status showing `WAIT`, never `WALL`, for a reviewer wall. |
| AC5 | The user hears at once. A `wall` line without a ruling makes the status table show a `WALL` state for the run and the watcher stops for it instead of carrying on; the postmaster's runbook says to tell the user immediately, naming the run, the lane, its role and the reset time. Check: with a recorded wall and no ruling `runs-status.sh` shows `WALL` for the run, and after the ruling it does not. | `runs-status.sh <runs>` on a record with a workhorse wall line and no ruling, then after appending the ruling; `runs-watch.sh --timeout` over a `WALL` run; the same record with role `reviewer`. | `WALL` before the ruling through the identical command, not `WALL` after; the watcher wakes naming the run and `WALL`; the reviewer-wall record never shows `WALL`. The immediate tell-user wording is `postmaster.md` prose, read against this criterion. |
| AC6 | The runbooks say it. `coachman.md` replaces the degrade-and-go-on rule for provider walls with the pause-and-ask of criterion 2 and keeps it for failures that are not walls; `postmaster.md` and `harnesses.md` say what the postmaster does with `WALL`. Check: read against the criteria, and `scripts/skill-refs.sh` passes. | Read the three runbooks against AC1-AC5; run `skill-refs.sh`. | Walls pause and ask, non-wall failures degrade and go on as today; `WALL` handling, the immediate notice and the ruling delivery are in `postmaster.md`; attested wall shapes and the one recognition path are in `harnesses.md`; `skill-refs.sh` exits 0. |

## Tasks

- [ ] T001 [P] [AC1] Add `scripts/lib/wall.ts` plus `scripts/lib/wall.test.ts`: pure
  queries over action-log lines (un-ruled workhorse walls, rulings by lane,
  pending rests).
- [ ] T002 [AC1] Add `scripts/lane-wall.sh`, `record` in `scripts/lane-wall.ts`,
  plus tests in `scripts/lane-wall.test.ts`, with the D19 stub streams.
- [ ] T003 [P] [AC1] Add the `wall` and `wall-ruling` verbs with detail
  shape-checks in `scripts/log-action.ts` plus tests in `scripts/log-action.test.ts`.
- [ ] T004 [AC2] Add `pause` in `scripts/lane-wall.ts` plus tests: escalation
  content, marker, `escalate` lines, `paused`/`none`.
- [ ] T005 [AC3] Add `ruling rest` and `ruling reset-now` in
  `scripts/lane-wall.ts` plus tests: past-time rest launches the stub once,
  future-time rest parks without launching, reset-now with the reset future
  launches at once, skip recorded in each resume.
- [ ] T006 [AC3] Add `ruling substitute` in `scripts/lane-wall.ts` plus tests:
  live-config validation, refusal of unknown and already-run lanes, manifest copy,
  worktree cut at BASE with the approved spec, single launch.
- [ ] T007 [AC3] Add `ruling go-on` in `scripts/lane-wall.ts` plus tests.
- [ ] T008 [AC3] Add the run-manifest lane fallback in `scripts/launch.ts`
  config resolution plus tests in `scripts/launch.test.ts`; classifier untouched.
- [ ] T009 [AC5] Add the `WALL` state in `scripts/runs-status.ts` plus tests in
  `scripts/runs-status.test.ts`: precedence, role filter, ruled clears.
- [ ] T010 [AC3] [AC5] Add the rest-awaiting silence and timed resume step in
  `scripts/runs-watch.ts` plus tests in `scripts/runs-watch.test.ts`; `WALL` wakes.
- [ ] T011 [P] [AC4] Audit every manifest-lanes reader (`fixture-lanes.ts` and
  any other) for the substitute entry shape; adjust only what breaks, with tests.
- [ ] T012 [AC2] [AC3] [AC4] [AC6] Edit `skills/postmaster/coachman.md`: harvest
  classification, pause-and-ask for walls, ruling forms, rest-awaiting, card words,
  audit and manifest rows; keep degrade-and-go-on for non-walls.
- [ ] T013 [AC5] [AC6] Edit `skills/postmaster/postmaster.md`: the `WALL` poll
  entry with the immediate notice, ruling delivery, rest-awaiting resumes.
- [ ] T014 [AC1] [AC6] Edit `skills/postmaster/harnesses.md`: attested wall
  shapes, the one recognition path.
- [ ] T015 [AC6] Run `scripts/skill-refs.sh` and the full gate `bun run check`
  until clean; keep a transcript per criterion under `.postmaster/verify/`.
