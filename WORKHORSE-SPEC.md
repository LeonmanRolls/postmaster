# Workhorse spec: 81 A planning stage: each workhorse's spec passes the user's review before any code

## Summary

Every run gains a planning stage before implementation: each workhorse drafts its own
`WORKHORSE-SPEC.md` and stops, the postmaster puts each spec to the user one at a time as a
link into the workhorse's worktree, and no workhorse writes code until its own spec is
approved. Approvals, change requests and drops are logged as they happen; at least two
approved specs are needed to go on.

## Technical context

- **Language and version**: bash with Python 3.11+ heredocs, as the rest of `scripts/`.
- **Dependencies used or added**: none.
- **Testing**: `scripts/stage.sh --self-test` (planning stage controls),
  `scripts/log-action.sh --self-test` (`spec-review` verb), `scripts/runs-status.sh
  --self-test` (spec-review marker), `scripts/verify.sh run .` / the project gate over
  every named script's self-test, `scripts/wiki-lint.sh` for the wiki pages.
- **Constraints**: the coachman contract changes and lands with no run in flight; specs
  stay blind between workhorses (never shown to one another); the rest of the run stays
  headless and only the planning review is interactive; the spec format stays GitHub Spec
  Kit's plan and tasks; the link template's host is private so it lives in machine config;
  no per-ticket switch to skip planning; the coachman still does not check code against a
  spec.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Each workhorse still drafts its own spec, blind to the others | Planning briefs say draft and commit `WORKHORSE-SPEC.md` only; feedback is delivered one workhorse's thread at a time and never carries another's spec |
| The user reviews every spec before any code, in the postmaster's interactive session | The coachman pauses on `.spec-review-ready`; the postmaster alone talks to the user and records each decision |
| Review is for scope and correctness, not making the specs alike | The runbook says the user reviews one spec at a time and never sees one workhorse's spec beside another's |
| Feedback goes to one workhorse at a time; one workhorse's spec is never shown to another | Per-lane resume prompts carry only that lane's user words; `spec-review.md` is for the postmaster, not for lanes |
| The spec keeps GitHub Spec Kit's plan and tasks format | `workhorse-spec-template.md` is unchanged |
| Specs pass back via a code-server link, iterable; once agreed the workhorses implement from them | Link from `planning.review_link` with `{path}`, a new link and commit on each revision; approved workhorses are resumed to implement |
| Weaker models gain most; faults are cheapest at planning | The whole stage exists to put the plan in front of the user before code |
| This reverses part of #29 (nobody reviews the spec); #29's other decision stands (coachman does not check code against the spec) | `workhorse-spec.md` and `coachman.md` stop saying the spec is unreviewed; no step makes the coachman compare code to spec |
| #9's own-spec level becomes reviewed specs; whether review makes specs converge becomes a measure | Noted on the wiki decision page and on `workhorse-spec.md`'s test |
| User's review time is the main cost; stage timings show it | `planning` is a stage; `run-times.sh` times it from the log with no change |
| Coachman contract change: new stage and a pause for the user; lands with no run in flight | `coachman.md`, `postmaster.md` and `stage.sh` change together; the waybill/fixture contract reads stages from the script |
| Out of scope: per-ticket skip switch; coachman checking code against a spec | Nothing adds either |
| Link template's host is private to the machine → machine config, never a ticket | `planning.review_link` in `config.example.toml` / `setup.sh`, like `ship.review_link` |
| Deterministic work goes in scripts | Stage list, the `spec-review` action, and the spec-review NEXT state are scripts; runbooks only say when to call them |
| Every count needs a control | New self-tests: planning stage set/refused, `spec-review` written/refused, marker recognised and not confused with others |
| Every action logged as it happens | Each user decision is one `spec-review` line through `log-action.sh` at the moment it is given |
| A script path in runbooks goes through `<tool>` | New script references written as `<tool>/scripts/...` |
| Identity: brindlewick only; no AI attribution | Commits and wiki prose follow the standing instructions |

## Structure

- `scripts/stage.sh` — add `planning` to `STAGES` and self-test controls for it.
- `scripts/log-action.sh` — add the `spec-review` verb (decision, commit, user's words) and controls.
- `scripts/runs-status.sh` — `.spec-review-ready` as `SPEC` (or `PLAN`) in the poll, with controls.
- `scripts/setup.sh` — `planning.review_link?` key (template with `{path}`).
- `config.example.toml` — `[planning] review_link`.
- `skills/postmaster/coachman.md` — planning section in the workhorse contract and leg 1: plan-only launch, spec harvest, review package, pause, revision loop, the two-approved gate, implementation resume; stage order gains `planning`.
- `skills/postmaster/postmaster.md` — spec review in the interactive session: one spec at a time, decision, log, drop, the two-approved rule, resume the coachman with `spec-decisions`.
- `wiki/concepts/planning-stage.md` — new decision page, standing `claimed`, source the SDLC playbook.
- `wiki/concepts/workhorse-spec.md` — no longer "nobody reviews it"; points at the planning page; #9 measure updated.
- `raw/articles/ai-native-sdlc-playbook/` — `source.md` + `passages.md` capturing the playbook.
- `wiki/sources/ai-native-sdlc-playbook.md` — what it claims and what it would mean here.
- `wiki/index.md`, `wiki/log.md` — catalog and log entries.

## Complexity tracking

None. The direction check has no departure.

## Decisions

1. **Stage name and place.** `planning`, between `bootstrapped` and `workhorses-running`.
   It covers draft + user review + revisions, so one stage's span is the planning cost the
   ticket says the timings should show.
2. **Who presents.** The postmaster, never the coachman. Criterion 2 names the postmaster's
   interactive session; the coachman is headless and pauses on a marker like a card.
3. **Pause marker.** `.spec-review-ready` with package `spec-review.md`; postmaster writes
   `spec-decisions.md` and resumes the coachman. Same shape as checkpoint cards and
   escalations, so `runs-status.sh` and Stage D stay uniform.
4. **Poll state.** `SPEC` when `.spec-review-ready` is present (after USER/RULE/GATE, before
   DISPATCH), so a paused planning run is visible to the postmaster poll.
5. **Decision log verb.** `spec-review`, target the lane, detail `approved|changes|dropped
   <commit> <user's words>`. The approved commit is on that line and mirrored in
   `spec-decisions.md` and the manifest (`lanes.<lane>.spec_commit`).
6. **Config key.** `planning.review_link`, optional, `{path}` = absolute path of
   `WORKHORSE-SPEC.md` in that workhorse's worktree. Empty template → the path alone. A
   revision is presented as a new entry (same path, new commit) so the user opens the new
   file state.
7. **Workhorse planning exit.** Spec committed is the harvest signal; `WORKHORSE-BLOCKED.md`
   still means blocked; anything else is died mid-flight. `WORKHORSE-SUMMARY.md` remains the
   final act of the whole workhorse, after implementation.
8. **Two-approved rule.** Implementation starts only when every live workhorse is approved
   or dropped and at least two are approved. Otherwise the run stops and says why (postmaster
   to the user; only the user abandons).
9. **Drop.** A dropped workhorse is out of the run: no resume to implement; outcome
   `dropped` on the manifest; its worktree is torn down at aftercare with the others.
10. **Revision loop.** Coachman resumes the one workhorse with the user's words only; the
    revised spec is committed (new commit, same file) and comes back as a new package entry.
11. **leg 1 covers planning.** Planning is inside the synthesis leg's pause pattern (exit and
    resume), not a new leg; the leg table lists planning under leg 1.
12. **`spec-decisions.md` shape.** One stanza per lane: decision, commit, user's words. The
    coachman reads it on resume; it is the hand-off between the postmaster's review turn and
    the coachman's next action.
13. **Article capture.** `raw/articles/ai-native-sdlc-playbook/` with `source.md` (url,
    retrieved, title, author) and `passages.md` quoting only what the wiki relies on,
    including "Design review happens before any code is generated".
14. **Wiki page name.** `wiki/concepts/planning-stage.md`, standing `claimed`, citing
    `[@articles/ai-native-sdlc-playbook]`. Outside work motivates it and does not move the
    standing.

## Tasks

- [x] T001 [P] [AC1] Add `planning` to `STAGES` in `scripts/stage.sh` and self-test controls (set, refuse unknown, order).
- [x] T002 [P] [AC1] Write the planning section of `skills/postmaster/coachman.md`: plan-only brief, spec committed then stop, harvest shapes, and the stage order including `planning`.
- [x] T003 [P] [AC5] Add the `spec-review` verb to `scripts/log-action.sh` with self-test controls (written with decision+commit+words; unknown decision refused).
- [x] T004 [P] [AC8] Add `planning.review_link` to `config.example.toml` and `scripts/setup.sh` (`--keys`, ask, write).
- [x] T005 [AC2] [AC8] Coachman writes `spec-review.md` (lane, link from template or path, commit) and touches `.spec-review-ready`; `scripts/runs-status.sh` shows `SPEC` with self-test controls.
- [x] T006 [AC2] [AC3] [AC4] `skills/postmaster/postmaster.md`: put one spec at a time to the user, record approved/changes/dropped via `spec-review`, write `spec-decisions.md`, resume the coachman; revision loop and the two-approved rule; stop and say why when under two.
- [x] T007 [AC3] Coachman revision loop: resume the one workhorse with the user's words, harvest the revised spec, new link and commit; no code until approved; resume approved workhorses to implement.
- [x] T008 [AC4] Record drop and the two-approved gate in the runbook and manifest outcomes (`dropped`, `spec_commit`).
- [x] T009 [AC5] Record the approved commit on each `spec-review` line and in `spec-decisions.md` / manifest.
- [x] T010 [AC6] Timings: `run-times.sh` already times stages from the log; add a planning row to its self-test so the review span is covered.
- [x] T011 [P] [AC7] Capture the SDLC playbook into `raw/articles/ai-native-sdlc-playbook/` (`source.md`, `passages.md`).
- [x] T012 [AC7] `wiki/concepts/planning-stage.md` at `claimed` + `wiki/sources/ai-native-sdlc-playbook.md` + `wiki/index.md` + `wiki/log.md`.
- [x] T013 [AC7] Update `wiki/concepts/workhorse-spec.md`: the spec is reviewed before code; remove "nobody reviews it"; note #9's measure.
- [x] T014 [AC1] [AC3] Update the workhorse contract text in `coachman.md` and the brief contents so the planning stop and the post-approval implement resume are spelled out (T002/T007 land with this).
- [x] T015 [AC6] `scripts/verify.sh run .` / gate green, including new self-tests; `scripts/skill-refs.sh` clean after runbook edits.
