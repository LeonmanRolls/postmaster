# Workhorse summary: #170 one spec per run

## Commits

- `40ee8a8` copy the #109 TypeScript port of spec-decisions and spec-review-link (byte-for-byte from `b8e5e6485f77`)
- `269ea46` one spec per run in spec-decisions and spec-review-link; add spec-session
- `1d6f81d` one coachman-written spec per run through the runbooks
- `30968c5` the wiki records one spec per run and the lane shares to watch
- `6becdf8` keep the ticket's own `##` headers in the spec session brief

(Planning commits `27ee73c`, `a9be687`, `8e51b88` are the workhorse spec itself.)

## Checks

`/home/brindlewick/.postmaster/tool-pins/ffe37821779aa7cc77275860573a8fdd43cd6e2d/scripts/verify.sh run .`:

- gate: pass, exit 0, 656s: `bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'`

Other commands:

- `bun test scripts/` exit 0: 18 pass, 0 fail (spec-decisions.test.ts, spec-review-link.test.ts, spec-session.test.ts)
- `scripts/spec-decisions.sh --self-test` exit 0
- `scripts/spec-review-link.sh --self-test` exit 0
- `scripts/skill-refs.sh` exit 0
- `scripts/wiki-lint.sh` exit 0
- `bash -n` on every `scripts/*.sh` exit 0

An earlier gate run under load showed host.sh close/tab controls misbehave; re-run on a quieter machine they pass, as the waybill says of host.sh and review-round.sh timing flakes. This change did not touch host.sh.

## Evidence

Transcripts under `.postmaster/verify/` in this worktree (git ignores that path).

- **AC1** (`.postmaster/verify/ac1.txt`): planning stage walked on the scratch run. `stage.sh planning` exit 0; copy into `<dispatch>/spec-review/` byte-identical (`cmp` exit 0); that folder holds only `WORKHORSE-SPEC.md`; synthesis holds one commit that adds the spec (`8910a77`); `spec-review-link.sh` exit 0 with the folder link; package has one entry (commit, link, path); `.spec-review-ready` touched; no workhorse launched (no lane logs).
- **AC2** (`.postmaster/verify/ac2.txt`): three rounds from a fresh package. Approve via `spec-session.sh approve` then `count` prints `approved 1` / `changes 0`. Record `changes` with words then `count` prints `approved 0` / `changes 1`. Record `dropped` with words then `count` prints `approved 0` / `changes 0`. The fixture-run paragraph in `postmaster.md` signs off with no session.
- **AC3** (`.postmaster/verify/ac3.txt`): after approval the spec is committed in both workhorse worktrees; `git show HEAD:WORKHORSE-SPEC.md` in each is byte-identical to the approved commit's file (`cmp` exit 0, both). The brief text carries no planning stop and no template for the workhorse.
- **AC4** (`.postmaster/verify/ac4.txt`): `workhorse-spec-template.md` and the coachman's planning step both say the spec is what to build, the decisions that matter and the tests, not the code.
- **AC5** (`.postmaster/verify/ac5.txt`): one package entry with commit, link and path; `runs-status` reports `SPEC` while `.spec-review-ready` is there; `run-times` shows a `planning` row (37s drafting through the decision); `actions.jsonl` holds `spec-review` lines opening `approved <commit>` (and changes/dropped) with target `spec`; `count` on a per-lane decisions file prints `approved 0` / `changes 2`.
- **AC6** (`.postmaster/verify/ac6.txt`): `bun test scripts/`, both `--self-test`s pass. Each break-to-fail names a new control and fails only that neighbourhood (stanza header, one-spec count, folder link, approve-of-unchanged); after each restore all pass again; nothing broken is committed.
- **AC7** (`.postmaster/verify/ac7.txt`): `wiki-lint.sh` exit 0; `planning-stage.md` records the one-spec change, the spec session, and #158's lane shares as what would show whether the lanes still differ usefully.
- **AC8** (`.postmaster/verify/ac8.txt`): brief with a preferences file copies it word for word; without one says `None are set.`; holds the ticket (including its own `##` headers), the folder link, the copy's path and the runbook path; lists a lane draft by commit when one exists. `host.sh spawn` with `POSTMASTER_HOST=none` exits 3, named `<ticket name> · spec`. Approve of unchanged text commits nothing and records the existing commit; of edited text makes one commit holding the copy; refused while the synthesis worktree holds another change (exit 2, nothing recorded). A launch in a real session tab is `not shown: it would open a session on the user's machine, and the first real run shows it`.

## Decisions

- **Where the one spec lives and is committed.** `WORKHORSE-SPEC.md` at the synthesis worktree root, committed on the ticket branch as the record of intent. On approval the coachman commits that file at every workhorse worktree root so each lane sees it in blinkers.
- **Workhorses are not launched in the planning stage.** The coachman writes the spec alone. A workhorse is first launched after approval, to implement.
- **Decision words stay `approved|changes|dropped`.** `dropped` now means the run stops. This keeps `log-action.sh`'s validation stable.
- **`spec-decisions` record takes no lane.** One `## spec` stanza. `count` prints `approved 0|1` and `changes 0|1` for that shape; a per-lane file is still counted as before.
- **One approved spec is the bar.** The two-approved bar goes.
- **Manifest.** On approval, `lanes.<lane>.spec_commit` is set to the same approved commit on every implementing lane.
- **Editor link.** `{path}` in `planning.review_link` is the folder that holds the spec under review; with no template the link is the file's path.
- **Spec session.** `spec-session.sh brief` writes the session's brief; `approve` commits the user-approved text and records the approval. Preferences come from `preferences.md` beside the machine config. With no session host the postmaster reviews in its own conversation.
- **Copy from #109.** Byte-for-byte from `b8e5e6485f77` in one commit; the change is made in the TypeScript; `scripts/lib/` and `bunfig.toml` are never edited after the copy.
- **Ticket parser.** The waybill's ticket body is verbatim and may hold `##` headers; only Project profile, Team and Dispatch end it.
- **`runs-status.sh` comment** still speaks of per-workhorse specs. Fixing it would mean copying the port of a script `runs-watch.sh` and `turnpikes.sh` call, for one line of comment; left and listed here.

## Not done

- Closing a spawned spec session tab needs a change to `host.sh`, which would mean copying #109's port of it. The tab is left for the user to close.
- A fixture run scoring clean is required before merge (the ticket's note). That is the postmaster's to arrange, not this branch's.
- The launch of a spec session in a real session tab is not shown here: it would open a session on the user's machine.

## Verdict

- **AC1 met.** The coachman writes and commits one spec; the workhorses write none and are not launched in planning.
- **AC2 met.** One review per run: approved, changes then revise and pause again, or the run stops. Fixture runs are signed off by the postmaster.
- **AC3 met.** On approval every workhorse implements from the same spec, byte-identical in each worktree, in blinkers.
- **AC4 met.** The template and the coachman's step keep the spec at what to build, the decisions that matter and the tests, not the code.
- **AC5 met.** `spec-decisions.sh`, the review package, `.spec-review-ready`, the stage timings and the action log follow one spec per run; a per-lane decisions file is still counted.
- **AC6 met.** Self-test controls cover a one-spec package, a changes round, an approval, a stop, and a decisions file from before the change.
- **AC7 met.** The planning-stage page records the change and names the #158 lane shares.
- **AC8 met.** The spec session brief and approval behave as specified; a real session tab is not shown.
