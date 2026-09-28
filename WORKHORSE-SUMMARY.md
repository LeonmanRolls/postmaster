# Workhorse summary: 113 two runs may change the same files

## What was built

Commits on `wb/113-mimo`, oldest first:

1. `0d4a16d` Add workhorse spec for #113 — `WORKHORSE-SPEC.md` alone, the record of intent.
2. `f5248fd` Two runs may change the same files; the second merger resolves the conflicts (#113) —
   the ticket's own change: `skills/postmaster/postmaster.md` Stage A step 6 and the hard rule,
   `skills/postmaster/coachman.md`'s Concurrency note; the spec's tasks T001–T004 ticked.
3. `2084fa1` Keep verify.sh's self-test off an outer run's POSTMASTER_VERIFY — one line in
   `scripts/verify.sh`, forced by the gate (see Decisions).
4. `ec7f185` Apply the host.sh stop fix from #117 — not this branch's work; applied by the run
   after the machine restarted so no copy of host.sh keeps that defect. Left in place; it merges
   cleanly.
5. `2cdaa0d` Apply the verify.sh self-test fix from #119 — not this branch's work; the one-word
   change #119 makes on main (`POSTMASTER_VERIFY= "$SELF" journey-path "$wt"` on the journey-path
   control). Left in place; it merges cleanly, and it stacks with `2084fa1` (mine isolates the
   whole self-test, #119's empties the variable on that one control).

## Checks

Run just before this summary was written, from the worktree root:

```
/home/brindlewick/postmaster/scripts/verify.sh run .
```

Post-remount gate attempts (at most 3, per the remount ruling):

- attempt 1: `gate: fail, exit 1, 197s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'`
  — failed only in review-round.sh's self-test, `FAIL a wait run again keeps the round's deadline rather than starting a new one (exit 3)`. Timing control; known load flake (same class as #85). Re-ran.
- attempt 2 (the run above): **`gate: pass, exit 0, 355s`** — every self-test green. This is the result line for `default:gate`, command as quoted above, exit 0.

Pre-remount gate attempts on the same branch, for the record (the machine then ran out of memory):

- fail on `verify.sh --self-test`, `FAIL a workhorse's in its worktree` — real, and this branch's
  `2084fa1` fixed it (see Decisions).
- fail on `host.sh --self-test`, `FAIL its runner and the launch killed outright: the marker still lands` —
  the brief's known #85 flake. Measured in isolation: 3 failures in 5 runs under load, 0 in a later idle run.
- fail on `review-round.sh --self-test`, the same deadline control as post-remount attempt 1 —
  measured in isolation: 1 failure in 4 runs under load, 0/5 idle per the remount note.
- one fail on `link-skills.sh --self-test` (`a link that points elsewhere is named`, and the dry-run
  control that depends on it) — 0 failures in 5 isolated runs afterwards; treated as the same load
  class, not this change.

Other commands run, with exit:

- `scripts/verify.sh --self-test` — exit 0 without `POSTMASTER_VERIFY`, and exit 0 with
  `POSTMASTER_VERIFY=<this worktree's .postmaster/verify>` after `2084fa1`; before that fix the
  second form failed deterministically (exit 1).
- `scripts/host.sh --self-test` × 5 — exits 1, 0, 0, 1, 0 (the known flake).
- `scripts/review-round.sh --self-test` × 4 — exits 0, 0, 1, 0 (timing flake).
- `scripts/link-skills.sh --self-test` × 5 — exit 0 every time.
- every other script in the gate's self-test list, each `--self-test` alone — all exit 0.
- the AC4 greps quoted below — exit 1 (no match) on the old-rule sweep.

## Decisions

**A gate failure forced one script change.** The first post-edit gate run failed in
`scripts/verify.sh --self-test`, on `a workhorse's in its worktree`. Cause, verified by
reproduction: `verify.sh run` passes `POSTMASTER_VERIFY` to each check (so a check finds the
armed spec); the gate then runs `scripts/verify.sh --self-test`, which inherited that variable,
so `journey-path` on the self-test's own temp worktree resolved through *this* worktree's
`spec.json` `journey_dir` instead of the temp worktree's own. Deterministic whenever an outer
run has an armed spec — that is, every `verify.sh run .` on an armed worktree. Pre-existing at
BASE (`bb782a9` carries the same code); not introduced by this ticket's prose. The brief allows
a self-test change when the gate forces one. Fix: `unset POSTMASTER_VERIFY` at the top of the
self-test section. The self-test builds its own temp repos and must not see an outer run's armed
spec. Production behaviour of `journey-path` is untouched. #119's one-word fix landed on the
branch the same way afterwards and was left in place (see commits).

**Stage A step 6's wording.** Now "Dependencies first: a ticket that needs another's change
waits for it to land." Dependencies still order tickets (the ticket says so). Ties beyond
dependencies are left to the postmaster's judgment; inventing a tie-break rule would be new
scope.

**The concurrency note keeps the merge mechanics and drops the sequencing advice.** It says runs
run in parallel, that the run which merges second resolves the conflicts at its merge, and that
it is merge, never rebase — the phrasing `coachman.md` already uses in its hard rules. The
"colliding barrel exports / shared surfaces" colour and "prefer sequencing" / "check the file
surfaces before mass-launching" are gone; they existed only to motivate sequencing. How a
conflict is resolved is out of scope and was not touched.

**`team.max_runs` is left as the sole in-flight limit.** The hard rule now reads only
"Never launch more runs than `team.max_runs`." Stage B's "when the run ceiling (`team.max_runs`)
has room" line is unchanged. The value of `team.max_runs` is out of scope and untouched.

## AC4 sweep: what was searched and what each search returned

Scope: `skills/`, `AGENTS.md`, `README.md`, `wiki/`. Two sweeps, run after the edits (and again
after the remount-applied commits, with the same returns):

Sweep A — the old rule's phrasings:
`grep -rniE 'file surface|disjoint file|overlapping file|do not run at the same time|prefer sequencing|check the file surface|mass-launch|barrel export|file safety|two runs on|must not change the same|must not touch the same|touching the same|colliding barrel|shared surface|shared module|route table, transport|sequencing those|not file safety' skills/ AGENTS.md README.md wiki/`
→ **no matches (exit 1)**.

Sweep B — broader same-files / two-runs phrasings:
`grep -rniE 'same files|same module|same route|parallel runs|two tickets touching|two runs must' skills/ AGENTS.md README.md wiki/`
→ two hits, neither a rule against two runs on the same files:
- `skills/postmaster/coachman.md:831` — the new concurrency note itself ("When two runs change
  the same files, the one that merges second resolves the conflicts at its merge").
- `skills/postmaster/harnesses.md:314` — "The launch keeps them, as a claude lane reads the same
  files." About a claude lane's file reads during a launch, not about two runs.

Other hits under a `same files|parallel` look, all unrelated: `hosts.md:91` (review lenses run in
parallel inside one run), `README.md:35` ("Several models change code in parallel" — lanes within
a run), wiki pages on review lenses and review-loop convergence (a sequence of lens *passes*
within one round, not a sequence of *runs*). `wiki/concepts/tool-faults.md` says "several runs may
be in flight at once", which is the new model, not the old rule.

## What was not done, and why

- **How a conflict is resolved** — out of scope by the ticket. `coachman.md`'s merge, never
  rebase, is left as it was.
- **The value of `team.max_runs`** — out of scope. Every number and default is untouched.
- **A tie-break rule for tickets with no dependency order** — not asked for; Stage A step 6 only
  orders by dependencies now.
- **No other script, gate or self-test change** beyond the one the gate forced (`2084fa1`).
  The wiki needed no edit; it was already free of the old rule. `AGENTS.md` and `README.md`
  needed no edit.

## Verdict on the acceptance criteria

1. **Met.** Stage A step 6 orders tickets by their dependencies only ("a ticket that needs
   another's change waits for it to land"), and no hard rule forbids two runs on the same files —
   the overlapping-file-surfaces clause is gone from `postmaster.md`.
2. **Met.** The only in-flight limit `postmaster.md` states is `team.max_runs`, in the hard rule
   and in Stage B's ceiling line.
3. **Met.** `coachman.md`'s concurrency note says the run that merges second resolves the
   conflicts at its merge, merging and never rebasing, and no longer advises sequencing.
4. **Met.** Nothing under `skills/`, in `AGENTS.md`, in `README.md` or in the wiki still says two
   runs must not change the same files; the sweeps above return no such statement.
