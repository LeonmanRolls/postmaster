# Workhorse summary: #124 The review leg ends with the run ready for the user's merge, with no separate ship leg

## Commits

- `dbcc115` Add workhorse spec for #124: two coachman legs, review ends the run
- `77a21b3` turnpikes.sh lists synthesis and review, with a legs: line and a three-leg fallback
- `8982995` runs-status and stage follow the two-leg run, with controls for one, two and three legs
- `dbf9a65` fixture scores a two-leg, a one-leg and a three-leg run, and allows a skipped review stage
- `9ec7a00` The review leg ends the run with the ship card; the postmaster opens the PR or merges and does aftercare
- `4a4d956` style-findings and ticket-check follow the sort and turnpike home as they moved
- `5f780b6` Tick the workhorse spec's tasks as done

## Checks

`/home/brindlewick/postmaster/scripts/verify.sh run .` printed, just before this summary:

```
gate: pass, exit 0, 391s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

One line per check the brief names:

| check | command | exit |
|---|---|---|
| gate [default:gate] | the bash -c above, through `verify.sh run .` | 0 (391s) |

Other commands run, with their exits:

| command | exit |
|---|---|
| `scripts/turnpikes.sh --self-test` (direct, several times) | 0 |
| `scripts/runs-status.sh --self-test` | 0 |
| `scripts/stage.sh --self-test` | 0 |
| `scripts/fixture.sh --self-test` | 0 |
| `scripts/style-findings.sh --self-test` | 0 |
| `scripts/ticket-check.sh --self-test` | 0 |
| `scripts/skill-refs.sh` | 0 |
| `bash -n scripts/*.sh` | 0 |
| `verify.sh run .` first attempt | 1, a one-off `link-skills.sh` control ("counts as linked") under load; the same self-test passes alone and the re-run of `verify.sh run .` is the 0 above |

## Decisions within the brief

- **How a pre-change run is recognised.** A `legs:` line under the waybill's title
  (`legs: synthesis` or `legs: synthesis review`), written at dispatch from
  `turnpikes.sh legs --names`. A waybill without it was dispatched before this change and
  keeps three legs, ship numbered 3 even when review is absent.
- **Stage names stay** (`shipping`, `shipped`). The last leg sets `shipping` and stops at the
  card; the postmaster sets `shipped` after the merge (or after the user says the pull request
  landed) and `done` when it closes. A one-leg run never enters `review`.
- **Who writes the style sort.** The postmaster, in Stage G aftercare, since no coachman is
  alive after the card. `style-findings.sh`'s self-test now reads the forms from
  `postmaster.md`.
- **Pull request or local merge.** The waybill's project profile carries `landing:
  pull-request` or `landing: local`. The postmaster pushes the branch and opens the PR
  (`gh pr create`) on the first; on the second it merges on the merge word (`MERGE_AUTHORITY:
  user`) or on its own verification (`MERGE_AUTHORITY: postmaster`).
- **A withheld card is still a resume of the last leg.** The coachman never merges, but the
  postmaster may resume its thread with a verification failure as the ruling; the leg fixes
  the card and touches `.card-ready` afresh, as it did for a withheld grant before.
- **`launch.sh` still accepts `--leg ship`** so a pre-change run can resume its ship leg.
- **`handoff-check.sh` section names stay**, including `Next leg`, which on the last hand-off
  is for the postmaster.
- **ticket-check.sh's self-test** plants its extra turnpike in `review`, not `ship`, because
  `ship` is no longer a home a turnpike may have.

## Not done, and why

- **A real fixture run scored clean.** That is the merge gate this ticket names ("it merges
  only after a fixture run from its branch scores clean"). It writes under `~/Code/fixtures`
  and `~/.postmaster/runs/`, outside this worktree, which the brief forbids. The postmaster
  runs it before merge: `scripts/fixture.sh new <name> <ticket>`, dispatch the run, then
  `scripts/fixture.sh score <dispatch> <repo>`.
- **Wiki pages.** They still describe the three-leg run. A lane does not write the wiki, and
  the acceptance criteria do not name it.
- **A PR helper script.** The runbook names `gh pr create` with the card's facts; a
  `github.sh pr` adapter is a separate concern and not in this ticket.

## Acceptance criteria

1. **A run is at most two coachman legs, synthesis and review. The review leg ends, once no P1 or P2 finding remains and the gates pass, by writing the ship card and its hand-off and touching the card's marker; it merges nothing.** Met. `coachman.md` legs table and Stage 3; `turnpikes.sh legs` prints two legs; the self-test walks a two-leg run to GATE with no third leg.
2. **The card carries what the ship leg's card carries today.** Met. Stage 3's card steps (gates and browser suite judgment, review link, preview and QA, turnpikes, open findings, every branch, the checks) are the ship leg's, unchanged in content.
3. **A run whose ticket names no review turnpike ends the same way at the end of its synthesis leg.** Met. Stage 1 sends a no-review run to Stage 3; `turnpikes.sh` one-leg walk ends at the card.
4. **On the card, the postmaster verifies it against the code as Stage F says, then opens the pull request where the project lands through pull requests, or asks for the merge word and merges where it merges locally, and after the merge does the aftercare and teardown the ship leg does today.** Met. Stage F verifies then opens the PR or merges; Stage G holds the style sort, the closing record, the worktree teardown and the close, in the ship leg's words.
5. **`turnpikes.sh legs` lists synthesis and review only; `runs-status.sh`, `stage.sh` and the runbooks follow; a run dispatched before this change keeps its three legs.** Met. `legs --line`/`--names` are two-leg; `legs <dispatch>` falls back to three when the waybill has no `legs:` line; the poll and the stages follow; the self-tests walk a legacy three-leg run.
6. **The self-tests of the scripts that change have controls for a two-leg run and a one-leg run, and for a three-leg run dispatched before the change.** Met. `turnpikes.sh`, `runs-status.sh`, `stage.sh` and `fixture.sh` each carry all three; `style-findings.sh` and `ticket-check.sh` follow where the content moved.
