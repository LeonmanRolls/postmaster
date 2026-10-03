---
title: Herdr shows a headless claude launch truthfully only when the launch owns its pane
type: concept
standing: settled
sources: [trials/herdr-headless-panes]
updated: 2026-09-26
---

# Herdr shows a headless claude launch truthfully only when the launch owns its pane

**Claim.** Herdr can be the window onto a headless fleet, but not by default. Left to itself it
shows a working headless claude as idle, and a launch that inherits its caller's pane writes
into its caller's pane. Claude is the only harness tried; the others are an open question below. The view is true when the host does three things: runs each launch in a
pane of its own and gives it that pane's identity; reports the launch working itself, and
releases it at the end rather than reporting it idle; and titles the pane itself, because a
headless harness does not.

**Standing: settled** for Herdr 0.9.1 with its claude integration and claude 2.1.283, by a trial
with a control for each finding, run twice with the same result
[@trials/herdr-headless-panes]. Other harnesses have not been tried.

## The evidence

All from one probe of a scratch repository in its own spaces
[@trials/herdr-headless-panes/probe-output.txt].

**Herdr misreads a headless harness.** It classifies claude by what claude draws on the screen,
and a headless claude draws nothing there. Over ten seconds of a headless run that the stream
shows working, Herdr gave the pane `idle` for six and `unknown` for three, and `working` never.
`idle` means ready for input, which a headless lane never is.

**A reported state holds; a closing `idle` does not; a release does.** Reported by the host,
`working` showed while the launch ran. After it exited, `idle` from the same source was
ignored, and again ten seconds later; `pane release-agent` ended the state. The control: the
same reports around `sleep`, which Herdr does not take for an agent, and there `idle` was
accepted at once. So a host reports `working` and releases; it never reports the end as idle.

**A launch reports into whatever pane its environment names.** Herdr's claude integration sent
a session's id to the pane named in `HERDR_PANE_ID`, though the process ran outside that pane.
A background launch inherits its caller's `HERDR_PANE_ID`, so without a host a lane started
from a coachman's pane puts its session on the coachman's pane, and each coachman leg its
session on the postmaster's.

**A headless harness does not title its pane.** With its output redirected, `claude -p --name`
names the session for the resume picker and writes no title: the pane kept the title it had
set for itself throughout, and the harness's streams held no escape byte. The host sets the
title.

**The tree Herdr can draw today is by worktree.** A worktree opened with `herdr worktree open
--workspace <repository's space>` is a linked worktree of that repository, whose own space is
its source, and the repository's space cannot be closed while it is open
(`workspace_group_close_required`).

## What changed because of it

`scripts/run host` runs each launch in a pane of its worktree's space, gives it that pane's
identity in place of its caller's, reports it `working` as it starts and releases it on exit,
and titles the pane with the launch's name. `skills/postmaster/hosts.md`
records the forms. Landed with issue #10.

## What would overturn it

A Herdr release that classifies a headless harness correctly by itself, or that accepts a
closing `idle` after an agent has run in the pane: rerun the probe against it. The pane-identity
finding holds for any integration that reports by `HERDR_PANE_ID`, and would change only if
Herdr resolved the pane from the process instead.

## Open

- codex, grok and agy: Herdr's documentation gives each of them screen detection for state, so
  they are expected to be misread the same way; pi's state comes from its own hooks when its
  integration is installed, and may be read correctly. Unverified: from the documentation, not
  tried.
- A parent link between agents
  ([herdrdev/herdr#3153](https://github.com/herdrdev/herdr/issues/3153)) is planned upstream and
  proposed for `herdr agent start` (unverified: a proposal, not a release). Whether it will reach
  an agent a host reports, rather than starts, decides whether a lane can sit under its
  coachman without becoming an interactive agent.
