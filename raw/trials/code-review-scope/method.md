---
kind: trial
subject: which change claude's, codex's and MiMo Code's own code-review skills review in a detached review scratch, and the form that reviews exactly the run's change
date: 2026-09-27
---

# Method

**Question.** Issue #38 runs the bug review through each harness's own code-review skill. A
review scratch is a worktree detached at the snapshot, with no upstream. For each installed
harness that has such a skill, which change does it review there by default, and which form
reviews exactly the run's change, from BASE to the snapshot? Claude Code 2.1.283's prompt for
`/code-review` diffs `@{upstream}...HEAD`, or `main...HEAD` or `HEAD~1` when there is no upstream,
so a target whose default branch is not `main` might get its last commit reviewed and nothing
else.

**Versions.** claude 2.1.283 on `claude-opus-5-5`; codex-cli 0.157.1 on `gpt-6-luna`; MiMo Code
0.1.15 on `mimo-v2.6-pro` through its `xiaomi-token-plan-sgp` provider; git 2.43.0; and the
flow's scripts from the branch that closes #66, which cut and check the scratches and launch
claude.

**Setup.** `apparatus/run.sh` builds a Node fixture whose default branch is `trunk`. The base
keeps records in memory in `src/store.js`. The change is two commits on a synthesis branch in a
worktree, as a run's synthesis is. The first adds `src/page.js`, whose
`slice(start, start + size + 1)` at line 8 returns one record too many: the planted bug. The last
adds `src/count.js`, which is correct. A review of the last commit alone sees only
`src/count.js`. The commit dates are fixed, so the fixture has the same SHAs every time: BASE
`4973110`, HEAD~1 `a58e725`, SNAP `5434717`.

Every run gets a fresh scratch: `scripts/cut-scratch.sh` cuts a worktree detached at SNAP, and
`--check` confirms it before the launch. Each harness runs twice, through one command that
differs only in the target it names:

| run | the review form |
|---|---|
| claude-default | `/code-review low` |
| claude-range | `/code-review low <BASE>...HEAD` |
| codex-default | `codex exec review` |
| codex-base | `codex exec review --base <BASE>` |
| mimo-default | `mimo run --command review` |
| mimo-range | `mimo run --command review <BASE>...HEAD` |

claude's prompt goes through `scripts/launch.sh launch` on a config naming one claude lane. codex
and MiMo Code have no review form in `launch.sh`, so `run.sh` builds theirs: codex's with `--json
-o <file> -m <model> -c model_reasoning_effort="low" --dangerously-bypass-approvals-and-sandbox
--skip-git-repo-check`, as `launch.sh` launches codex in a detached scratch; MiMo Code's with
`--format json -m <provider/model> --variant low --dangerously-skip-permissions`, stdin from
`/dev/null`, and its key sourced from a file into its process alone. Each runs from inside its
scratch, at `low`, the lowest level each offers.

**What is recorded.** `apparatus/record.py` writes each record from the run's stream and the few
facts `run.sh` kept. Per run: the form; the model and level asked for; the versions; BASE, HEAD~1
and SNAP; the planted line; the scratch before and after. For claude, the version and model from
the init event, whether `/code-review` was offered, how the skill ran, and the passages of the
skill's prompt that choose the diff. For codex, the model and effort of each thread in the
scratch from its rollout, the review prompt, the review target and the review's structured
findings. For MiMo Code, each subtask it launched. Then for every run: each git command the
reviewer ran, with the files that command's output showed a diff for; the tool counts; how the
run ended; whether the report cites `src/page.js:8`; and the report. The check for that citation
is run on three citations and three misses before any record is written.

The streams are not kept. claude's init event lists this machine's own tools and connectors, and
codex's rollout carries this machine's own instructions. `record.py` writes the scratch's path as
`<tmp>`, and replaces a report line that mentions a connector with a marker: one claude report
ended with a sentence about a connector of this machine's account (`claude-range.txt`).

**Where the review's own tool calls are.** claude runs `/code-review` as a forked task. Its tool
calls are not in the `-p` stream but in the task's output file, which the stream's
`task_notification` names, and `run.sh` copies it. codex runs the review as a thread of its own:
its commands are in the `--json` stream, and its model, effort and prompt are in the rollouts
under `~/.codex/sessions/`. MiMo Code's `/review` runs as a subtask whose tool calls stream
inline, under the parent's session id.

**Runs.** One invocation of `run.sh` made `claude-default.txt`, `claude-range.txt`,
`codex-default.txt` and `codex-base.txt`; two more made `mimo-default.txt` and `mimo-range.txt`.
`claude-default-first.txt` and `claude-range-first.txt` are an earlier invocation, with the same
fixture and forms, made before `run.sh` copied the forked task's transcript. The transcript was
copied afterwards from the path the stream names, and the record made with the same `record.py`.
codex-default ran in that invocation too, with the same result.

# Results

- **claude, no target.** In both runs the skill's first command,
  `(git diff @{upstream}...HEAD 2>/dev/null || git diff main...HEAD); git diff HEAD`, failed on
  `main...HEAD` and showed nothing. The model then listed the branches and ran `git show HEAD`,
  which showed the last commit only. Having seen `trunk` in the branch list, it ran
  `git diff trunk...HEAD`, which showed both files, and reported the planted bug at
  `src/page.js:8`. Both reports say the review was made against `trunk` because the repository
  has no `main`. It ran three git commands where the prompt asks for one.
- **claude, `<BASE>...HEAD`.** The prompt the skill ran on began `Review target:
  <BASE>...HEAD`. In both runs it ran one command, `git diff <BASE>...HEAD` then `git diff HEAD`,
  once with pathspecs leaving out test files, which showed both files, and reported the planted
  bug at `src/page.js:8`.
- **codex, no target.** `codex exec review` exited 1 before any model call: `Specify
  --uncommitted, --base, --commit, or provide custom review instructions`.
- **codex, `--base <BASE>`.** codex took a commit as the base, found the merge base itself, and
  gave the review thread the prompt `Review the code changes against the base branch '<BASE>'.
  The merge base commit for this comparison is <BASE>. Run git diff <BASE> ...`. The thread ran on
  gpt-6-luna at effort low, ran `git diff <BASE>`, which showed both files, and returned one
  finding, `[P1] Return no more than size records`, at `src/page.js` lines 8 to 8, confidence
  1.0, with the overall verdict `patch is incorrect`. The report cites the file by absolute path.
- **MiMo Code, no target.** `/review` launched its subtask with `subagent_type build`, which the
  actor tool refused: only `explore` and `general` exist. The model then reviewed by the
  command's rule for no arguments, uncommitted changes: `git status --short`, `git diff` and
  `git diff --cached`, all empty. It reported nothing to review, no finding, and exited 0.
- **MiMo Code, `<BASE>...HEAD`.** The subtask launch failed in the same way. The model retried with
  `subagent_type general`, which ran on mimo-v2.6-pro, ran `git diff <BASE>...HEAD`, which showed
  both files, ran the page function in node to reproduce the bug, and reported it at
  `src/page.js:8`.
- **The scratches.** No run changed a tracked file or left an uncommitted one.

# What it settles

Facts about three tools at one version each, at their lowest level, in a worktree detached at
the snapshot of a target whose default branch is `trunk`:

- claude 2.1.283's `/code-review low <BASE>...HEAD` reviews exactly the change from BASE, in one
  command. Given no target, it saw the last commit alone first, and reached `trunk...HEAD` in both
  runs only because the branch list showed `trunk`: the model's judgment, not the skill's rule.
- codex-cli 0.157.1's `codex exec review` has no default target, takes a commit as `--base`,
  and in a detached scratch reviews the diff from the merge base it computes.
- MiMo Code 0.1.15's `/review` reviews uncommitted changes when given no target, which in a
  clean scratch is nothing, reported as nothing to review with exit 0. Given `<BASE>...HEAD`,
  which its rules do not name, it reviewed that range. Its subtask launch fails on an invalid
  subagent type, and the review runs because the model recovers.

It does not show how often claude's default reaches the whole change, what any skill does above
`low` (claude's prompt above `low` names `HEAD~1` as the fallback, read from the 2.1.283 binary
and not run here), or how well any of them finds bugs against postmaster's brief: one
planted bug, and one or two runs of each form.
