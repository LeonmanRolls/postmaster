# Workhorse spec: 38 Run the bug review through each harness's own code-review skill

## Summary

The bug review must run each harness's own code-review skill on the run's change from BASE to
the snapshot, never postmaster's bug brief, and never a diff the skill chooses for itself.
Lanes whose harness has no such skill do not review for bugs at all. Build on #66's shape: an
Own review skills section in `harnesses.md`, a form in `scripts/launch.sh`, the ordinary
worktree scratch, and a normalizer so the coachman's dedup and verification stay as they are.

## Technical context

- **Language and version**: bash with Python 3.11 heredocs (the repo's script style); markdown
  runbooks.
- **Dependencies used or added**: none new. Existing scripts (`launch.sh`, `reviewers.sh`,
  `setup.sh`, `cut-scratch.sh`, `log-action.sh`) and the live harnesses (claude 2.1.283,
  codex 0.157.1, MiMo Code 0.1.15) for the positive control.
- **Testing**:
  - `bash -n` on every script.
  - `scripts/launch.sh --self-test`, extended for `review` and `skill … code-review`.
  - `scripts/review-findings.sh --self-test` (positive and negative controls on recorded output).
  - `scripts/reviewers.sh --self-test`, `scripts/setup.sh --self-test` for the bug-reviewer filter.
  - The waybill's gate, from the worktree root.
  - `/home/brindlewick/postmaster/scripts/verify.sh run .`
  - Criterion 9's live control: a worktree scratch of a fixture whose default branch is `trunk`,
    planted bug in the first of two commits, each harness through `launch.sh review` at its top
    level, normalized findings at the bug's file and line.
- **Constraints**:
  - Every form names the change from BASE; no skill chooses its own diff.
  - Reviews run at each harness's top level (`max` claude/codex, `high` MiMo Code), whatever
    effort the lane is configured at.
  - Style and security lenses unchanged in structure; the bug brief goes.
  - No reviewer runs the project's gate; the coachman runs it once per round on the snapshot.
  - Harness-specific facts live in `harnesses.md` / `scripts/launch.sh` only.
  - A prompt lives in argv or `--prompt-file`; never match a process on prompt text.
  - Every count has a control (positive and negative).
  - Never push; work only in this worktree.

## Direction check

| Direction / project rule | How this plan meets it |
|---|---|
| Run each harness's own code-review skill for the bug review where it has one | `launch.sh review` builds each skill's own form; the bug lens launches only through it |
| Keep the skill's own method; do not wrap it in postmaster's bug brief | No bug brief is written; the prompt is the skill's own invocation with a named range |
| Never let a skill choose its own diff | Every form names `<BASE>...HEAD` or `--base <BASE>` (trial: named range reviewed exactly the change) |
| Reviews at max effort / harness top level | `launch.sh review` forces `max` / `high`, ignoring the lane's configured effort |
| Build on #66's shape | Own review skills section, `launch.sh` form, worktree scratch (a named range needs no clone) |
| Normalize findings afterwards in a script | `scripts/review-findings.sh`; coachman dedup/verification unchanged |
| Lane with no review form does not review for bugs; bug brief goes | Bug lens filters lanes; no `review-bug-brief.md` |
| Coachman runs the gates; code review is the skill | Brief template stops inviting the full gate; coachman runs gate once per round |
| A prompt lives in argv / `--prompt-file` | claude prompt through launch form's argv; mimo range in its prompt file (stdin); codex `review --base` is argv |
| Every count needs a control | review-findings self-test positive/negative; launch.sh review exit 3 control; criterion 9 live positive control |
| Nothing harness-specific outside an adapter | All forms in `launch.sh` + `harnesses.md`; runbooks say only "review form" |
| Script paths in `skills/postmaster/` go through `<tool>` | `scripts/skill-refs.sh` after runbook edits |
| Deterministic work in `scripts/` | Filtering, launching, normalizing are scripts, not prose |

## Structure

- `skills/postmaster/harnesses.md` — Own review skills: code-review table (every harness),
  each form (command, range, level, findings shape, known findings, where tool calls are).
- `scripts/launch.sh` — `skill … code-review` query; `review <lane> <cwd> <base> [--last]
  [--run]`; self-test.
- `scripts/review-findings.sh` — new: harness review output → finding contract; `--self-test`.
- `scripts/reviewers.sh` — bug-lens lanes filtered to those whose harness has a review form;
  self-test.
- `scripts/setup.sh` — name bug reviewers whose harness has none; warn when none has one;
  self-test.
- `skills/postmaster/coachman.md` — bug lens launches via `launch.sh review`, no bug brief;
  harvest copies claude's task output file; brief template stops inviting the full gate;
  coachman runs the gate once per round on the snapshot.
- `skills/postmaster/postmaster.md` — pre-flight refuses a bug turnpike with no form-capable
  bug reviewer, saying why.
- `skills/postmaster/SKILL.md` — waybill Team template: bug reviewers line is the filtered list.
- `wiki/concepts/own-review-skills.md` — bug lens, what each skill needs, trial + control cites.
- `wiki/index.md` — catalog line if needed.
- Recorded criterion-9 control output under `raw/trials/` (new directory or beside the
  existing trial), cited from the wiki page.

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| New script `review-findings.sh` rather than parsing in the coachman | AC6–AC7 require a script with its own controls; coachman prose cannot carry positive/negative controls | Parsing in the runbook is re-derived every run and untestable |

## Decisions

1. **Which harnesses have a code-review skill** (from the trial and each help): claude
   (`/code-review`), codex (`codex exec review`), mimo (`/review` / `mimo run --command
   review`). pi and muse: none (their help / built-in skills). grok: none in documentation.
   agy: not recorded. Source is recorded per harness in `harnesses.md`.
2. **`launch.sh skill <lane> code-review`** is the single query for "has a review form"
   (exit 0 / 3). `reviewers.sh`, `setup.sh` and the pre-flight use it so the table lives in
   `launch.sh` only. `setup.sh` checks through a throwaway config naming the lanes being
   written, since it has no config yet.
3. **`launch.sh review <lane> <cwd> <base>`** builds the form in argv (no prompt file the
   coachman has to write): claude's prompt is `/code-review max <BASE>...HEAD` through its
   launch form; codex is `codex exec review --base <BASE>` with its launch-form flags and
   `model_reasoning_effort="max"`; mimo is its launch form with `--command review` and
   `<BASE>...HEAD` in the prompt file (a temp file the script writes, since mimo appends
   stdin to free-text arguments). Level is forced to the top, not the lane's effort.
4. **Finding contract fields** for the normalizer: `file`, `line` (optional `end_line`),
   `severity` (`P1`/`P2`/`P3` or `not provided`), `confidence` (or `not provided`), `title`,
   `body`, `evidence` (or `not provided`). Security-only `exploit_path` is out of scope for
   the bug lens but the field is `not provided` when absent so the contract shape is stable.
5. **Normalizer input** is a lane's final message (last result line / `-o` file / last text
   event), with optional structured extras (codex `review_output` lines already recorded).
   Output is JSON lines, one finding per line, so the coachman can read it without a new
   prose format. Exit 3 when the text is clearly a review report with finding-like markers
   that cannot be parsed (never a clean empty review); exit 0 with zero lines when the
   report says there are no findings or carries none.
6. **Waybill**: `reviewers.sh lines` always emits a `bug reviewers:` line with only
   form-capable lanes (possibly empty). `reviewers.sh lanes` therefore never falls back to
   `reviewers:` for bug when that line is present. Empty means the round has no bug
   reviewers; the pre-flight refuses before dispatch so this is not reached in a real run.
7. **Harvest (AC8)**: in `coachman.md` harvest, for a claude lane, copy each
   `task_notification`'s `output_file` into `<dispatch>/logs/` (the deterministic copy is a
   short snippet in the runbook beside the existing harvest prose, consistent with how the
   trial's `record.py` names the files). A script is not needed: the path is already in the
   stream and the copy is one `cp`.
8. **Gate invitation (AC11)**: the brief template's "may run … including the full gate suite"
   becomes "run targeted probes for its own findings, never the project's full gate"; the
   coachman runs the project's gate, lint, build and tests once per round on the snapshot
   (before fixes and again after applying them, as now). "The one brief left, the style
   lens's" means the shared brief template (style and security fallback); the wording change
   sits in that one template so every remaining brief is covered. Security lens's launch
   shape is unchanged.
9. **Criterion 9 control** is run live against claude, codex and mimo through
   `launch.sh review` at max/high, using the trial's fixture shape (default branch `trunk`,
   bug in the first of two commits). Output is recorded under `raw/trials/` and cited from
   the wiki. Where a harness is not usable in this environment, the control records that
   instead of inventing a pass.
10. **New script's self-test is not added to the frozen 31-name gate list** (the waybill's
    gate is fixed at BASE's list). It is run as its own check in `WORKHORSE-SUMMARY.md` and
    will be picked up when #17 gives the repo a real gate.

## Tasks

- [ ] T001 [P] Write `WORKHORSE-SPEC.md` and commit it alone.
- [ ] T002 [AC1] [AC2] Record every harness's code-review skill and its review form in
  `skills/postmaster/harnesses.md` (Own review skills), with sources.
- [ ] T003 [AC3] Add `launch.sh review <lane> <cwd> <base>` and `skill … code-review` to
  `scripts/launch.sh`, with self-test controls (exit 3 for no form; level forced).
- [ ] T004 [AC6] [AC7] Add `scripts/review-findings.sh` (normalize) with positive controls
  (each harness's recorded output → findings at file and line) and negative controls
  (no findings → none; unparseable → loud failure).
- [ ] T005 [AC4] [AC11] Change `skills/postmaster/coachman.md`: bug lens only via
  `launch.sh review`, no bug brief, no full gate for any reviewer, coachman runs the gate
  once per round; harvest copies claude's task output file (AC8).
- [ ] T006 [AC5] Filter bug reviewers in `scripts/reviewers.sh` (waybill line), warn in
  `scripts/setup.sh`, refuse at pre-flight in `skills/postmaster/postmaster.md`; waybill
  template in `skills/postmaster/SKILL.md`.
- [ ] T007 [AC9] Run the criterion 9 positive control through `launch.sh review` on a
  `trunk` fixture with the bug in a non-last commit; record it under `raw/trials/`.
- [ ] T008 [AC10] Update `wiki/concepts/own-review-skills.md` (bug lens, what each skill
  needs, trial and control cites) and `wiki/index.md` if needed.
- [ ] T009 [AC-all] Run `skill-refs.sh`, `wiki-lint.sh`, every touched self-test, the
  gate and `verify.sh run .`; write `WORKHORSE-SUMMARY.md` and commit.
