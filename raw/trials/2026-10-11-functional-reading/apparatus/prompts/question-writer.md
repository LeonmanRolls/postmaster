# Brief: the questions for a reading test of `scripts/{{MODULE}}.ts`

You are writing the question set for a reading-comprehension test of TypeScript code. A reader, a
language model that cannot run code, will see only one module's source and a short glossary of the
helpers it imports, and will answer your questions from the text. Your questions and their
ground-truth answers decide how reading is scored, so every answer must come from *running* the
module, never from your own reading of it.

**Module.** `scripts/{{MODULE}}.ts` in the checkout `{{CHECKOUT}}` (the repository at one fixed
commit). Do not modify any file in the checkout. Read the module and its test file
`scripts/{{MODULE}}.test.ts`; the reader will not see the test file or any other file. Run code with
`bun --no-env-file --config=/dev/null <script>` from the checkout root, or the way the tests do.

**Deliverables**, all in `{{OUT}}`:

1. `questions.json`: an array of `{ "id", "type", "prompt" }`, what the reader sees. A prompt holds
   every input it needs (inline text, a list, a short event stream) and states the exact answer
   format (an integer; a JSON array of strings; a JSON object; the word yes or no; ...).
2. `answers.json`: an object, id to ground-truth answer (a JSON value), from running the module.
3. `spec.json`: an object, id to what the harness needs to compute that answer (the call or command,
   the inputs; for a `change` question the constant's name and its new value).
4. `ground-truth.ts`: `bun --no-env-file --config=/dev/null {{OUT}}/ground-truth.ts <path to a copy
   of the module>` recomputes every answer by running that file and prints one JSON object, id to
   answer. It must work for any module path with the same exports and command line (import or run it
   by absolute path; for a `change` question, copy the module text to a temporary file in the same
   folder, replace the value of the named constant, which is always written `const NAME = <literal>`,
   run, and delete that one temporary file). Run it on the original and confirm it equals
   `answers.json` exactly, twice, so you know it is deterministic.
5. `glossary.md`: one line for each helper the module imports from another file: its name and what it
   does, precisely and briefly, verified by running it. A reader who cannot see the helper must be
   able to rely on the line.
6. `notes.md`: how many questions of each type, any question you dropped and why, and anything about
   the module that was hard to ask about.

**The questions.** 24, plus two controls.

- 10 `trace`: one call or run on a given input; the answer is the return value, the output, or a
  named part of it.
- 8 `state`: the answer depends on something carried across steps inside one run (a flag, a
  counter, a buffer, an accumulator, a remembered previous value, a cache, the order of steps). Give
  an input where that carried state matters.
- 6 `change`: "Suppose the constant NAME were V instead of what it is; for this input, what is the
  result?" Only named module-level constants.
- 1 `control-trivial`: answerable by reading one line (a constant's value, an exported name).
- 1 `control-undetermined`: the module and glossary do not determine the answer (it depends on the
  clock, the environment, or a file whose content is not shown). The expected answer is the string
  `"undetermined"`.

**Rules.** Every answer is a short deterministic value (at most 200 characters printed), and at
most 4 answers are booleans or yes/no. No answer may be guessable from names or comments alone. Each
question needs tracing the code, and a careful reader can get it right. Cover the whole module, not
only the entry function: vary the functions and paths exercised. Keep inputs small (at most 25
lines). No question may depend on the time, randomness, the environment, or files other than the
inputs you give. Do not mention mutation, state, style or any hypothesis in a question: they are about
behaviour only.

**Report** as your final message: the files written, the counts by type, and the exact command lines
to rerun the ground truth.
