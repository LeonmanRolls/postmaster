---
title: Prompt delivery differs by harness, and the difference is not cosmetic
type: concept
standing: settled
sources: [trials/pi-prompt-forms, trials/codex-resume-forms, trials/muse-mimo-controls]
updated: 2026-09-27
---

# Prompt delivery differs by harness, and the difference is not cosmetic

**Claim.** How a harness is handed its prompt changes what the model receives, not merely how
it is typed. Two forms that look equivalent in a shell can produce different messages, and the
difference is invisible unless somebody checks what arrived.

**Standing: settled.** Demonstrated against a real harness with a controlled comparison
[@trials/pi-prompt-forms], and the failure it predicts was reproduced and then fixed.

## The evidence

pi 0.87.0, given a prompt file two ways, with a local provider recording the request
[@trials/pi-prompt-forms]:

| form | what the model received |
|---|---|
| `pi … @prompt.txt` | `<file name="/abs/path/prompt.txt">` … `</file>` |
| `pi … < prompt.txt` | the prompt verbatim |

`@file` is pi's *attachment* syntax. With no other argument, the attachment becomes the whole
user message, so a lane is handed a file rather than told to do something, and the dispatch
path enters the conversation. A capable model usually infers the intent, which is why the
form passed a casual trial.

Two further findings from the same session, each reproduced:

- pi reads stdin to EOF before starting in every mode but rpc. A launch inheriting an open
  pipe therefore never begins. With the prompt redirected from the file, the same launch runs
  to completion.
- `--session <id>` resolves against the current working directory first. Given an id belonging
  to another directory, pi asks "Fork this session into current directory? [y/N]" on stdin,
  consumes the first line of the piped prompt as the answer, prints "Aborted." and **exits 0**
  having done nothing. A caller checking only the exit status sees success.

Muse Code 1.4.0 and MiMo Code 0.1.15 were checked the same way, with the prompt file below
holding quotes, a dollar sign, backticks, an `@` mention, a line opening with a dash, non-ASCII
text and a final newline. Muse Code ran on its echo provider, which answers with what it was
given, and MiMo Code on a stand-in that recorded each request [@trials/muse-mimo-controls]:

| harness | form | what the model received |
|---|---|---|
| Muse Code | `--prompt-file prompt.txt`, the launch form | the prompt verbatim |
| Muse Code | the prompt as an argument, `"$(cat prompt.txt)"` | the prompt without its final newline, which the shell strips |
| MiMo Code | `< prompt.txt`, the launch form | a newline, then the prompt verbatim |
| MiMo Code | the prompt as an argument | the prompt in double quotes, its own quotes escaped |

MiMo Code joins its message arguments, quoting any that holds a space, and appends stdin after a
newline. So no `mimo run` form delivers a file unchanged. The launch form is the stdin one, whose
only change is the leading newline, and the user accepted that when issue #71 was settled.

## Why it matters beyond pi

A silent difference in the prompt is a confound in every comparison the project makes. If one
lane is told to do something and another is handed a file, a difference in their output is not
evidence about the models. The same applies to a resume that exits 0 without running: a lane
that did nothing is indistinguishable from one that had nothing to do.

So the general rule, which the flow now follows: **check what a harness received, not what it
was sent**, and check on the harness's own record rather than on the exit status.
[A resumed codex thread](codex-resume-model.md) is another case: it exits 0 on a model other
than its own [@trials/codex-resume-forms].

## What changed because of it

`skills/postmaster/harnesses.md` records the stdin form for pi and the resume-directory
caveat; `scripts/run launch` passes the prompt on stdin. Landed in pull request #1. For Muse Code
and MiMo Code it records what arrives, and `run launch` gives Muse Code the file with
`--prompt-file` and MiMo Code the file on stdin. What a resume of a missing thread does is in
[its own page](resume-exit-status.md).

## What would overturn it

A harness where the attachment form provably delivers the identical message, or evidence that
the difference does not affect output. Neither would generalise: the rule is to check per
harness, and the cost of checking is one trial run.
