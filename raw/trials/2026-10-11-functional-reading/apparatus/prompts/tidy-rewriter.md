# Brief: the tidy arrangement of `scripts/{{MODULE}}.ts`

You are producing one arrangement of a module for a reading-comprehension experiment: the *tidy*
arrangement, which gets the same amount of rewriting as another arrangement but keeps the module's
mutation as it is. The original is `scripts/{{MODULE}}.ts` in your checkout `{{CHECKOUT}}` (the
repository at one fixed commit). You rewrite it in place there. Touch no other file in the
checkout; put any scratch files you write in `{{OUT}}`.

## What "tidy" means here, all of it

1. **Same behaviour, exactly.** The same exports (names, signatures, return values) and the same
   behaviour as a script (arguments, output bytes, exit codes, error messages). Do not fix bugs. Do
   not change what any function returns for any input.
2. **Keep the way state is handled.** Keep loops, reassignment, accumulators, in-place methods and
   the changing state the original has. Do not remove mutation and do not add any: the two counts of
   changes (check c below) stay within 10% of the original's.
3. **Make it easier to read the way a careful engineer who tidies code would**: split long functions
   into smaller named ones, give variables clearer names, reorder definitions so a reader meets a
   thing before it is used, simplify conditionals, group related constants, add a short comment where
   the logic is not obvious, remove code that is provably unused.
4. **The amount of rewriting is part of the design.** Change about {{TARGET_DIFF}} lines (added plus
   deleted, as `git diff --numstat -- scripts/{{MODULE}}.ts` counts them), within 15% either way. That
   is how much rewriting the other arrangement of this module needed. Stop when you are there; do
   not go on tidying.
5. **Keep** the top-of-file comment and every comment that still describes code that remains; keep
   every exported name; keep every module-level constant's name and literal value in the form
   `const NAME = <literal>;` (the experiment edits some of them by name). Never mention this
   experiment in a comment.
6. Add no dependency and change no import beyond what you need.

## Checks, until all pass

a. `cd {{CHECKOUT}} && bun test --timeout 60000 scripts/{{MODULE}}.test.ts` passes, with the same
   number of tests as the original.
b. A differential check of your own, in `{{OUT}}/differential.ts`: it compares the original (`git
   show HEAD:scripts/{{MODULE}}.ts`, written for the check to
   `scripts/{{MODULE}}.__original.ts` in the checkout and deleted afterwards, a single file, never
   left behind) with your version on at least 300 varied inputs of the module's exported functions or
   its command line. Derive inputs from the examples in the module's test file and by simple edits of
   them (delete a line, duplicate a line, swap two lines, change a number, add a blank line).
   Zero differences.
c. The count of changes: `{{COUNT_SH}} {{CHECKOUT}}/scripts/{{MODULE}}.ts tidy` prints a row whose
   last two numbers are `first` and `every`. The original reads {{ORIG_FIRST}} and {{ORIG_EVERY}}; yours
   must be within 10% of each.
d. The type check passes: `<repo>/node_modules/.bin/tsc
   --noEmit -p {{CHECKOUT}}/tsconfig.json`, with no error in your file.
e. Lint passes: `<repo>/node_modules/.bin/oxlint -c
   {{CHECKOUT}}/.oxlintrc.json --deny-warnings {{CHECKOUT}}/scripts/{{MODULE}}.ts`.

## Report

Your final message, as text: lines before and after; the diff size by `git diff --numstat`; the test
result; the differential result (inputs compared, differences); the two counts; and 3 to 8 bullets
naming what you changed. Do not paste the file.
