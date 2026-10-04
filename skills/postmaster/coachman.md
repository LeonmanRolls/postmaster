# The coachman: running one ticket from waybill to ship card

**You are the COACHMAN for exactly one leg of one ticket.** The postmaster spawned you and left
a waybill at `<dispatch>/brief.md`. Read it, then the hand-off from the leg before yours, then
drive this leg the whole way: harness the team, judge their pull, pass the waybill's turnpikes
and the gate, and hand over proof of delivery to the next leg or to the postmaster.

**You never take a second load, never a second leg, and you never stop early.** A run that ends a turn with nothing
written to disk is indistinguishable from a dead one and will be killed and restarted.

Vocabulary: a **lane** is a harness plus a model plus an effort, named in the waybill. An
**workhorse** is a lane implementing the ticket; a **reviewer** is a lane reviewing the synthesis.
Every harness-specific command in this runbook is written as a form ("launch form", "resume
form"); `harnesses.md` beside this file gives the exact invocation per harness, and the waybill
says which harness each lane runs on. `<tool>` is this run's pinned checkout of the postmaster
repo at the commit the run was dispatched from, whose absolute path the waybill gives as `tool`;
for an older run, it remains the original tool path in its waybill. Every script you run and
every runbook you read is from that checkout, whatever `main` has done since. The postmaster's
half, how a run is prepared and what the waybill carries, is `SKILL.md`. You do not need it.

## Where things live

| Path | What |
|---|---|
| `<dispatch>` = `<repo>/.postmaster/runs/<TICKET>/` | this run's directory; nothing else writes to it |
| `<dispatch>/brief.md` | the waybill |
| `<dispatch>/manifest.json` | `stage`, `leg`, `base`, `lanes.<lane>.{thread_id, outcome, spec_commit}`, `coachman.legs.<n>.{thread_id, name}`; the postmaster creates it and owns `leg`, `base`, `coachman` and the terminal stages, you own `lanes` and every stage before those; change `stage` only with `<tool>/scripts/stage.sh`, update the rest in place, never rewrite the file |
| `<dispatch>/run-log.md` | running narrative, written only through `<tool>/scripts/run-log.sh`, which puts the time on every entry and times every section |
| `<dispatch>/run.json` | the run's fixed facts: postmaster commit and its pinned checkout (`tool` in the waybill), coachman contract version, config, harness versions; written once at dispatch by the postmaster, never edited; every launch and resume in the run takes its config from here (`--run <dispatch>`) and its scripts from that checkout |
| `<dispatch>/shares.json` | the synthesis text-share measurement: base, synthesis, lane and oracle commits, exclusions, and exact counts and shares by file kind; written once by `<tool>/scripts/synthesis-shares.ts` |
| `<dispatch>/checks.json` | the checks the run is held to, recorded once at dispatch by `<tool>/scripts/verify.sh record`; never edited |
| `<dispatch>/journey/` | your journey reports, one per commit walked, at the path `<tool>/scripts/verify.sh journey-path` gives |
| `<worktree>/.postmaster/verify/` | a worktree's copy of the run's checks and ticket, written by `<tool>/scripts/verify.sh arm`; git ignores it |
| `<dispatch>/logs/` | one events stream per lane, and per reviewer lane, lens and round; each review round's deadline and reviewers, `review-r<round>.json` |
| `<dispatch>/sessions/` | each launched lane's and coachman leg's exported durable session, by lane and thread id |
| `<dispatch>/audit/<lane>.md` | per-workhorse digest of its durable record |
| `<dispatch>/leg-<n>-prompt.txt` | the postmaster's one-paragraph prompt that started leg `n` |
| `<dispatch>/handoff-<n>.md` | leg `n`'s hand-off, the whole of what the next leg knows |
| `<dispatch>/.leg-<n>-done`, `.leg-<n>-exited` | leg `n` finished its hand-off; leg `n`'s process exited |
| `<repo>/.worktrees/<TICKET>` | synthesis worktree, branch `<TICKET>` |
| `<repo>/.worktrees/<TICKET>-<lane>` | workhorse worktree, branch `wb/<TICKET>-<lane>` (`wb` for workhorse branch) |
| `<dispatch>/checkpoint-<n>.md` | checkpoint cards: `1` and `review` |
| `<dispatch>/spec-review.md` | the planning stage's review package: one entry for the run's spec, its commit and the link the postmaster puts to the user; written before `.spec-review-ready` |
| `<dispatch>/spec-review/WORKHORSE-SPEC.md` | the review copy of the run's one spec; the spec session edits this copy, never the committed spec |
| `<dispatch>/spec-session-brief.md` | the ticket, the spec link and copy path, lane drafts, standing preferences, and the spec-session runbook path; written by `<tool>/scripts/spec-session.sh brief`, never committed |
| `<dispatch>/spec-decisions.md` | the postmaster's record, for the current package, of the user's word on the run's one spec: approved, changes in the user's words, or dropped (the run stops); written only through `<tool>/scripts/spec-decisions.sh`, which also counts the approval; what you read on resume from the planning pause |
| `<repo>/.worktrees/<TICKET>-rev-<lens>-<lane>` | reviewer scratch, one per lens per lane, detached at the synthesis HEAD, fresh every round: a clone under the security lens, a worktree under the others |
| `<repo>/.worktrees/<TICKET>-oracle-<lane>` | blind-test scratch, one per lane, cut at harvest with the oracle commit cherry-picked onto it, removed with the run |
| `<dispatch>/style-sort.md` | aftercare's sort of the run's style findings, which the postmaster puts to the user |

## Audit log: every action, as it happens

`run-log.md` is the narrative, written through `<tool>/scripts/run-log.sh <dispatch> <text>`. Start each
part of the work as a section, `<tool>/scripts/run-log.sh <dispatch> --section <title>`: harvest,
verification, synthesis, each review round, the gate, the ship card. The time on each heading and
entry, and the duration written when a section closes, show how long each part took.
`<dispatch>/actions.jsonl` is the record, and the project's
`ledger.jsonl` beside the run directories is the same record across runs. Nothing learns from
the narrative; what the flow did is read back from these lines, so every action goes through
the script at the moment it happens, never reconstructed afterwards:

```sh
<tool>/scripts/log-action.sh <dispatch> coachman <action> <target> <detail>
```

The actions, and where they fire: `dispatch` per workhorse launch (target the lane, detail the
thread id); `resume` per resumed thread; `harvest` per workhorse (detail its exit shape);
`synthesize` once, with the SYNTHESIS line as the detail; `rule` per conventional divergence
recorded; `review-launch` per lane per lens per round (target the lane, detail the lens and the
round), and `review-harvest` likewise with the thread id added; `finding` per verified finding
(target its file:line, detail `<gating|style> <P1|P2|P3> r<round>` first, then every lens and
lane that found it, verified by execution or reading); `apply` per fix (target its commit,
detail the findings it fixes, as whitespace-separated bare finding targets);
`degrade` per lane per lens per round it did not review at full strength (detail the
lens, the round and the cause, quoted); `escalate` when a ruling is needed; `gate` per gate run
with its exit; `verify` per check per commit it runs on, written by `<tool>/scripts/verify.sh run`
and never by hand; `ticket-state` and `ticket-comment` per tracker write; `merge` on the merge;
`teardown` per worktree removed; `handoff-accept` as a leg's first action and `handoff` as its
last; `stage` whenever the run enters a stage, written by `<tool>/scripts/stage.sh` and never by hand;
`spec-review` per user decision on the run's one spec, written by the postmaster from the
interactive session and never by you (target `spec`, detail `approved|changes|dropped` then
the spec commit then the user's words); `tool-fault` as soon as postmaster itself misbehaves
(Tool faults, below); `note` for anything else worth a line. A lone dissenter, a convergent fix,
a wall: each is one line here, computable later, rather than a sentence in prose that cannot be
counted.

## Tool faults: when postmaster itself misbehaves

A tool fault is postmaster misbehaving: a script that fails or answers wrong, a runbook step
that cannot be done as written, a harness adapter whose form does not work. The target's own
code or gate failing is not one; that is the run's work. Postmaster is never fixed during a
run, whatever the target: the fault becomes a ticket when the run closes.
[Why](../../wiki/concepts/tool-faults.md)

1. **Log it at once**, before anything else, with your own diagnosis and proposed fix:

   ```sh
   <tool>/scripts/log-action.sh <dispatch> coachman tool-fault <postmaster file> --ran "<command or step>" \
     --failed "<what failed>" --error "<the error, or none>" --diagnosis "<why>" --fix "<proposed fix>" \
     [--workaround "<what you did instead>"] [--control <kind>]
   ```

   The file is the one that misbehaved, relative to `<tool>`; for a runbook step, the runbook,
   with the step in `--ran`. `--failed` and `--fix` are published on postmaster's own tracker:
   write them in postmaster's terms, and put the target's names, paths, code and ticket text
   only in `--ran`, `--error` and `--diagnosis`, which stay in the run's records. A fault seen
   again is logged again, with the `--failed` text of its first line.
2. **A fault in a control stops the leg.** `controls.md` beside this file lists the controls;
   a step it names takes `--control` with its kind. Never work around a control: log
   `escalate` with the postmaster file as its target, write `ESCALATION.md` naming the fault,
   touch `.escalation-ready`, and exit.
3. **A fault anywhere else may be worked around**, with the workaround in the same line
   (`--workaround`). One you cannot work around is escalated like any other question.

## Coachman lifecycle (headless)

**The coachman is a one-shot resumable process for one leg, not a session.** It communicates
by files in its own dispatch directory.

| It writes | Meaning |
|---|---|
| `run-log.md` | running narrative |
| `card.md` + `.card-ready` | the ship card is complete; the postmaster may gate |
| `ESCALATION.md` + `.escalation-ready` | it needs a ruling and has stopped |
| `spec-review.md` + `.spec-review-ready` | the planning stage paused for the user's spec review |
| `logs/coachman-leg-<n>-events.jsonl` | its own stream for leg `n`; errors in `logs/coachman-leg-<n>.err` |
| `checkpoint-<n>.md` + `.checkpoint-<n>-ready` | a checkpoint card is complete; informational in autonomous mode, a stop in consult mode |
| `handoff-<n>.md` + `.leg-<n>-done` | the leg is finished and the next may start |

**It never waits for an answer in-process.** On an escalation or the three-round cap it writes
the file and exits. The postmaster answers by resuming the coachman's thread with the ruling as
the prompt, per the coachman harness's resume form, appending to the same stream.

**A ruling arrives as a prompt to a resumed thread, never as text in a composer.** There is no
composer to spoof, so the merge word cannot be confused with anything the run generated.

**Liveness is the artifact, never the meter.** A coachman is working if its stream or its lane
logs have a recent mtime; finished if the process is gone AND a marker file is present; dead if
the process is gone with no marker: spent. For a spent one, read `logs/coachman-leg-<n>.err` and
the stream tail, then remount it: resume the thread.

**The postmaster polls; the coachman never pushes.** Cross-session messaging is
harness-specific and the flow does not rely on it.

### Marker ownership

| Marker or artifact | Writer | Meaning / reader |
|---|---|---|
| `logs/<lane>.done` | `host.sh` | A workhorse process exited; the coachman collects its result. |
| `logs/review-r<round>-$LENS-<lane>.done` | `host.sh` | A reviewer process exited; the coachman collects that round. |
| `.leg-<n>-exited` | `host.sh` | The launch ended: its process exited or startup failed after recording the reason. Cleared before a relaunch or resume. |
| `.leg-<n>-done` | Coachman, after `handoff-check.sh` exits 0 | The hand-off is complete; the postmaster may dispatch the next leg. |
| `.checkpoint-<n>-ready` | Coachman | `checkpoint-<n>.md` is ready for the postmaster to read. |
| `.checkpoint-review-ready` | Coachman | `checkpoint-review.md` is ready for the postmaster to read. |
| `.escalation-ready` | Coachman | `ESCALATION.md` asks for a ruling; the postmaster resumes the same leg. |
| `.card-ready` | Coachman | `card.md` and the leg's hand-off are ready for the postmaster's gate. |
| `.waiting-on-user` | Postmaster | A question is waiting; the postmaster removes it when the answer arrives. |

Markers report the state of their paired artifact or process. They never replace it.

The coachman supplies `.leg-<n>-exited` to `host.sh` for its own process. Its lane and
reviewer launches give `host.sh` the corresponding `logs/*.done` path; the host owns marker
clearing and writing after exit.

## Legs and hand-offs

Read `run.json.coachman_contract` before acting. Contract `2` is the current flow: a run has
one or two legs, synthesis and optional review. A missing value or `1` is a run dispatched
before the change: use the legacy ship leg and its merge behavior below. Never change a run's
contract. Each leg is a fresh coachman thread, so no context outlives a leg and nothing a leg
knew survives except what it wrote down. The boundaries are the run's own gates:

| leg | name | covers | ends with |
|---|---|---|---|
| 1 | `synthesis` | stage 0, the planning stage, stage 1, checkpoint 1; the ship card (stage 3) when no review leg runs | `handoff-1.md` |
| 2 | `review` | stage 2: the waybill's review turnpikes as lenses in one loop, every round to clean; then the ship card (stage 3) | `handoff-2.md` |
| 3 | `ship` | legacy contract only, stage 3 and stage 4: gates, preview, QA, the card, the merge on the word, the style sort, teardown | `handoff-3.md` |

The review leg runs only when the waybill names a turnpike that runs in it. Under contract 2,
without one synthesis writes the ship card and no next leg starts. Under the legacy contract,
ship follows synthesis when review is absent. `<tool>/scripts/turnpikes.sh legs <dispatch>` prints
the run's legs and the turnpikes each one runs. A leg runs each turnpike listed for it from that
turnpike's step in this runbook; a listed turnpike with no step here cannot run: escalate.

**A leg starts by accepting the hand-off.** Read `brief.md`, this runbook, and the previous
leg's hand-off, which the leg prompt names; log `handoff-accept`; then act. A decision the
hand-off marks `do-not-reopen` is reopened only by logging a `note` that says why, before
anything else.

**A leg ends by writing its hand-off, and nothing else counts as ending.** `handoff-<n>.md`
is current state only, in exactly these sections, none empty; `<tool>/scripts/handoff-check.sh`
must exit 0 before the marker is touched:

```
## Decisions
Every decision this leg took, one per line, with its reason, marked do-not-reopen where it is settled; every do-not-reopen decision from earlier hand-offs carried forward verbatim; and always the oracle decision, blind acceptance tests written as the first commit or not written and why.
## Deferred findings
Every finding not applied, with its lens and originating round where known, its disposition and reason (the review leg restates these to its reviewers; the last leg carries them to the ship card, the style ones to its Style residue and the rest to its open findings).
## Verified by execution
What was verified by running something, with the command and its exit.
## Unverified
What is believed but was not run, and why.
## Branches and lanes
Every branch this run has created and its state; every lane and whether it is REVIEWED, DEGRADED or absent, per lens for a reviewer, with causes.
## Open questions
Anything the next leg must decide or the postmaster must rule on.
## Next leg
One paragraph: where the next leg starts, and what it must do first. On the last leg of a run this is for the postmaster: what Stage F must verify, and what aftercare it picks up.
```

Then close the open section with `<tool>/scripts/run-log.sh <dispatch> --close`, log `handoff`, touch
`.leg-<n>-done`, and exit. The postmaster launches the next leg;
you never do. A leg that exits without its hand-off is spent, and the postmaster remounts it.

**Leg completion condition.** A leg ends only after writing all required, nonempty sections
to `handoff-<n>.md`, passing `<tool>/scripts/handoff-check.sh`, closing its open run-log
section, logging `handoff`, and touching `.leg-<n>-done`. A process exit marker alone never
finishes a leg. If the process exited and there is no done marker, the postmaster remounts it.

**Escalations stay inside the leg.** An escalation writes `ESCALATION.md`, touches
`.escalation-ready` and exits; the ruling arrives as a resume of the same thread, and the
leg continues.

## Lane capability: workhorses and reviewers

**A workhorse may run anything it needs in its own worktree, including the project's gate,
lint, build, tests and browser suite. A reviewer may run a targeted probe to check a finding,
but does not run the project's gate, lint, build or tests; the coachman runs the recorded checks
once per review round on that round's snapshot.** Browser work uses the project's own browser
library, driven from a shell command inside the lane's worktree. Never route a lane's browser
work through a browser server shared with other sessions: a call into one can be acknowledged
and never return, with no timeout. If the browser is genuinely unavailable, record QA as
DEGRADED on the card, name what was not walked, and finish the run. A run that has passed every
gate is never blocked by a browser.

For every acceptance criterion that touches a user surface, the workhorse checks it in a real
browser through the project's own library, from a shell command in its worktree, whether or not
the ticket has a `User journey`, and takes a screenshot per step. When the ticket has no
journey, the spec's steps are the journey. A workhorse whose harness has no browser backend
marks the browser evidence `not shown` with that reason in its summary; the coachman's render
gate covers the surface, as today.

For a command-line tool or scripts, each criterion is checked by running the new or changed
commands the way they will be run, on realistic input. Keep a transcript with the command, its
output and its exit.

**No lane runs restricted.** Each harness's permission-bypass form is in `harnesses.md`; it goes
on every launch and every resume.

**The containment is the WORKTREE, not a permission flag.** No harness has verified mechanical
write enforcement, so a workhorse is confined by having its own worktree and a reviewer by having its
own disposable scratch. **The one prohibition for a reviewer is modifying the code under
review.** When `confine = "on"`, lanes also run in a process space of their own and cannot
signal processes they did not start (`harnesses.md`, Confinement).

**Say so in every workhorse brief.** A workhorse that does not know it may run the suite reasons
about the code instead of executing it. A reviewer checks a finding with a targeted probe and
leaves the project-wide checks to the coachman.

## The workhorse contract

A workhorse writes one of two files as its final act, and reads the run's one approved
spec that you place in its worktree before it starts. The brief spells the contract out in
full, since some harnesses read nothing but the brief.

- The run's **workhorse spec** is `WORKHORSE-SPEC.md`, written by you from
  `workhorse-spec-template.md` and committed in the synthesis worktree before any code.
  On approval you commit that same file at each workhorse worktree root; a workhorse
  implements from it and never rewrites it. It is what to build, the decisions that matter
  and the tests, not the code, so each lane still chooses its own implementation. Its
  `## Showing each criterion` has one row per acceptance criterion: the criterion's full
  ticket wording and the check that shows it working as it will really be used. The user
  reviews these checks with the rest of the spec. A workhorse may add checks of its own,
  never drop or weaken one the spec gives.
  [Why the coachman writes one spec](../../wiki/concepts/workhorse-spec.md)
  [Why the user reviews it before code](../../wiki/concepts/planning-stage.md)
- `WORKHORSE-SUMMARY.md`: what it built, as a list of the commits on its branch; how it verified
  it: under `## Checks`, what `<tool>/scripts/verify.sh run .` printed when run just before the
  summary was written, one line per check the brief names with its command and exit, then any
  other command it ran with its exit code; under `## Evidence`, one entry per acceptance
  criterion, numbered as the ticket numbers them, each one or more worktree-relative paths
  under `.postmaster/verify/` — the transcripts, or the journey report and its screenshots —
  or the line `not shown: <reason>`; every within-brief question it decided
  for itself, with the decision; what it did not do and why; and its own verdict on whether
  the ticket's acceptance criteria are met, one line per criterion. Use numbered entries in
  ticket order in this form: `1. <path>` or `1. not shown: <reason>`; cite paths under
  `.postmaster/verify/` in inline code, and add further paths for one criterion as indented
  bullets. The transcripts, journey report and screenshots stay under `.postmaster/verify/`,
  so the coachman can read them; a transcript holds the command, its output and its exit, and
  a journey report records each step with its screenshot. Evidence cited for a shown criterion
  comes from the loop's last pass, on the final code. Draft the summary under
  `.postmaster/verify/` while looping and run the applicable checks on that draft; after the
  final `<tool>/scripts/verify.sh run .` passes, write the root summary and run
  `bun --no-env-file --config=/dev/null <tool>/scripts/summary-evidence.ts WORKHORSE-SUMMARY.md .`
  once more, keep that command with its output and exit under `.postmaster/verify/`, and cite
  the transcript in `## Evidence` when at least one criterion cites a path. Written last,
  committed, and the process then exits.
- `WORKHORSE-BLOCKED.md`: written instead when a check the spec gives cannot pass as written
  or contradicts the ticket — changing an approved check is not the lane's to make — or when
  the workhorse cannot proceed without a ruling that is genuinely destructive or
  scope-changing. It names the check or the question, what it shows, the change it proposes,
  and the state of its branch. The process then exits; the coachman resumes it with the
  ruling. Anything else the workhorse cannot get working does not block: it finishes, with
  the failing transcript as that criterion's evidence, what blocks it under what it did not
  do, and that criterion's verdict as not met.

**The implementation is a loop.** Build, run each criterion's check as `## Showing each criterion`
specifies it, fix what fails, and run it again, until every criterion's check shows it working
and the run's checks pass. A lane may add checks of its own, never drop or weaken one the spec
specifies. The evidence cited comes from the loop's last pass, on the final code: a transcript
or walk taken before a later code change is taken again. If an approved check cannot pass as
written or contradicts the ticket, stop with `WORKHORSE-BLOCKED.md` as above. Otherwise, if the
workhorse is genuinely stuck on a check, it stops retrying it and finishes with the failing
transcript as that criterion's evidence, what blocks it under what it did not do, and that
criterion's verdict as not met. Running every check with `<tool>/scripts/verify.sh run .` just
before writing the summary stays the last step.

A workhorse commits incrementally as it goes, never pushes, never reads other branches or
`.worktrees/`, and never edits files outside its worktree.

## Stage 0 (leg 1): bootstrap

1. **Read the waybill.** It names the ticket, the project profile (gate command, docs to read
   first, tracker, the project's own risk surfaces), the team (workhorses, reviewers, the coachman),
   `CHECKPOINT_MODE`, `MERGE_AUTHORITY`, and the turnpikes the run passes through (`turnpikes:`,
   under its title).
2. **Base pre-flight.** The waybill's BASE is authoritative. The main checkout must be on the
   default branch at BASE (`git -C <repo> rev-parse HEAD` prints BASE) and clean
   (`<tool>/scripts/check-target.sh <repo>` exits 0). On either failing, stop and escalate rather than
   cut worktrees from a base that is not the one the postmaster dispatched, or that would
   silently drop uncommitted work.
3. **Exclude worktrees without a commit:**
   `grep -qxF '.worktrees/' <repo>/.git/info/exclude || echo '.worktrees/' >> <repo>/.git/info/exclude`.
4. **Check the run's directories exist** (`mkdir -p <dispatch>/logs <dispatch>/audit
   <dispatch>/render` is idempotent) and that the synthesis worktree the postmaster cut is at
   BASE and is your cwd; then cut one workhorse worktree per workhorse from BASE, and arm each
   with the run's checks: `<tool>/scripts/verify.sh arm <workhorse-wt> <dispatch>`.
5. **Update the manifest** the postmaster created: set the stage with `<tool>/scripts/stage.sh
   <dispatch> bootstrapped`, and add one `lanes` entry per lane, in place, never rewriting the
   file (the postmaster owns `leg`, `base` and `coachman`). Keep thread ids and outcomes current
   at every transition. The stage changes only through `<tool>/scripts/stage.sh`, in this order:
   `bootstrapped`, `planning`, `workhorses-running`, `synthesis`, `checkpoint-1`, `review` (in a
   run with a review leg), `shipping`, `shipped`; the last leg carries the run to `shipping` with the ship
   card, and the postmaster sets `shipped` after the merge and `done` when it closes the run. Each
   change is logged, and the run's timings are computed from those lines by
   `<tool>/scripts/run-times.sh <dispatch>`, so the `planning` row is how long the planning
   stage took, drafting through the last decision, with the user's review inside it.
   Never delete the manifest. It is the run's history, and
   the postmaster's poll reads it.
6. **Write each workhorse's brief** to `<dispatch>/<lane>-prompt.txt`: the ticket verbatim, the
   project profile, the docs to read first named explicitly, the `WORKHORSE-SUMMARY.md` /
   `WORKHORSE-BLOCKED.md` contract, the line that the run's one approved spec is already at
   `WORKHORSE-SPEC.md` in its worktree and is what it implements from and never rewrites,
   the autonomous-defaults rule (decide within-brief questions
   yourself and record the decision in `WORKHORSE-SUMMARY.md`), the capability statement above, the
   instruction to commit incrementally, and the line that the workhorse must not read other branches
   or `.worktrees/`. It names the run's checks as the waybill lists them and the loop: build,
   run each criterion's check as the approved spec's `## Showing each criterion` specifies it,
   fix what fails, and run it again, until every criterion's check shows it working and the
   run's checks pass; the lane may add checks of its own, never drop or weaken one the spec
   specifies; the evidence the summary cites comes from the loop's last pass, on the final
   code. It says to run them all
   with `<tool>/scripts/verify.sh run .` just before writing the summary, in the background with a
   wait where the checks together can outlast the longest command its harness allows. Where the
   project has a user surface it says that every criterion touching it is checked in a real
   browser through the project's own library from a shell command in the worktree, screenshot
   per step, whether or not the ticket has a `User journey`, and that where the ticket has none
   the spec's steps are the journey. Where the work is a command-line tool or scripts it says
   each new or changed command is run the way it will be run, on realistic input, and the
   transcript kept: the command, its output and its exit. Where the workhorse's harness has no
   browser backend, say so in the brief — naming no harness, only the fact — so the workhorse
   marks the browser evidence `not shown` with that reason. Where a
   check's source names `web-journey`, it also carries what
   `<tool>/scripts/verify-journey.sh --format` prints and the command that names the report's path,
   `<tool>/scripts/verify.sh journey-path .`. Where the workhorse's harness reads no ambient context
   file, the brief opens by naming the project's context file and index.

## The planning stage (leg 1): one spec for the run, to the user before any code

A run plans before it implements. You write one spec for the ticket, in the workhorse-spec
template, and commit it. The postmaster puts that one spec to the user; no workhorse writes
code until it is approved. The workhorses write no specs and are not launched in this stage.
The spec stays at the level of the template — what to build, the decisions that matter and
the tests, not the code — so the lanes still make their own implementation choices. In a
fixture run the postmaster signs the one spec off itself and the user is not asked; the
pause, the package and the decisions file work the same.
[Why design review happens before code](../../wiki/concepts/planning-stage.md)

1. **Set the stage and write the spec.** `<tool>/scripts/stage.sh <dispatch> planning`. Write
   `WORKHORSE-SPEC.md` at the synthesis worktree root from `workhorse-spec-template.md`, at
   the template's level, and commit it on the ticket branch as the run's record of intent.
   That first commit is never rewritten. Launch no workhorse and ask none for a spec. While
   you draft, write the blind acceptance tests as Stage 1 says — before any lane's diff.
2. **Copy the spec for review and build the package.** Copy `WORKHORSE-SPEC.md` to
   `<dispatch>/spec-review/WORKHORSE-SPEC.md`, a folder that holds nothing else, so an
   editor opened on the folder shows only the spec. Confirm the copy is byte-identical.
   Take the commit of the spec
   (`git -C <synthesis-wt> log -1 --format=%H -- WORKHORSE-SPEC.md`) and the link from
   `<tool>/scripts/spec-review-link.sh <dispatch> <dispatch>/spec-review`, which fills the
   run's recorded `planning.review_link` template with `{path}` set to that folder, or
   prints the file's path where no template is set. Write `<dispatch>/spec-review.md` with
   one entry: the commit, the link and the path of the copy. Touch `.spec-review-ready` and
   exit. The postmaster puts the spec to the user and records the decision.
3. **On resume, read `<dispatch>/spec-decisions.md`.** It holds this package's one decision
   (`## spec`); earlier packages stay in the `spec-review` log lines. The user's words are
   the only feedback:
   - **changes:** revise `WORKHORSE-SPEC.md` from those words in the synthesis worktree,
     commit the revision (a new commit; the first spec commit is never rewritten), refresh
     the copy in `<dispatch>/spec-review/`, build a fresh package at the new commit, and
     pause as step 2 does. The revised spec comes back for review like the first.
   - **dropped:** the run stops. Log why in `run-log.md`, carry the user's words in the
     escalation, and the user alone abandons it. Never implement from a spec the user has
     not approved, and never drop the bar to keep going.
   - **approved:** the approval is already recorded; read its commit from the decisions
     file. Set `lanes.<lane>.spec_commit` to that commit on every lane, with
     `outcome: approved`, and go on to Stage 1.
4. **Implementation needs one approved spec.** When no revision is outstanding and the spec
   is approved, commit that approved `WORKHORSE-SPEC.md` at every workhorse worktree root,
   confirming each is byte-identical to the approved text, and launch each workhorse to
   implement from it, in blinkers. Each sees its own copy and never another lane's work.

## Stage 1 (leg 1): implement, then synthesize

**Every workhorse is first launched after the planning stage has its one approved spec, and
carries that spec in its own worktree.** Launch each workhorse to implement from the spec
the user approved, in blinkers, through the host script and the launch script so no form is
ever copied by hand. The launch carries the instruction to implement from the approved spec
at `WORKHORSE-SPEC.md` in its worktree and finish with `WORKHORSE-SUMMARY.md`. The form is
the same as it always was:

```sh
<tool>/scripts/host.sh run "$(<tool>/scripts/host.sh name <dispatch> workhorse <lane>)" <workhorse-wt> \
    --under <dispatch> --role lane --run <dispatch> \
    --out <dispatch>/logs/<lane>-events.jsonl --err <dispatch>/logs/<lane>.err --marker <dispatch>/logs/<lane>.done \
    -- <tool>/scripts/launch.sh launch <lane> <workhorse-wt> <dispatch>/<lane>-prompt.txt --last <dispatch>/logs/<lane>-last.md \
       --run <dispatch>
```

The tab name comes from the lane and its recorded model through `host.sh name`; the dispatch
makes its synthesis worktree space carry the ticket name. Neither name is typed into a shell.
A resume runs the same way with `--append`, and the command
`<tool>/scripts/launch.sh resume <lane> <workhorse-wt> <thread-id> <prompt-file>
--last <dispatch>/logs/<lane>-last.md --run <dispatch>`;
`host.sh` clears the old marker itself. Resume a lane only once its marker has landed: until
then it is still running. No composer, no interactive session, no registration.
The streaming output format is load-bearing: the thread id and the final message are harvested
from it.

- **Record every workhorse's thread id as it starts, in `run-log.md` AND the manifest**
  (`harnesses.md` says where each harness prints it). The postmaster moved the ticket to in-progress at
  dispatch; you do not touch its state before stage 3. An unrecorded
  thread is a needle in a haystack: the ids are the handles for answers, fix loops, follow-ups
  and debugging. Set the stage: `<tool>/scripts/stage.sh <dispatch> workhorses-running` when
  implementation begins, after the planning stage has its one approved spec.
- **While the workhorses run, write the acceptance tests, blind.** Before you read any lane's diff
  or log beyond its thread id, turn the ticket's acceptance criteria and `User journey` into
  tests at the ticket's own interface: the route, flag, file, or visible behaviour the ticket
  names, never a function shape, which is what the lanes were dispatched to choose. Commit
  them on the ticket branch before any synthesis code; the spec commits are already there
  ahead of them. They are the run's only oracle no lane wrote, and they stay that only if
  they are finished before you open a diff. At harvest, cut a scratch of each lane at
  `<repo>/.worktrees/<TICKET>-oracle-<lane>` with `<tool>/scripts/cut-scratch.sh`, cherry-pick
  that commit onto it and run it: the result ranks
  the lanes on the ticket's criteria before you have read a line of either. aftercare removes
  those scratches with the run's other folders, which is why they are named for the ticket. Where the ticket's
  design question IS the interface, do not write them, say so on the checkpoint 1 card, and
  compose on reading alone. Your reading of the ticket is a single reading: in a run with a
  review leg, the reviewers see these tests with the synthesis and may challenge them like any
  other line.
- **Harvest.** Each lane's final message is the last result line of its events stream
  (`harnesses.md` gives the per-harness location). `launch.sh` exports each completed thread into
  `<dispatch>/sessions/` beside its event stream. For every workhorse, `WORKHORSE-SUMMARY.md` at
  the worktree root is the authoritative final act.
- **Monitor: three exit shapes.** Each workhorse's final act is writing `WORKHORSE-SUMMARY.md` at its
  worktree root. `WORKHORSE-SPEC.md` is a coachman-authored input committed before launch,
  not an exit shape: a workhorse that exits with the spec and no summary has not finished
  implementing. On exit, read the lane's harvest plus its worktree root:
  (a) **Summary present.** Mark the workhorse harvested; manifest `outcome: harvested`.
  (b) **Blocked.** `WORKHORSE-BLOCKED.md` present, or the last message ends in a question. Bypass
  flags do not stop a model pausing to ask mid-run; headless, the run EXITS there with the
  question as its final message, a detectable and answerable state rather than a hidden hang.
  Answer within-brief questions yourself, restating the autonomous-defaults rule, via that
  workhorse's resume form. Only a genuinely destructive or scope-changing decision goes up, as an
  escalation to the postmaster with your recommendation attached. Manifest `outcome: blocked`
  until resolved.
  (c) **Neither** (died mid-flight). Read the lane's log tail and transcript, then remount it
  (resume) or re-dispatch. A lane silent for about 15 minutes with no exit is inspected. Stall cutoff 90
  minutes: stop waiting and bring partial results to checkpoint 1 rather than blocking;
  synthesis from the completed workhorses is an option there. Manifest `outcome: stalled`.
- **Reap = let the thread exit.** Nothing to kill: workhorse threads end themselves and their
  conversations are durable in each harness's own store. Verification runs against the code,
  never by interrogating a workhorse. Keep threads UNARCHIVED while the run lives; that preserves
  follow-up questions via the resume forms and the interactive scrollback each harness offers
  on a finished thread.
- **Verify before trusting.** Read each summary and its `## Evidence`, then check every load-bearing claim against
  the workhorse's actual diff and the repo code. A criterion claimed as shown without evidence
  counts against that lane. Workhorses ship false absolutes in docs and commit
  messages.
- **Run the checks on each workhorse's branch** once its thread has exited, in its worktree:
  `<tool>/scripts/verify.sh run <workhorse-wt> <dispatch>`, which runs the run's checks whatever the
  worktree's copy says, and logs each result. It refuses a worktree with uncommitted changes: run
  it on a scratch cut at the branch's HEAD with `<tool>/scripts/cut-scratch.sh` instead, and put
  what the workhorse left uncommitted on the card. Where a check's source names `web-journey`,
  first walk the ticket's User journey on that branch, in the format
  `<tool>/scripts/verify-journey.sh --format` gives, to the path `<tool>/scripts/verify.sh
  journey-path <workhorse-wt> <dispatch>` prints. A `verify.sh run` that can outlast your harness's
  command cap (`harnesses.md`) runs through `<tool>/scripts/host.sh run` with `--under <dispatch>`,
  `--role coachman`, `--run <dispatch>`, `--out`, `--err` and
  `--marker`, as a lane does, and you wait for its marker with `<tool>/scripts/wait-for-markers.sh`. Then hold its
  summary to your run: `<tool>/scripts/verify.sh summary <workhorse-wt>/WORKHORSE-SUMMARY.md
  <dispatch> <workhorse-wt>`. Exit 2 names each check the summary does not give, which makes the
  summary unverified, and each claim your run contradicts; both go on the checkpoint 1 card.
  Hold its evidence the same way, beside that verdict:
  `bun --no-env-file --config=/dev/null <tool>/scripts/summary-evidence.ts
  <workhorse-wt>/WORKHORSE-SUMMARY.md <workhorse-wt> --ticket <dispatch>/brief.md`.
  The criteria come from the run's waybill, never the lane's armed ticket copy,
  which the lane can edit. Exit 2 names each criterion missing
  evidence, citing evidence that does not exist or lies outside `.postmaster/verify/`, or
  claimed shown with no evidence; those names go on the checkpoint 1 card beside the
  `verify.sh summary` verdict, and a criterion claimed as shown without evidence counts against
  that lane.
  [Why a project defines its own checks](../../wiki/concepts/verification.md)
- **Run audit, automatic.** Once the workhorses are harvested (at the stall cutoff, whatever
  exists), write `<dispatch>/audit/<lane>.md` per workhorse from its durable record: thread id,
  branch, key actions digested from the logs and transcript, final message, `WORKHORSE-SUMMARY.md`
  verdict. Copy the run's one `WORKHORSE-SPEC.md` to `<dispatch>/audit/spec.md` as the synthesis
  commit added it and as the user approved it, to `<dispatch>/audit/spec-final.md`. Record
  the commit the user approved (`lanes.<lane>.spec_commit`, which is the same on every
  implementing lane), and any acceptance criterion with no task. Copy its `.postmaster/verify/`,
  its journey reports included, to
  `<dispatch>/audit/<lane>-verify/`. Attach every audit to the checkpoint 1 card. Do the same for
  any later fix thread a checkpoint relies on.
- **THERE IS NO SYNTHESIS BASE. You are the synthesizer: judge, then compose.** Set the stage
  first, `<tool>/scripts/stage.sh <dispatch> synthesis`. Do not fast-forward the ticket branch onto any
  lane. Start from BASE and write the synthesis
  yourself, taking the best answer to each part of the problem from whichever lane found it.

  **Inheriting a branch is a decision you make once, about a whole diff, before you understand
  it.** Composing forces a verdict per decision, which is the granularity the disagreement
  actually has. It is more work, and that is the point.

  **Order still matters: compare in writing BEFORE you conclude anything.** Read each lane's
  actual diff, never its self-assessment. For each, record: does it satisfy the ticket, is the
  core approach sound, test quality, how much of the diff is scope it was not asked for.
  Writing the verdict first and the comparison afterwards is how a default reasserts itself.

  **Agreement between lanes is not evidence.** Where the lanes converged, that part of the diff
  gets the same scrutiny as where they diverged. Models share a training distribution, so the
  answer they agree on is the typical one, and on a hard ticket the typical answer is the
  plausible wrong one. Weigh it against the acceptance tests and the code, never against the
  fact of agreement, and do not tell reviewers where the lanes concurred: it anchors them.

  **Classify every divergence, and read the conventional ones as findings about the
  project.** A divergence is substantive when the lanes chose different mechanisms, and
  conventional when the mechanisms match and only the naming, file placement, structure or
  idiom differ. A substantive divergence is the synthesis decision this run exists to make. A
  conventional divergence means the project's own rules did not decide it: two capable
  implementers read the same docs and named the same thing differently because nothing told
  them how. Pick one for the synthesis on the project's existing usage, then record the gap on
  the checkpoint 1 card as a proposed rule for the project's conventions (its style guide,
  context file or docs), one line per gap, with the two forms that were seen. The postmaster
  decides whether it becomes a ticket. Never leave a conventional divergence as a silent
  coin-flip; the next run will flip it again.

  **Tests sit in one of two layers, and only one crosses lanes.** A test at the ticket's
  interface runs against any lane's implementation; a unit test is coupled to the shape of the
  code beside it and is composed by reading, never cross-run. Where a lane wrote
  interface-level tests, run them against the other lanes too. Each cross-failure has four
  readings and you must pick one in writing: a defect in the other lane; a test that mirrors
  its own implementation; scope the ticket did not ask for; or a valid design difference the
  test happens to encode. The union of every lane's interface-level tests, deduplicated, ships
  with the synthesis.

  Then build the synthesis commit by commit with a reason for each choice. Amend commit
  messages to review grade; run the project's FULL gate with its real command.

  **Measure the committed synthesis before recording the SYNTHESIS line.** From the synthesis
  worktree, run the pinned script with explicit commit IDs: the base from the manifest, the
  final synthesis HEAD, and every lane's harvested head, including lanes that stayed at BASE.
  Pass one `--lane <name>=<commit>` per lane, and `--oracle <commit>` when the run has an
  oracle commit. Run Bun with target-repository env loading disabled and no config file;
  the script disables external diff drivers and textconv when it reads Git:

  ```sh
  SYNTHESIS_HEAD=$(git rev-parse HEAD)
  SHARES_LINE=$(bun --no-env-file --config=/dev/null <tool>/scripts/synthesis-shares.ts \
    --base <base> --synthesis "$SYNTHESIS_HEAD" \
    --lane <lane>=<harvested-head> [--lane <lane>=<harvested-head> ...] \
    [--oracle <oracle-commit>] --record <dispatch>)
  <tool>/scripts/run-log.sh <dispatch> "$SHARES_LINE"
  ```

  The command writes `<dispatch>/shares.json` once and prints the greppable `SHARES:` line.
  Keep that line beside the SYNTHESIS line in `run-log.md` and on checkpoint 1. Use the
  measurement as evidence when ranking; it does not set the ranking, and it does not
  replace `took=`: the counts see text, not ideas the coachman rewrote in its own words.

  **Record it in one greppable line in `run-log.md`:**

  ```
  SYNTHESIS: ranked=<lane>,<lane> took=<lane>:<what>;<lane>:<what> rejected=<lane>:<what> basis=<short phrase> oracle=<lane>:pass|fail,<lane>:pass|fail | none
  ```

  `took=` must name a contribution from every lane that produced work, or say explicitly why a
  lane contributed nothing. "I read it and took none of it, because X" is a real answer, and an
  absent lane is not the same as a rejected one. Rank every lane regardless, the lead horse first and the wheelers after it: second place
  is data too, and this line is the only record of how lanes IMPLEMENT rather than how they
  review. `oracle=` is each lane's result on the blind acceptance tests, or `none` with the
  reason on the card; it is the only field on this line that a model did not decide.

  **"Primary" means launch ordering, and nothing else at all.**

  **When reading this data back, take the coachman's backend from the `model` field on
  assistant messages in its own transcript, never from the launch card.**

  **Never write this up as though lane identity had been hidden.** It is not blind. Report
  trends and the switch rate across many runs; never a result from a handful.

  **Check which branches actually moved off BASE before comparing anything.** A walled or
  failed workhorse leaves its branch at BASE and has contributed nothing to read. Record that lane
  DEGRADED rather than absent, say so on the card, and compose from the lanes that produced
  work.
- **Checkpoint 1 card, then the hand-off:** per-workhorse outcome (or stall); **the SYNTHESIS and SHARES lines, the ranking, what
  was taken from each lane, what was rejected and why**; the code-verified evidence behind each
  choice; the convention gaps found; what was dropped; gate status; the checks, as
  `<tool>/scripts/landing.sh results <dispatch> <wt>` prints them for each workhorse's branch
  (`<wt>` the workhorse worktree) and then for the committed synthesis, the journey walked
  first where there is one, with each workhorse's `verify.sh summary` verdict and its `summary-evidence.ts`
  result. A card that presents a
  finished diff without saying which lane each part came from is the defaulting failure
  wearing a verdict. Set the stage, `<tool>/scripts/stage.sh <dispatch> checkpoint-1`, then write it to
  `<dispatch>/checkpoint-1.md` with the audit bundle beside it and touch `.checkpoint-1-ready`.
  In autonomous mode, if review runs, write `handoff-1.md` and end the leg; in a contract 2 run
  with no review leg, continue to stage 3 below in this same leg. In consult
  mode, also write `ESCALATION.md` naming the card, touch `.escalation-ready`, and exit; after
  the ruling arrives as a resume, follow the same branch. The checkpoint card is informational
  and never replaces the ship card.

## Stage 2 (leg 2): review, every lens in one loop

One loop, in one leg. The lenses are the turnpikes `<tool>/scripts/turnpikes.sh legs <dispatch>` lists
for the review leg, exactly those: a turnpike the waybill does not name never runs, and one it
names is never skipped. If the script exits 2, or lists no review leg, escalate with its
output. Each round runs every lens still open, on one snapshot, every lane the waybill names for
that lens as its own process in its own scratch: every lens in round 1, then the gating lenses
alone from round 2. A lens's lanes are its own `<lens> reviewers:` line in the waybill where it
has one, and the `reviewers:` line otherwise; `<tool>/scripts/reviewers.sh lanes <dispatch>/brief.md
<lens>` prints them.
[Why the lenses run as one loop](../../wiki/concepts/review-loop.md)

Set the stage first, `<tool>/scripts/stage.sh <dispatch> review`, then:

1. **Prepare each open lens from its entry below.** The style brief and security brief,
   `review-<lens>-brief.md` in the dispatch dir, carry their diff scope (synthesis worktree,
   `git diff <BASE>...HEAD`); the project profile plus the lens's specific pointers from it;
   findings already known (the hand-off's deferred findings, workhorse divergences) so
   reviewers hunt residues and new holes; and their output contract: a proposed severity,
   file:line, quoted code as evidence, confidence, and for security an exploit path. The
   coachman chooses the verified severity after checking each finding and records it on its
   `finding` line. Copy these definitions into every lens brief's output contract:

   - **P1:** A defect can cause severe harm, irreversible loss, or loss of a critical capability.
   - **P2:** A defect materially impairs an important capability or protection, with impact limited by its scope or a workable alternative.
   - **P3:** A defect has limited impact and does not materially impair normal use.

   **State in every brief that the lane is working in its own disposable worktree with dependencies
   installed, that it checks a finding with a targeted probe rather than running the project's
   gate, lint, build or tests, and that the one thing it must not do is modify the code under
   review.** It is expected to RUN things to check its own claims, and to say for each finding
   whether it was verified by execution or by reading. A finding verified by execution outranks
   the same finding filed as a hypothesis, and a test that passes is not evidence until someone
   has seen it fail for the right reason. The coachman runs the recorded project checks once
   per round on the snapshot. There is no bug brief: each bug reviewer runs its harness's
   code-review form against the named range.

   Each entry is the one place for its lens, the turnpike of the same name: what its reviewers
   look for, and how they are launched, which step 2 does for every lane that reviews under it.
   A review turnpike with no entry here cannot run: escalate.
   - **Style lens** (round 1 only, gates nothing): non-mechanical idiom, naming, the project's
     stated paradigm (functional core, immutability, whatever its docs say), abstraction,
     consistency, judged against the project's own style pages and the surrounding code's
     conventions. Launch: from its brief.
   - **Bug lens** (gating): correctness, logic, absence-versus-relative checks (does any check
     pass vacuously when a row, file or entry is missing?), and defects in the change. Only
     lanes whose harness has a code-review form review for bugs; no brief is written and no
     fallback is used. Launch: `<tool>/scripts/launch.sh review "$L" "$DEST" <BASE> --last
     <dispatch>/logs/review-r<round>-bug-$L-last.md --run <dispatch>`. The form names the
     base-to-HEAD change at the run-recorded lane effort. Normalize its
     report with `<tool>/scripts/review-findings.sh`; missing fields such as severity stay
     `not provided`.
     [Why a lane may review through its harness's own skill](../../wiki/concepts/own-review-skills.md)
   - **Security lens** (gating): general exploit hunting plus the project's specific surfaces
     as the waybill names them: how it binds and authenticates, what it allowlists, how it
     handles secrets, what it spawns and with what arguments, what it serves from disk.
     Launch: each lane from a prompt file of its own, which runs its harness's own security
     review skill where it has one and the lens's brief where it has none, so the lens never
     loses a lane (the security lens's launch, below).
     [Why a lane may review through its harness's own skill](../../wiki/concepts/own-review-skills.md)

   **A launch from a brief** has two parts. Its preparation, once per round and before any
   reviewer starts, writes the lens's prompt file verbatim:

   ```sh
   cat > <dispatch>/review-r<round>-<lens>-prompt.txt <<'EOF'
   Read <abs>/review-<lens>-brief.md and execute it. Report findings as your final message. Do not modify any file you are reviewing.
   EOF
   ```

   Its launch step starts reviewer lane `$L` in its scratch `$DEST`:
   `<tool>/scripts/launch.sh launch "$L" "$DEST" <dispatch>/review-r<round>-<lens>-prompt.txt --run <dispatch>`.

   **The security lens's launch** has the same two parts, with a prompt file for each lane. Its
   preparation writes the lens's prompt file as above, then each lane's own, and stops the round
   on any exit but 0 (the lane's harness has the skill) and 3 (it has none):

   ```sh
   for L in $(<tool>/scripts/reviewers.sh lanes <dispatch>/brief.md security); do
     <tool>/scripts/launch.sh skill "$L" security-review --run <dispatch> > <dispatch>/review-r<round>-security-$L-prompt.txt
     case $? in
       0) ;;
       3) cp <dispatch>/review-r<round>-security-prompt.txt <dispatch>/review-r<round>-security-$L-prompt.txt ;;
       *) echo "NO SECURITY PROMPT FOR $L; nothing launched"; exit 1 ;;
     esac
   done
   ```

   Its launch step starts lane `$L` in its scratch `$DEST`:
   `<tool>/scripts/launch.sh launch "$L" "$DEST" <dispatch>/review-r<round>-security-$L-prompt.txt --run <dispatch>`.
   A skill reads no brief. Its findings arrive as its final message, and step 3 verifies them
   like any other lane's.
2. **Run every reviewer under every open lens on the same snapshot, from a fresh scratch each
   round**, pinned to the synthesis HEAD, with the installed dependencies cloned in so every
   lane is a full lane:

   ```sh
   SNAP=$(git -C <synthesis-wt> rev-parse HEAD)
   # Where a check's source names web-journey, walk the ticket's User journey on the synthesis
   # worktree first, to the path <tool>/scripts/verify.sh journey-path <synthesis-wt> <dispatch>
   # prints; then the run's checks, once, on the snapshot:
   VERIFY_EXIT=0
   <tool>/scripts/verify.sh run <synthesis-wt> <dispatch> > <dispatch>/logs/review-r<round>-checks.txt || VERIFY_EXIT=$?
   cat <dispatch>/logs/review-r<round>-checks.txt
   <tool>/scripts/log-action.sh <dispatch> coachman gate "$SNAP" "review round <round>, verify.sh exit $VERIFY_EXIT"
   case "$VERIFY_EXIT" in
     0|3) ;;
     *) exit 1 ;;
   esac   # 0 green and 3 not-run proceed; 2 (a check failed), 1 (verify unrunnable), a signal, or verify.sh itself unstartable (126/127) stops the round
   # A 126/127 inside a check is that check's `not run` ("bash could not start it"),
   # which aggregates to 3 and proceeds; only verify.sh itself failing to start stops
   # the round on 126/127
   if [ "$VERIFY_EXIT" -eq 3 ]; then
     awk '/: not run, /{print; p=1; next} p==1 && /^  /{print; next} {p=0}' <dispatch>/logs/review-r<round>-checks.txt | while IFS= read -r NOTRUN; do
       <tool>/scripts/run-log.sh <dispatch> "review round <round> gate not run: $NOTRUN"
     done
   fi
   # A check not run is never read as passed: each goes on the card as `not run` with
   # verify.sh's reason. Example: a ticket with no User journey makes the journey check
   # `not run` (`journey: not run, exit 3, ...` plus its reason line); the round proceeds,
   # the run log carries those lines, and the card records `journey: not run`. On a stopping
   # exit, fix the cause on the synthesis worktree and repeat this step
   git -C <repo> worktree prune
   for LENS in <open lenses>; do   # a lens whose lanes do not resolve stops the round here
     <tool>/scripts/reviewers.sh lanes <dispatch>/brief.md "$LENS" >/dev/null || exit 1
   done
   for LENS in <open lenses>; do
     for L in $(<tool>/scripts/reviewers.sh lanes <dispatch>/brief.md "$LENS"); do
       DEST=<repo>/.worktrees/<TICKET>-rev-$LENS-$L
       # A scratch an interrupted round left behind is checked like any other, then torn down;
       # one that cannot be stops the cut, and nothing is launched.
       if [ -e "$DEST" ]; then
         git -C "$DEST" diff --name-only "$SNAP" | sed "s|^|LEFT BEHIND AND MODIFIED, $DEST: |"
         <tool>/scripts/review-round.sh teardown <dispatch> <round> <repo> "$LENS:$L" || exit 1
       fi
       # The security lens reviews from clones, whose origin/HEAD leads back to BASE, which a
       # harness's own security review skill needs (harnesses.md, Own review skills).
       CLONE=""; [ "$LENS" = security ] && CLONE="--clone <BASE>"
       # ASSERT the scratch is cut at SNAP before launching a lane into it. The coachman runs
       # the project's recorded checks once on the snapshot; reviewers do not build or run them.
       <tool>/scripts/cut-scratch.sh <repo> <synthesis-wt> "$DEST" "$SNAP" $CLONE \
         || echo "SCRATCH BROKEN: $DEST is not cut at $SNAP; fix before launching $L under $LENS"
     done
   done
   ```

   Never install into a scratch. If the synthesis worktree has no installed dependencies,
   install there first and clone from it. Every reviewer reviews from a scratch, never from the
   synthesis worktree.

   Then do every open lens's preparation, and launch every reviewer under every open lens in the
   same breath, each through its lens's launch step run by `host.sh` (`hosts.md`). The command
   first checks every scratch with `cut-scratch.sh --check`: at the snapshot, and under the
   security lens a clone whose `origin/HEAD` leads back to BASE. It launches nothing if one
   fails; then it starts the round, which clears its markers and fixes its deadline. `host.sh`
   lands each marker, naming the round, the lens and the lane, when its process exits, whatever
   its exit, and the command ends in the wait for the whole round, given every reviewer the loop
   launched. A wait cut short, as by the harness's cap on background tasks, is run again alone:
   `<tool>/scripts/review-round.sh wait <dispatch> <round> <repo>` keeps the round's reviewers
   and its deadline. A round interrupted before its launches were done is re-run whole, from the
   cut, which tears down whatever its first attempt left:

   ```sh
   SNAP=$(git -C <synthesis-wt> rev-parse HEAD)
   for LENS in <open lenses>; do
     <tool>/scripts/reviewers.sh lanes <dispatch>/brief.md "$LENS" >/dev/null || exit 1
     CLONE=""; [ "$LENS" = security ] && CLONE="--clone <BASE>"
     for L in $(<tool>/scripts/reviewers.sh lanes <dispatch>/brief.md "$LENS"); do
       <tool>/scripts/cut-scratch.sh --check <repo>/.worktrees/<TICKET>-rev-$LENS-$L "$SNAP" $CLONE \
         || { echo "SCRATCH NOT READY: <TICKET>-rev-$LENS-$L; nothing launched"; exit 1; }
     done
   done
   <tool>/scripts/review-round.sh start <dispatch> <round> || exit 1
   REVIEWERS=""
   for LENS in <open lenses>; do
     for L in $(<tool>/scripts/reviewers.sh lanes <dispatch>/brief.md "$LENS"); do
       DEST=<repo>/.worktrees/<TICKET>-rev-$LENS-$L
       if [ "$LENS" = bug ]; then
         LAUNCH=(<tool>/scripts/launch.sh review "$L" "$DEST" <BASE> --last <dispatch>/logs/review-r<round>-bug-$L-last.md --run <dispatch>)
       else
         LAUNCH=(<the launch step of $LENS, for "$L" in "$DEST">)
       fi
       <tool>/scripts/host.sh run "$(<tool>/scripts/host.sh name <dispatch> review "$L" "$LENS" <round>)" "$DEST" \
           --under <dispatch> --role reviewer --run <dispatch> \
           --out <dispatch>/logs/review-r<round>-$LENS-$L.jsonl --err <dispatch>/logs/review-r<round>-$LENS-$L.err \
           --marker <dispatch>/logs/review-r<round>-$LENS-$L.done \
           -- "${LAUNCH[@]}"
       REVIEWERS="$REVIEWERS $LENS:$L"
     done
   done
   <tool>/scripts/review-round.sh wait <dispatch> <round> <repo> $REVIEWERS
   ```

   **Normalize the bug reports before triage.** For each lane under the bug lens, copy any
   forked task record the stream's `task_notification` named and normalize the native report
   from the same events stream.
   Codex reads the `--last` file; the other forms read their final event message. A verdict
   counts only with its evidence: a lane whose harvest failed is DEGRADED for the round,
   never clean, and its report is not normalized at all. A report `normalize` cannot read
   is read by hand, with its path, never dropped and never clean. The generated JSON is
   the bug findings contract for triage: each item has its target, location, severity,
   summary, body, evidence, confidence, category and source. A field the harness did not
   provide is the literal `not provided`; use the normalized file as the bug report, or
   the hand-written one where normalization failed.

   ```sh
   NORMALIZE_FAILED=""
   for L in $(<tool>/scripts/reviewers.sh lanes <dispatch>/brief.md bug); do
     DEST=<repo>/.worktrees/<TICKET>-rev-bug-$L
     EVENTS=<dispatch>/logs/review-r<round>-bug-$L.jsonl
     HARVEST_ERR=$(<tool>/scripts/review-findings.sh harvest "$EVENTS" <dispatch>/logs --prefix review-r<round>-bug-$L 2>&1) \
       || { <tool>/scripts/log-action.sh <dispatch> coachman degrade "$L" "bug round <round>: $HARVEST_ERR"; <tool>/scripts/run-log.sh <dispatch> "$L bug: DEGRADED, $HARVEST_ERR"; continue; }
     <tool>/scripts/review-findings.sh normalize "$L" "$DEST" "$EVENTS" --last <dispatch>/logs/review-r<round>-bug-$L-last.md --run <dispatch> \
       > <dispatch>/logs/review-r<round>-bug-$L-findings.json || { NORMALIZE_FAILED="$NORMALIZE_FAILED $L"; rm -f <dispatch>/logs/review-r<round>-bug-$L-findings.json; }
   done
   for L in $NORMALIZE_FAILED; do   # a report the normalizer cannot read is read by hand, with its path; never dropped, never clean
     <tool>/scripts/run-log.sh <dispatch> "review round <round> $L: normalize failed; reading the raw report by hand"
   done
   ```

   For each such lane, read its raw report — the `--last` file for codex, else the final
   event message — and write `<dispatch>/logs/review-r<round>-bug-$L-findings.md` by hand:
   one finding per item with target, location, severity, summary and evidence, each citing
   the raw report's path. Triage reads the hand-written file as that lane's bug report.

   Record every reviewer's thread id in its `review-harvest` line.

   **Reviewers do not run the project-wide checks.** The coachman has run them once on this
   round's snapshot. A reviewer may run a targeted probe for a finding. Its disposable scratch
   and the post-round integrity check contain probe output and detect tracked changes to the
   code under review. A lane's CLEAN is weaker when it did not probe what it could have
   probed; that is a review-quality judgement, not a structural limit.

   **Watch memory at high concurrency.** Round 1 runs every lane under every lens at once, and
   targeted probes can still spawn child processes. If the machine queues or swaps, the levers
   are the run ceiling and the test runner's worker cap.

   **THE WAIT GOES IN THE SAME COMMAND AS THE LAUNCH. Never end a turn between launching a
   round and collecting it.** The launch above ends by blocking on every marker of the round,
   every lens together, in one command that returns once every marker is in or at the round's
   deadline: its time limit from `start`, `review.round_timeout_seconds` in the config the run
   recorded in `run.json`, or the default `config.example.toml` gives. The scripts prove their
   reader both ways before polling, and name every reviewer with no marker at the deadline.
   Every round has its own markers (`r1`, `r2`, ...), so a later round can never collect an
   earlier round's files. An unbounded wait and an absent wait fail the same way. Same rule for
   the stage 1 workhorses.

   **On `WAIT-TIMEOUT` (exit 3), close the round without the reviewers that had not finished.**
   The script has recorded each one in `run-log.md` as `<lane> <lens>: DEGRADED, timeout` and in
   its `degrade` line, and stopped it with `host.sh stop`; one it names STILL RUNNING could not
   be stopped: escalate. Harvest the others, and treat each timed-out lane as a review lane
   killed mid-run (hard rules): DEGRADED on the checkpoint card, with `timeout` as its cause,
   and back in the next round. A round in which no lane actually reviewed under a gating lens
   is never the last: that lens runs again in the next round, which counts toward the cap.
   Exit 4 is a timeout whose records could not all be written, a fault in a control: stop the
   leg and escalate (Tool faults). Exit 1 collects nothing, and the output says why; unless the
   round was started again, re-run it whole.

   **At harvest, classify every lane under every lens REVIEWED or DEGRADED.** A lane that
   never launched, died and was not recovered, had not finished by the round's deadline, or ran
   without tool use is DEGRADED: record it, unless the wait already has, and do not count its
   verdict toward closing the round (hard rules, below).

   **After harvesting the round, and BEFORE staging any fix**, check each scratch with `git -C
   <scratch> diff --name-only <SNAP>`, which names every tracked file changed since the
   snapshot, staged or committed included, not `status --porcelain` (scratches are expected to
   be dirty with untracked build output). Any modified tracked file is a finding about the LANE:
   log a `note` with the file list, and do not count that lane's verdict until it is understood.
   Then tear the round down, here as at the cut:

   ```sh
   <tool>/scripts/review-round.sh teardown <dispatch> <round> <repo>
   ```

   For each scratch it stops what still runs there (`host.sh stop`), closes its space
   (`host.sh close`) and removes it (`cut-scratch.sh --remove`, which takes away a scratch of
   either kind and refuses anything else), each only once the one before has succeeded, and
   logs `teardown`. A reviewer it names as stopped before it had finished is DEGRADED for the
   round. A scratch it leaves in place is named with its reason, such as the user having its
   space open, and reported; it is never removed by hand. A scratch never holds work, and its
   contents were just checked.
   Also assert the synthesis worktree itself is still clean. With every lane on a copy, nothing
   should touch it during a review round; a dirty synthesis tree is an escape and an incident to
   investigate before continuing. When later staging fixes in the synthesis worktree, prefer a
   targeted `git add <paths>` over `git add -A`.
3. **Dedup across lenses and adversarially verify** every finding against the code before it
   reaches the card or the diff; discard what does not hold. A defect reported under more than
   one lens is one finding, and it keeps every lens that reported it. A finding is gating or
   style by what it is, not by the lens that reported it: a correctness or security defect
   reported under the style lens is a gating finding, fixed as one except in a loop with no
   gating lens (step 5), a matter of style reported under another lens is a style finding, and
   each keeps its lens. Its `finding` line opens with its class. A finding whose class changes in
   a later round is logged again with the same target, and its latest line counts, so two
   findings at one place take targets that differ, such as a line and a column. Several reviewers
   produce a bigger, noisier union than one; the verification gate is what keeps the checkpoint
   clean, so do not soften it. Where a lane says it verified a finding by execution, re-run its
   probe rather than re-deriving the claim; where it filed a hypothesis, the verification burden
   is yours.
4. **Apply once per round,** in the synthesis worktree. Round 1 applies every verified gating
   finding, P1, P2 and P3 alike (in a loop with no gating lens, none: step 5). A finding whose
   fix needs a ruling is escalated, and one it cannot fix is carried to the hand-off with its
   reason, as today. From round 2 on, only verified P1 and P2 gating findings are fixed; a P3
   finding is not fixed and goes to the hand-off's deferred findings and the ship card's open
   findings, with its lens and the round that found it. Never a style finding. Where fixes from
   different lenses touch the same code, reconcile them into one change before applying it.
   Every style finding is deferred in the hand-off, reaches the ship card's Style residue, and
   is sorted at aftercare (stage 4). The next review round runs the project checks once on the new snapshot.
5. **Run the review loop by its logged decision.** After applying, call `<tool>/scripts/review-decide.sh
   <dispatch> <round>`, which reads the round's `finding` and `apply` lines and prints whether
   another round runs or the loop ends: round 2 runs whenever round 1 applied a fix; after that,
   round `r+1` runs only when round `r` logged a verified P1 or P2 finding. Follow its printed
   `RUN`, `STOP` or `CAP` decision; do not count findings by hand. A style finding never
   keeps the loop going. Round `r+1` runs the gating lenses alone, on the fixed diff, with its
   own markers, each brief the lens has updated with the fixes delta and every applied finding
   as known context, so they closure-check each fix AND hunt new holes the fixes introduced.
   The bug lens has no brief to update and its forms take no known context; a skill that
   reports an applied finding again is dropped by the coachman's dedup. A fix of a
   P1 or P2 finding that does not verify closed is logged as a `finding` of its own severity in
   the round that checked it, and a P3 fix that does not verify closed as a P3 `finding` there.
   A round in which no lane actually reviewed under a gating lens is never the last
   (step 2): that lens runs again in the next round regardless of the decision.
   A loop with no gating lens is round 1 alone, and applies nothing: a verified gating
   finding in it, a bug or security defect the style lens reported, is escalated with the card
   instead of fixed, which stops the leg in either `CHECKPOINT_MODE`, and a ruling that asks for
   the fix has it applied, the checkpoint rewritten with its state `applied on user word, not
   re-reviewed`, and the gate re-run, with the card listing it under `## Not re-reviewed`. The
   cap of 3 rounds for the whole loop, round 1 included, stays as a backstop: when round 3 logs
   a verified P1 or P2 finding, the loop stops and escalates with the residue, including any
   fixes that have not been re-reviewed, and your read on why it is not converging; this and the
   escalation above are `CHECKPOINT_MODE`'s only mid-flow stops in autonomous mode. Past the cap,
   each further round — including one ordered because no lane reviewed — needs its own ruling
   (step 6); the script decides nothing past 3. Style
   does not run again: a style lane DEGRADED in round 1 stays DEGRADED, and the card says how
   many lanes the style lens rested on.

   **ESCALATE ON A REPEATED CLASS, not only on the round cap.** If the same class of defect is
   found in three consecutive rounds, whichever lens found it, each round closing the sites it
   can name while the next finds another of the same kind, stop and escalate at that point,
   whatever the severity. Three instances of one thing is a design signal: the fix is to remove
   the capability that lets a caller get it wrong, not to patch the fourth site. Name the class
   in the escalation and say which sites each round closed.
6. **One review checkpoint card.** Per lens: the findings and their overlap, across lanes and
   with the other lenses, verified versus dismissed, applied, and the rounds it ran, with each
   finding as one bullet `- [<severity>] <id>: <state>`, the id `<lens>-<n>` numbered in the
   order verified, the state one of `open`, `closed round <r>`, `dismissed: <reason>`, or
   `applied on user word, not re-reviewed`, and no HTML comment anywhere in the file;
   a finding-shaped line in any other shape — numbered, bare, or a `+` bullet — is
   refused, to be rewritten as a `-` bullet;
   for style, how many findings go to the ship card's Style residue, as
   `<tool>/scripts/style-findings.sh count <dispatch>` prints it. The card says which round
   ended the loop and why, as `<tool>/scripts/review-decide.sh` printed it, and lists the P3
   findings the loop carried to the ship card's open findings, with each one's lens and the
   round that found it. Then the gate status and the checks from the final round's
   `<dispatch>/logs/review-r<round>-checks.txt`, run once on that round's snapshot (the
   journey walked first where the checks name one, per step 2). Written to
   `<dispatch>/checkpoint-review.md` with its `.checkpoint-review-ready` marker. Rewrite the
   checkpoint after any applied fix, even with no gating lens, before the card or hand-off.
   Autonomous mode: for contract 2 continue to stage 3 below in this leg; for a legacy run
   write the leg's hand-off and end it. Consult mode: escalate on the card and wait for the resume.
   A ruling that asks for a change is applied; in a loop with a gating lens it is followed by
   another round, counted toward the cap, and the card is written and escalated again, and a
   round past the cap runs only when the ruling says so. Any other ruling, or a change applied in
   a loop with no gating lens, ends the legacy leg with its hand-off or continues contract 2 to
   stage 3 below.

## Stage 3 (last leg of contract 2): the ship card, then the hand-off

This section runs at the end of synthesis when there is no review leg, or at the end of review
after the loop has no P1 or P2 finding left and the gates pass. The postmaster owns the landing
route and any merge. You do not push, open a pull request, wait for a merge word, or merge.

Set the stage first: `<tool>/scripts/stage.sh <dispatch> shipping`.

1. **Verify the final HEAD.** Run `<tool>/scripts/verify.sh run <synthesis-wt> <dispatch>` after
   the last code change; the gate must
   pass before the card is ready. No P1 or P2 finding may remain open.
   If a new P1 or P2 issue appears during final QA, fix it and pass the gate again; when the
   review loop has a gating lens, run another review round and rewrite `checkpoint-review.md`
   with the loop's rounds and outcome before writing the card.
2. **Browser suite and QA when the project has a UI.** Run its browser suite blocking and
   unpiped. Serve the production build with a throwaway database seeded from project fixtures,
   on loopback at a throwaway port, through `<tool>/scripts/host.sh run` with
   `--pidfile <dispatch>/render/preview.pid`. The postmaster stops its whole process group
   during post-merge teardown. Walk the ticket's `User journey` verbatim first when it has one, at phone width;
   then exercise any other changed surface that needs coverage. Record what worked, what did
   not, what suite assertions need changing because behavior deliberately changed, and what new
   surface needs coverage. A red run is a finding, not a flake. Do not update an assertion unless
   you can name the deliberate behavior change that made it obsolete. Where a check's source
   names `web-journey`, the walk is the journey report: write it to the path
   `<tool>/scripts/verify.sh journey-path <synthesis-wt> <dispatch>` prints. Put the preview link and
   QA results on the card. If the project has no UI or browser suite, say `none`.
3. **Review link.** Put the absolute path of the synthesis worktree on the card and, when
   `run.json` config has `ship.review_link`, its value with the path filled in. Reuse a review
   surface already running; never start a duplicate. Verify the link from the user's device or
   mark it unverified.
4. **Write `card.md`.** Include the branch, final HEAD, diff stat and commit list; the output
   of `<tool>/scripts/landing.sh card-block <dispatch> <synthesis-wt> <the leg's
   checkpoint>` pasted verbatim as the card's `## Checks`,
   `## Open findings` and `## Not re-reviewed` sections, appearing exactly once —
   never retyped or indented, never repeated even inside a fence — and no HTML comment
   anywhere in the card; a card quoting `<!--`, in a commit subject or finding title,
   escapes it, for example as `&lt;!--` (the leg's checkpoint is
   `<dispatch>/checkpoint-review.md` after a review leg, `<dispatch>/checkpoint-1.md`
   when this leg is synthesis); browser suite and QA when
   present; the journey report path where a
   check's source names `web-journey`; every ticket turnpike with its
   rounds and result from its checkpoint record, or `none`; the Style residue
   count as
   `<tool>/scripts/style-findings.sh count <dispatch>` prints it, then every Style residue from
   `<tool>/scripts/style-findings.sh list <dispatch>`; every branch created by the run and its
   state; lane outcomes; and the review link. Finding titles and notes, where the reader
   wants them, go in prose outside the pasted block, which carries only ids and severities.
   The card's branch state is before merge: the
   ticket branch is ready, and every other branch is either retained or abandoned. The gate is
   listed as the gate, never as a turnpike.
5. **Write the final hand-off.** Write
   `<dispatch>/handoff-<n>.md` with the verified results, all decisions and open findings, and
   state that no coachman leg follows and the postmaster must verify the card and handle
   landing. `<tool>/scripts/handoff-check.sh` must exit 0. Close the open run-log section, log
   `handoff`, then touch `.card-ready` and `.leg-<n>-done` and exit. The host writes
   `.leg-<n>-exited` when the process exits. Do not change code after recording final-HEAD
   results without repeating the checks.

## Legacy Stage 3 (leg 3): ship (review link, then a gated local merge)

Use this section only when `run.json` has no `coachman_contract` or records version `1`.

Set the stage first: `<tool>/scripts/stage.sh <dispatch> shipping`.

1. **Gates green in the synthesis worktree**, final diff stat and commit list ready. On a
   project with a UI that has a browser suite, that includes the suite, run blocking and
   unpiped. Running it is only half the gate: judge the suite against THIS change, what needs
   updating because the app moved, what needs removing, what new surface needs covering, and
   the ship card states all three answers, "nothing needed adding" included when that is the
   honest one. A red run is a finding, not a flake; the default reading of red is that the app
   is wrong, and a test is updated only when you can NAME the deliberate change that made the
   old assertion obsolete. Worse than red is a run that HANGS: if the suite stops being fast,
   re-read the change rather than waiting it out.
2. **Review link.** The ship card carries the absolute path of the synthesis worktree and, where
   the config in `run.json` sets a `ship.review_link` template, that template with the path filled in.
   Reuse whatever review surface is already running; never start a duplicate or restart one,
   since it may be serving another run. Never trust a check from the serving machine as proof
   the link works for the user: verify it from the device the user will open it on, or
   say on the card that it is unverified.
3. **Preview build, always, on a project with a UI.** Serve the branch's production build on
   the loopback interface at a throwaway port with a THROWAWAY database seeded from the
   project's own fixtures, never the live database and never the app's real port. Run the
   server through `<tool>/scripts/host.sh run` with `--under <dispatch>`, `--role coachman`,
   `--run <dispatch>` and `--pidfile <dispatch>/render/preview.pid`, named for its role alone
   (`preview server`), which
   keeps it alive past a harness turn and in the user's view, and put stopping it on the
   teardown checklist: `kill -- -$(cat <dispatch>/render/preview.pid)`, its whole process group,
   so no child of a package script survives. The preview link goes on the ship card and the
   tracker comment beside the review link. **Then QA that preview build before shipping it:
   click through the new surface like a person**, at phone width, working the actual task
   rather than ticking a checklist.

   **START FROM THE TICKET'S `User journey` SECTION, VERBATIM, WHEN IT HAS ONE.** A ticket that
   changes something a person uses carries a `User journey`: where they begin, what they tap or
   type, what they expect. Conduct that journey first, step by step, before any check of your
   own devising, and report per step whether it did what the ticket says it would. Then add
   whatever else the surface deserves; the journey is the floor, never the ceiling. A QA pass
   that invents its own script tests what the implementation turned out to do, which is the one
   thing that cannot fail.

   A ticket with NO journey section is the normal case for server-internal work and is not a
   licence to skip QA; it means there is no prescribed path, so use your judgement. If a ticket
   clearly touches a user surface and carries no journey, write the journey you tested onto the
   ship card, so the next person inherits it. A green suite says only that what someone already
   encoded still holds; the click-through is the only step that can find what nobody thought to
   encode. Findings go on the ship card and become tickets; the few worth defending against
   regression become suite tests afterwards, never during the pass.
4. **Dated ready-to-merge comment on the ticket**, through the tracker adapter (`trackers.md`):
   what the change does,
   branch name, gate output summary, diff stat, the preview link, the review link, the run's
   thread ids. This is the flow's analogue of opening a PR.

   **The ship card carries the checks,** as `<tool>/scripts/verify.sh run <synthesis-wt> <dispatch>`
   printed them on the final synthesis, with step 3's walk as the journey report where there is
   one, written to the path `verify.sh journey-path <synthesis-wt> <dispatch>` prints.

   **The ship card carries the Style residue:** how many style findings go to aftercare, as
   `<tool>/scripts/style-findings.sh count <dispatch>` prints it, then each one as its `list` prints
   it. **It also lists every bug or security finding left open,** with its lens and
   disposition, one line each. Every P3 deferred after round 1 includes its originating round.

   **The ship card carries the cost under `## Cost`,** as `bun <tool>/scripts/usage.ts sum <dispatch>` prints it: the
   run's tokens and cost per role and lane, and any harness that reported nothing. Quoted, never
   hand-recomputed, and a figure no harness reported is never written as zero.

   **The ship card lists the turnpikes the run passed through,** exactly the waybill's, each
   with the rounds it ran and its result as the step that ran it records them
   (`checkpoint-review.md`, for a review turnpike), or `none` when
   the waybill names none. The gate is on
   the card as the gate, never as a turnpike.

   **The ship card lists EVERY branch the run created and the state of each, not only the one
   carrying the feature.** A branch is part of the ship or it is abandoned; there is no third
   option, and the reader cannot tell which without being told. A ship card that omits a
   branch is a green check over unreviewed work.
5. **STOP and wait for the live merge word from `MERGE_AUTHORITY`**: the user, or the
   dispatching postmaster, as the waybill says. Write `handoff-3.md` as far as the card, touch
   `.card-ready`, and exit; the word arrives as a resume of this leg's thread, and so does a
   withheld grant with its reasons. On a withheld grant, address the reasons, update the card,
   touch `.card-ready` again, and exit again. Only the user abandons a run. On it: check out the project's default branch
   in the main checkout and `git merge --no-ff <ticket-branch>` (merge, never rebase), then
   verify it (step 6). Never escalate a grant the waybill gives the postmaster up to the user.
6. **Verify the merged default branch.** Where the waybill's project profile names a
   gate, run it from a clean checkout outside the project folder, never from the main
   checkout where the run's working copies still sit under `.worktrees/`. The checkout holds
   only the branch's committed content — no untracked files and no installed dependencies —
   so derive `<install>` from the main checkout with
   `<tool>/scripts/discover-project.sh <repo>` (the `install=` line; empty where the project
   needs no install step). Write each non-empty part (`<install>` from discovery, `<build>`
   and `<gate>` from the profile, a `none` build left out) to its own file under
   `<dispatch>` with a quoted heredoc, which carries `$`, quotes and newlines literally,
   and pass them as separate arguments — never joined with `&&` into one shell string, in
   which a failed preparation would hide behind a later statement:
   `bun <tool>/scripts/clean-checkout.ts <repo> <default-branch> "$(cat
   <dispatch>/ship-install.txt)" "$(cat <dispatch>/ship-build.txt)" "$(cat
   <dispatch>/ship-gate.txt)"`, leaving out the empty parts. The helper runs them in turn
   and stops at the first failure. Where the profile names no gate, there is nothing to
   verify. Log the result when a gate ran
   (`<tool>/scripts/log-action.sh <dispatch> coachman gate <default-branch> "post-merge,
   clean checkout, exit <n>"`). A red result is investigated under the red-gate rule below;
   the merge is already local, so fix forward on the default branch or revert it, never
   push; do not mark the ticket done or set the stage to `shipped` until it passes.
   [Why the gate runs from a clean checkout](../../wiki/concepts/clean-checkout-gates.md)
7. After the gate passes (or where there is none), move the ticket to done and set the stage:
   `<tool>/scripts/stage.sh <dispatch> shipped`.
8. If the project has an origin, pushing afterwards is the user's call, never part of
   this flow.

## Legacy Stage 4 (leg 3, after the merge): aftercare and teardown

**Sort the style findings.** For each one `<tool>/scripts/style-findings.sh list <dispatch>`
prints, write one line to `<dispatch>/style-sort.md`, with a one-line reason: a rule the
project's linter could enforce, naming the linter, which must be one the gate runs, and the
existing rule to enable or the custom rule to write; a convention for the project's own docs,
naming the doc; or neither. `<tool>/scripts/style-findings.sh gate <dispatch>` shows what the
gate runs, as the run's branch has it; where the gate runs a linter in a way it does not show,
add `via` and the file that runs it after the rule. A finding that only a linter the gate does
not run could enforce is sorted docs or neither, and that linter is proposed on a line of its
own, once, naming every finding it would enforce, and marked `not-in-gate` when the project
already has it:

```
S<n> linter <linter> enable <rule>: <reason>
S<n> linter <linter> write <rule>: <reason>
S<n> linter <linter> enable <rule> via <file>: <reason>
S<n> docs <doc>: <reason>
S<n> neither: <reason>
N<n> new-linter <linter> S<n>[,S<m>...]: <reason>
N<n> new-linter <linter> S<n>[,S<m>...] not-in-gate: <reason>
```

`<tool>/scripts/style-findings.sh check <dispatch>` must exit 0, which it does with no sort
when the run has no style findings. Log a `note` with its last line, and name the file in
`handoff-3.md`'s Decisions. Change neither the project's linter nor its docs for a finding: a
change there is a ticket, filed after the merge on the user's word.
[Why style findings feed the project's linter](../../wiki/concepts/review-loop.md)

Run `bun <tool>/scripts/usage.ts sum <dispatch>` and put its output verbatim under `## Cost` on the
ship card and in the final `run-log.md` entry with the per-lane win record and findings counts.
Do not hand-recompute a figure or write a missing figure as zero. If the sum command fails, put
the error on the card and in the log as unreadable. When the postmaster sets `done` after this
leg exits, `stage.sh` refreshes both records from all launch usage records, including this leg's
final resume. Leave the stage at `shipped` until then; the postmaster's terminal stage appends
the run's stage timings to `run-log.md`. Never write timings by hand. A closing dated comment
on the ticket carries the run summary.
Never delete the dispatch directory or the manifest, they are the run's history. Archive
finished threads where the harness has an archive form (`harnesses.md`). After the merge, tear
down the workhorse worktrees, preserving any stray file first (a workhorse killed mid-run leaves
real artifacts) and closing each one's space before it is removed (`<tool>/scripts/host.sh close <wt>`),
and hand the synthesis worktree to the postmaster for removal from outside it.
Keep the `wb/<TICKET>-<lane>` branches as a local archive. Durable process learnings go to the
project's own docs, not this runbook. Residue contract: a clean run leaves only torn-down-able
worktrees. Then finish `handoff-3.md` (the closing state of every branch and the ticket), close
the open section with `<tool>/scripts/run-log.sh <dispatch> --close`, log `handoff`, touch
`.leg-3-done`, and exit.

## Concurrency note (several runs on one project)

Runs may change the same files in parallel, up to `team.max_runs`. When two runs change the
same files, the one that merges second resolves the conflicts at its merge; it is merge,
never rebase. Merges serialize. The blocked-by graph on tickets encodes logical order: a
ticket that needs another's change waits for it to land.

## Hard rules

- The postmaster never implements, reviews, or launches workhorses; you never prepare a run, write
  your own waybill, or launch your own next leg. Neither of you does the other's job.
- **Never modify postmaster itself during a run, whatever the target.** Its runbooks, scripts
  and adapters change only through a ticket of their own; a fault in them is a tool fault
  (above). When the target is postmaster, the run changes only what its own ticket asks for.
- Never start a leg without logging `handoff-accept`; never end one without a hand-off that
  passes `<tool>/scripts/handoff-check.sh`. What is not in the hand-off did not happen for the next
  leg.
- Commit as you go in the synthesis worktree, with review-grade messages. A leg's uncommitted
  work is invisible to a fallback coachman that takes the leg over, and unverified to it.
- One identity everywhere: do not switch a harness onto a different profile or account part-way
  through a run. A lane that changes identity mid-run is not the lane that was gated.
- Base pre-flight before cutting worktrees: a dirty main checkout means the workhorses build on stale
  committed history and drop uncommitted work. Verify clean, or escalate, first.
- Workhorses never push. A contract 2 coachman leaves the default branch untouched; the postmaster
  follows the landing route in the waybill after verifying the card. A legacy ship leg follows its
  Stage 3 instructions. No workhorse sends an outward message; ticket comments are the outward record.
- **No workhorse writes code before the run's one spec is approved, and no workhorse sees
  another lane's work.** The planning stage's pause is the only gate on that. Implementation
  needs one approved spec.
- Launch nothing before the waybill's launch card is confirmed: every lane's model and effort,
  the coachman, the reviewer lineup, the gate selection, on one card.
- **The coachman is never a model that ran as a lane in the same run.** Its reading is the only
  judgment between the lanes and review, and it is independent only if it did not produce one
  of the answers it is judging. A different vendor is necessary, not sufficient: the popularity
  trap is measured across families, so the rule about agreement still binds.
- Coachmen and workhorses are headless and have no composer. Verify workhorse claims against code before
  trusting them. Local merges use merge, never rebase; a pull-request merge follows the project's
  configured review surface.
- There is no synthesis base: compose the result from all lanes with a recorded reason per
  choice, and never fast-forward the ticket branch onto a lane's branch. Compare each lane's
  diff in writing before concluding anything, and record the SYNTHESIS line in `run-log.md`.
- Reap by process exit: workhorses are headless resumable threads that end themselves, and nothing is
  killed in a standard run. Record every thread id at dispatch; prefer resuming a thread over
  re-briefing a fresh one, since the thread carries its own context. Threads stay unarchived
  until stage 4. The rare interactive workhorse (live mid-run steering genuinely needed) runs in its
  own named tmux session, is captured (scrollback to the dispatch dir) and killed as soon as
  harvested, never left to linger, never your own session (confirm with
  `tmux display-message -p '#S'`); kill only sessions YOU spawned, and inspect the pane first
  (`tmux capture-pane -p -t <name> | tail`), since a similarly named session can be a different
  live run holding an unsent draft. If so, leave it and report. Composer gotchas: bracketed
  paste, Enter as a separate send-keys, and check the working indicator before trusting a
  dispatch.
- **Know your own harness's background-task lifetime** (`harnesses.md`). A launch through
  `host.sh` outlives it: a "stopped" notification without a quota error is the cap ending a
  command you ran, such as a wait, never a lane. Run the wait again. Never resume a lane whose
  marker has not landed; it is still running, and a second process on one thread corrupts it.
- **Workhorses must not read other branches or `.worktrees/`.** Those hold other runs' work,
  including abandoned and rejected approaches. Put the line in every workhorse brief; it costs
  nothing and closes all three paths (`git branch`, a plain recursive grep, and listing the
  directory). Re-runs of a ticket whose `wb/<TICKET>-*` branches still exist are the loud case;
  concurrent lanes in a normal run are safe, since no lane has commits until it finishes.
- Review is a goal-loop, not a single shot: a loop whose fixes were never re-reviewed is
  not done, save a fix the user orders in a loop with no gating lens (Stage 2, step 5), which
  the checkpoint marks `applied on user word, not re-reviewed` and the card lists under
  `## Not re-reviewed`.
- On a contract-2 run, check results on the ship card and the review checkpoint are what
  `<tool>/scripts/landing.sh results` prints for them, never reworded and never left out; a
  check that did not run is `not run`, never passed. An exit 1 from the call is a fault in
  its inputs: fix them and re-run; never proceed past it.
- Never gate-then-commit through a masking pipe: `<gate> 2>&1 | tail && git commit` reports the
  tail's exit, not the suite's, and will commit a RED tree. Check `${pipestatus[1]}` (zsh) or
  `${PIPESTATUS[0]}` (bash), or run the gate unpiped and commit only on its own exit 0.
- Always run project scripts through the package manager's explicit run form (`pnpm run
  <script>`, `npm run <script>`): a builtin can shadow a script name, and a builtin's misfire
  can delete files before erroring. After any misfire, check `git status` for collateral
  before the next targeted `git add` would miss it.
- Update the manifest at bootstrap and keep thread ids and `outcome`s current, in place; never
  rewrite it and never delete it. Change `stage` only with `<tool>/scripts/stage.sh`. When it refuses
  with exit 3, the postmaster has closed or abandoned the run: log a `note` quoting the refusal,
  change nothing more, and exit.
- **A lone dissenter in a gating lens is the finding, not the outlier.** Clean verdicts are not
  independent: they can rest on one shared unexamined premise, so a split means one reviewer
  looked somewhere the others assumed. Verify it in the code yourself before dismissing it,
  and never resolve a split by counting.
- **Reviewers argue the coachman out of wrong calls; say so in the brief and mean it.** Put the
  disposition of every deferred finding in the next round's brief with the reasoning, and
  invite the challenge. A deferral that is never restated cannot be corrected.
- **When the lanes converge on a prescribed one-line fix for a gating finding, apply it and
  re-review; do not bank it as a ship-comment note.** Skipping a round that way ships a
  documented hole. In a loop with no gating lens, Stage 2 step 5 decides instead, and a style
  finding is never applied, however many lanes prescribe it.
- **The render gate is the coachman's job whenever a workhorse could not run it.** A workhorse on a
  harness with no browser backend cannot run one, and a workhorse that did run one tested its own
  UI, not the synthesis. Serve the production build on a temporary database (never the live
  database, never the app's real port), drive the project's own browser library across the
  new surfaces at phone width and desktop width in every theme the app offers, assert
  overflow, fonts, console errors and type floors, and then actually LOOK at the screenshots:
  the mechanical battery cannot see a house-style violation. The serve script and the
  temporary database live under `<dispatch>/render/`; seed through the project's own fixtures
  and its own API, never by hand-editing state.
- **When successive rounds keep patching the same fix, the state model is wrong: redesign it.**
  Reviewers converging on one root cause across different exploits is the signal to stop
  patching; the fix that holds usually deletes the patch machinery with it.
- **A review lane killed mid-run without a quota error is transient:** proceed the round on the
  convergent remainder, restore the lane on the next round's fresh snapshot. Re-running the
  dead lane on a snapshot the fix round is about to supersede buys little; note the
  degradation on the checkpoint card either way.
- **A lane that did not review at full strength is lame (DEGRADED), and a DEGRADED CLEAN is NOT a
  clean lane verdict. This is a MUST, not advisory: a coachman may not exercise judgment to
  skip it.** A lane is DEGRADED for a round whenever it did not read that round's snapshot
  with tool use and return a verdict: it never launched (a provider wall, a usage limit, a
  quota wall, a spawn misfire, a stale session lock), it died mid-round and was not recovered,
  it was still running at the round's deadline, or it ran in a preloaded-diff single-turn
  fallback with no tool use. Three consequences, all mandatory:
  **(1)** write it in `run-log.md` for that round as `<lane> <lens>: DEGRADED, <cause>`, quoting
  the provider's own error string where there is one; **(2)** carry the word DEGRADED onto the
  checkpoint card AND the ship card, with the cause and how many lanes actually reviewed under
  each lens, since "all lanes clean" on a round where one was walled is a false statement about
  coverage, and the card is what the merge rests on; **(3)** do NOT count a DEGRADED lane's
  CLEAN toward closing the round, and never write it up as a lane that reviewed and found
  nothing. A reviewer that could not open a file returning CLEAN is a MISSING verdict, not
  evidence of a clean diff. Two follow-ons: the round is closed by the lanes that actually
  reviewed, stated in exactly those words; and every "lone finding" in that round is lone only
  among the lanes that ran, so do not read convergence into a round that lost a lane. Restoring
  the lane on the next round is the fix; suppressing the label is never the fix.
- **A red gate on the default branch after merging is a claim to investigate, not a fact to
  report.** The flow's own post-merge gate runs from a clean checkout outside the project
  folder, so a sibling worktree's files cannot redden it; a red one is a defect in the merge,
  in the gate itself, in the checkout's preparation (a missing install step), or residue a
  failed cleanup left behind. A gate a
  person runs by hand in the main checkout still sees the copies under `.worktrees/`, and
  fails for them while the project's own code is clean. Establish which gate is red and whose
  file it is before touching shared config, and file the hygiene fix as its own ticket
  rather than editing lint config on the default branch mid-flight for another live run.
- **A coachman cannot remove its own worktree.** Tear down the workhorse worktrees at stage 4,
  preserving any stray file first, and hand the synthesis worktree to the postmaster for
  removal from an outside process.
