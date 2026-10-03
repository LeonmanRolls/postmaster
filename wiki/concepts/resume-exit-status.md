---
title: A resume's exit status does not say it continued its thread
type: concept
standing: settled
sources: [trials/pi-prompt-forms, trials/muse-mimo-controls]
updated: 2026-09-27
---

# A resume's exit status does not say it continued its thread

**Claim.** A harness asked to resume a thread it cannot find may exit 0 anyway. It may have done
nothing, or it may have started a new thread. Only the harness's own record says which thread a
resume continued. So the flow checks that the thread is where the resume will look, before
resuming it, rather than reading the exit.

**Standing: settled**, for pi 0.87.0, Muse Code 1.4.0 and MiMo Code 0.1.15. Each case was
reproduced against the harness, beside a resume of the launch's own thread that did continue it
[@trials/pi-prompt-forms] [@trials/muse-mimo-controls].

## The evidence

| harness | resumed with | what it did | exit |
|---|---|---|---|
| pi 0.87.0 | an id from another directory | asked on stdin whether to fork it, took the prompt's first line as the answer, and printed "Aborted." | 0 |
| Muse Code 1.4.0 | an id its data directory does not hold | opened a new thread under that id and answered the prompt with no earlier turn | 0 |
| Muse Code 1.4.0 | its thread, from another directory | refused, naming the workspace the thread was created in | 1 |
| MiMo Code 0.1.15 | an id its data directory does not hold | wrote no event and sent the model nothing; "Session not found" on stderr | 0 |
| MiMo Code 0.1.15 | its thread, from another directory | continued the thread, and ran its tools in the other directory | 0 |

The controls: the same resume, given the launch's own id from the launch's directory, continued
the thread. Muse Code's record says `session.resumed` after the launch's turn, and MiMo Code
sent the launch's turn and answer ahead of the new prompt [@trials/muse-mimo-controls].

## Why it matters

A resume is how a ruling reaches a coachman, and how a coachman answers a lane. A resume that
quietly starts afresh hands a lane a prompt without the context it refers to. One that quietly
does nothing looks like a lane with nothing to say. A lane resumed in the wrong directory works
in someone else's worktree, which breaks blinkers.

`run launch` gives each Muse Code and MiMo Code launch its own data directory, keyed by
directory, name, leg and run. That makes the not-found case the common one: a resume from
another directory, on another leg, or outside the run it was launched in looks in a data
directory that holds no such thread.

## What changed because of it

`scripts/run launch` refuses a muse or mimo resume unless the harness's own export finds the
thread in the launch's data directory. Its self-test shows each refusal, and fails without the
check (issue #71). pi's case was covered already: `run launch resume` changes to the given
directory first. `skills/postmaster/harnesses.md` records each harness's behaviour.

## What would overturn it

A version that fails the resume of an unknown thread with a non-zero exit, as Muse Code already
does for a thread from another directory. That would make the check redundant for that
harness, not wrong.
