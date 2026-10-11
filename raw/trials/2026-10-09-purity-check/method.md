---
kind: trial
subject: what a purity check flags in postmaster's scripts, whether it points at the cause of the eight review findings where the environment or an effect leaked into a decision, and whether the project's linters can do it for one folder
date: 2026-10-09
---

# Method

**Question.** [Issue #366, Research: what does a purity check flag in the project's code, and does it reach the review findings?](https://github.com/brindlewick/postmaster/issues/366)
It is the first half of trial 4 on [the functional-core page](../../../wiki/concepts/functional-core-and-verification.md).
Design rule 8 says a computation does no I/O and effects sit at the edges, and nothing checks it. The check measured here
does not decide purity. It flags reads of the environment and the clock and uses of the modules that reach files,
processes and the operating system, in the modules named `*-core.ts` and in the shared helpers. Three things are counted:
how much good code it flags, whether it points at the cause of the eight review findings of kind E, and whether the
linters the project already runs can do it for one folder.

**What it ran on.** `main` at `e3bbb3c`, and the 19 review snapshots of
[the classified findings](../2026-10-04-review-findings-classified/data/findings.tsv) (commits in
[results/snapshots.tsv](results/snapshots.tsv)). The 12 snapshots of #202 and #252 are on `main`. The 4 of #216 and the 3 of
#268 were on 2026-10-09 only on the local branches `216` and `268`, whose tickets were open; they were read from there with
`git archive`, which touches no worktree. Bun 1.4.2, Oxlint 1.86.0 and Biome 2.5.14, as `bun.lock` resolves them.
Nothing was installed beyond `bun install --frozen-lockfile` of the project's own development dependencies.

**Two points the ticket leaves open were settled with the user during the session.**
(1) A finding counts as reached when the check flags a read or effect its defect passes through, wherever the finding's
own line is (the ticket's decision D3, read in full): 6 of 8. (2) The 3 reads of `process.env` that the check flags on
`main` are all defects; the 10 imports are not.

## The check

[apparatus/purity-check.ts](apparatus/purity-check.ts). One place per import declaration and per read or call.

- **Scope.** The modules named `*-core.ts` anywhere under `scripts/`, and the non-test modules under `scripts/lib/`. Test
  files (`*.test.ts`) are left out. Scope `all` is every non-test module under `scripts/` and is used only to show what the
  scope leaves out.
- **Flagged.** `process.env`, `import.meta.env`, `Bun.env`; `Date.now`, `performance.now`, `new Date()` with no argument
  (`new Date(ts)` is not flagged); static and dynamic imports, `export ... from` and `require` of `fs`, `fs/promises`,
  `child_process` and `os`, with or without the `node:` prefix; `Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.spawnSync`,
  `Bun.$`.
- **The page's own list** is `process.env`, `Date.now` and imports of `fs`, `child_process` and `os`. The `page` column of
  the check's output says `yes` for a place that list finds and `no` for one only the added names find, so the page's
  narrower check can be read off any result.
- **How.** A small scanner that skips comments, strings, template text and regular expressions, and reads the expressions
  inside templates as code; the functions that decide are pure, and reading files is at the edge.
- **A second implementation**, [apparatus/purity-ast.ts](apparatus/purity-ast.ts), is an Oxlint plugin that finds the
  same names from syntax trees. It shares the list of names with the first and nothing else.
  [apparatus/cross-check.ts](apparatus/cross-check.ts) runs both over the same modules and compares them by file, line and
  rule. Output: [results/main-cross-check.out](results/main-cross-check.out),
  [results/controls-cross-check.out](results/controls-cross-check.out), and the `agree` column of
  [results/snapshots.tsv](results/snapshots.tsv).

The command for every count is `bun --no-env-file --config=/dev/null apparatus/purity-check.ts --root <tree>`, where
`<tree>` holds a `scripts/` folder: `--count` prints the number, `--files` prints one count per module. A tree is a folder
made with `git archive --format=tar <commit> scripts | tar -x -C <folder>`, or one of the control folders.

## Controls (C4, D2)

Each control is a small folder under [controls/](controls/), run through the identical command, with its output in
[results/controls.tsv](results/controls.tsv). The first three are decision D2.

| control | scope `core` | scope `all` | what it controls |
|---|---|---|---|
| `effectful`: a helper under `lib/` that reads `process.env`, calls `Date.now()` and imports `node:fs`, and a test beside it that does the same | 3 | 3 | positive; the test is left out |
| `injected`: the same helper with the environment, the clock and the file reader passed in | 0 | 0 | negative |
| `outside`: a script outside `lib/` and `*-core.ts` that reads `process.env` | 0 | 1 | negative for the scope; positive once the scope is widened |
| `core-named`: `thing-core.ts` outside `lib/`, the same lines in `thing.ts`, and in `thing-core.test.ts` | 1 | 2 | the name part of the scope, which no module on `main` exercises |
| `every-rule`: each rule once, and the forms around it (multi-line import, `import type`, dynamic import, `require`, optional chain, a template inside a template, a read after a division, a read after a regular expression) | 30 | 30 | positive for every rule |
| `not-flagged`: the same names in comments, strings, template text, a regular expression, as a property of another object, `new Date(0)`, and `Bun.sleep` | 0 | 0 | negative for the scanner |
| `other-names`: names the check does not look for (`process.argv`, `Math.random`, `node:crypto` and the rest of the table below) | 0 | 0 | negative; the check is blind to them by design |

The two implementations agree on every control. A plain text search is not the check: it counts the word in a comment.
On `controls/effectful/scripts/lib/helper.ts` `grep -c 'process\.env'` reads 2 (the comment and the code) and the check
reads one `process.env` place.

## C1: every place the check flags on `main`

[results/main-places.tsv](results/main-places.tsv) lists them, and [results/main-verdicts.tsv](results/main-verdicts.tsv)
says for each whether it is a defect, with the reason. `main` has 10 non-test modules under `scripts/lib/` and none named
`*-core.ts` ([results/main-modules.tsv](results/main-modules.tsv)).

- **13 places in 6 of the 10 modules**: `confine.ts` 3, `data.ts` 1, `paths.ts` 1, `pinned.ts` 1, `proc.ts` 5,
  `processes.ts` 2; 10 imports and 3 reads of `process.env`. The ticket's text search found the same 13. The page's list
  finds all 13, and the added names find none more. Over every non-test script the count is 367 across 78 modules
  ([results/main-counts.tsv](results/main-counts.tsv)). `origin/main` moved to `67d4ae2` (15 commits, none in
  `scripts/lib/`) while the trial ran: the 13 places are identical there, and the count over every script is 368 across 79
  modules, with the two implementations agreeing ([results/main-latest-counts.tsv](results/main-latest-counts.tsv)).
- **Defects: 3.** `proc.ts:49` and `proc.ts:51`: `run()` gives the child the ambient `process.env` unless the caller passes
  `env`, so a caller that names none hands the child the whole environment. That is the read behind 202/bug-14 and
  252/bug-22, and the merge named in 216/bug-2. `processes.ts:21`: a variable that sets where the module reads `/proc`,
  read inside the function every read goes through; no finding in the trial data names it. The user ruled it a defect.
- **Not defects: 10.** Imports in modules whose job is the effect: the sandbox's start check, the file readers, the
  path resolver, the executable lookup, the process wrapper and the process-table reader.
- **Page test (more than about twenty places that are not defects): not met, 10.** Whichever way the three reads are
  ruled, at most 13 places are not defects.

## C2: the 19 snapshots and the eight findings

[results/snapshots.tsv](results/snapshots.tsv) has one line per snapshot: the modules in scope, the places flagged, how
many of them the page's list finds, the places over every script, and whether the two implementations agree (yes at all
19). [results/snapshot-places.tsv](results/snapshot-places.tsv) lists every place.

| run | snapshots | modules in scope | places flagged | by the page's list | over every script |
|---|---|---|---|---|---|
| #202 | 9 | 5 | 10 | 10 | 317 to 325 |
| #216 | 4 | 6 (adds `scrub-core.ts`) | 17 | 15 | 338 to 343 |
| #252 | 3 | 5 | 10 | 10 | 308 to 309 |
| #268 | 3 | 8 | 14 | 14 | 315 |

The 2 places only the added names find, at all four #216 snapshots, are `new Date()` (`scrub-core.ts:1192` at `dab3bea`)
and `Bun.file` (`scrub-core.ts:1345`). The ticket's baseline for `dab3bea` holds: `scrub-core.ts` reads
`SCRUB_CHECK_DISABLE` at L438, `SCRUB_PREFILTER` at L1066, `POSTMASTER_DETECTIONS_LOG` at L1185 and the clock at L1192,
reads a file through `Bun.file` at L1345, and imports `node:fs` and `node:child_process` at L1 and L2.

**The set never changes within a run.** [results/constancy.out](results/constancy.out): at every snapshot of a run the check
flags the same places (file, rule and text, ignoring line numbers): #202 9 of 9, #216 4 of 4, #252 3 of 3, #268 3 of 3. The
control is the first snapshots of different runs, which differ in 5 of 6 pairs (#202 and #252 share their five helper
modules). The check flags the same lines before and after each round's fixes: it cannot see a fix.

**The eight findings** are the rows of kind E, and the table is [results/reach.tsv](results/reach.tsv). For each, the code
was read at the finding's own snapshot, the read or effect its defect turns on was named, and the check's output at that
snapshot was searched for it.

| finding | the read or effect behind it | reached |
|---|---|---|
| 216/bug-2, 216/bug-10 | `scrub-core.ts` reads `SCRUB_CHECK_DISABLE` into `DISABLED` (L438, L517) | yes: the read itself |
| 202/bug-14, 252/bug-22 | `run()` in `scripts/lib/proc.ts` hands git the ambient `process.env` (L76, L78); the callers in `reach.ts` and `aftercare.ts` name no `env` | yes: the read itself |
| 216/bug-16, 216/bug-17 | `logFinding` in `scrub-core.ts` reads `POSTMASTER_DETECTIONS_LOG` and writes the log; the defects are a call left out and a call that should not run | yes: the effect's implementation, not the faulty call |
| 202/bug-23, 252/bug-4 | `readFileSync` and `readdirSync` in `reach.ts` and `aftercare.ts`, whose failure becomes an empty list | no: outside the scope |

**6 of 8 reached.** *Page test (flags none of the eight): not met.* Two things differ from what the ticket expected. The
ticket's note took a git call that inherits a directory variable to sit at the edge, outside the scope. The call does, but
the environment it inherits is taken in `scripts/lib/proc.ts`, which is in scope, so by decision D3 both git findings
are reached. Counted the narrower ways the user was offered (the two git findings as edge findings, or only where the flag
is the read itself) the number is 4 of 8, and the test is not met either way. In the four cases the data lets one check
(216/bug-2, 216/bug-10, 202/bug-14, 252/bug-22), the flagged read is still there, unchanged, at the run's last snapshot or
on `main`: `lib/proc.ts` is byte-identical at `b8056c9` and `dec1100`, and at `a793251` and `d2a5e88`, and `scrub-core.ts`
reads the same three variables at `dab3bea` and `cbd0384`. Each fix was made in the caller: an `UNSET_GIT` table passed to
`run()` in `reach.ts` (at `4fcdacf`); `SCRUB_CHECK_DISABLE: undefined` passed in `landing.ts` and `scrub-rewrite.ts`, and
`delete process.env.SCRUB_CHECK_DISABLE` at the entries of `landing.ts`, `raw-promote-main.ts`, `tree-check.ts` and
`scrub-rewrite.ts` (at `cbd0384`); four `GIT_*` variables deleted at the entry of `aftercare.ts` (on `main`). Over every script, the two
findings it does not reach would flag `reach.ts`'s import of `node:fs` (L13) and `aftercare.ts`'s (L26), not the calls.

## C3: what the project's linters can do

Configurations: [apparatus/lint/](apparatus/lint/). [apparatus/lint-compare.ts](apparatus/lint-compare.ts) writes them into
a scratch tree, runs each linter, and sets the reports beside the places the check flags. The trees were `main`'s
`scripts/` folder and the control folders copied into one tree (the commands are under "Repeating it"). Nothing in the
repository's own `.oxlintrc.json`, `biome.json` or gate was changed.

| tree | mode | places the check flags | Oxlint covers | Biome covers | Biome with a plugin covers | reports outside those places |
|---|---|---|---|---|---|---|
| main | rules through the override | 13 | 13 | 13 | 13 | 0, 0, 0 |
| controls | rules through the override | 34 | 30 | 31 | 33 | 0, 0, 0 |
| main | the same rules for every file | 13 | 13 | 13 | 13 | 931, 931, 961 |
| controls | the same rules for every file | 34 | 30 | 31 | 33 | 5, 5, 5 |

([results/linters-scope.tsv](results/linters-scope.tsv); the per-place tables are
[results/linters-main.tsv](results/linters-main.tsv) and [results/linters-controls.tsv](results/linters-controls.tsv).)
The last column is the control for the override: nothing is reported outside `scripts/lib/` and `*-core.ts` when the
override scopes the rules, and 931 reports per linter appear when it does not.

- **Oxlint 1.86.0**, already in the gate: `node/no-process-env`, `no-restricted-imports` with a path for each spelling of
  the four modules, and `no-restricted-properties` for `Date.now`, `performance.now` and the six Bun names. It also
  reports `import()`, `export ... from`, side-effect and `import type` imports, but not `require()`. Details: an override
  must name `"plugins": ["node"]` for the node rule, and so must a later override that switches the rule off; a negated
  glob in `files` does not exclude tests inside `scripts/lib/`, but a later override over `**/*.test.ts` that switches
  the rules off does. There is no `no-restricted-syntax` (Oxlint answers "Rule 'no-restricted-syntax' not found"), so
  `new Date()` with no argument has no rule, and nothing covers `import.meta.env`. Oxlint's JavaScript plugin interface
  does the whole check: [apparatus/purity-ast.ts](apparatus/purity-ast.ts), 30 of 30 on the every-rule control.
- **Biome 2.5.14**, which the gate runs only as a formatter (`biome format`): `style/noProcessEnv`,
  `style/noRestrictedImports` (also reports `require`), and `nursery/noJsRestrictedProperties` for the named properties.
  An override's `includes` takes negated globs, so tests are left out. Running them means adding `biome lint` to
  `bun run check`. One GritQL plugin, scoped by the override, covers `new Date()` and `import.meta.env`
  ([apparatus/lint/no-ambient.grit](apparatus/lint/no-ambient.grit)).
- **What no built-in rule covers**: `new Date()` with no argument and `import.meta.env` (neither linter), and `require()`
  (Oxlint). `new Date` written without parentheses is covered by no linter and by the check alone.
- **The way round for the clock, restricting the global `Date`, is all false alarms on `main`.** Both linters have a
  rule that restricts a global name, and it would reach `new Date()` with no argument. It reports every use of `Date`:
  12 places in `scripts/lib/wall.ts`, which takes its time as a parameter and reads no clock
  ([results/linters-date-global.out](results/linters-date-global.out); configurations in
  [apparatus/lint/probe-date-global/](apparatus/lint/probe-date-global/)).

## What the check does not look at

The check names a fixed list. [results/not-covered.tsv](results/not-covered.tsv) counts, in the 10 modules on `main`, names
that read ambient state or act and are not on it: `process.argv` 4, `process.platform` 3, `process.exit` 4,
`process.kill` 1, `process.stdout` and `process.stderr` 2, `node:crypto` (random bytes) 1, `console` 2, and
`import.meta.url` 1. The positive control is the file `controls/other-names`, where each name reads 1 through the same
`grep -cE`; the negative control is `controls/injected`, which reads 0 for each.

## How sure

- **Firm:** the counts of places. Two implementations written differently agree on every module they were run on, and the
  controls read as expected.
- **A judgement:** whether a place is a defect, and whether a place is behind a finding. One reader made both, from the code
  at the snapshot; the lines are in the tables so each can be checked. The eight findings were chosen by a reading of the
  84 serious findings that knew every defect, as the classified-findings trial says.
- **What "reached" means:** the flagged place is among the flagged ones, not that the check would have drawn a reviewer to
  it. At the seven snapshots of the eight findings it flags 10 to 17 places, all of them present before and after the fix.
- **Not run:** adding the check to the gate, what it would flag in code written later, and whether code can be made to
  pass it. Four runs, two of them still in review when counted.
- **Settled, and no more:** a trial settles a fact about a tool. This one does not move the page's standing.

## Repeating it

```
R="bun --no-env-file --config=/dev/null"; A=raw/trials/2026-10-09-purity-check/apparatus
bun install --frozen-lockfile
git archive --format=tar e3bbb3c scripts | tar -x -C <main tree>
$R $A/purity-check.ts --root <main tree>                 # the 13 places
$R $A/cross-check.ts --root <main tree> --scope all      # token and syntax-tree versions
for c in effectful injected outside core-named every-rule not-flagged other-names; do
  $R $A/purity-check.ts --root raw/trials/2026-10-09-purity-check/controls/$c --count; done
$R $A/snapshots.ts --repo . --findings raw/trials/2026-10-04-review-findings-classified/data/findings.tsv --out <folder>
$R $A/constancy.ts --findings <same findings.tsv> --places raw/trials/2026-10-09-purity-check/results/snapshot-places.tsv
# the controls as one tree for the linters (two files share a name, so they are renamed)
C=raw/trials/2026-10-09-purity-check/controls; T=<controls tree>; mkdir -p $T/scripts/lib
cp $C/effectful/scripts/lib/helper.ts $T/scripts/lib/effectful.ts; cp $C/effectful/scripts/lib/helper.test.ts $T/scripts/lib/effectful.test.ts
cp $C/injected/scripts/lib/helper.ts $T/scripts/lib/injected.ts; cp $C/every-rule/scripts/lib/every-rule.ts $C/not-flagged/scripts/lib/not-flagged.ts $T/scripts/lib/
cp $C/outside/scripts/script.ts $T/scripts/outside.ts; cp $C/core-named/scripts/thing*.ts $T/scripts/
$R $A/lint-compare.ts --root $T                          # writes the lint configurations into $T; add --unscoped for the contrast
$R $A/lint-compare.ts --root <main tree>
bun test raw/trials/2026-10-09-purity-check/apparatus/
```

The snapshots of #216 and #268 need those runs' branches, or the commits, in the repository.
