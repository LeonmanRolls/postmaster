---
title: A resumed codex thread runs on the model its resume names, not the one it was launched on
type: concept
standing: settled
sources: [trials/codex-resume-forms]
updated: 2026-09-27
---

# A resumed codex thread runs on the model its resume names

**Claim.** `codex exec resume` does not restore the model or the effort a thread was launched
on. A resume runs on the model and effort its own command line names. Where it names none, it
runs on codex's configured default, and where the config names none either, on codex's
built-in default. It also prints text unless it is given `--json`, whatever the launch was
given.

**Standing: settled** for codex 0.157.1. A controlled trial launched every thread on one model
and effort, then resumed it with each flag present or absent. It read both the request the
provider received and codex's own record of the turn [@trials/codex-resume-forms]. The
measurement that would refute the claim, a resume that names no model, was made, and the
resumed thread did not keep its model.

## The evidence

Every thread was launched on `launch-model` at effort `high`, and the codex config's default
was `config-model` at `low`. Where a resume named a model or an effort, it was `resume-model`
or `medium` [@trials/codex-resume-forms/results.md].

| the resume named | the resumed turn ran on |
|---|---|
| no model and no effort | `config-model`, `low` |
| no model and no effort, with a config naming neither | `gpt-6-astra`, codex's built-in default; codex's record gives no effort, and the request carried `low` |
| `-m resume-model` | `resume-model`, `low` |
| `-c model_reasoning_effort="medium"` | `config-model`, `medium` |
| both, with `--json` and `-o` | `resume-model`, `medium` |

Every resume that ran continued its thread: the same thread id, with the launch's prompt in the
resumed request. Every one exited 0. codex knows what the thread was launched on, and warns
when a resume changes it: "This session was recorded with model `launch-model` but is resuming
with `config-model`" [@trials/codex-resume-forms/part1/bare.md].

The same trial found more about the resume form:

- `codex exec resume` accepts `--json`, `-o`, `-m` and `-c`, placed before or after `resume`
  [@trials/codex-resume-forms/part1/all-four.md]
  [@trials/codex-resume-forms/part1/all-four-before-resume.md]. With `--json`, a resumed
  stream has the same event types as a launch's.
- After `resume`, codex refuses `-C` and `-s`, exiting 2 with "unexpected argument"
  [@trials/codex-resume-forms/part1/cd-flag.md]
  [@trials/codex-resume-forms/part1/sandbox-flag.md]. Before `resume` it accepts both: the
  resumed turn ran in the `-C` directory, and on the `-s` sandbox with no bypass flag
  [@trials/codex-resume-forms/part1/cd-flag-before-resume.md]
  [@trials/codex-resume-forms/part1/sandbox-flag-before-resume.md].
- A prompt that starts with `-` is read as a flag, and codex exits 2 before the turn begins,
  unless `--` comes before the prompt [@trials/codex-resume-forms/part1/dash-prompt.md]
  [@trials/codex-resume-forms/part1/the-form.md].
- Without the bypass flag, a resumed turn ran `workspace-write` in a worktree the codex config
  trusts, and read-only in one it does not [@trials/codex-resume-forms/part1/no-bypass.md]
  [@trials/codex-resume-forms/part1/no-bypass-untrusted.md]. A launch with the bypass flag
  writes that trust entry itself. `harnesses.md` had said read-only.
- A thread launched in a detached worktree with `--skip-git-repo-check` resumed there without
  it [@trials/codex-resume-forms/part1/detached-scratch.md].

## Why it matters

The flow resumes a thread for a remount, a ruling, the merge word and a workhorse's answer.
Before issue #45, `run launch` resumed a codex thread with no model and no effort. Through it, a
resumed lane and a resumed coachman leg both ran on the codex config's default
[@trials/codex-resume-forms/part2/before-one.md]
[@trials/codex-resume-forms/part2/before-coachman.md]. That default can be a lane's model, and
a coachman never runs on a lane's model. In the trial, codex's built-in default was
`gpt-6-astra`. That is the model `config.example.toml` gives the codex fallback coachman, so a
resumed codex lane could have run on the coachman's model.

The resumed turn also printed text into a stream the flow reads as JSON. A ruling that started
with `-`, a markdown list say, never reached the thread: codex exited 2 before the turn began.

None of this showed in an exit status but the last. It is the rule that
[prompt delivery](prompt-delivery.md) states: check what the harness received, on its own
record.

## What changed because of it

`skills/postmaster/harnesses.md` records the resume form the trial found, and
`scripts/run launch resume` builds it: the launch's flags without `-C` and
`--skip-git-repo-check`, with `--` before the prompt. `coachman.md` resumes a lane with
`--last`, so the lane's final message file holds its latest turn. Through `run launch`, a
resumed lane and a resumed coachman leg now run on the model and effort the config names for
them, write the same events as their launch, and receive a prompt that starts with `-`
[@trials/codex-resume-forms/part2/after-one.md]
[@trials/codex-resume-forms/part2/after-coachman.md]. This was issue #45.

## What would overturn it

A codex release that restores a thread's own model on resume. That would not make the form
wrong, since the form names the model either way. Re-running `trial.py` against a new codex
takes under a minute.
