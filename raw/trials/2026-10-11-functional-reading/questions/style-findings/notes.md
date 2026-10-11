# Notes: questions for `scripts/style-findings.ts`

## Counts

26 questions: 10 `trace`, 8 `state`, 6 `change`, 1 `control-trivial`, 1 `control-undetermined`.
No answer is a boolean or yes/no. Answers are arrays of strings (19), arrays of integers (2), one object (state-1) and strings (4, among them the two controls). The longest printed answer is 166 characters as compact JSON. The longest input is 23 lines.

| id | what the answer depends on |
|---|---|
| trace-1 | `findings` fault rules (blank and non-finding lines, a missing or numeric detail, case, U+0085 against U+200B), physical line numbers |
| trace-2 | `shape` / `ENTRY` through `core("forms", file)` |
| trace-3 | `run-p` / `run-s` patterns (sorted, anchored only at the end), pre and post hooks |
| trace-4 | which package-manager subcommands run a script (`BUILTINS`, `npm start`, `bun run`) |
| trace-5 | `uncomment`, `subst`, tokens, `unwrap` (env, timeout, nice, xargs, `command -v`), `sh -c`, redirection, `$(...)` |
| trace-6 | make options (`-C`, `-j8`, `-f`, a target, `VAR=value`), `include` with a glob, recipe order |
| trace-7 | justfile: alias, parameterised dependency, variable, attribute line, a comment line that ends a recipe |
| trace-8 | runner config files: `;` and `#` comments, `/* */` and `//` comments in a JS config |
| trace-9 | `check` of linter lines: `plain`, `named` (`eslint_d` and `cspell-cli` do not name a linter), `npx`, `cat`, a script file that runs the linter |
| trace-10 | `pnpm-workspace.yaml` list parse (a column-0 comment ends the list), `--filter`, turbo `-F`, `**` |
| state-1 | `findings` map: a target logged again moves to the end, the last class wins |
| state-2 | `profile`: last heading, first `repo` and first `gate` win, `###` does not end a section |
| state-3 | working directory carried over script lines, subshell restore, nearest `package.json` |
| state-4 | `seen` set: scripts calling each other in a cycle, with hooks |
| state-5 | make variables: `=`, `:=`, `?=`, `+=`, a variable fixed on the command line |
| state-6 | make `current` target, conditionals, `define` block |
| state-7 | `firstNew`: a linter proposed twice in different case, with line numbers |
| state-8 | `states`: what the ledger last records, over many runs |
| change-1 | `SHOWN` = 2, two sources interleaved |
| change-2 | `LONG` = 28, a comment makes the raw line longer than the trimmed one |
| change-3 | `MARK` = `""`, bold markup becomes part of a field's value |
| change-4 | `MVER` requires a decimal point, so `-j 4` makes `4` a target |
| change-5 | `YARNRE` = `/^yarn@([3-9])/u`, so `yarn@2.4.3` is no longer berry |
| change-6 | `MANIFESTS` only `package.json`, so `ruff` named in `pyproject.toml` is unknown |
| control-trivial | the usage line printed with no arguments |
| control-undetermined | an action log whose content is not shown |

The six `change` answers all differ from the answers of the unchanged module (checked by running without the change): SHOWN 20 prints all 8 lines; LONG 4000 reaches `check, lint, format, types, test`; MARK prints `gate: npm run lint` and the `lint` script line; MVER prints `Makefile lint: ruff .`; YARNRE prints only `lint`; MANIFESTS prints one fault line and exits 2.

## How the answers were made

`ground-truth.ts` holds the 26 specs (the same objects as `spec.json`) and runs each one against the module path it is given. For a `cli` spec it writes the listed files under a fresh temporary working directory, builds a git repository `repo` whose single branch (named after the run directory, as the module reads it) holds the listed files, and runs `bun <module> <args>` there. For a `call` spec it imports the module in a fresh process and calls one export. For a `change` spec it copies the module text to one temporary file in the module's own folder, replaces the value of the named constant, runs that copy and deletes it. The controls: one is a run with no arguments, the other is the fixed string `undetermined`.

Spec fields: `kind` (`cli`, `call`, `fixed`), `args`, `files` (path to text, under the working directory), `repo` (`dir`, `branch`, `files`), `extract` (how the answer is read from the output: lines with optional `skip` and `drop`, script names, script texts, package dirs, text after the file part, fault numbers, id to target map, first words, first line, first line of standard error) and `change` (`constant`, `value`). An argument `@file:<path>` is the absolute path of that written file.

Checks made: the script was run twice on the original module and printed the same object both times, equal to `answers.json`; it was run on a copy of the module and its three helper files in another folder and gave the same object; it was run on a copy whose constants were reformatted (a type annotation, a literal on the next line, single quotes) and gave the same object; no temporary file is left in the module's folder. Every input was also run in process under `bun test --coverage`: the inputs reach 99.8 % of the lines of `style-findings.ts` (all but the three lines of `die`).

Reader check: two independent readers (one Sonnet, one Opus), each given only the module, this glossary and the prompts and told to run nothing, answered all 26 questions exactly as `answers.json` has them. They saw an earlier trace-9 (answer `[3,4,5]`); the version now in the set (answer `[1,4,5]`, with `eslint_d` and a script file that runs `biome`) was checked by running and by hand, not by a reader. Their remarks led to wording changes only: the script-line form no longer says `<dir>`, the committed files are said to be ordinary files, "printed" means standard output, and the answer format of the undetermined control is a plain JSON string. Each reader took about 12 minutes of tracing, so a strong reader with that time scores at the ceiling.

## Left out or dropped

- A direct call of `field` was dropped as a separate question. It is reached through `profile` in state-2 and change-3, and `core("forms")` stays as the one direct-call question.
- Symbolic links in `Tree.file`, the 512 KiB and NUL guards of `Tree.read`, `lerna.json`, `yarn workspaces foreach` and the byte-order-mark strip were not asked. A symlink needs a committed link, and the others are small.
- The `die` paths (no action log, a line that is not JSON, no branch named for the run) were not asked. They print a message to standard error and exit 1; they are the three uncovered lines.
- No yes/no questions. A boolean has a 50 % floor.
- A lookup that never ends is not asked about (see below).

## Hard to ask about

- Almost nothing is a pure exported function. Only `findings`, `field`, `shape`, `core`, `Makefile` and the regular-expression constants are exported; the shell, make, just and package reading is reachable only through `core` and a git repository on disk. The questions therefore give file listings and the command line.
- `gate` prints `./package.json scripts.NAME: ...` for a root package reached by `npm run` (`posix.dirname("package.json")` is `"."`), never `package.json scripts.NAME` without the `./`. Questions on package scripts ask for names, texts or directories, never a whole line.
- Some fault messages of `check` are longer than 200 characters, so those questions ask for the `line N` numbers or for one short message.
- Recipe lines of a Makefile start with a tab. The listings show `<TAB>` and say so.
- The `style` class word, the file name `style-sort.md` and the ledger text `style proposal ...` are inputs the module requires; they appear only as input data.
- The module has an unanchored-regex habit that is easy to misread and that some answers rely on: `field` (its comment says `re.match`; a `gate:` inside a longer line is found) and `scriptsLike` (`test:unit` also selects `pretest:unit` and `posttest:unit`). `hasLinter`'s file-name test is unanchored too, but no question uses it.

## A defect found while building

`Tree.up(cwd, names)` never returns when no name is found and `cwd` is not the root: `posix.dirname(".")` is `"."`, and the loop stops only on an empty directory. Minimal run: a repository whose only file is `sub/x`, gate `cd sub && just lint` (no justfile anywhere). The run hangs. The same happens for `npm run` below a directory with no `package.json` above it, and for a runner config looked up from a subdirectory. No question depends on it and no input reaches it; `ground-truth.ts` stops a run after 30 seconds and records `ERROR: ...` for that question.

## Rerun

```
bun --no-env-file --config=/dev/null /tmp/claude-1001/-home-brindlewick-postmaster--worktrees-research-366/89d34c04-06f8-40bc-816a-be5a96c271bd/scratchpad/fr/out/style-findings/ground-truth.ts /tmp/claude-1001/-home-brindlewick-postmaster--worktrees-research-366/89d34c04-06f8-40bc-816a-be5a96c271bd/scratchpad/fr/ck/style-findings-qw/scripts/style-findings.ts
```

It needs `bun` (1.4.2 was used) and `git`, and it writes only under the system temporary directory plus, for the six `change` questions, one temporary copy next to the module that it deletes.
