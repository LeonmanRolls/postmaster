# Workhorse summary: 38 Run the bug review through each harness's own code-review skill

## Commits

- `1ef8548` workhorse spec for running the bug review through each harness's own code-review skill
- `d9ea9bc` run the bug review through each harness's own code-review form
- `11153c8` normalize each harness's code-review output to the finding contract
- `ec30905` the bug lens runs only harness code-review skills, and no reviewer runs the gate
- `7889ab3` wiki records the bug lens and each code-review form's needs
- `33ed96d` control through launch.sh review, and normalize the reports it produced
- `1ac58fd` keep the code-review-launch trial's streams out of git's sight

## What I built

- **`skills/postmaster/harnesses.md`** — Own review skills now covers code-review as well as
  security-review: every harness, whether it has a skill, the source for the answer, and for
  each form the command, how the change from BASE is given, the level, what the findings look
  like, whether known findings can be given, and where the harness keeps the review's own tool
  calls.
- **`scripts/launch.sh review <lane> <cwd> <base>`** — runs that form on the change from
  `<base>` to the scratch's HEAD, events to stdout as `launch` does, with `--last` and `--run`.
  `max` for claude and codex, `high` for MiMo Code, whatever the lane's effort is. Exit 3 for
  a harness with no form. `skill <lane> code-review` is the yes/no query.
- **`scripts/review-forms.sh`** — the one list of who has a code-review form, used by
  `launch.sh`, `reviewers.sh` and `setup.sh`.
- **`scripts/review-findings.sh`** — turns each form's report into the finding contract
  (file, line, severity, confidence, title, body, evidence), marking a field the harness did
  not give as `not provided`. Self-test has positive controls from the recorded trial and the
  control, and negative controls: no findings yield none, unparseable output fails loudly.
- **`skills/postmaster/coachman.md`** — the bug lens launches only through `launch.sh review`,
  writes no bug brief, and has no fallback; harvest keeps claude's forked task output file;
  the brief template no longer invites the full gate; the coachman runs the gate once per
  round on the snapshot; a reviewer checks a finding with a targeted probe.
- **`scripts/reviewers.sh`** — the waybill's `bug reviewers:` line is always printed and holds
  only the configured bug reviewers whose harness has a form.
- **`scripts/setup.sh`** — names each bug reviewer whose harness has none, and warns when none
  of them has one.
- **`skills/postmaster/postmaster.md`** — pre-flight refuses a run whose turnpikes include the
  bug review and whose config gives it no form-capable bug reviewer, saying why.
- **`wiki/concepts/own-review-skills.md`** and `wiki/index.md` — the bug lens, what each form
  needs, citing `raw/trials/code-review-scope/` and `raw/trials/code-review-launch/`.
- **`raw/trials/code-review-launch/`** — criterion 9's positive control through
  `launch.sh review`, with reports and normalized findings.

## Checks

`/home/brindlewick/postmaster/scripts/verify.sh run .` printed, just before this summary was
written:

```
gate: pass, exit 0, 405s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

Other commands run, with their exit codes:

| command | exit |
|---|---|
| `scripts/review-forms.sh --self-test` | 0 |
| `scripts/review-findings.sh --self-test` | 0 |
| `scripts/launch.sh --self-test` | 0 |
| `scripts/reviewers.sh --self-test` | 0 |
| `scripts/setup.sh --self-test` | 0 |
| `scripts/skill-refs.sh` | 0 |
| `scripts/wiki-lint.sh` | 0 |
| `bash -n` on every `scripts/*.sh` | 0 |
| `scripts/review-findings.sh claude raw/trials/code-review-launch/opus-report.md` | 0 |
| `scripts/review-findings.sh codex raw/trials/code-review-launch/luna-last.md` | 0 |
| `scripts/review-findings.sh mimo raw/trials/code-review-launch/mimo-report.md` | 0 |
| criterion 9 check: claude normalized finding at `src/page.js:8` | HIT |
| criterion 9 check: codex normalized finding at `src/page.js:8` | HIT |
| criterion 9 check: mimo normalized finding at `src/page.js:8` | HIT |

Three earlier full-gate runs failed only in `host.sh`'s or `review-round.sh`'s timing controls
(a pane closed mid-run, a space closed, a wait's deadline) and once in `style-findings.sh`'s
hadolint control while the machine was running other postmaster runs; `host.sh --self-test`
and `style-findings.sh --self-test` each passed every time they ran alone. Per the waybill's
word, those are load flakes, not this change's. The run above is completely clean.

## Decisions I made for myself

1. **Which harnesses have a code-review skill:** claude `/code-review`, codex `codex exec
   review`, mimo `/review`. pi and muse have none (their help / `muse skills list`). grok's
   documentation lists none. agy's is not recorded. Recorded per harness with its source in
   `harnesses.md`.
2. **`launch.sh skill <lane> code-review` is the query** for "has a review form" (exit 0 / 3),
   backed by `review-forms.sh` as the one table so three callers do not each carry a copy.
3. **`launch.sh review` builds the form itself** from `<lane> <cwd> <base>`: claude's prompt is
   `/code-review max <BASE>...HEAD` on its launch form; codex is `exec review --base` with its
   launch-form flags and `model_reasoning_effort="max"`; mimo is its launch form with
   `--command review --variant high` and `<BASE>...HEAD` in a prompt file written into the
   scratch (mimo appends stdin to its free-text arguments). Level is forced to the top.
4. **Finding contract fields:** `file`, `line`, `end_line`, `severity`, `confidence`, `title`,
   `body`, `evidence`. Missing harness fields are `not provided`, never invented. Output is
   JSON lines so the coachman can read it without a new prose format. Exit 3 when the text
   looks like a review with findings that cannot be parsed.
5. **The waybill always prints `bug reviewers:`**, filtered to form-capable lanes, even when
   empty, so `reviewers.sh lanes` never falls back to `reviewers:` for bug. The pre-flight
   refuses before a run is dispatched with an empty one.
6. **Harvest copy is a short runbook step**, not a script: the path is already in the stream
   and the copy is one `cp`, matching how the rest of harvest is written. The control's
   `apparatus/run.sh` does the same copy and kept 24 task files; one is published as a sample.
7. **"The one brief left, the style lens's"** is read as the shared brief template (style and
   security fallback). The wording change sits in that one template and in Lane capability, so
   no remaining brief invites the full gate. Security lens's launch shape is unchanged.
8. **Criterion 9's control** ran live through `launch.sh review` at max/high on a `trunk`
   fixture with the planted bug in the first of two commits. The first normalize pass failed on
   two report shapes (claude's fenced JSON array; mimo's Bug heading with the path in the
   body); both are now in the normalizer and its self-test, and re-normalizing the same
   reports yields the finding at `src/page.js:8` for all three. That re-normalize is the
   check; the reviews themselves are the recorded reports.
9. **The new scripts' `--self-test` is not in the frozen 31-name gate list** (the waybill's
  gate is fixed at BASE's list). They are run as their own checks above and will be picked up
  when #17 gives the repo a real gate.

## What I did not do, and why

- **Did not compare skill reviews with brief-driven ones** — out of scope for this ticket;
  #37's fixture can measure it later.
- **Did not add a fallback brief for the bug lens** — the direction is explicit: a lane whose
  harness has no review form does not review for bugs at all.
- **Did not lower review effort** — the direction is max for now; lowering is a later
  experiment.
- **Did not publish the events streams or all 24 forked task files** — they may name this
  machine's paths. Reports, normalized findings and one sample task file are what
  `code-review-launch` publishes, per its `method.md` and `.gitignore`.
- **Did not change the number of review rounds** — #60's cap and `review-convergence.md`'s
  one round of bug review with triage stay as they are.

## Verdict on the acceptance criteria

| # | met? | how |
|---|---|---|
| 1 | yes | `harnesses.md` Own review skills records every harness it covers with a source (trial, help or documentation) |
| 2 | yes | each form records command, change from BASE, level, findings shape, known findings and where tool calls live |
| 3 | yes | `launch.sh review` runs that form on `<base>`...HEAD, writes the stream to stdout, takes `--last`/`--run`, forces max/high, exits 3 with no form (self-test) |
| 4 | yes | bug lens launches only form-capable lanes via `launch.sh review`, same snapshot, own worktree scratch; no bug brief; style and security unchanged |
| 5 | yes | `reviewers.sh lines` filters the waybill's bug line; `setup.sh` names and warns; `postmaster.md` pre-flight refuses with a reason |
| 6 | yes | `review-findings.sh` maps each report to the finding contract; missing fields are `not provided` |
| 7 | yes | self-test: positive controls at file and line for each harness; empty/clean yield none; unparseable exits 3 |
| 8 | yes | harvest copies claude's `task_notification` output file into the run's logs; the control kept 24 and one is published |
| 9 | yes | live control through `launch.sh review` at max/high on a `trunk` fixture with the bug in a non-last commit: all three harnesses yield a normalized finding at `src/page.js:8` |
| 10 | yes | `wiki/concepts/own-review-skills.md` covers the bug lens (no form ⇒ no bug review), what each form needs, citing `code-review-scope/` and `code-review-launch/` |
| 11 | yes | no brief invites the full gate; coachman runs it once per round on the snapshot; reviewers use targeted probes |
