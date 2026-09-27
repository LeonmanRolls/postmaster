---
kind: trial
subject: claude's /security-review under postmaster's own launch form, in a clone scratch and a worktree scratch
date: 2026-09-26
---

# Method

**Question.** Issue #66 runs the security review through a harness's own security review skill
where it has one. Claude Code's `/security-review` reviews the change against `origin/HEAD`.
Does it, launched the way the flow launches a reviewer lane, report a planted vulnerability at
its file and line in a scratch clone whose `origin/HEAD` leads back to the base? And what does it
do in a worktree scratch where `origin/HEAD` does not resolve?

**Versions.** claude 2.1.283 on `claude-opus-5-5`, git 2.43.0, and the flow's scripts from the
branch that closes #66.

**Setup.** `apparatus/run.sh` builds a two-commit Node fixture in a temporary directory. The
base serves disk usage through `execFile`, with no shell. The change adds a `GET /archive`
endpoint whose `name` query parameter reaches a shell through `exec` at `src/archive.js:5`. The
change is committed on a synthesis branch in a worktree, as a run's synthesis is. The fixture has
no `origin` remote.

A config names one claude lane. `scripts/launch.sh skill <lane> security-review` writes the
prompt file. `scripts/cut-scratch.sh` cuts two scratches at the change's commit: a clone with
`--clone <base>`, and a detached worktree. Both arms then run the identical command,
`scripts/launch.sh launch <lane> <scratch> <prompt-file>`, in the foreground, with the event
stream on stdout.

**What is recorded.** `run.sh` keeps, per arm: the prompt, the planted line, git's version, the
files a diff against `origin/HEAD` names in the scratch, the harness version and model from the
stream's init event, whether `/security-review` was offered, the exit code and the size of
stderr, a count of tool calls, and for each result line its subtype, error flag, turns, duration
and end reason, then the text of the last result line. The streams themselves are not kept: their
init event lists the machine's own tools, connectors and settings.

**Runs.** `clone.txt` and `worktree.txt` are one run of `run.sh`. `clone-first.txt` is an earlier
run of the clone arm, made by hand before `run.sh` existed: the same fixture, prompt, model and
command, with the lane named `opus` and a second, unused lane in the config. Its record was
extracted from its stream with the Python in `run.sh`.

# Results

- **Clone scratch.** In both runs the diff against `origin/HEAD` named exactly the two changed
  files, and the last result line reported `Command Injection: src/archive.js:5` at severity
  High, with an exploit scenario. `clone.txt` ended with one result line after 4 turns, in 72
  seconds. In `clone-first.txt` the skill ran its verification agents in the background, and the
  run ended with three result lines: the first two say the agents are still running, and the
  third is the report.
- **Worktree scratch.** `origin/HEAD` did not resolve. The run exited 0, with one result line of
  subtype `success`, no error, 0 turns and empty text, after half a second, having reviewed
  nothing.

# What it settles

A fact about one tool at one version: claude 2.1.283's `/security-review` needs `origin/HEAD` to
lead back to the base, returns success with an empty report where it does not resolve, and can
end a headless run with several result lines, the report on the last. It says nothing about
whether the skill reviews better or worse than postmaster's brief, which needs runs.
