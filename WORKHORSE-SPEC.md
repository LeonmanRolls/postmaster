# Workhorse spec: #158, Measure each lane's share of the shipped synthesis from git, beside the coachman's own account

_Shared spec written by the coachman per the user's word; identical in both lanes' worktrees.
Both lanes implement from this spec, in blinkers as before._

## Summary

The SYNTHESIS line's `took=` is the coachman's own claim and nothing measures it; this change
adds a TypeScript script on Bun that counts, from git at the end of synthesis, how much of the
synthesis's added text appears only in each lane's diff, in both (in more than one, when a run
has more than two lanes), and in neither, split into code and docs, and shows those shares on
the checkpoint card beside the SYNTHESIS line and in a run record a later audit can read
without re-running the script. By the user's word it also sets up the project's TypeScript
linter, Oxlint run by Bun, with the project's first custom rule: a test file sits beside its
target and is named `<name>.test.ts`.

## Technical context

- **Language and version**: TypeScript, run by Bun 1.4.2 or later. Bun runs TypeScript
  natively, so there is no build step and no `tsconfig.json`.
- **Dependencies used or added**: the script uses Bun and nothing else. The linter adds one
  dev dependency, `oxlint`, pinned to exactly 1.86.0 because its plugin support is still
  alpha, in a new root `package.json` with its `bun.lock`. No other packages.
- **Testing**: run `bun install` first, then:
  - `bun test ./scripts ./lint`. Name the two folders: a bare `bun test` also runs the sample
    project's tests under `fixtures/`.
    - The script's controls: those the ticket's third acceptance criterion asks for, plus one
      for exclusions and one for a third lane. Each builds a small git repository, runs it
      through the same command the coachman uses, and reads the counts back exactly:
      - *one lane only*: the synthesis copies one lane's text. Every six-word run is that
        lane's; the other lane's count, shared and neither read 0.
      - *split between both*: the synthesis takes one part from each lane. Each lane's count
        reads its part's exact size; shared and neither read 0.
      - *identical in both lanes*: both lanes wrote the same text and the synthesis keeps it.
        Every run is shared; the rest read 0.
      - *the coachman alone*: text no lane wrote. Every run is neither; the rest read 0.
      - *exclusions*: text in a left-out file (Decision 7) counts nowhere, while the same
        text in a kept file counts.
      - *three lanes*: text from each of three lanes, and text two of them share, read back
        per lane by name and as shared.
    - The lint rule's controls, each run through Oxlint on Bun with the project's config, on
      small folders the test builds, and read back exactly: a test file beside its target
      passes with no problem; a test file with no target, and one inside a `test/` folder,
      each fail with one problem naming the file.
  - `bun run lint`: the repository lints clean, the new files included.
  - The project's gate, from the worktree root. Until #17 ("A turnpike for this repo:
    postmaster cannot QA itself without one") gives this repo a real gate, the gate is a
    stand-in command: it checks that every shell script parses, that every script path the
    runbooks name exists, and that the wiki lints clean, and it runs the self-test of each of
    the 40 scripts that had one when this run started. It knows nothing of TypeScript, so it
    runs neither the tests nor the lint, and this change does not add them to it (#171 does):
    run `bun test` and `bun run lint` as above as well, and record all three results. It does
    check that the `<tool>/scripts/synthesis-shares.ts` path named in `coachman.md` exists.
- **Constraints**:
  - From git at the end of synthesis: diffs of real commits, never lane logs.
  - Match runs of words, as the audit did; Decisions 1 to 3 state the rule in full.
  - Count code and docs separately; leave out oracle and spec files, and generated files.
  - `took=` stays; the measurement sits beside it and does not replace the coachman's reasons.
  - The measurement informs the ranking; it does not decide it.
  - Nothing in the target repository runs or is loaded while measuring (Decision 11).
  - The lint runs on Bun with no Node installed: `bun x --bun oxlint`, so Bun hosts the plugin.
  - Functional style: a pure core with side effects at the edges; no reassignment, no mutation
    of objects or arrays, and no loops that mutate state. Where mutation is truly needed, a
    comment says why.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Match runs of words, as the audit did | The audit's rule, stated in full in Decisions 1 to 3: every six words in a row in the synthesis's added lines, counted once per occurrence, matched exactly against each lane's diff. The direction allows a simpler measure only if it gives the same answers; the simpler one, whole lines, does not, since it misses prose re-wrapped onto different lines. |
| New script in TypeScript on Bun (user's word) | `scripts/synthesis-shares.ts`, which uses Bun and nothing else. |
| Tests beside their target, named `<name>.test.ts` (user's word) | `scripts/synthesis-shares.test.ts` and `lint/test-beside-target.test.ts`, each beside its target, run by `bun test`. |
| A lint rule enforces that placement (user's word) | Oxlint, run by Bun, with the rule as a plugin written in TypeScript (Decisions 13 and 14). Biome cannot express it: its rules are pattern matches that cannot see other files. |
| Functional style (user's word) | A pure core (split into words, cut runs, classify, count) with git, argv and file writes at the edges; no reassignment, no mutation of objects or arrays, no loops that mutate state, and a comment wherever mutation is truly needed. These are the rules #171 ("The TypeScript linter enforces the project's style rules: tests beside their target, functional style") will enforce. |
| Code and docs separately | By file type only (Decision 6). |
| Oracle and spec files left out | On every side, by exact path: the files the oracle commit added (none when the run wrote no oracle), the three lane records, and generated files such as lockfiles (Decision 7). |
| Card shows shares beside SYNTHESIS; records keep them auditable | The script prints one greppable `SHARES:` line for the card and `run-log.md`; `--record` writes `<dispatch>/shares.json` with the pinned commits and exact counts. |
| `took=` stays; informs, does not decide | `coachman.md` keeps the SYNTHESIS line and `took=` unchanged, runs the script before that line is written, adds the SHARES line beside it, and says the measurement informs the ranking. |
| Near-matches and lane logs (user's question) | Decisions 3 and 4. |
| Criterion 5, added to the ticket by the user's word | "A lint rule, run by Oxlint on Bun, fails a test file that has no sibling target named `<name>.ts` or that sits in a separate test folder, and passes one beside its target; its test has a control for each, read back exactly." Decisions 13 and 14; T005 and T006. |
| Nothing repo-specific (project rule 1) | No folder names from any one repository in the measure: docs by file type, exclusions by exact path, lanes and commits passed in as arguments, any number of lanes (Decision 5). |
| Every count needs a control (project rule 5) | Each count reads a known non-zero in one control and 0 in another, through the same command (Testing); the lint rule's controls likewise. |
| Self-contained against #109 (user's word) | The script, its test and the runbook prose touch nothing #109 ports. The lint setup adds a root `package.json` and `bun.lock`, as #109 does; whichever branch merges second combines them. |

## Structure

Create:

- `scripts/synthesis-shares.ts` — measure from git, print the `SHARES:` line, `--record` the
  JSON, all new logic here.
- `scripts/synthesis-shares.test.ts` — the script's controls listed under Testing, as bun
  tests on small git repositories.
- `lint/test-beside-target.ts` — the placement rule (Decision 13).
- `lint/test-beside-target.test.ts` — the rule's controls listed under Testing.
- `lint/plugin.ts` — the plugin that names the project's own rules for Oxlint; later rules
  join it.
- `.oxlintrc.json` — Oxlint's config: the plugin, its rule turned on, `fixtures/` left out.
- `package.json` and `bun.lock` — `oxlint` pinned, and a `lint` script.

Change:

- `.gitignore` — add `node_modules/`.
- `skills/postmaster/coachman.md` — at the end of synthesis, before the SYNTHESIS line is
  written, run the script as Decision 11 says; put the `SHARES:` line on checkpoint-1 beside
  the SYNTHESIS line, keep `took=` and the coachman's reasons, record
  `<dispatch>/shares.json`, add it to the paths table, and say the measurement informs the
  ranking and does not decide it.

## Decisions

1. **What "word-run matching" means.** Take the lines a diff adds, file by file, and split
   them into words at whitespace: a word is anything between spaces, tabs or line breaks.
   Every six words in a row make one run. For example, the two added lines

   ```
   const total = items.length + extra;
   return total;
   ```

   hold eight words and so three runs: `const total = items.length + extra;`, then
   `total = items.length + extra; return`, then `= items.length + extra; return total;`.
   Line breaks are only whitespace, so re-wrapping text does not break a run. A run of the
   synthesis counts for a lane when that lane's own diff holds the same six words in the same
   order. Each run is counted once for each place it occurs in the synthesis, and falls in
   exactly one group: only one lane's diff holds it (that lane's), two or more do (shared;
   with two lanes, both), or none does (neither: written in the synthesis itself). Matching
   is exact, with no change of case or punctuation.
2. **Six words, as the audit used.** Fewer words match boilerplate by accident; more words
   miss short shared passages.
3. **Slightly changed text still counts, stretch by stretch.** Every unchanged stretch of six
   or more words still counts for the lane it came from. Each changed word breaks the runs
   that hold it, up to six, and those go to neither, so light editing moves a little of a
   lane's share to neither. More forgiving counts were checked on the audit's runs: counting
   words instead of runs, ignoring case and punctuation, and runs of four words. None moved
   much out of neither, and each blurred text only one lane wrote into shared, so the exact
   count stands. What no text count can see is an idea the coachman rewrote in its own
   words. The `took=` reasons carry that, which is why the measurement informs the ranking
   rather than deciding it.
4. **Lane logs do not feed the measure.** A lane's log holds nothing its diff does not: what
   a lane wrote is in its diff. Only the coachman's own log could show what it copied from
   where, and that log's format differs by harness and it lives outside git, which the
   ticket's first criterion rules out. Provenance stays in `took=`.
5. **Lanes by name, any number of them.** Shares are reported per lane by name, never by
   rank: the script runs before the SYNTHESIS line is written, so the shares can inform the
   ranking. A run may have more than two workhorses; the groups in Decision 1 hold for any
   number, and with two lanes they are the ticket's four.
6. **Two kinds, code and docs, by file type.** Docs are files ending `.md`, `.mdx`, `.rst`,
   `.adoc` or `.txt`; every other file is code, tests included, since a test file is product.
   No folder name from any one repository decides a kind.
7. **What is left out, on every side, by exact path.** The files the oracle commit added
   (none when the run wrote no oracle). The lane records at a worktree's root,
   `WORKHORSE-SPEC.md`, `WORKHORSE-SUMMARY.md` and `WORKHORSE-BLOCKED.md`, matched exactly.
   Lockfiles and other generated files: a short list of well-known names, such as
   `bun.lock`, `package-lock.json`, `yarn.lock`, `Cargo.lock` and `go.sum`, and any file the
   project's `.gitattributes` marks as generated; nobody writes these by hand, and one added
   dependency would otherwise credit a lane with hundreds of runs. Nothing is left out
   because a word such as `oracle` or `acceptance` appears in its path: that would drop real
   work, such as a script named `front-door-acceptance.ts` or a wiki page named
   `workhorse-spec.md`. A renamed file counts only the lines it changed (git's rename
   detection), not its whole text. A synthesis range that holds a merge commit is refused,
   since a merge would bring other work in as the coachman's own.
8. **The record is `<dispatch>/shares.json`.** One JSON object, written once by `--record`,
   holding the pinned commits (base, each lane's name and head, the synthesis range, the
   oracle if any), the run length, the exclusions, and exact integer counts and shares per
   kind and per lane. An audit reads it without git and without this script. It sits beside
   `checks.json` and `run.json`, which are already structured records outside the action log.
9. **The card line is `SHARES:`.** One greppable line carrying, per kind, the denominator,
   each lane's share by name, shared and neither; exact counts live in the JSON. Its exact
   layout is the implementation's choice. No existing script is touched to persist anything:
   the new script writes the JSON itself.
10. **CLI takes explicit commits.** The manifest does not record harvested lane heads, and the
    coachman knows the base, each lane's name and head, the synthesis range and the oracle
    commit at the end of synthesis, so those are arguments. Exact flag spelling is the
    implementation's choice.
11. **Nothing in the target repository runs or is loaded while measuring.** The coachman runs
    the script from the target's worktree, and by default Bun reads a `bunfig.toml` there,
    running any preload script it names, and loads a `.env` there. So bun runs with
    `--no-env-file` and an explicit, empty config (`--config` naming a file the tool owns, or
    `/dev/null`), and `coachman.md` gives that invocation. Git runs with `--no-ext-diff` and
    `--no-textconv`, so no diff driver or text filter the repository configures runs either.
12. **This change edits `coachman.md`, so the fixture-run merge rule applies**: a run
    dispatched from this branch against a fixture repo, scored clean, before merge. That is
    ship-side duty; implementation notes it in the summary.
13. **The placement rule, `test-beside-target`.** A file named `<name>.test.ts` passes only
    when `<name>.ts` sits in the same folder and no folder on its path is named `test`,
    `tests` or `__tests__`; otherwise it fails with a message naming the missing target or
    the folder. It reads only the file's path and whether the sibling file exists. It is
    written in TypeScript against ESLint's rule API, which Oxlint's plugins use, so it would
    run unchanged under ESLint. A target without a test is not this rule's concern.
14. **The lint setup.** Oxlint's npm package, pinned to exactly 1.86.0: its plugin support is
    alpha, and that version is known to run a TypeScript plugin on Bun 1.4.2 with no Node.
    The config is `.oxlintrc.json` at the root, with Oxlint's default rules left on and this
    one rule added. It lints the repository's own TypeScript and leaves out `fixtures/`, a
    sample project for fixture runs with its own layout: tests in `test/` folders, and hidden
    tests with no target. Oxlint follows `.gitignore`, so it skips `node_modules/` once that
    is listed there. `bun run lint` runs it as `bun x --bun oxlint`. The lint is not
    added to the gate here, and neither the functional-style rules nor reasons on disable
    comments are written here: all three are #171's.

## Tasks

- [x] T001 [P] [AC1] Write `scripts/synthesis-shares.ts`: from git, count the synthesis's added
  six-word runs per lane by name, shared and neither, against each lane's added runs, split
  into code and docs, leaving out the files Decision 7 names, with nothing from the target
  run or loaded (Decision 11); functional style, pure core, effects at the edges.
- [x] T002 [P] [AC3] Write `scripts/synthesis-shares.test.ts`: the script's controls listed
  under Testing (wholly one lane, split between both, identical in both, coachman alone,
  exclusions, three lanes) as bun tests on small git repositories, each read back as exact
  integers.
- [x] T003 [AC2] Add `--record`: write `<dispatch>/shares.json` with the pinned commits, the
  run length, exclusions, and exact counts and shares per kind and lane; print the greppable
  `SHARES:` line.
- [ ] T004 [AC2] [AC4] Edit `skills/postmaster/coachman.md`: run the script at the end of
  synthesis, before the SYNTHESIS line, as Decision 11 says; put `SHARES:` on checkpoint-1
  beside SYNTHESIS, keep `took=` and the coachman's reasons, add `shares.json` to the paths
  table, and say the measurement informs the ranking and does not decide it.
- [ ] T005 [P] [AC5] Set up Oxlint: add `node_modules/` to `.gitignore` before the first
  install; a root `package.json` with `oxlint` pinned to exactly 1.86.0 and a `lint` script
  that runs `bun x --bun oxlint`; its `bun.lock`; `.oxlintrc.json` with the plugin and
  `fixtures/` left out.
- [ ] T006 [AC5] Write `lint/test-beside-target.ts`, `lint/plugin.ts` and
  `lint/test-beside-target.test.ts`: the rule, and its three controls run through Oxlint on
  Bun, each read back exactly.
- [ ] T007 [AC1] [AC2] [AC3] [AC4] [AC5] Run the project gate, `bun test ./scripts ./lint` and
  `bun run lint` clean from the worktree root; note in the summary that the stand-in gate
  runs neither the tests nor the lint, and the fixture-run merge rule.
