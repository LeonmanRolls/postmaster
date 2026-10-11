---
kind: trial
subject: what two counts of mutation flag in the project's scripts, and whether the first reaches the serious review findings of four runs
date: 2026-10-09
---

# Method

**Question.** [Issue #372](https://github.com/brindlewick/postmaster/issues/372), the second half of
trial 4 on the research page ([functional core and verification](../../../wiki/concepts/functional-core-and-verification.md)).
Count mutation twice in the project's scripts: once for changes to something the function did not
create (the first count), once for every change including giving a local name a new value (the second
count, a contrast and not a pass mark). Then: how many of the 84 serious review findings of four runs
sit in a function the first count flags, in the code that round reviewed; and how many of the first
count's flags on the main branch a reader would call a hazard.

The page's two failure tests for the first count:

- **Test 1:** it fails if it flags more than about twenty places on the main branch that are not
  hazards.
- **Test 2:** it fails if it flags none of the 84 findings' functions.

## Order of work, so the controls mean something

1. The apparatus (`apparatus/`), the control inputs and what each is expected to read (`controls/`),
   the reading rule ([rubric.md](rubric.md)) and the two seeds of the draws below were committed
   before the first place was drawn or marked. The commit that holds them is the first commit of this
   folder.
2. Counts on the controls, on the main branch and at the 19 snapshots; the findings joined to their
   functions.
3. The draw of 30 places, the first reader's marks, the draw of 10 of the 30, the second reader's
   marks, the tally.

**What the first reader had seen before the draw.** While building the rule and checking its
categories the first reader looked at about eighty flagged places on the main branch, in the lists of
the categories and in the totals per module. None was marked then. The draw was made afterwards, from
the whole list, so some drawn places may have been glimpsed. The first reader had also read the
descriptions of the findings that sit in a flagged function (the join below was run first). The second
reader had seen none of this.

## Decisions that fix the counts

From the ticket (D1): both counts cover every non-test module under `scripts/`, and the first exempts
no module as being at the edge. The record tags each flagged place by whether its own function reads
the environment or the clock, touches files, starts processes or uses the operating system, so the
page's exemption for edge code can be read off afterwards.

**Settled with the user during the session, before any join or draw:** the first count holds every
kind of change to something the function did not create, whether or not the ticket's list names it.
The ticket's list is arguments, module-level variables and imports. The general line on the page,
"something the function did not create", also takes in process-wide objects such as `process.env`,
the object a method was called on, and a variable of an enclosing function changed from a nested
function. The user put all of them in the one count. Each place carries its kind (`root` below), so
a narrower reading is a filter on the same rows, and every table here shows the kinds beside the
total.

## The two counts

A **place** is one change. The rule finds, in each function and at each module's top level:

- a name given a new value: `=`, compound assignment (`+=`, `??=`, ...), `++` and `--`, and each name
  in a destructuring assignment or a `for (x of ...)` head;
- a property or an element given a value, with the same operators: `a.b = ...`, `a[i] += 1`, `a.n++`;
- the `delete` operator on a property;
- a call of a method on the ticket's list of those that change their object in place: `push`, `pop`,
  `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`, `copyWithin`, `set`, `add`, `delete`,
  `clear`, by name, since no type is known;
- `Object.assign` with the thing as its first argument.

Anything else that changes an object (`Object.defineProperty`, `Reflect.set`, a method of a class that
the rule cannot know) is not found, and is a limit.

**What a change lands on (`root`).** Decided from the scope analysis of the file, following the
change's object through properties and elements to a name:

| root | what it is | in the first count |
|---|---|---|
| `param` | an argument of the function, or of an enclosing one; including giving the argument's own name a new value | yes |
| `import` | an imported binding or a property of it | yes |
| `module` | a module-level variable, changed from inside a function | yes |
| `global` | a global such as `process` or `Bun`, or a local that is another name for one | yes |
| `this` | the object a method was called on; inside a constructor it is being built, so it is `local` | yes |
| `captured` | a variable of an enclosing function, changed from a nested function | yes |
| `local` | a variable the function itself declared, or a module-level variable changed by the module's own top-level code | no |
| `temp` | a value no name holds: a call's result, a new object, a literal | no |

A **local that is another name for something** takes the root of the thing (`alias` is 1): a local
whose declared value, or any value ever assigned to it, is an argument, a module-level value, an
import, a global, or `this`, or a property, element or `get`/`find`/`at`/`pop`/`shift` result of one,
or a conditional or `??`/`||` of one. A local that is the loop variable of a `for ... of` takes the
root of what it loops over, and a loop over a copy (`.slice()`, `.filter()`, `.concat()`, `.flat()`,
`.toSorted()`, `.toReversed()`, `.toSpliced()`, `.values()`, `.entries()`, `Object.values()`,
`Object.entries()`, `Array.from()`, `new Set(...)`, `new Map(...)`, or an array literal with a spread)
still hands out the original's elements. A local that holds what a call returned, or a literal, a
`new` or a copy, is the function's own, and so is a local that is another name for a variable captured
from an enclosing function (see the limits). The tracking is by syntax, not by flow: a name that is an
alias on one path is an alias everywhere.

The **second count** is every place, whatever it lands on. It is the first count plus the places on
`local` and `temp`.

**A function** is the innermost function declaration, function expression, arrow function or method
that holds the place; a place outside every function is at the module's top level. A function's
**tags** come from what lies inside its text, nested functions included: `env` (`process.env`,
`import.meta.env`, `Bun.env`), `clock` (`Date.now()`, `new Date()` with no argument,
`performance.now()`), `files` (a name imported from `fs`, `node:fs`, `fs/promises`; `Bun.file`,
`Bun.write`), `proc` (a name imported from `child_process`; `Bun.spawn`, `Bun.spawnSync`, `Bun.$`),
`os` (a name imported from `os`). The module's tags are the same over the whole file, with any
non-type import of those modules.

## Scope and versions

The modules counted are every `.ts` file under `scripts/` that is not a test (`*.test.ts`), not a type
declaration and not under `scripts/fixtures/`. The same selection runs at every commit.

- The **main branch** is pinned: commit `67d4ae255b4961140de3452139c2908d13520298`, the tip of
  `origin/main` when the counts were run on 2026-10-09. The branch moves; the record is of this commit.
- The **19 snapshots** are the commits the 19 review rounds looked at, named in
  [the findings table of the earlier trial](../2026-10-04-review-findings-classified/data/findings.tsv)
  (`snapshot` column). The 12 of runs #202 and #252 are on the main branch. The 4 of run #216 and the 3 of
  run #268 were, when this was run, only on local branches of those two runs, whose tickets are still
  open, so the record names every commit and keeps what the join needs of them (`results/`).
- Oxlint 1.86.0, the version the gate pins, runs the rule through its JavaScript plugin interface
  (`apparatus/mutation-rule.ts`). It was installed from the registry into a scratch folder; nothing
  was added to the project. Bun 1.4.2 runs every script of the apparatus, as
  `bun --no-env-file --config=/dev/null <script>`. The scripts use only Bun and Node built-ins, with
  `git` and `tar` for the export. They were run on Linux only. Nothing in them is specific to Linux
  that was found, but they have not been run on macOS.

## What is run

Each commit is exported with `git archive` (scripts only, no repository around it) into a scratch
folder. `<oxlint>` is the Oxlint 1.86.0 binary, `<work>` and `<out>` scratch folders.

    bun --no-env-file --config=/dev/null apparatus/count.ts --oxlint <oxlint> --work <work> \
        --repo <repo> --commit <sha> --label <name> --out <out>        # one commit
    bun --no-env-file --config=/dev/null apparatus/count.ts --oxlint <oxlint> --work <work> \
        --tree controls --label controls --out <out>                   # the controls
    bun --no-env-file --config=/dev/null apparatus/snapshots.ts --oxlint <oxlint> --work <work> \
        --out <out> --findings <findings.tsv> --repo <repo> --main <sha>   # the 19 snapshots and main
    bun --no-env-file --config=/dev/null apparatus/snapshots.ts --oxlint <oxlint> --work <work> \
        --out <out> --findings controls/findings.tsv --tree controls       # the same, on the controls
    bun --no-env-file --config=/dev/null apparatus/check-controls.ts controls <count out> <snapshots out>
    bun --no-env-file --config=/dev/null apparatus/summarise-join.ts results/findings-join.tsv
    bun --no-env-file --config=/dev/null apparatus/edge-tags.ts results/main-first-count-places.tsv
    bun --no-env-file --config=/dev/null apparatus/draw.ts <main's places.tsv from count.ts> <out>
    bun --no-env-file --config=/dev/null apparatus/tally.ts results

`count.ts` prints one row per module and a total (functions, lines, first count, second count) and
with `--out` writes every place and every module's row. `snapshots.ts` writes one row per commit with
both counts side by side, and one row per finding. `summarise-join.ts` counts the findings in flagged
functions by run and against chance; `edge-tags.ts` counts the first count's places by what they land
on, what they do and what their function touches; `draw.ts` makes the two draws; `tally.ts` tallies
the marks of both readers. The unit tests of the pure parts are in `apparatus/mutation-core.test.ts`.

## The controls

The same commands run on `controls/`: 29 small modules, each with the counts it is expected to read in
[controls/expected.tsv](controls/expected.tsv). They include the page's four, in files named for what
they do:

- `push-onto-argument.ts` pushes onto its argument: expected 1 in the first count and 1 in the second;
- `local-array.ts` builds a local array and returns it: expected 0 in the first (the second reads 2,
  the two pushes on the local);
- `local-let.ts` gives a local `let` a new value: expected 1 in the second (0 in the first);
- `const-map-filter.ts` uses only `const`, `map` and `filter`: expected 0 in the second (so 0 in both).

The rest control each kind of change and each kind of root, positive and negative: the thirteen
in-place methods, `delete`, `Object.assign` into an argument and into a new object, `++` and `+=`,
module-level variables and the module's own top-level code, an imported object, a local that is
another name for an argument, a part of one, an element of one, or a module-level array, a loop over
a filtered copy, `process.env`, a method and its constructor, a callback and the loop that does the
same, a call's result, a rest parameter, a loop counter, a shadowed name, destructuring, an optional
call. Every other count of the record has its controls too, run through the same command:

| count | controls | expected values |
|---|---|---|
| tags of a function | nine functions that each read the environment, the clock, a file, start a process, use the system, or touch none of them | [expected-tags.tsv](controls/expected-tags.tsv) |
| findings in flagged functions | nine findings joined to the control modules: in a flagged function, in one that is not, in one flagged only by the second count, at the module's top level, inside a callback, in the function around a callback, in a file the tree does not hold, on a runbook line, on no line; then the same summary on all of them (2 of 6 in a flagged function, the failure test not met) and on the one in a clean function alone (0 of 1, the failure test met) | [expected-findings.tsv](controls/expected-findings.tsv), [expected-summary.tsv](controls/expected-summary.tsv) |
| places in edge functions and modules, and by operation | the 50 places the first count holds in the controls: 8 in edge functions, 11 in edge modules; 32 in-place calls, 14 properties, 2 names, 1 `delete`, 1 `Object.assign`, counted by hand from the control files | [expected-summary.tsv](controls/expected-summary.tsv) |
| hazards among the marks, the estimate and the agreement | three mark lists on a population of 90: every place a hazard (reads 30, estimates 0 non-hazards), none a hazard (reads 0, estimates 90), and a mix of 10, 15 and 5 whose estimates (45 and 60), agreement (7 of 10) and kappa (0.49) were worked by hand and by a second implementation; a third of the population in edge functions | [expected-marks.tsv](controls/expected-marks.tsv), [marks/](controls/marks/) |

`apparatus/check-controls.ts` compares every reading with its expectation and exits 1 if any differ.
It reads 105 of 105 as expected ([results/controls-check.txt](results/controls-check.txt)). The
statistic itself is also run on a mark list against itself (10 of 10, kappa 1.00) and against a
seeded shuffle of itself (6 of 10, kappa -0.25), in the same report. The two hand-made places given
to the second reader as controls on the reader are in [controls/reader/](controls/reader/).

Faults the controls and the reading found, in order:

1. The first run of the controls with their expected values found that the clock reads
   (`Date.now()`, `new Date()`) were not tagged: Oxlint's scope analysis holds an entry for a builtin
   such as `Date` that has no declaration in the file, and the rule took the entry for a declared
   name. Fixed; the controls then read 38 of 38.
2. Reading flagged places on the main branch, before the draw, found a sort of `Object.entries(env)`
   read as a change to `env` (the call's result is a new array, and only a loop over it hands out the
   original's elements), and `Object.values(x)` read through its receiver `Object`. Fixed, and now
   a control (`iteration-aliases.ts`).
3. The totals of lines were one per module too high against `wc -l`, because a final newline leaves
   an empty last element. Fixed before the draw.
4. The rows for findings that cite a runbook or no line were one column short, so their description
   sat in the wrong column. Fixed after the draw; it changes no count, and the controls hold such rows.

## The findings join (check C1)

[data/findings.tsv](../2026-10-04-review-findings-classified/data/findings.tsv) of the earlier
trial has 84 rows, one per serious finding, with `location` (module and line) and `snapshot`. At
each finding's own snapshot, the finding's line is joined to the function that holds it: the
innermost function whose lines contain it (the smallest span; two sibling functions on one line tie,
and the tie is reported), or the module's top level. A finding is **in a flagged function** when a
place of the first count has that very function as its innermost function. The looser readings
(**within**: a place in the function or in one nested inside it) are in the table beside it. Of the 84
rows, 78 cite a TypeScript module and a line, 3 cite a runbook line and 3 cite `scripts/reach.ts` with
no line; the last six are reported apart and are not in any share.

**Chance.** To read the number against what it would be if findings fell on lines at random, each
file's share of non-blank lines that lie in a flagged function is computed at the same snapshot
(`file_share_first`), and the expected number of findings in a flagged function is the sum of those
shares over the 78 findings. This treats every non-blank line as equally likely to hold a finding. It
is a baseline, not a test: findings concentrate in the larger functions, which also hold more changes.

## The draw and the readers (check C2)

The first count's places on the main branch, sorted by module, line, column, target and method name,
are the population (360). The draw takes the first 30 after a seeded partial shuffle: step i swaps
item i with an item chosen from i to the end, using mulberry32, a 32-bit generator with a published
definition. Both the generator and the draw were checked against a second implementation of the same
algorithm (`apparatus/mutation-core.test.ts`). **The first seed is 372**, the ticket's number. The
second draw takes 10 of the 30, in the order they were drawn, with **the second seed, 373**. If the
population is 30 or fewer, all of it is taken. The draws are in
[results/sample-30.tsv](results/sample-30.tsv) and [results/sample-10.tsv](results/sample-10.tsv).

The first reader read all 30 against [rubric.md](rubric.md), with the function that holds each place
and the calls to it, and wrote a mark (hazard, harmless or unclear), the rubric question that
settled it and a one-line reason ([results/first-reader.tsv](results/first-reader.tsv)). Those marks
were committed before the second reader answered.

The second reader was given the rubric, 12 places in a different order with new item numbers
([results/second-reader-items.tsv](results/second-reader-items.tsv)), and a plain copy of the
`scripts/` folder of the main branch, and was told to read nothing else (its brief:
[results/second-reader-brief.md](results/second-reader-brief.md)). Twelve, not ten: two places made up
for the purpose were added as controls on the reader, in files placed in the copy beside the others,
one in which a function named and commented as a summary sets a field on the caller's order (a
hazard), and one that fills an output parameter named `out` (not a hazard)
([controls/reader/](controls/reader/)). The reader was not told which two they were. The second
reader is a language model, a different one from the first, working in a fresh context with no access
to the first reader's marks, the findings, this record or the page; the transcript of its tool calls
was searched afterwards for any path outside its folder and for the names of the first reader's files,
and found none.

The estimate of the places on the main branch that are not hazards is the population times the
share of the 30 not marked hazard, with the Wilson 95% interval for that share. It is given for
harmless alone and for harmless and unclear together, and the verdict of Test 1 under each.
Agreement of the two readers is the share of identical marks on the 10 and Cohen's kappa.

## Results

All figures are in [results/](results/), made by the commands above. The 105 controls read as
expected.

### The two counts (checks C3, C4)

On the main branch at `67d4ae2` (79 modules, 52,522 lines, 3,082 functions) the **first count flags 360
places and the second count 3,511**. The second is the first plus 3,053 changes to a variable the
function declared and 98 to a value no name holds (a call's result, a new object). Of the 360, by what
the change lands on and what it does ([results/edge-tags-main.txt](results/edge-tags-main.txt)):

| lands on | places | a name given a value | a property assigned | an in-place call | `delete` |
|---|---|---|---|---|---|
| an argument | 81 | 24 | 25 | 24 | 8 |
| a module-level variable | 44 | 34 | 9 | 1 | 0 |
| an imported binding | 0 | 0 | 0 | 0 | 0 |
| a process-wide object (29 are `process.env`, 5 `process.exitCode`, 3 `globalThis`) | 37 | 0 | 27 | 0 | 10 |
| the object a method was called on | 32 | 0 | 4 | 28 | 0 |
| a variable of an enclosing function | 166 | 79 | 8 | 79 | 0 |
| all | 360 | 137 | 73 | 132 | 18 |

At the 19 snapshots (one row per commit in [results/counts-by-commit.tsv](results/counts-by-commit.tsv))
the first count reads 323 to 422 and the second 3,112 to 3,949, on 45,000 to 48,500 lines; no import is
changed at any commit.

**Edge code.** The first count was run with nothing exempt (decision D1). Of the 360 places, 115 lie in a
function that reads the environment or the clock, touches files, starts processes or uses the
operating system, and 355 lie in a module that does. So the page's exemption for edge code, applied by function, would leave 245
places, and applied by module, 5.

### Findings in flagged functions (check C1)

Of the 84 findings, 78 cite a TypeScript line; 3 cite a runbook line and 3 cite `scripts/reach.ts` with
no line, and are in no figure below. Of the 78, **8 sit in a function that holds a place of the first
count**, and 21 sit in such a function or in one around it
([results/findings-summary.txt](results/findings-summary.txt), [results/findings-join.tsv](results/findings-join.tsv)):

| run | findings | in a flagged function | in or around one | in a function of the second count | expected by chance: first count, nested, second count |
|---|---|---|---|---|---|
| #202 | 30 | 1 | 8 | 23 | 1.7, 9.4, 19.2 |
| #216 | 17 | 3 | 5 | 11 | 2.4, 5.1, 10.5 |
| #252 | 14 | 0 | 4 | 7 | 0.5, 6.9, 8.5 |
| #268 | 17 | 4 | 4 | 16 | 1.3, 5.6, 11.1 |
| all | 78 | 8 | 21 | 57 | 5.9, 27.1, 49.2 |

The number is not zero, so the page's second failure test is **not met**. It is also not more than chance
would give: if each finding fell on a random non-blank line of its own file at its own snapshot, 5.9 would sit in a
flagged function, and 8 or more would be seen 23.3% of the time; for the looser reading 21 sit in or
around a flagged function where 27.1 are expected. The second count reaches 57 where 49.2 are expected. No
line tied between two functions, and one finding (216/bug-10) sits at a module's top level.

Reading the 8 ([results/findings-reading.md](results/findings-reading.md)): the flagged place bears on the
defect in 1 (216/bug-14, global regexes whose `lastIndex` is kept in module state), partly in 1, sits next
to the defect in 1, and has nothing to do with it in 5. That reading is the first reader's alone.

### Hazards among the flagged places (check C2)

Of the 30 places drawn from the 360, the first reader marked **4 hazards, 26 harmless and none unclear**
([results/marks-tally.txt](results/marks-tally.txt)). That puts about **312 of the 360 places (Wilson 95%
interval 253 to 341) outside the hazards**, well above the page's about twenty, with unclear counted either way
(there is none). The page's first failure test is **met**, and it holds at the low end of the interval.

| lands on | population | sample | hazard | harmless |
|---|---|---|---|---|
| an argument | 81 | 9 | 0 | 9 |
| a module-level variable | 44 | 2 | 2 | 0 |
| a process-wide object | 37 | 5 | 1 | 4 |
| the object a method was called on | 32 | 3 | 0 | 3 |
| a variable of an enclosing function | 166 | 11 | 1 | 10 |

The four hazards: a module-level delay set from 16 places in one test function and read by the helper
that builds each stub's environment (host-self-test.ts); a module-level regex's `lastIndex` reset inside
a predicate named `isDigitChar` (lib/text.ts); a flag kept on `globalThis` through a cast and read at two
exits (review-round.ts); and a `replace` callback that also collects into an outer array
(lib/wall.ts). Three of the four are changes to a module-level variable or a process-wide object, which are
7 of the 30 drawn (81 of the 360 places); the other 23 drawn hold one. This is a split made after the
fact on small numbers, not a test. By the page's exemption for edge code applied by function, 11 of the 30
lie in an edge function (1 hazard) and 19 do not (3 hazards); of the 245 places that would remain, about 206
(153 to 231) are not hazards, so the first failure test is met on that reading too.

**The second reader**, on the 10 places drawn from the 30, gave the same mark on **10 of 10** (Wilson 95%
interval 72% to 100%; kappa 1.00); both marked 2 as hazards (the delay and `isDigitChar`) and 8 as
harmless. On the two made-up places it read the hazard as a hazard and the harmless one as harmless. The
statistic read 10 of 10 against itself and 6 of 10, kappa -0.25, against a shuffle of itself.

## How sure

- **Firm:** what the rule finds, as the rule is defined, on the 20 commits. The 105 controls, which include
  the page's four, read as expected. A spot check, not a count: 16 places the rule called local and 16 it
  called a value no name holds, chosen at random, were read against the code and were all right, and
  the root of each of the 30 drawn places was as the code shows. That 8 of the 78 findings sit in a flagged function
  (21 with the nested reading) is a count, not an estimate.
- **Firm enough for the test it serves:** the page's first failure test. For it to read otherwise, fewer
  than about 6% of the 360 places would have to be harmless, against 26 of 30 drawn (interval 70% to
  95%), and a second reader agreed on all 10 it read.
- **Soft:** the share of hazards itself. It rests on 30 places, marked by one reader against a rubric the
  same reader wrote. Both readers are language models, the second a different one from the first, and neither
  maintains this code. The rubric settles some cases by rule (a write inside a predicate is a hazard;
  state changed from several places is a hazard), and both hazards among the 10 fall under those
  clauses, so 10 of 10 is agreement on the rubric's reading as much as independent judgement. The first
  reader also knew the review findings and had seen about eighty flagged places while building the rule.
  The reading of the 8 findings is one reader's. One reason in the first reader's marks says a delay is
  set at 17 places; it is 16 assignments and the declaration, and the committed marks are left as
  they were.
- **Not measured:** whether a rule against these changes would have found a defect a reviewer found, or
  fewer; whether code without them is easier to follow; how the counts would read in another
  project. The second count's yield is given as a contrast only.

## Limits of the rule

- It reads syntax and scope, not types or flow. A method on the ticket's list is found by name whatever
  its receiver is. Every method call among the 30 drawn was a real change.
- A local is another name for something by one step: its declared value, or any value ever assigned
  to it, and the loops and calls listed above. A name that is an alias on one path is an alias on every
  path (a `let env = process.env` that is later given a copy still counts). What a call returned is
  the function's own. A local that is another name for a variable captured from an enclosing function is
  read as a local; a trial change of the rule, not kept, that follows it adds 2 places to the 360.
- Other in-place changes are not looked for. A text search of the same modules finds 1 `Object.defineProperty`,
  4 `.append(` or `.prepend(` and 3 `process.chdir`, `umask` or `setuid`; no `Reflect.set` and no
  `Date` setter. Assigning to `lastIndex` and to `length` is found, as an assignment.
- The finding is joined to the innermost function by lines. The nested reading is beside it.
- The chance baseline treats each non-blank line of a file as equally likely to hold a finding. Findings
  fall in larger functions, which also hold more places, so it is a baseline and not a test.

## Changes made after the first commit

All visible in the history of this folder. Before the draw: the draw script, the function lines of a
place, the line count (fault 3 above) and the golden test of the draw. After the draw, none of which touches
`mutation-rule.ts`, `mutation-core.ts` or `count.ts`, so the population and the sample are as drawn: the
summary and tally scripts, the share of lines in or around a flagged function, the width of the rows
for findings out of scope (fault 4), the operation table of `edge-tags.ts`, and the controls of each.

After the pull request was opened, `main` brought in the lint rule against an explicit `any`, and the
wiki workflow lints these scripts. The syntax node (`Node` in `mutation-core.ts`) and the parts of
Oxlint's plugin interface the rule uses (`mutation-rule.ts`) are typed with named fields instead of
`any`, and a field a kind of node always has is read through `need`. No comment switches a rule off.
No count changed: the counts, the join, the draw, the tally and the controls were made again from
fresh exports of the same commits with the typed scripts, and every result file is byte for byte the
committed one.
