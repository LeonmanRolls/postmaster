# Workhorse summary: 81 A planning stage: each workhorse's spec passes the user's review before any code

## Commits on `wb/81-mimo`

- `a8a5f15` Add workhorse spec for a planning stage before code (`WORKHORSE-SPEC.md` alone, first)
- `6e35178` Add a planning stage: specs pass the user's review before any code (`scripts/stage.sh`, `scripts/log-action.sh`, `scripts/runs-status.sh`, `scripts/run-times.sh`, `scripts/setup.sh`, `config.example.toml`, `skills/postmaster/coachman.md`, `skills/postmaster/postmaster.md`, `skills/postmaster/workhorse-spec-template.md`)
- `1859db9` Record the planning stage in the wiki, from the SDLC playbook (`raw/articles/ai-native-sdlc-playbook/`, `wiki/concepts/planning-stage.md`, `wiki/sources/ai-native-sdlc-playbook.md`, `wiki/concepts/workhorse-spec.md`, `wiki/index.md`, `wiki/sources/index.md`, `wiki/log.md`)
- `e347354` Tick the planning-stage spec tasks
- (this summary)

## Checks

What `/home/brindlewick/postmaster/scripts/verify.sh run .` printed just before this summary was written, from the worktree root:

```
gate: pass, exit 0, 732s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane review-decide review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

One line per check the brief names:

- gate: the stand-in gate above; exit 0. Shows the project's gate passes.

Every other command run, with its exit:

| Command | Exit |
|---|---|
| `bash scripts/stage.sh --self-test` | 0 (all controls behaved; includes the new planning controls) |
| `bash scripts/log-action.sh --self-test` | 0 (all controls behaved; includes the new `spec-review` controls) |
| `bash scripts/runs-status.sh --self-test` | 0 (all controls behaved; includes the new `SPEC` controls) |
| `bash scripts/run-times.sh --self-test` | 0 (all controls behaved; includes the planning row) |
| `bash scripts/wiki-lint.sh` | 0 |
| `bash scripts/skill-refs.sh` | 0 |
| `bash scripts/host.sh --self-test` (alone, after a gate fail) | 0 |
| `bash scripts/review-round.sh --self-test` (alone, retries) | 0 on a quiet moment; 3 controls misbehaved while load was 34 |
| `verify.sh run .` (first run) | 1: `host.sh` control "a reviewer's scratch clone gets a window in the session of the repository it was cut from"; `host.sh` is not in this diff and its self-test passed alone |
| `verify.sh run .` (second run) | 1: three `review-round.sh` timing/teardown controls; `review-round.sh` is not in this diff |
| WebFetch of https://claude.com/blog/the-ai-native-sdlc-playbook | 0; text captured, not invented |

The two failed full gates were load flakes in `host.sh` and `review-round.sh` self-tests, the kind the waybill names, on a box with load average 34 and several other gates running. Neither script is in this diff. The third run, the one above, was completely clean.

## Decisions

Within-brief questions I decided for myself:

1. **Stage name and place.** `planning`, between `bootstrapped` and `workhorses-running`, covering draft + user review + revisions, so one stage's span is the planning cost.
2. **Who presents.** The postmaster alone, never the coachman; criterion 2 names the postmaster's interactive session. The coachman pauses on a marker like a card.
3. **Pause marker.** `.spec-review-ready` with package `spec-review.md`; the postmaster writes `spec-decisions.md` and resumes the coachman. Uniform with checkpoint cards and escalations.
4. **Poll state.** `SPEC` in `runs-status.sh` when `.spec-review-ready` is present (after USER/RULE/GATE, before DISPATCH).
5. **Decision log verb.** `spec-review` in `log-action.sh`, target the lane, detail opening `approved|changes|dropped`, then the spec commit, then the user's words. Enforced like a finding's class.
6. **Config key.** `planning.review_link`, optional, `{path}` = absolute path of `WORKHORSE-SPEC.md` in that workhorse's worktree; empty template sends the path alone. A revision is a new package entry at the new commit. Placed in `config.example.toml` and `setup.sh` beside `ship.review_link`, so the private host stays in machine config.
7. **Workhorse planning exit.** Committed spec is the harvest signal; `WORKHORSE-BLOCKED.md` still means blocked; anything else is died mid-flight. `WORKHORSE-SUMMARY.md` stays the final act of the whole workhorse.
8. **Two-approved rule.** Implementation starts only when every live workhorse is approved or dropped and at least two are approved; otherwise the run stops and says why. Never implement from an unapproved plan.
9. **Drop.** Dropped is out: no resume to implement, `outcome: dropped`, worktree torn down at aftercare.
10. **Revision loop.** The coachman resumes the one workhorse with the user's words only; the revised spec is a new commit (the first is never rewritten) and comes back as a new package entry.
11. **Planning is inside leg 1,** with the same pause-and-resume shape as escalations; the leg table lists planning under leg 1. No new leg.
12. **Blind acceptance tests** are written before any spec's content is read; the review package is built from path and commit alone, so the tests stay blind.
13. **Article capture.** `raw/articles/ai-native-sdlc-playbook/` with `source.md` (url, retrieved, title, author) and `passages.md` quoting only what the wiki relies on, including "Design review happens before any code is generated". Fetched successfully; text is quoted from the capture.
14. **Wiki page name.** `wiki/concepts/planning-stage.md`, standing `claimed`, citing `[@articles/ai-native-sdlc-playbook]`. Outside work motivates it and moves no standing.

## Not done, and why

- **No fixture run.** `AGENTS.md` requires a fixture run scoring clean before a coachman-contract change merges. That is a merge gate for the coachman and postmaster, not a workhorse check; this run's check is the gate. The fixture will score `planning` because it reads stages from `scripts/stage.sh --list`.
- **No per-ticket switch to skip planning.** Out of scope in the ticket.
- **The coachman does not check code against a spec.** #29's other decision stands; nothing here adds it.
- **No new script.** Planning uses the existing `stage.sh`, `log-action.sh`, `runs-status.sh` and `run-times.sh`; no name was added to the gate's self-test list.

## Verdict on the acceptance criteria

1. **Met.** `scripts/stage.sh` has `planning` before `workhorses-running`; the coachman plan-only brief has each workhorse commit `WORKHORSE-SPEC.md` and stop before any code.
2. **Met.** `postmaster.md` Spec review puts one spec to the user at a time and records approved, changes in the user's words, or dropped, each as a `spec-review` line.
3. **Met.** A `changes` resume sends the one workhorse back to revise from the user's words on its own thread; the revised spec returns as a new package entry; a hard rule says no code until approval.
4. **Met.** The user may drop a workhorse; implementation needs two approved specs; otherwise the run stops and says why.
5. **Met.** Each decision is a `spec-review` line through `log-action.sh` as it happens, carrying the decision and the commit; the approved commit also lands in `spec-decisions.md` and as `lanes.<lane>.spec_commit`.
6. **Met.** The planning stage has self-test controls (set, order, refuse); `run-times.sh` times every stage from the log, including a planning row in its self-test, so the review span shows.
7. **Met.** `wiki/concepts/planning-stage.md` at `claimed` explains the stage and cites the playbook, captured into `raw/articles/ai-native-sdlc-playbook/`; `workhorse-spec.md` no longer says nobody reviews it and points at the planning page.
8. **Met.** The link is `planning.review_link` with `{path}` filled from the spec file's absolute path, or the path alone when no template is set; a revision is a new entry at its new commit.

My verdict: all eight criteria are met. The gate is green on a completely clean run. The coachman contract changed, so a fixture run should score clean before merge, and it lands with no run in flight as the ticket requires.
