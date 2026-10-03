# Workhorse spec: 202 After the workhorses and after each review round, check for a lane's reach outside its own worktree

## Summary

The flow gains a reach check that notices when a lane touches anything outside its own
worktree or scratch: the coachman scans each lane's events stream for outside paths, records
and compares the repository's refs around each review round, and checks the main checkout
with `check-target.sh` at harvest, after every round and before the ship card, so a reach
becomes a finding about the lane before synthesis builds on it or a round closes on it.

## Technical context

- **Language and version**: TypeScript under Bun 1.4.2+, the repo's scripts; Markdown runbook.
- **Dependencies used or added**: none. Bun built-ins and Node standard modules only, git on PATH.
- **Testing**: `bun test scripts/lane-reach.test.ts scripts/check-target.test.ts` for the
  controls; `bun run check` from the worktree root for the gate; drill transcripts under
  `.postmaster/verify/` for the runbook-driven criteria.
- **Constraints**: deterministic work goes in `scripts/`, not prose; every script path the
  runbooks name resolves; Linux and macOS 13+; no new Python; harness stream shapes parsed
  behind the new script, as `usage.ts` and `view-stream.ts` already do; `coachman.md` is in
  the coachman contract file list, so this change lands only after a fixture run from its
  branch scores clean.

## Direction check

- Ticket direction, "put the two reads where the coachman harvests the lanes": the runbook
  runs the stream scan and the main-checkout check at workhorse harvest, and the stream
  scan, the ref comparison and the main-checkout check after each review round's harvest,
  before any fix is staged or any verdict counts. Met by the `coachman.md` steps.
- Ticket direction, "the reads and the ref comparison around each review round": refs are
  recorded before the round's launches and compared after its harvest. Met by the
  `refs-record` / `refs-compare` subcommands and the round steps.
- Ticket direction, "use the event shapes `harnesses.md` records": the stream reader parses
  the per-harness shapes recorded there and in the committed trial apparatus
  `raw/trials/confine-lanes/apparatus/digest.py`, pinned by made-up-stream controls in the
  script's test, the same pairing `usage.ts` uses. Met by `lane-reach.ts` and its test.
- Ticket direction, "a lane's stream is its own record, never its report": the scan reads
  only the events stream (and, for Claude bug reviews, the task record the round already
  copies into the logs); a lane's summary or review verdict is never an input. Met by the
  script's inputs.
- AGENTS.md, "deterministic work goes in `scripts/`": the scan, the ref record/compare and
  the full path listing are script subcommands with exits the runbook branches on; prose
  decides nothing a script can decide. Met by the structure below.
- AGENTS.md, "nothing harness-specific in the flow ... behind an adapter": the five stream
  formats live inside the one new script, invoked as `lane-reach.sh stream <harness> ...`
  with the harness resolved from `run.json`, so the runbook names no event shape. Met by
  the script's interface.
- AGENTS.md, "a prompt lives in argv ... match on pid or working directory": the scan reads
  stream files by path, never selects a process. Met trivially.
- AGENTS.md, "every count needs a control": every verdict the script prints has a
  positive and a negative control in its test. Met by AC6's tasks.

## Structure

- `scripts/lane-reach.sh` (new): one-line wrapper, the repo's form.
- `scripts/lane-reach.ts` (new): `stream`, `refs-record`, `refs-compare` subcommands.
- `scripts/lane-reach.test.ts` (new): the AC6 controls, with made-up streams per harness.
- `scripts/fixtures/lane-reach/` (new): the made-up streams, one file per control where a
  test file cannot hold them readably.
- `scripts/check-target.ts` (changed): gains `--full`, every changed path, same exit 2.
- `scripts/check-target.test.ts` (new): `--full` flags an untracked file and passes clean;
  the default output and exits unchanged.
- `skills/postmaster/coachman.md` (changed): the reach steps at harvest, around each review
  round, and before the ship card; the void rule; the card sections. No other runbook
  changes; no change to `docs/coachman-contract.toml`, which already covers `coachman.md`.

## Decisions

- D1. One new script, `lane-reach.sh`, with three subcommands: `stream <harness>
  <events.jsonl> <lane-root> [--task <task-record>]`, `refs-record <repo> <synthesis-wt>
  <out-file>`, `refs-compare <before-file> <after-file>`. The runbook resolves `<harness>`
  from the run's `run.json` (`config.lanes.<lane>.harness`) and passes the stream path it
  already owns (`logs/<lane>-events.jsonl`, `logs/review-r<round>-<lens>-<lane>.jsonl`).
- D2. `stream` prints one line per outside touch: `<kind> <path> <tool> <detail>`, where
  kind is `write`, `read`, `shell` or `refused`, path is the absolute outside path, tool
  is the harness's tool name, and detail is the command text (shell) or the outcome.
  Exits: 0 no outside touch; 2 a `write` outside; 3 only `read`, `shell` or `refused`
  outside; 1 usage or unreadable input.
- D3. Inside means under the lane root (the workhorse worktree, the reviewer scratch),
  resolved physically. Outside is everything else except the harness-operational paths:
  `~/.codex`, `~/.claude`, `~/.claude.json`, `~/.config/muse`, `~/.config/mimocode`,
  `~/.mimocode`, `~/.pi/agent`, the lane's `XDG_DATA_HOME` harness-data directory, the
  package caches (`~/.npm`, `~/.cache`), and the launch's own prompt and last-message
  files under the dispatch `logs/` directory. A touch of an operational path is not
  printed at all: it is the harness breathing, not a reach.
- D4. Read/write per tool, from the recorded shapes: codex `file_change` is a write and
  names absolute paths; Claude `Read`/`Glob`/`Grep` are reads, `Write`/`Edit` are writes
  (`file_path`); MiMo `read` is a read, `write`/`edit` are writes (`file_path`), `bash`
  is shell (`state.input.command`, `state.status`, `state.output`/`state.error`); pi
  `read` is a read, `write`/`edit` are writes (`path`/`args`), `bash` is shell
  (`args.command`); Muse `read_file` is a read, `write_file`/`edit_file` are writes with
  the path parsed from the result prose, `bash` is shell with the command parsed from the
  result JSON (`correlation_facts` names tool and outcome). An error outcome on an
  outside path is `refused`, whatever the tool. An unknown tool naming an outside path is
  printed with its kind as `read` when its name contains `read`, `glob` or `grep` and as
  `shell` otherwise, so a gap in the table still surfaces the path.
- D5. A shell command names a path only in its text: absolute-path tokens, and `git -C
  <path>` with any path form, resolved against the lane root when relative. A `git -C
  <outside> <subcommand>` is a `write` when the subcommand mutates (`merge`, `commit`,
  `add`, `checkout`, `switch`, `reset`, `restore`, `push`, `pull`, `stash`, `branch`,
  `update-ref`, `rebase`, `cherry-pick`, `revert`, `rm`, `mv`, `clean`, `am`) and a
  `read` when it only inspects (`status`, `log`, `diff`, `show`, `rev-parse`,
  `merge-base`, `ls-files`, `symbolic-ref`, `branch --show-current`, `worktree list`,
  `fetch`); any other subcommand, and any other shell text naming an outside path, is
  `shell`, printed with the command, for the coachman to judge by reading. The 2026-10-03
  case, `git -C <synthesis worktree> merge --ff-only <sha>`, is therefore a `write` and
  exits 2.
- D6. `refs-record` writes `git show-ref`, `git worktree list --porcelain`, and the
  synthesis worktree's `HEAD` and `status --porcelain` to the out file. `refs-compare`
  prints `moved <ref> <before-sha> <after-sha>`, `added <ref> <sha>`, `deleted <ref>
  <last-sha>`, `synthesis-head <before> <after>` and `synthesis-status <changed-lines>`
  for whatever differs, and exits 0 when nothing differs, 2 when anything does. The
  round's own scratch refs are told from the run's by name: a ref literally named
  `<ticket>-rev-<lens>-<lane>` is the round's own and is not printed; every other ref is
  the run's. In the normal case the round creates no refs at all (detached worktrees and
  clones add none to the main repository), so any printed line is a reach until the
  coachman understands it; the worktree list tells the round's own scratches, named
  `<ticket>-rev-<lens>-<lane>`, from anything else.
- D7. `check-target.sh --full <repo>` prints every `status --porcelain` line, with no
  twenty-line cap and no advisory text, and exits 2 when dirty, 0 when clean; the default
  form is byte-for-byte unchanged for its existing callers.
- D8. The runbook runs, at workhorse harvest: `check-target.sh --full` on the main
  checkout and `lane-reach.sh stream` per harvested workhorse, recorded to
  `logs/reach-harvest.txt`. Around each review round: `refs-record` after the scratches
  are cut and before any launch; after the harvest and before any fix is staged,
  `refs-compare`, `check-target.sh --full` on the main checkout, and `stream` per
  reviewer stream (with `--task` where the round copied a Claude task record), recorded
  to `logs/reach-r<round>.txt`. Before the ship card: `check-target.sh --full` again,
  recorded to `logs/reach-ship.txt`. Each record is one `note` action line.
- D9. A `write` into the main checkout, another lane's worktree or the synthesis
  worktree, or a moved ref, is a finding about the lane that made it. For a workhorse it
  goes on the checkpoint-1 card before synthesis. For a reviewer it voids that lane's
  verdict for the round: the round closes on the lanes that actually reviewed, stated in
  exactly those words, and the card names the voided verdict with its evidence. A `read`,
  `shell` or `refused` outside is a note on the lane, on the same card. A `shell` touch
  the coachman reads as a write is promoted to a finding with the command quoted.
- D10. The ship card gains `## Reach`: the main checkout's state (clean, or every changed
  path), each lane's reach findings and notes by stage, and any voided review verdict
  with its evidence. Checkpoint-1 and checkpoint-review carry the same per-stage lines
  the card quotes.
- D11. AC7 is verified at run level, not by a lane: after this change's branch is up, the
  postmaster dispatches a fixture run from it and `fixture.sh score` must exit 0. A
  lane's part is to keep the new steps fixture-safe: no path the fixture repo lacks, no
  network, no Linux-only call, and every new script path the runbook names resolving
  from a fresh checkout.

## Showing each criterion

| # | Criterion, as the ticket words it | Check (command and input) | Expected output |
|---|---|---|---|
| AC1 | After the workhorses finish, after each review round, and again before the ship card, the flow checks the main checkout with `check-target.sh` and names every path that changed there. | In a scratch clone of the worktree: add an untracked file and 25 tracked edits, run `scripts/check-target.sh --full <clone>`; then on a clean clone. Also quote the three new `coachman.md` steps. | Dirty: exit 2, all 26 porcelain lines printed, none capped. Clean: exit 0, `dirty 0`. The runbook names the check at harvest, after each round, before the card. |
| AC2 | A script reads each lane's events stream, a workhorse's after the workhorses finish and a reviewer's after each review round, and lists the paths its tool calls touched outside the lane's own worktree or scratch, for codex, Claude Code, Muse Code, MiMo Code and pi. A shell command counts only where it names a path in its text, and `git -C <path>` counts as touching that path. | `scripts/lane-reach.sh stream <harness> <made-up stream> <lane-root>` per harness, with a write-outside, a read-outside, a refused-outside, a shell naming an outside path, a `git -C <outside> status`, and an inside-only stream. | Write-outside: `write <path> ...`, exit 2. Read/refused/shell-only: the path line, exit 3. Inside-only: no output, exit 0. `git -C` outside: the path line. |
| AC3 | Before and after each review round the flow records every ref of the repository and the head and status of the synthesis worktree, and compares them. A ref other than the round's own scratch refs that moved, or a synthesis worktree that changed, is named with its hash before and after. | In a scratch repo with a synthesis worktree: `refs-record` before; move a branch with `git update-ref`, dirty the synthesis worktree; `refs-record` after; `refs-compare`. And a no-change pair. | Moved: `moved refs/heads/<b> <sha1> <sha2>`, `synthesis-head`/`synthesis-status` lines, exit 2. No-change: no output, exit 0. |
| AC4 | A write into the main checkout, into another lane's worktree or the synthesis worktree, or a moved ref, is logged as a finding about the lane that made it. For a workhorse it goes to the user before synthesis. For a reviewer it voids that lane's verdict for the round, since a verdict from a lane that changed what it was reviewing counts for nothing. A read or a refused attempt is logged as a note on the lane. | Drill transcript: replay the 2026-10-03 case in a scratch repo (a reviewer stream running `git -C <synth> merge --ff-only <sha>` plus a moved ref) through `stream` and `refs-compare`, and quote the runbook's void rule and the checkpoint card lines the drill would write. | `stream` exits 2 with the `write` line; `refs-compare` exits 2 with the `moved` line; the quoted rule voids the verdict and closes the round on the lanes that actually reviewed; reads/refused map to notes. |
| AC5 | The ship card states the main checkout's state and each lane's findings from this check, with any voided review verdict. | Quote the new `## Reach` card section from `coachman.md` and show it filled from the drill's `logs/reach-*.txt` lines. | The section names the checkout state, each lane's findings and notes, and the voided verdict with its evidence path. |
| AC6 | The script has a control for each harness's stream format: a stream with a write outside is flagged, a read outside is a note, and a stream that stays inside reads clean. A reviewer stream whose tool call runs `git -C <synthesis worktree> merge --ff-only <sha>`, the case of 2026-10-03, is flagged and its verdict voided. A round whose refs are unchanged reads clean, and one in which a ref moved is named with its two hashes. A main checkout with an untracked file is flagged and a clean one is not. | `bun test scripts/lane-reach.test.ts scripts/check-target.test.ts` | All pass: per-harness write/read/clean, the merge case (exit 2, `write` line, and the runbook void rule quoted in the test's comment), refs clean/moved, checkout dirty/clean. |
| AC7 | A fixture run scores clean with the check in place. | At run level, after the branch is up: dispatch a fixture run from it, `scripts/fixture.sh score <dispatch> <fixture-repo>`. A lane shows `bun run check` green and every new script path resolving. | `score` exits 0. The lane's transcript shows the gate green. |

## Tasks

- [ ] T001 [P] [AC2] Add `scripts/lane-reach.sh` wrapper and the `stream` subcommand in `scripts/lane-reach.ts` for codex, claude, mimo, pi and muse shapes, per D2–D5.
- [ ] T002 [P] [AC3] Add `refs-record` and `refs-compare` in `scripts/lane-reach.ts`, per D6.
- [ ] T003 [P] [AC1] Add `--full` to `scripts/check-target.ts`, per D7, default output unchanged.
- [ ] T004 [AC6] Add `scripts/lane-reach.test.ts` with per-harness write/read/refused/shell/clean controls and the 2026-10-03 merge case, plus `scripts/check-target.test.ts`, per D11's fixture-safety.
- [ ] T005 [AC1] [AC4] Add the harvest, round and pre-card reach steps and the void rule to `skills/postmaster/coachman.md`, per D8–D9, every script path through `<tool>`.
- [ ] T006 [AC5] Add the `## Reach` ship-card section and the checkpoint lines to `skills/postmaster/coachman.md`, per D10.
- [ ] T007 [AC7] Run `bun run check` green; run the AC1–AC5 checks above and keep the transcripts under `.postmaster/verify/`; confirm every new script path resolves from a fresh checkout.
