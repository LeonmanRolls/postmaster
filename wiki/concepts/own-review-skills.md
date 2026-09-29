---
title: A lane may review through its harness's own skill
type: concept
standing: claimed
sources: [trials/claude-security-review, trials/code-review-scope, trials/own-review-skills-control]
updated: 2026-09-29
---

# A lane may review through its harness's own skill

**Claim.** The flow uses a harness's own review form where one is recorded, and gives that form
the run's exact base-to-snapshot change. Under the bug lens, a harness with no code-review form
does not review and receives no brief fallback. This is the chosen review method; it does not
claim that native skills find more or better bugs than a shared brief. The security lens keeps
its earlier brief fallback for harnesses without a security skill.

**Standing: claimed.** No run has compared native bug reviews with brief-driven reviews on the
same snapshot. The recorded controls establish which change each native form reviews and whether
it reports the planted finding, not comparative review quality.

## The reasoning

- **A harness's makers tune its skill for their own model.** A skill carries its maker's
  prompt, and Claude Code's also filters its own false positives with verification agents.
  postmaster's brief is one prompt written for every harness (unverified: no run has compared
  the two).
- **The lane stays independent.** The skill runs in the lane's own scratch, on the same
  snapshot as every other lane, and the coachman verifies its findings like anyone else's. So a
  finding it shares with another lane still counts as corroboration by lane, as
  [combining models](combining-models.md) needs.
- **The user chooses the lanes.** Since #63 a lens may have its own reviewer lanes (see
  [the review loop](review-loop.md)), so a lane can be added to one lens for its skill alone.
- **The two lenses have different fallback rules.** Security keeps a brief for a harness without
  a security skill. Bug review has no brief; unsupported harnesses are left out of the waybill's
  bug reviewer list and an empty eligible list stops dispatch.

## What it costs

- **The brief's context does not reach a skill.** A skill may report a known bug finding again;
  the coachman deduplicates it. It may also miss something the shared brief would have named.
  Verification can reject a finding, but cannot add one a skill never looked for.
- **Its report is not the finding contract.** Claude Code's gives each finding a file and line,
  a severity, a category, an exploit scenario and a confidence
  [@trials/claude-security-review/clone.txt]. It has no P1 to P3, and does not say whether a
  finding was verified by running something. Bug review reports vary by harness; the normalizer
  records missing fields as `not provided`, and the coachman verifies the finding.
- **A skill has its own assumptions about the repository.** Review scope must be explicit, as the
  code-review trial shows. Claude Code's security skill also needs `origin/HEAD`, below.

## The bug lens's code-review forms

The scope trial used a detached scratch with no upstream, a `trunk` default branch, and a bug in
the first of two commits. The three supported forms each reported the bug at its file and line
when given the base-to-HEAD range. With no target, Claude first reviewed only the last commit,
Codex stopped before a model call, and MiMo Code reviewed no changes but exited successfully
[@trials/code-review-scope/method.md]. A later control ran the `launch.sh review` adapter at each
harness's configured top level in the same shape of scratch. Claude Code 2.1.284 at `max`, Codex
CLI 0.157.1 at `max`, and MiMo Code 0.1.15 on MiMo V2.6 Pro at `high` each produced a normalized
finding at the planted bug's file and line. One MiMo invocation on the control snapshot reported
a finding at line 8; a repeat on the identical snapshot reported line 10, the planted line. This
is one positive result per form, not a repeatability estimate
[@trials/own-review-skills-control/method.md].

| harness | change and level | report and known findings | tool-call record |
|---|---|---|---|
| Claude Code | `/code-review max <BASE>...HEAD`; `launch.sh` also sets effort `max` | JSON array at max; severity is not provided. Extra instructions become part of the target, so known findings are not appended. | The forked task's tool calls and output are in the task file named by `task_notification`; harvest copies that file into run logs. |
| Codex | `codex exec review --base <BASE>`; `launch.sh` sets reasoning effort `max` | `--last` message has `[P<n>]` bullets, while its session has structured `review_output`. A custom prompt replaces `--base`, so known findings are not passed. | JSON event stream and the Codex session rollout. |
| MiMo Code | `mimo run --command review`; the prompt file supplies `<BASE>...HEAD`, at variant `high` | Free markdown; known findings are not passed and coachman deduplication handles repeats. | Tool calls stream inline under the parent session id. |

The level, scope, parsing and launch details are recorded in
[`harnesses.md`](../../skills/postmaster/harnesses.md). No comparison with brief-driven review is
in scope for #38.

## What Claude Code's skill needs

Launched as the flow launches a reviewer lane, with the prompt `launch.sh skill` prints,
Claude Code 2.1.283's `/security-review`:

- in a scratch clone whose `origin/HEAD` leads back to the base, reported the planted command
  injection at its file and line, severity High, in both runs
  [@trials/claude-security-review/clone.txt] [@trials/claude-security-review/clone-first.txt];
- in a worktree scratch where `origin/HEAD` did not resolve, exited 0 with one `success` result,
  0 turns and empty text, having reviewed nothing [@trials/claude-security-review/worktree.txt].
  Read as a verdict, that is a clean review;
- in one run of two, verified its findings in background agents and ended with three result
  lines, the report on the last [@trials/claude-security-review/clone-first.txt]. The harvest
  reads a lane's last result line, so it gets the report either way.

A worktree cannot hold an `origin/HEAD` of its own. Remote-tracking refs are shared by every
worktree of a repository, as git's worktree documentation says (unverified here). A clone of
the target has one, the branch the target has checked out, which is the default branch at the
run's base until another run merges. So the security lens reviews from clones cut with
`scripts/cut-scratch.sh --clone <BASE>`, every lane of it, so that which lane runs a skill never
decides what its scratch is. The cut, and the check before each launch, refuse a clone whose
`origin/HEAD` does not lead back to BASE. Another run's merge moves `origin/HEAD` on but leaves
the merge base where it was, so the skill still reviews exactly the run's change.

## What would settle it

Runs in which a security lane runs its harness's skill beside lanes on the brief, on the same
snapshots:

- per lane, the findings reported, and how many survive the coachman's verification;
- the surviving findings only a skill lane reported, and those only a brief lane reported;
- the project-specific surfaces a brief lane covered and a skill lane missed.

A fair comparison needs the same model on both: one claude lane on the skill and one on the
brief, which a config can set up with two lanes on one model. The claim is weakened if a skill
lane's surviving findings are routinely a subset of the brief lanes' on the same model. It is
refuted if they survive verification less often than the same model's findings on the brief.

## What changed because of it

`scripts/launch.sh skill <lane> security-review` prints the prompt that invokes a lane's
harness's own security skill, and exits 3 for a harness with none. `scripts/launch.sh review`
runs an eligible bug lane's own code-review form with the range named. `skills/postmaster/harnesses.md`
records which harnesses have each form, and where each answer came from. The coachman launches a
security lane through its skill where it has one, and from the brief otherwise; a bug lane with no
code-review form is not launched.
`scripts/cut-scratch.sh` cuts the security lens's scratches as clones, checks every scratch
before a lane is launched into it, tells a scratch from anything else, and removes a scratch of
either kind. `scripts/host.sh` hosts a clone in a space of its
own, which it closes like a worktree's.
