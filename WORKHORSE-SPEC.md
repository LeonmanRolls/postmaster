# Workhorse spec: 227 Teardown closes a run's spaces when its logs hold review findings lists

## Problem / feature

When a run is finished, teardown stops anything still running in the run's worktrees and closes the tabs and spaces the run opened. To find the reviewers' worktrees, it reads each review round's record in the run's log folder. It also picks up the list of findings that every bug review writes into that folder, takes it for a damaged record, and gives up without a word, so the run's spaces stay open. This breaks what [#165, A finished launch's tab closes, and teardown closes every space a run opened](https://github.com/brindlewick/postmaster/issues/165) promised.

Done: in the log folder, teardown reads only the round records, and no refusal while it reads a run's records is silent.

## Acceptance criteria

1. Both teardown steps, stopping and closing, finish on a reviewed run and cover exactly the worktrees its records name that still exist, whatever else is in its log folder.
2. A round record that stops teardown today, such as one holding a list, still stops it, and teardown now says which record it was.
3. What teardown passes over today, a round record it cannot read or reviewers it cannot use, in whole or in part, is still passed over without a word.
4. An action-log line that stops teardown today still stops it, and teardown now says which line it was. Lines it skips today are still skipped.
5. The refusals that already print a message while teardown reads a run's records keep it word for word.
6. Automated tests cover criteria 1 to 5, and the tests of what this ticket changes fail when the fix is taken out.

## Decisions

- **D1 (proposed)** Teardown reads only the round records in the log folder, known by their name. Why: they are the only files there that the flow writes for this. Instead of: skipping just the findings lists, the quick fix used on two fixture runs, which lets any other file there still add a reviewer or stop teardown.
- **D2 (proposed)** A new message is one line, printed like teardown's other refusals, that names the record by its full location, spelled as teardown spells the worktrees it lists; the rest of its wording is open. Why: it says which run and where to look. Instead of: the record's name alone, which does not say which run.
- **D3 (proposed)** For an action-log line, the message names the log the same way and gives the line's number, counting every line from 1, blank and unreadable ones included. Why: the person can go straight to the line. Instead of: counting only the lines teardown reads.
- **D4 (proposed)** When several records are damaged, teardown names just one of them and stops there; which one is not fixed. Why: it stops at the first today, before anything is stopped or closed. Instead of: reading on to list them all.
- **D5 (proposed)** Two other silent failures in closing a run's spaces stay for a ticket of their own. Why: neither is in the run's own records, and nothing else in teardown changes here. Instead of: fixing them in this ticket.
- **D6 (proposed)** Tests also hold what this ticket keeps (criteria 3 to 5). Why: adding messages could turn a skip into a refusal and stop teardown again. Instead of: testing only what changes.

## Out of scope

- The two other silent failures in closing a run's spaces (D5): when Herdr cannot list a space's panes, and when a damaged record of where a launch was placed leaves the run's spaces open.
- Changing which worktrees teardown covers, beyond D1.

## Direction

Linux and macOS, in the language and runtime of the project's other scripts. It does not change the coachman's steps, so it needs no fixture run. Nothing else in teardown changes: the reviewers it finds in the run's action log, its exit codes, a run whose log folder or action log is missing or cannot be opened, and every refusal coming before anything is stopped or closed. The new tests never touch the live Herdr or tmux.

## Turnpikes

default

## For the agents

*Everything above is what the user signed off. This part follows from it and adds nothing to it.*

### Checks

Every check runs `scripts/host.sh stop-run` and `scripts/host.sh close-run` on **record R**, built fresh in a temporary folder `$T` taken with `pwd -P`. R holds directories `$T/repo/.worktrees/227`, `227-sol`, `227-mimo`, `227-rev-bug-mimo`, `227-rev-bug-decoy` and `227-rev-security-opus`; `$T/runs/227/brief.md` holding `## Dispatch`, `name: #227, test` and `synthesis worktree: $T/repo/.worktrees/227`; `run.json` `{"config":{"team":{"workhorses":["sol","mimo"]}}}`; `manifest.json` `{"lanes":{"sol":{},"mimo":{}}}`; no `actions.jsonl`; and in `logs/`: `review-r1.json`, a mapping as `review-round.sh` writes it with `"reviewers":[["bug","mimo"]]`; `review-r1-bug-mimo-findings.json`, a one-item list as `review-findings.sh normalize` writes it; `review-r1-bug-mimo-usage.json`, a mapping that also holds `"reviewers":[["bug","decoy"]]`; `review-r1-notes.json`, the list `["not","a","record"]`. Each runs as `PATH="$T/bin:$PATH" POSTMASTER_HOST_STATE="$T/state" POSTMASTER_HOST_FIXTURE="$T" scripts/host.sh <command> $T/runs/227`, with `$T/bin/herdr` and `$T/bin/tmux` stubs that exit 1. Per worktree, `stop-run` prints `no launch is running in <path>` and `close-run` prints `closed what host.sh opened for <path>`.

- **C1** R → exit 0, empty stderr, and four lines, for `227-mimo`, `227-sol`, `227-rev-bug-mimo` and `227`; none for `227-rev-bug-decoy` or `227-rev-security-opus`. R plus an `actions.jsonl` of `{"action":"review-launch","target":"opus","detail":"security r1"}` → five lines, adding `227-rev-security-opus`. R without its `logs/` folder → three lines, for `227-mimo`, `227-sol` and `227`. **At the base:** R exits 2 with nothing printed, and so does a copy that skips files named like findings lists or usage records. Without the two lists, the base prints a line for `227-rev-bug-decoy`, and a copy that skips lists does so on R. Without `logs/`, the base gives the three lines.
- **C2** R with `review-r1.json` as `[["bug","mimo"]]`, and in turn `"text"`, `5`, `true` and `null` → exit 2, empty stdout, and one stderr line containing `$T/runs/227/logs/review-r1.json`; given through a link to the dispatch folder, the line still names that resolved path. With `review-r2.json` as `null` as well, or check 4's action log as well → exit 2 and one stderr line. **At the base:** exit 2, nothing printed.
- **C3** R with `review-r1.json` as `{broken`, and in turn an empty file, a folder of that name, `{}` and `{"reviewers":"bug"}` → exit 0, empty stderr, and three lines, for `227-mimo`, `227-sol` and `227`. As `{"attempt":"1","reviewers":[["bug","mimo"],["bug"]]}`, or R with `actions.jsonl` as a folder → check 1's four lines. **At the base:** exit 2, nothing printed, because of the lists.
- **C4** R plus an `actions.jsonl` of four lines, `{"action":"review-launch","target":"mimo","detail":"bug r1"}`, a blank line, `{broken` and `["review-launch"]` → exit 2, empty stdout, and one stderr line containing `$T/runs/227/actions.jsonl` and `line 4`; the same with `null` or `"text"` as the fourth line. Without the fourth line → check 1's four lines. **At the base:** exit 2, nothing printed, for each.
- **C5** An empty dispatch folder, a waybill whose synthesis worktree is `$T/repo/elsewhere/227`, and R with `run.json` and `manifest.json` both `{broken` → exit 2, empty stdout, and exactly `host: run waybill has no synthesis worktree`, `host: synthesis worktree is not under .worktrees` and `host: run lane records unreadable`. The last with `review-r1.json` as a list as well → still only `host: run lane records unreadable`. **At the base:** the same.
- **C6** `bun test scripts/host.test.ts` passes, and the new controls run `host.sh` through the self-test's `execHost` with its stub `herdr` and `tmux`. In a scratch copy with the base's `scripts/host.ts`, the controls for checks 1, 2 and 4 fail, and no control that exists at the base fails. **At the base:** no such controls.

### Technical notes

- Both commands read the records in [`runWorktreePaths`](https://github.com/brindlewick/postmaster/blob/ede70e2/scripts/host.ts#L5480-L5596). Its match at L5544, `^review-r[0-9].*\.json$`, also takes findings lists and usage records; `REVIEW_ROUND_FILE` (L331) matches exactly `review-r<n>.json`, with any number of digits. The action log's `review-launch` lines keep adding reviewers (L5580-L5583). (C1, D1)
- The silent refusals are `hostError("", 2)` at L5553, for a state file that parses to something other than a mapping, and at L5579, for an `actions.jsonl` line likewise. The commands print `host: <message>` on stderr for a non-empty message (L5616, L5806), so a message gets the form of the other refusals. The comments calling them quiet (L5545-L5546, L5577) go with them. The path is the resolved dispatch path the function already holds. The line number is 1-based and counts every line `pySplitLines` yields, blank and unparseable ones included; it also breaks at `\r`, `\v`, `\f`, `\x1c` to `\x1e`, `\x85`, U+2028 and U+2029. (C2, C4, D2, D3)
- These skips stay: a state file that cannot be read or does not parse, an empty one or a folder included (L5548-L5552); a mapping whose `reviewers` is missing or not a list, and pairs of the wrong form (L5557-L5567); an `actions.jsonl` line that does not parse (L5572-L5576); a `logs/` or `actions.jsonl` that is missing or cannot be opened (L5538-L5542, L5585-L5588). (C3, C4, D6)
- The first refusal ends the function, before either command stops or closes anything: the waybill, then the lane records, the round records in directory order, then the action log. (D4)
- The commands print a line only for a worktree that is a directory (L5627, L5817), and print resolved paths: a check record creates its worktrees and takes its folder with `pwd -P`, since macOS temporary folders sit behind a symlink. (C1, C2, C3, C4)
- The silent exit when `herdr pane list` fails ([L5729-L5733](https://github.com/brindlewick/postmaster/blob/ede70e2/scripts/host.ts#L5729-L5733)) and the silent emptying of the run-space list on one damaged placement file (L5690) stay. (D5)
- `close-run` probes `herdr` and `tmux` on `PATH` whatever `POSTMASTER_HOST` says, so tests isolate them by `PATH`, as `execHost` does. The live suite, `live()` in `host-self-test.ts`, is separate and opt-in. (C6)
- The controls go in [`host-self-test.ts`](https://github.com/brindlewick/postmaster/blob/ede70e2/scripts/host-self-test.ts#L941)'s `runControls`. [`host.test.ts`](https://github.com/brindlewick/postmaster/blob/ede70e2/scripts/host.test.ts) asserts each section's count; its first line says 320 controls while its 29 sections sum to 321, and should state the new sum. (C6)
- [`hosts.md` L189-L192](https://github.com/brindlewick/postmaster/blob/ede70e2/skills/postmaster/hosts.md#L189-L192) says either command exits 2 when the run's records cannot be read; it may add that the refusal names the record. `coachman.md` and `postmaster.md` are contract files and stay as they are. (C2, C4)

### Verified at ede70e2

- Since 503893f, of the files cited only `coachman.md` changed: one line added above its findings line, now L848. Every line cited above reads as cited.
- Under the old match the flow writes round state ([review-round.ts#L252](https://github.com/brindlewick/postmaster/blob/ede70e2/scripts/review-round.ts#L252)), a findings list per bug review ([coachman.md#L848](https://github.com/brindlewick/postmaster/blob/ede70e2/skills/postmaster/coachman.md#L848)) and usage records with no `reviewers` ([usage.ts#L358](https://github.com/brindlewick/postmaster/blob/ede70e2/scripts/usage.ts#L358)).
- [`docs/coachman-contract.toml`](https://github.com/brindlewick/postmaster/blob/ede70e2/docs/coachman-contract.toml) lists `scripts/host.sh`, not `host.ts`. `scripts/coachman-contract.sh 93eb17d^ 93eb17d`, a change to `host.ts` and `host.test.ts` only, prints `no coachman contract change`.
- Checks C1 to C5 ran at ede70e2 and gave the results above. On scratch copies, a minimal fix passes all of them; a copy that skips lists fails check 1 on the decoy, and a copy that skips findings and usage files by name fails it on the notes list.

