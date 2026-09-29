---
kind: trial
subject: a positive control through the flow's own launch path — each harness's code-review form, at the level launch.sh review sets, yields a normalized finding at the planted bug's file and line
date: 2026-09-29
---

# Method

**Question.** Issue #38's criterion 9: in a worktree scratch detached at the snapshot of a
target whose default branch is not `main`, with a planted bug in a commit that is not the last,
does each harness with a review form, launched through `scripts/launch.sh review` at the level
that form sets, yield a normalized finding at the bug's file and line?

**Versions.** The same three harnesses as [`../code-review-scope/`](../code-review-scope/method.md):
claude 2.1.283 on `claude-opus-5-5`; codex-cli 0.157.1 on `gpt-6-luna`; MiMo Code 0.1.15 on
`<plan-provider>/mimo-v2.6-pro`. The reviews ran through `launch.sh review` from this change's
workhorse branch (`wb/38-mimo`), whose review forms are argv-identical to the synthesis: both
assert the exact commands in `launch.sh --self-test`. The published findings below are the
synthesis `review-findings.sh normalize` of the recorded streams.

**Setup.** `apparatus/run.sh` builds the same Node fixture as the earlier trial: default branch
`trunk`; BASE keeps records in memory (`src/store.js`); the first of two commits on a synthesis
branch adds `src/page.js`, whose `slice(start, start + size + 1)` at line 8 is the planted bug;
the last adds `src/count.js`, which is correct. A review of the last commit alone sees only
`src/count.js`. The commit dates are fixed, so the fixture has the same SHAs every time: BASE
`4973110`, HEAD~1 `a58e725`, SNAP `5434717`.

Every review runs in a fresh worktree scratch cut by `scripts/cut-scratch.sh` at SNAP and
checked before the launch. Each harness runs once, through the flow's own form:

| lane | harness | `launch.sh review` |
|---|---|---|
| opus | claude | `/code-review max <BASE>...HEAD` |
| luna | codex | `codex exec review --base <BASE>` at `max` |
| mimo | mimo | `--command review`, `--variant high`, `<BASE>...HEAD` in the prompt file |

The trial config names the same harnesses, models and MiMo Code key file as the live one. Each
lane's configured effort is `low`, so a control that ran on the lane's effort rather than the
top level would be visible in the command. `launch.sh review` writes the events stream to
stdout; the script keeps it as `<lane>.jsonl`, the final message as `<lane>-last.md` or
`<lane>-report.md` for the record, and harvests each `task_notification`'s output file into
the out directory with `review-findings.sh harvest` (criterion 8).

**The check.** `scripts/review-findings.sh normalize` reads the events stream (codex's
`-o` file where it has one) and prints the findings. The
control passes when one normalized finding is at `src/page.js:8` (file ending `src/page.js`,
line 8), which is where the planted bug sits. The check is the script's own parse of the
stream, not a grep of the report text.

**What is recorded.** Per lane: the events stream, the final message, the normalized findings,
and for claude the forked task's output file. `run.log` is the control's own stdout. The
streams are not published: they may name this machine's paths. The findings and the report
passages that cite `src/page.js:8` are what the wiki cites.

# Results

| lane | harness | `launch.sh review` | exit | normalized finding at `src/page.js:8` |
|---|---|---|---|---|
| opus | claude 2.1.283 | `/code-review max 4973110...HEAD` | 0 | yes — the JSON array's first finding, severity not provided |
| luna | codex 0.157.1 | `codex exec review --base 4973110` at `max` | 0 | yes — `[P1] Limit each page to the requested size` at `src/page.js:8-8` |
| mimo | MiMo Code 0.1.15 | `--command review --variant high`, range in the prompt file | 0 | yes — `### Bug — off-by-one in page`, `src/page.js:8` |

Each ran in a worktree scratch detached at SNAP, cut and checked before the launch. The
planted bug is in the first of two commits; a review of the last commit alone would see only
`src/count.js`.

**What each report looked like.** claude at `max` ran ten finder angles and a gap sweep through
forked tasks (24 `task_notification` output files, kept as `opus-claude-task-*.output`), then wrote a
JSON array in its final message, one object per finding with `file`, `line`, `summary` and
`failure_scenario` and no severity. Its first finding is the planted off-by-one at
`src/page.js:8`. codex wrote `- [P1] Limit each page to the requested size —
<scratch>/src/page.js:8-8` with a body, the form its `-o` message takes. MiMo Code wrote free
markdown, `### Bug — off-by-one in page (high)` with `` `src/page.js:8` `` in the body and a
fenced `js` block as evidence.

**Normalization.** `scripts/review-findings.sh normalize` turned each recorded stream into
the finding contract and each run's check was that one normalized finding is at the bug's file
and line. Nine findings for claude (two distinct ones at `src/page.js:8`, both kept), one for
codex with its `P1`, one for mimo with its fenced block as evidence. Fields no harness gave
are `not provided`, never invented.

**Claude's own record.** Each of the 24 forked task output files named by the stream's
`task_notification` was copied into the out directory (`opus-claude-task-*.output`) by
`review-findings.sh harvest`, which is the harvest's keep.

**Scratches.** No run changed a tracked file in its scratch.

# What it settles

That the flow's own launch path — `launch.sh review` at the top level, a worktree scratch, a
named range from BASE — puts each harness's code-review skill on the run's change and that
`review-findings.sh` turns its report into a finding at the planted bug's file and line, on
this fixture and this machine. It does not show how often any of them finds a bug it is not
tipped to, nor anything about pi or muse, which have no review form and so do not review for
bugs at all.
