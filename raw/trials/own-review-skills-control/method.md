---
kind: trial
subject: whether each native bug-review form, launched and normalized by postmaster, reports a planted bug at its source line
date: 2026-09-29
---

# Method

**Question.** Does `scripts/launch.sh review` run each supported harness's own form at the
configured top level in a detached worktree scratch, and does
`scripts/review-findings.sh normalize` place a known bug at its file and line?

**Versions.** Claude Code 2.1.284 on the configured Opus 5.5 model; Codex CLI 0.157.1 on the
configured gpt-6-luna model; MiMo Code 0.1.15 on MiMo V2.6 Pro; git version 2.43.0. The MiMo
provider id is omitted. The launch adapter and normalizer are from the #38 worktree.

**Setup.** `fixture/` is a small Node project whose default branch is `trunk`, with no remotes.
BASE is `3de4ecb591d720102df13d51d2e72942240e17f8`; SNAP is
`825189e08e1c6482914211af182f114533186e16`. Four commits follow BASE. The first,
`698c4cf0f499a04563ef2ee9ea402013e87f96de`, introduces the off-by-one in
`src/page.js`; the last is not the bug-introducing commit. In SNAP, the extra `+1` is on line 10.

For each invocation, `git worktree add --detach` cut a fresh scratch at SNAP. The scratch kind
was checked with `scripts/cut-scratch.sh --kind`; `HEAD` was detached, `@{upstream}` did not
resolve, and the tracked tree was clean. BASE and SNAP were unchanged for all invocations.

Each harness was launched through
`scripts/launch.sh review <lane> <scratch> <BASE> --run <dispatch>`. The adapter set Claude and
Codex to `max`, and MiMo Code to variant `high`. Codex wrote its final message through `--last`;
Claude's task files were harvested from `task_notification` before normalization. Each report
was normalized through `scripts/review-findings.sh normalize` on its own scratch.

**Results.** Claude launch, harvest and normalization exited 0; its eight normalized findings
included `src/page.js:10`. Codex launch and normalization exited 0; its one normalized finding
was `src/page.js:10`. MiMo Code launch and normalization exited 0; a run on this same snapshot
normalized the off-by-one finding at `src/page.js:10`. One other MiMo invocation on SNAP produced
a normalized finding at line 8 and did not meet the positive location check; the successful
invocation was repeated on the identical SNAP and BASE. These are positive controls, not a
repeatability estimate.

The event streams and task transcripts are not included. They contain harness session and tool
context from this machine. The control retained only versions, commit ids, exit codes, finding
counts and normalized locations needed to check the result. Claude's harvest exit was 0; its
temporary copied task files were removed after the location check.
