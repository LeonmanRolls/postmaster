# Workhorse summary: 108 The front door runs the stream when it can

## Commits

- `0a16057` `#108, workhorse spec: the front door runs the stream when it can` —
  `WORKHORSE-SPEC.md` alone, the record of intent.
- `d806dd9` `#108, front-door.sh chooses self or spawn, with controls for each reason` —
  `scripts/front-door.sh` with `--self-test`.
- `55b3712` `#108, the front door carries on as the postmaster when it can` —
  `skills/postmaster/SKILL.md`, `skills/postmaster/postmaster.md`, `AGENTS.md`, `README.md`.
- this commit — tasks ticked in the spec, and this summary.

## Verification

| command | exit |
|---|---|
| `bash -n scripts/*.sh` (each file) | 0 |
| `scripts/front-door.sh --self-test` | 0 |
| `scripts/skill-refs.sh` | 0 |
| `scripts/wiki-lint.sh` | 0 |
| the project gate: `bash -c 'for f in scripts/*.sh; do bash -n "$f" \|\| exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for f in $(grep -l -- --self-test scripts/*.sh); do "$f" --self-test \|\| exit 1; done'` | 0 |
| `grep` for the retired phrases over `AGENTS.md`, `README.md`, `skills/postmaster/SKILL.md`, `skills/postmaster/postmaster.md` | 1 (no match) |

The gate's `host.sh` self-test was not among the failures; every self-test printed
`all controls behaved`.

## Decisions made within the brief

1. **Harness and model are separate reasons** (`spawn harness differs` / `spawn model differs`),
   not one combined "harness or model" case. A launch card that names which of the two differs
   is more useful, and each gets its own positive and negative control.
2. **"The repo it runs in" is the git repository**, compared by `git rev-parse
   --path-format=absolute --git-common-dir`. A session in a worktree or a subdirectory of the
   target is in the target's repo. Two clones of the same project are two repos.
3. **Model ids are compared as written.** No stripping of `[1m]` suffixes or provider prefixes.
   The session reports the model it is on; the config names the model the postmaster should run
   on. A mismatch is a real mismatch.
4. **Reasons are checked in the ticket's order**: harness, model, target, terminal. The first
   mismatch is the one printed, so a launch card names one cause.
5. **`at-terminal` is a word the session reports** (`yes` or `no`), not a tty probe. A headless
   launch on a tty is still nobody at the terminal; an interactive session over a socket still
   has the user.
6. **`front-door.sh` is not added to `controls.md`.** The ticket does not ask for it, and a
   fault in the decision can be made by hand.
7. **Output is one line**: `self` or `spawn`, a space, then the reason text. The first word is
   the machine-readable choice; the rest is for the launch card.

## Not done, and why

- **The waybill template, markers, turnpike table and completion detection are untouched.** The
  ticket says this changes the entry flow only.
- **Coachman dispatch and a headless postmaster's escalations are untouched**, named out of
  scope.
- **`controls.md`, `harnesses.md`, `hosts.md`, `trackers.md` and the wiki are untouched.** The
  ticket names four documents; adding the script to `controls.md` or a wiki page would widen the
  change.
- **No fixture run.** The ticket's turnpikes are `default`, and the coachman contract is
  unchanged, so AGENTS.md's rule for a contract change does not apply.

## Verdict on the acceptance criteria

1. **Met.** `SKILL.md` Stage 0 step 3 runs `<tool>/scripts/front-door.sh`; on `self` step 7
   carries on in this conversation from `postmaster.md`, and no second session is started.
2. **Met.** `front-door.sh` prints `spawn` only on harness, model, target or terminal, and
   `SKILL.md` step 8 keeps today's spawn path only then.
3. **Met.** `SKILL.md` step 4 puts the decision and its reason on the launch card.
4. **Met.** `scripts/front-door.sh` takes the session's harness, model, cwd and at-terminal
   report with the target and config, prints `self` or `spawn <reason>`, and its self-test has a
   positive and a negative control for each of the four reasons (plus refusals).
5. **Met.** `SKILL.md` steps 5–7 write `<runs>/postmaster/brief.md` and log from the first action
   under `<runs>/postmaster/` in both cases; `postmaster.md`'s Memory section states the same
   records and the restart requirement for a front-door postmaster.
6. **Met.** `postmaster.md` opens as "the front door started you", not "spawned you"; the phrase
   grep over `AGENTS.md`, `SKILL.md`, `postmaster.md` and `README.md` finds nothing that says
   the front door never runs the stream or always spawns.
