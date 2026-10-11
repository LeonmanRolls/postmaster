# Notes: questions for `scripts/ticket-parts.ts`

Module read: `scripts/ticket-parts.ts` at commit `7b470584f728b61813639c410e8f2eefb22f1093` (the checkout
`fr/ck/ticket-parts-qw`, left untouched), with its test file `scripts/ticket-parts.test.ts` and the one
helper file it imports, `scripts/lib/ticket-sections.ts`. Every answer was produced by running the module
(`ground-truth.ts`), except q23, whose answer is the fixed word `undetermined`; two runs on the original
give identical output and equal `answers.json`.

## Counts

26 questions.

| type | count | ids |
|---|---|---|
| trace | 10 | q01 q03 q06 q09 q12 q13 q16 q18 q21 q25 |
| state | 8 | q02 q05 q08 q11 q14 q17 q20 q22 |
| change | 6 | q04 q10 q15 q19 q24 q26 |
| control-trivial | 1 | q07 |
| control-undetermined | 1 | q23 |

No answer is a boolean or yes/no. The longest answer prints at 161 characters. Every input is at most 25
lines (q20 has exactly 25). The ids are in a mixed order on purpose; the type is in the `type` field.

What each question needs the reader to trace:

| id | type | what it exercises |
|---|---|---|
| q01 | trace | `countSentences`: link masking with a trailing stop, a code span with no space around it, abbreviations in either letter case and not inside a word, a decimal, closers, a trailing space |
| q02 | state | the fence flag in the plain part: an unclosed, indented fence hides everything after it, yet the criteria heading is still found; a bullet list is no numbered criteria |
| q03 | trace | the plain-part rules: only the first code span is reported, a path keeps the closing backtick, an empty span, a span with inner spaces, rule order over text order, a flag next to an anchor, `line` words in both letter cases |
| q04 | change | `MAX_CRITERIA` = 2 with a last criterion that is not a fixture run |
| q05 | state | the command line: `--final` given twice, one file, a draft first line, the first printed line |
| q06 | trace | `clip` at 50, 60 and 80 characters, an exact-60 name that is kept, the link kinds (blob, tree, commit, raw, an issue link that gives none, an anchor), the draft line under `final` |
| q07 | control-trivial | a constant's value |
| q08 | state | the plain-part word count: skipped draft line, headings, fence lines, `#word`, a stray `#` word, tabs; exit status and first printed line without `--final` |
| q09 | trace | file, call, identifier and path rules with near misses for each, and one rule that wins over another |
| q10 | change | `MAX_CRITERION_WORDS` = 6: a criterion that continues on a second line, one exactly at the limit, the word and sentence counts in the note |
| q11 | state | decisions: a duplicate, a decision inside a fence, a numbered line that follows, citations from the checks, an out-of-order check |
| q12 | trace | the command line when no line is the agents heading (five near misses): status and both output counts |
| q13 | trace | the mark rule: five wrong marks, two lines that are not decisions |
| q14 | state | the checks list: a duplicate label, a check inside a fence, an indented item, three look-alike criteria headings, a numbered list that is not the criteria; the counts note |
| q15 | change | `TICK` = `~`: which spans hide a tag, which line gets a `code` finding, `C0` and an unlabelled check |
| q16 | trace | a ticket that starts with the agents heading: no numbered criteria, a level-4 heading, a later `##` heading, a sha with trailing text |
| q17 | state | criteria items: continuation lines, a column-0 bullet that closes an item, written numbers, 30 and 31 words, 2 and 3 sentences, a `##` inside a line |
| q18 | trace | the checks section found among look-alike titles; two of three checks missing |
| q19 | change | `MAX_CRITERION_SENTENCES` = 1 with abbreviation, link, closer and no-final-stop cases |
| q20 | state | technical notes: tags in and around code spans, a lone backtick, a continuation at column 0, malformed and lower-case tags, a fence, citations that do not exist, out-of-range checks; the counts note |
| q21 | trace | a byte-order mark and CR LF through the command line with `--final`, and a first line that only looks like a draft marker |
| q22 | state | the order of findings that share a line: plain rules, mark, no-criteria, uncited decision; the counts note |
| q23 | control-undetermined | a file whose content is not shown |
| q24 | change | `MAX_DECISION_WORDS` = 7: head not counted, a blank line inside an item, a number with a stop inside the text |
| q25 | trace | the fixture-run exemption: split over two lines, letter case, "scores cleanly" |
| q26 | change | `USAGE` replaced: two files given |

## How the answers are produced

`ground-truth.ts <module>` reads `spec.json` (a copy is embedded in the script and used when the file is
not beside it) and runs, for each id, either the module's exported `analyze` or `countSentences` (in a
child process, so that a hang or a crash costs one answer), or the module as a command in a fresh folder
that holds the input file. A `change` question copies the module to a temporary file in the module's
folder, replaces `const NAME = <literal>;` (one line, with or without `export`), runs, and deletes the
copy. A failed or hung computation gives the string `ERROR: <reason>` for that question only.

`spec.json`, per id: `type`, `call` (a sentence), `run` (`analyze`, `countSentences`, `cli`, `export`,
`fixed`, or `tuple` whose `parts` are runs on the same module), the input (`lines` joined with LF, or an
exact `text`), `final`, `file` and `args` for a command, `change` (`constant`, `value`, `literal`), and
`extract`, which says which part of the result is the answer (`of`: `findings`, `notes`, `status`,
`stdout`, `stderr`; `kind`, `line`, `prefix`, `map`, `capture`, `int`, `as`; or `tuple` of extracts).

## Dropped or changed

- A trace question that called `analyze` directly with a byte-order mark and CR LF text (it returns null)
  was dropped: it needed a second call on the same input. The same behaviour is asked through the
  command line (q21), and the null report through the command line in q12.
- A state question on overlapping claimed spans (path over file, call over identifier) was dropped after
  the coverage check below showed that q03 and q09 already cover it; the command-line flag question q05
  took its place.
- No question asks for the message of an unreadable file: it carries the operating system's own text.
  The unreadable-file branch and the unknown-option branch of the command line are therefore not asked
  about; the two-files branch is (q26).
- No yes/no question was written; a count or a list is harder to guess.

## Hard to ask about

- The header comment already lists every kind of finding, so a question about a kind alone is answerable
  from the comment. The inputs aim at what the comment does not say: a path keeps the closing backtick,
  code spans in the plain part are still scanned, only the first span is reported, rule order beats text
  order, a column-0 bullet or a heading closes an item, a continuation line with a tag counts for the
  note, a line starting `*word*` is not a bullet, and ties keep the order of the phases.
- Nearly all behaviour is regular expressions. I avoided inputs that rest on backtracking subtleties and
  used look-behind and look-ahead only where the outcome is plain.
- Limits are counted in words (30, 60) and in characters (50, 60, 80). To ask about an exact boundary I
  built the text from ten-character blocks, and the builder checks the word counts (30 and 31 words in
  q17).
- `main` is not exported, so five questions run the module as a command (q05, q08, q12, q21, q26): a
  rearrangement must keep the entry point (`import.meta.main`) and the exit codes.
- Only six constants can be edited as `const NAME = <literal>;` on one line with a JSON value: the four
  limits, `TICK` and `USAGE`. `PATH_RE` and `FILE_RE` are declared over two lines and the rest are
  regular-expression literals.
- `level3Sections` returns objects with an extra `level` field (always 3); the glossary says so.
- Nothing in the module reads the clock or the environment, so the undetermined control rests on a file
  that is not shown.

## Checks beyond the brief

- Each glossary line was run on the cases it relies on (a byte-order mark once, a lone CR, a fence of
  four backticks, an indented fence, a level-4 heading, a title with trailing words, 6, 7, 40 and 41 hex
  digits, an unreadable file).
- As a coverage check the writer made 318 single-edit variants of the original (comparison and logic operators,
  integer literals, deleted statements, edits inside regular expressions) and 66 variants that add a
  letter to a string literal, and ran `ground-truth.ts` on each. 273 of the 318 and 48 of the 66 give
  a different answer set. Of the 45 logic variants that do not, I read 39 as equivalent (a loop bound
  that reaches past the end and appends nothing that is read, a default argument that is never used, a
  guard that an earlier one repeats, a fallback that cannot be reached). Six are not: two edits in the
  check-label expression (its start anchor and its look-ahead) and the exit value 2 at the unknown-
  option branch and at the unreadable-file branch of the command line, which no question reaches. The
  18 surviving string variants are message texts that no answer prints.
- A read-only copy of an early draft of another arrangement, found in this output folder as
  `draft1.ts`, was run through `ground-truth.ts`: 25 of the 26 answers equalled the original's; q15
  differed (`13:note` for `12:note`), because that draft did not take the span character from `TICK`.
- While I worked, this output folder also held files written by another process (`base-out`,
  `base-tree`, `base-work`, `cases`, `differential.ts`, `draft1.ts`, `generators.ts`, `make-mutants.ts`,
  `mutants`, `mutants-result.txt`, `orig-for-compare.ts`, `run-mutants.sh`, `unicode-patch.py`). I did
  not write, change or delete any of them; my six files are `questions.json`, `answers.json`,
  `spec.json`, `ground-truth.ts`, `glossary.md` and this file.
