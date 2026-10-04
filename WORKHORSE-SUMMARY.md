# Workhorse summary: #268, a run cannot add a comment that switches off a check without the user's word

## What I built

The landing gained a deterministic switch-off check, and the runbooks put it between the
ship card and the merge. Nothing about it is postmaster-specific: it works for every
project the postmaster lands, with no new dependency, on Linux and macOS.

- **The new call — `run landing switch-offs --repo <repo> --default <branch> --ticket <ref>`**
  (`scripts/landing.ts`, tenth landing mode). It compares the ticket's head with the merge
  base of the ticket and default branches, file by file, and lists every switch-off
  comment the run adds: TypeScript's (`@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` in
  `//`, `/* */` or `/** */`), the linter's under both spellings (`eslint-disable`,
  `-line`, `-next-line`, and the same as `oxlint-`, with or without rule names), and
  Biome's (`biome-ignore`, `biome-ignore-all`, `biome-ignore-start`, each
  `category: reason`), anywhere in the tree. Each entry carries its file, its line, its
  form, the rules it names (or every rule), its reason, and a stable identity
  (`comment:<16 hex>`). Only real comments count: a small scanner tells comments from
  strings, template literals (with `${}` scanned as code) and regex literals, so a
  switch-off written as a test's input is never listed, and a comment inside an
  interpolation is. What the merge base already holds is not added — a multiset
  comparison per identity — so a switch-off main has is never listed, even after main is
  merged; removing a close (`eslint-enable`, `oxlint-enable`, `biome-ignore-end`) widens
  its block, so the block's open then counts as added. The same call lists every change
  to the project's check settings anywhere in the tree (`tsconfig*`, `jsconfig*`,
  `.oxlintrc.json`, `.eslintrc*`, `eslint.config.*`, `.eslintignore`, `biome.json`,
  `biome.jsonc`, `.prettierrc*`, `prettier.config.*`, `.prettierignore`, `bunfig.toml`;
  and `package.json` when its `scripts`, `eslintConfig` or `prettier` block changes — not
  for a dependency), each with its diff. It prints a status line — `clear`, `held` or
  `no reason` — then the card-ready `## Switch-offs` section (or `none`), and exits 0,
  2 or 3. An identity the project's ledger holds an `approved` switch-off line for is
  marked `(approved)` and does not hold the branch.
- **The record** (`scripts/log-action.ts`): a fixed verb `switch-off`, its target
  enforced to `comment:<16 hex>` or `settings:<16 hex>` (the identity the listing
  prints), its detail enforced to open with `approved` or `refused`, then the entry's
  naming and the user's words. One write lands in the run's `actions.jsonl` and the
  project's `ledger.jsonl`, which the call reads back.
- **Stage F** (`skills/postmaster/postmaster.md`, step 2): before either landing route,
  on every run and whatever `MERGE_AUTHORITY` says, the postmaster runs the call and must
  reach `clear`. Exit 3 (`no reason`) withholds under the claim-fail clause to the last
  leg, each reason-missing line as the exact discrepancy, before the user is asked. Exit
  2 (`held`) puts the section and the card to the user, writes the question to
  `.waiting-on-user`, and waits; on their word each refusal is recorded and withheld with
  that entry as the discrepancy (the leg removes it and raises a corrected card, checked
  again from the start), each approval is recorded per entry, and the call is asked
  again. The word is the user's alone: a note, a merge grant or the config naming the
  postmaster never approves a switch-off. A run whose card predates the list has none on
  it and is still checked.
- **The coachman** (`skills/postmaster/coachman.md`, Stage 3): runs the call before the
  gate, removes any switch-off it can fix, gives each one it keeps its reason beside the
  comment, and pastes the final `## Switch-offs` section (or `none`) on the card, after
  the pasted block. The block `card-block` renders and `card-results`/`card-findings`
  match is untouched, so a card written before this change still answers `match`.

Commits on the branch (base `af47492`):

- `b9ae9ea` Record the run's spec: the ticket brought to ready before dispatch
- `ea12e9f` Add the run's blind acceptance tests for the switch-off check
- `0993a9b` 268: list the switch-offs a run adds and hold the landing until each is approved
- `dc8d40b` 268: Stage F holds the landing on the switch-off call and the coachman puts its list on the card
- `0cda2de` 268: tests beside the switch-off check, in the repo's text atoms
- `06460be` 268: a card carrying the switch-off section still matches the rendered block

(`WORKHORSE-SUMMARY.md` is this file, committed as the final act.)

## Checks

What `/home/brindlewick/.postmaster/tool-pins/af47492a8c1932f622a1e2e6baedf3813ff3dd30/scripts/run verify run .`
printed when run just before this summary was written (transcript:
`.postmaster/verify/verify-run.txt`):

```
gate: fail, exit 1, 1157s: bun run check
  error: script "check" exited with code 1
  log: /home/brindlewick/postmaster/.worktrees/268/.postmaster/verify/logs/gate.log
coachman-contract: pass, exit 0, 9s: scripts/run coachman-contract --self-test
exit: 2
```

The gate's one failing test is environmental and pre-existing, not this change: see
"What I did not do" below; its log shows `2757 pass, 1 fail`, the fail being
`probe-confine > a bwrap is vetted only on a root-owned chain`, which fails identically
at the base commit in this lane's sandbox
(`.postmaster/verify/base-probe-confine.txt`).

One line per check the brief names:

- gate — `bun run check` — exit 1 in this lane's sandbox only, on the pre-existing
  environmental test above; transcript `.postmaster/verify/gate-final.txt`
  (2757 pass, 1 fail; tsc, Oxlint, Biome format, the whole test suite, `skill-refs` and
  `wiki-lint` all complete inside it).
- coachman-contract — `scripts/run coachman-contract --self-test` — exit 0, 36 passed;
  transcript `.postmaster/verify/coachman-contract-selftest.txt`.

Other commands run in the loop, with exit codes:

- `ORACLE_CALL='scripts/run landing switch-offs …' ./oracle-268.sh` — exit 0, 55 passed,
  0 failed — `.postmaster/verify/c1-c2-c3-c4-c8-oracle.txt`
- C10 sweep of all 94 first-parent merges at the base against their first parents — exit 0,
  held for exactly the seven tickets — `.postmaster/verify/c10-92-merges.txt`
- `run landing switch-offs --repo . --default main --ticket HEAD` (this branch) — exit 0,
  `clear` — `.postmaster/verify/c10-this-branch.txt`
- approval/refusal scenario through `run log-action` — script exit 0 —
  `.postmaster/verify/c7-c9-approval-record.txt`
- Stage F runbook + held/no-reason call scenario — `.postmaster/verify/c6-c8-c9-stage-f-runbook.txt`
- live Stage F of the fixture run — `.postmaster/verify/c6-live-stage-f.txt`
- `run fixture new 268-contract remove` — exit 0
- `run fixture score <fixture-dispatch> <fixture-repo>` — exit 0, every check `ok` —
  `.postmaster/verify/c11-fixture-score.txt`
- `run landing card-results` / `card-findings` on the fixture records (with and without
  the section) — all exit 0, `match` — `.postmaster/verify/c5-fixture-card.txt`
- `bun test scripts/landing.test.ts scripts/log-action.test.ts scripts/lib/text.test.ts`
  (guard + the new tests) — exit 0, 209 pass
- `bun test scripts/landing.test.ts` after the card test — exit 0, 133 pass
- `bunx tsc --noEmit` — exit 0; `bunx biome format <changed files>` — exit 0 (no fixes);
  `bunx oxlint` on the changed files — exit 0, no warnings
- `scripts/run skill-refs` — exit 0; `scripts/run wiki-lint` — exit 0
- `scripts/run summary-evidence` on the draft — ran to confirm it reads the ticket's 11
  criteria (it named each missing entry, as a draft without Evidence should)

## Evidence

1. `.postmaster/verify/c1-c2-c3-c4-c8-oracle.txt`
2. `.postmaster/verify/c1-c2-c3-c4-c8-oracle.txt`
3. `.postmaster/verify/c1-c2-c3-c4-c8-oracle.txt`
4. `.postmaster/verify/c1-c2-c3-c4-c8-oracle.txt`
5. `.postmaster/verify/c5-fixture-card.txt`
   - `.postmaster/verify/c11-fixture-score.txt`
6. `.postmaster/verify/c6-live-stage-f.txt`
   - `.postmaster/verify/c6-c8-c9-stage-f-runbook.txt`
7. `.postmaster/verify/c7-c9-approval-record.txt`
8. `.postmaster/verify/c1-c2-c3-c4-c8-oracle.txt`
   - `.postmaster/verify/c6-c8-c9-stage-f-runbook.txt`
9. `.postmaster/verify/c7-c9-approval-record.txt`
   - `.postmaster/verify/c6-c8-c9-stage-f-runbook.txt`
10. `.postmaster/verify/c10-92-merges.txt`
    - `.postmaster/verify/c10-this-branch.txt`
    - `.postmaster/verify/c6-live-stage-f.txt`
11. `.postmaster/verify/c11-fixture-score.txt`

Each entry shows what the ticket asks for on the loop's last pass: (1) the oracle plants
every comment form of the first technical note with a reason and the call lists each
once with file, line, form, rules and reason, exit held; (2) each settings change alone
is listed as a settings change with its diff, a dependency-only `package.json` is not;
(3) switch-off text in strings, templates, regexes, a test's written file and Markdown
is omitted while a real comment and a comment inside `${}` are listed; (4) a switch-off
main gains after the cut is absent after the merge, as are the base's own comments;
(5) the fixture run's card carries the `## Switch-offs` section the call prints at the
card's final HEAD (`none`), and both `card-results` and `card-findings` still print
`match` for a card with the section and for one written without it; (6) the fixture's
Stage F records the call answered `clear` before the `MERGE_AUTHORITY=postmaster` grant
on `landing: local`, and the runbook puts the ask ahead of both routes with
`.waiting-on-user` and the wait; (7) after the word, `run log-action … postmaster
switch-off <id> approved …` writes one line each into `actions.jsonl` and
`ledger.jsonl`, naming the identity and carrying the user's words, and the call says
`clear`; (8) a plant with no reason is listed `reason: missing` at exit 3, and Stage F
withholds to the last leg before asking; (9) a refusal records through the same verb and
detail shape (and the runbook withholds with that entry as the exact discrepancy, the
corrected card checked from the start); (10) the call is clear at exit 0 on this branch
and on 87 of the base's 94 merges (the eight-five of the ticket's 92 plus the two that
landed since), and the fixture run landed through the clear path exactly as the base
route does; (11) `run fixture score` exits 0 with every check `ok`.

## Decisions I made within the brief

- **The call's name and form** (the brief leaves these to the lanes): a tenth landing
  mode, `run landing switch-offs --repo --default --ticket`, whose first line is the
  status (`clear`/`held`/`no reason`) and whose exit is 0/2/3; the `## Switch-offs`
  section after that first line is what the coachman pastes and the postmaster puts to
  the user.
- **The identity, and the id the listing prints**: `comment:<16 hex of sha256(file,
  comment text, covered line)>` — no line number, so an approval survives a line move
  (D8) while a changed comment or covered line needs a new word;
  `settings:<16 hex of sha256(file, blob at head)>` — an approval covers the file as it
  stands at the head (D8). Stage F records the id verbatim, so the ledger line and the
  call cannot drift.
- **Approvals match by identity in the project's ledger, not by run**: the approval
  covers that comment over that code (D8); the run name in the line is provenance. A
  `refused` line never clears; in the runbook flow a refusal withholds before any
  approval for that identity exists.
- **Exit 3 dominates exit 2**: an unapproved entry with no reason can never be asked
  about, so the withhold path and the ask path are told apart by the exit code rather
  than by prose.
- **Statuses are computed over unapproved entries only**: after the user's word the call
  prints `clear` while still listing (and marking `(approved)`) what the run adds, so
  the card's list is the run's list, not the unapproved's.
- **A Biome comment without `category: reason` is not a switch-off** (it switches nothing
  off — verified at the base) and is never listed; every other form is listed even
  reason-less, as missing.
- **`package.json` is read as three blocks** (`scripts`, `eslintConfig`, `prettier`)
  compared on canonicalized JSON so key order is not a change; unparsable text compares
  whole. `.postmaster/project.toml` is not a settings file (the ticket's list).
- **No edit to `docs/coachman-contract.toml`**: its `holds` prose for landing.ts still
  reads "landed state, freshness, card rendering and matching, journey gating". Adding
  the switch-off listing to that text after the fixture dispatch would itself be a
  contract change and force a fixture run from a later commit; the list is a list of
  files, and landing.ts is already covered.

## What I did not do, and why

- **`bun run check` and `verify run .` do not exit 0 in this lane's sandbox.** The gate's
  `probe-confine > a bwrap is vetted only on a root-owned chain` test asks
  `isSecureBwrapPath("/bin/sh")` to be true; this lane runs in a user namespace where
  uid 0 is unmapped, so root-owned paths stat as uid 65534 and the root-owned chain is
  false. The identical failure happens at the base commit with no lane changes
  (`.postmaster/verify/base-probe-confine.txt`, run against the tool pin at `af47492`),
  the `POSTMASTER_PROBE_BWRAP_SECURE` override cannot satisfy both of the test's
  assertions, and gates in other processes on this machine pass it (the ledger's recent
  `gate result=pass` lines each contain `(pass) … root-owned chain`). Everything else in
  the gate is green on the final code: 2757 pass, 1 fail
  (`.postmaster/verify/gate-final.txt`, `.postmaster/verify/verify-run.txt`).
- **Legacy Stage F** (runs without `coachman_contract: 2`) is untouched: the ticket's
  Stage F notes point at the contract-2 stage, and contract-2 runs dispatched before this
  change are held the same way by it.
- **No contract-list prose edit** — the last decision above.
- **The fixture run needed one resume**: the postmaster's session ended on a provider
  rate limit (reset 12:40 UTC) with the card ready; I resumed its thread with the
  watcher's finding, and it completed Stage F, the merge and Stage G from its records
  (visible in the fixture's `actions.jsonl`, cited in the C6 transcript).

## Verdict, one line per acceptance criterion

1. Met — before landing, the check lists every switch-off comment the run adds with its
   file, line, form, rules and reason (oracle C1, exit held).
2. Met — the same call lists every settings change of the project's checks, with its
   diff, held (oracle C2).
3. Met — switch-off text that only looks like one (strings, templates, regexes, written
   files, Markdown) is not listed (oracle C3).
4. Met — a switch-off main already has is not listed after main is merged, and the base's
   own comments are never listed (oracle C4, landing tests).
5. Met — the fixture run's card shows the section the call prints at the card's final
   HEAD, and cards with or without it still answer `match` (C5 transcript).
6. Met — the run's Stage F runs the call before either route, whatever `MERGE_AUTHORITY`
   says, and does not land while it says held (runbook text plus the live fixture grant
   conditioned on "switch-offs are clear").
7. Met — each approval is recorded in the project's ledger (and the run's actions) with
   the user's words and the identity it covers, through `run log-action` (C7 transcript).
8. Met — a switch-off with no reason is listed as missing and Stage F withholds to the
   last leg before the user is asked (oracle C8 plus the runbook transcript).
9. Met — a refusal is recorded through the same verb and Stage F withholds with that
   switch-off as the exact discrepancy, the corrected card checked again from the start
   (C9 transcripts).
10. Met — a run that adds no switch-off is `clear` at exit 0 and Stage F goes on as at
    the base: this branch is clear, 87 of the base's 94 merges are clear, and the fixture
    run landed through the unchanged route (C10 transcripts plus the live Stage F).
11. Met — the fixture run dispatched from this branch scores clean: `run fixture score`
    exits 0 with every check `ok` (C11 transcript).

Summary evidence check: `.postmaster/verify/summary-evidence.txt`
