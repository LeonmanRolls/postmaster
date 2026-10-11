# Brief: the functional arrangement of `scripts/{{MODULE}}.ts`

You are producing one arrangement of a module for a reading-comprehension experiment: the
*functional* arrangement. The original is `scripts/{{MODULE}}.ts` in your checkout `{{CHECKOUT}}`
(the repository at one fixed commit). You rewrite it in place there. Touch no other file in the
checkout; put any scratch files you write in `{{OUT}}`.

Write it the way a careful engineer who prefers this style would: named intermediate values, small
single-purpose functions, no clever one-liners, no point-free puzzles, no deeply nested reduce
chains. It must read well; it will be read by someone who has to follow it.

## What "functional" means here, all of it

1. **Same behaviour, exactly.** The same exports (names, signatures, return values) and the same
   behaviour as a script (arguments, output bytes, exit codes, error messages). Do not fix bugs. Do
   not change what any function returns for any input.
2. **Nothing is changed after it is made.** No variable is reassigned after its initialisation (`let`
   only for a variable assigned once; prefer `const`). No assignment to a property or element of
   anything. No in-place method: `push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`,
   `fill`, `copyWithin`, and `set`, `add`, `delete`, `clear` on a Map, Set or object (use `map`,
   `filter`, `reduce`, `flatMap`, spread, `slice`, `toSorted`, `toReversed`, `new Map(...)`,
   recursion). No `++`, `--`, `+=` and the like. No `delete`. No `Object.assign` onto an existing
   object. No class with fields that change: use plain immutable data and functions that return new
   values. No module-level variable that changes.
3. **Decisions are kept apart from effects.** Reading files, writing output, exiting, reading the
   clock or the environment, and spawning processes happen at the edges, in the entry function(s).
   Everything that decides what to do is a function that takes its inputs as arguments and returns a
   value.
4. **State carried through a loop** is expressed as a fold or as recursion over an explicit
   immutable state value. A loop that only reads may stay a `for...of`.
5. **Keep** the top-of-file comment and every comment that still describes code that remains; keep
   the names of functions and constants that survive; keep every module-level constant's name and
   literal value in the form `const NAME = <literal>;` (the experiment edits some of them by name).
   Add a short comment only where the new structure needs one. Never mention this experiment, or
   immutability, in a comment.
6. Add no dependency and change no import beyond what you need.

If one small place cannot be done without a change after creation (a driver loop that reads from a
stream, say), keep it as small as possible, at an edge, give its function a name ending `Edge`, and
list it in your report. Leave mutation nowhere else.

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
c. The count of changes: `{{COUNT_SH}} {{CHECKOUT}}/scripts/{{MODULE}}.ts functional` prints a row
   whose last two numbers are `first` (changes to something the function did not create) and `every`
   (every change, locals included). The original reads {{ORIG_FIRST}} and {{ORIG_EVERY}}. Aim for 0 and
   0.
d. The type check passes: `/home/brindlewick/postmaster/.worktrees/research-366/node_modules/.bin/tsc
   --noEmit -p {{CHECKOUT}}/tsconfig.json`, with no error in your file.
e. Lint passes: `/home/brindlewick/postmaster/.worktrees/research-366/node_modules/.bin/oxlint -c
   {{CHECKOUT}}/.oxlintrc.json --deny-warnings {{CHECKOUT}}/scripts/{{MODULE}}.ts`.

## Report

Your final message, as text: lines before and after; the test result; the differential result (inputs
compared, differences); the two counts; every `Edge` exception with its reason; and 3 to 8 bullets
naming the structural moves you made. Do not paste the file.
