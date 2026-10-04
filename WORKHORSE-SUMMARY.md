# Workhorse summary: 266 Runbooks hold no code: each step is one call to a postmaster script

## What I built

Commits on `wb/266-mimo`, oldest first:

- `db54222` Run the bwrap vetting positive control only where a root-owned path is visible — this machine's user namespace maps no uid 0, so the pre-existing probe-confine control could not pass here; the refusal control and the vetting function are untouched.
- `db63ffe` 266: add the gate check that refuses code in the runbooks — `scripts/runbook-code.ts` and its tests: AGENTS.md and every `.md` under `skills/` hold one `scripts/run` call per line in a shell block and no shell syntax in a text command, reported as `<file>:<line>: <what>: <command>`.
- `a18aede` 266: cut, launch and harvest the review round in the script — `review-round.ts` gains the three steps a round is now (D7), with tests that stand in for every script they call and record its arguments.
- `34c8c0b` 266: the shares call reads the synthesis HEAD and records its line — without `--synthesis` the measurement is HEAD; `--record` appends the SHARES line to the run log.
- `75a8094` 266: the run root and the worktree exclude are project-settings calls — `run-root` creates `<root>/.postmaster/runs/postmaster` and the ignore rule and prints the run root; `exclude-worktrees` keeps `.worktrees/` in the repository's git exclude.
- `061676e` 266: the host composes a workhorse launch and stops a pidfile's group — `host workhorse` names the lane as `host name` prints it, sets the logs paths and runs the launch with `--run`; `host stop-pidfile` stops a pidfile's whole process group.
- `e47837c` 266: the spec session spawns with the handle and form the run recorded — `spec-session spawn` takes the spec commit from `spec-review.md`, labels the session and builds the interactive form for each of the seven harnesses.
- `bbc246b` 266: splice, clean-checkout and view-stream take their input without a shell — `--out` for the spliced body, `--file` for each checkout command, a stream file as view-stream's argument.
- `f79b9cc` 266: the runbooks hold no code: each step is one call to a script — AGENTS.md, SKILL.md, coachman.md, postmaster.md, hosts.md, harnesses.md and the wiki skill rewritten; `runbook-code` joins `bun run check`; the tests that read the runbooks' shell move to the scripts.
- `7f35a08` 266: the steps that took over the runbooks join the coachman contract — `review-round.ts`, `synthesis-shares.ts` and `project-settings.ts` get `holds` lines.

## Checks

Run just before this summary was written, with the run's pinned tool at the dispatch commit:

- `/home/brindlewick/.postmaster/tool-pins/af47492a8c1932f622a1e2e6baedf3813ff3dd30/scripts/run verify run .` →
  `gate: pass, exit 0, 1178s: bun run check` ·
  `coachman-contract: pass, exit 0, 9s: scripts/run coachman-contract --self-test` · [exit 0]

Other commands run in the loop, with their exits:

- `bun run check` → 0 (2833 pass, 0 fail; the check line includes `scripts/run runbook-code`) — `.postmaster/verify/c5.txt`
- `bunx tsc --noEmit` → 0
- `bunx oxlint` → 0
- `bunx biome format scripts types lint package.json tsconfig.json biome.json .oxlintrc.json` → 0
- `scripts/run skill-refs` → 0
- `scripts/run runbook-code` → 0
- `scripts/run wiki-lint` → 0
- `scripts/run coachman-contract --self-test` → 0 (36 passed, 0 failed)
- `bun test scripts/runbook-code.test.ts` → 0 (115 pass)
- `bun test scripts/review-round.test.ts` → 0 (53 pass)
- `bun test scripts/synthesis-shares.test.ts` → 0 (12 pass)
- `bun test scripts/project-settings.test.ts` → 0 (122 pass)
- `bun test scripts/spec-session.test.ts` → 0 (25 pass)
- `bun test scripts/clean-checkout.test.ts` → 0 (19 pass)
- `bun test scripts/ticket-check.test.ts` → 0 (155 pass)
- `bun test scripts/view-stream.test.ts` → 0 (5 pass)
- `bun test scripts/host.test.ts` → 0 (39 pass)
- `bun test scripts/link-skills.test.ts` → 0 (41 pass)
- `bash .postmaster/verify/c1.sh` → 0 (each plant refused and named; clean and accepted forms exit 0)
- `bash .postmaster/verify/c2.sh` → 0 (41 plants refused by kind; the not-refused list exits 0)
- `bash .postmaster/verify/c4.sh` → 0 (refused in the five runbooks; the files outside the set are not read)
- `bash .postmaster/verify/c6.sh` → 0 (8 pass runs; each of 7 mutations fails its test; the tree restored)
- `bash .postmaster/verify/c7.sh` → 0 (no command line remains; four harnesses print both forms)
- `bash .postmaster/verify/c8.sh` → 0 (review-round.ts answers yes, wiki-lint.ts no)
- `scripts/run launch form luna` / `mimo` / `opus` / `coachman` → 0 each (both forms printed)
- `scripts/run summary-evidence .postmaster/verify/summary-draft.md .` → 0 (evidence shape holds for 9 criteria)

## Evidence

Transcripts under `.postmaster/verify/`, each holding the command, its output and its exit; the summary-evidence run on this summary is `.postmaster/verify/summary-evidence.txt`.

1. `.postmaster/verify/c1.txt`
2. `.postmaster/verify/c2.txt`
3. `.postmaster/verify/c1.txt` and `.postmaster/verify/c2.txt`
   - the refusal shape and the silent clean run are printed in both
4. `.postmaster/verify/c4.txt`
5. `.postmaster/verify/c5.txt`
6. `.postmaster/verify/c6.txt`
7. `.postmaster/verify/c7.txt`
8. `.postmaster/verify/c8.txt`
9. not shown: the fixture run is the coachman's to dispatch from the synthesis and score, not this lane's

## Decisions I made for myself

- **The check is its own script.** The note allows extending `skill-refs`; `runbook-code` beside it keeps `skill-refs`' file set and rules unchanged and gives the new rule its own tests.
- **A text span is a command** when it starts with a script path, a command placeholder with an argument, a program with an argument, or an assignment with a command after it. A single-token span is a value, so `$CLAUDE_CONFIG_DIR/skills`, `done` and `took=` stand, while `NAME=value env` is refused.
- **The open lenses come from `turnpikes legs`**, style dropped from round 2: the runbook can no longer hold an `<open lenses>` variable, and the runbook's own rule is style in round 1 alone.
- **The preview stops through `host stop-pidfile`.** `host stop <worktree>` would stop the coachman itself (its launch is registered in the synthesis worktree), and hosts.md documents `--pidfile` as its own process group.
- **`spec-session spawn` reads the spec commit itself** — a `commit:` line in `spec-review.md`, else the first full sha — and the coachman's package step now pins `commit: <the commit>` as the entry's first line.
- **The interactive form builder lives in `spec-session.ts`**, for the seven harnesses of harnesses.md's table; the table stays, and nothing else spawns interactively through a script.
- **Pinned stop messages keep their semicolon in the script and lose it from the span**: the runbook names `SCRATCH NOT READY: <TICKET>-rev-<lens>-<lane>` and says "and nothing launched" in words, because a span holding `;` is a command chain.
- **`approved 0|1` and `changes 0|1` are reworded** — the check cannot tell them from commands, and the ticket sanctions rewording: `count` now prints `approved` and `changes`, each followed by `0` or `1`.
- **SKILL.md's first step is `realpath <skill>/../..`**, with the checkout check in prose: `skill-refs` refuses a path that reaches `scripts/` through `../..`, and the agent verifies `scripts/run` with its own tools.
- **The probe-confine positive control runs only where a root-owned path is visible.** This machine's user namespace maps no uid 0 (pid1 is bwrap), so no chain here can pass; the refusal control always runs and `isSecureBwrapPath` is unchanged.
- **project.toml's gate `shows` text names the new check**, so the recorded checks still say what the gate runs.
- **The runbook-reading tests moved with the runbooks**: launch.test's scan of coachman/postmaster and review-findings' harvest-in-bash test went to the scripts' tests, link-skills.test follows SKILL.md's new step, and skill-refs.test's bash/zsh block runner is gone because no block runs a shell.

## What I did not do and why

- **The fixture run (C9)**: the brief makes it the coachman's to dispatch from the synthesis and score; this lane's part is a branch the gate passes and scripts that behave as the ticket says.
- **#260's Linux-only constructs check**: out of scope; the new TypeScript starts each script directly and never through a shell string.
- **The README, the wiki, the archived trials, the fixture app and the blind oracles**: out of scope; untouched.
- **What any step does**: unchanged — same records, output and stops, only moved into scripts with tests.

## Verdict on the acceptance criteria

1. met — a planted block line is refused and named, and the accepted forms and a clean copy exit 0 (`.postmaster/verify/c1.txt`).
2. met — every shell-syntax kind is refused in a block and as a text command, and the not-refused list exits 0 (`.postmaster/verify/c2.txt`).
3. met — every refusal prints `<file>:<line>: <what>: <command>` on stdout with exit 1, and a clean run prints nothing with exit 0 (`.postmaster/verify/c1.txt`, `.postmaster/verify/c2.txt`).
4. met — the same plants are refused in AGENTS.md and every skill document, and plants outside the set are not read (`.postmaster/verify/c4.txt`).
5. met — `bun run check` on the branch head exits 0 with `runbook-code` in its check line (`.postmaster/verify/c5.txt`).
6. met — a test beside each script asserts the records, files, output and stops, and taking one out makes that test fail (`.postmaster/verify/c6.txt`).
7. met — harnesses.md holds no launch or resume command line, and `launch form` prints both forms for a codex, a MiMo, a Claude and a Muse lane (`.postmaster/verify/c7.txt`).
8. met — a commit touching only `scripts/review-round.ts` exits 1 naming it; one touching only `scripts/wiki-lint.ts` exits 0 (`.postmaster/verify/c8.txt`).
9. pending — the fixture run is the coachman's to dispatch and score; not shown here.
