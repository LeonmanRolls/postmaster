# Notes: reading questions for scripts/view-stream.ts

## Counts

26 questions: 10 trace, 8 state, 6 change, 1 control-trivial, 1 control-undetermined.
No answer is a boolean or yes/no. Answer shapes: 21 arrays of strings (the printed lines), 2 objects
(q09: exit status and stderr; q19: line lengths and an ellipsis count), 1 integer (q04), 2 strings (q10,
q23). The longest answer prints at 188 characters (q14, with non-ASCII escaped; 183 as plain text).

Every prompt ends with the same sentence offering the answer "undetermined", so the one control that
needs it is not marked out by it. Ids are in a mixed order on purpose (types are interleaved, the
controls sit in the middle).

| id | type | what it needs the reader to trace |
|---|---|---|
| q01 | trace | claude events: init with no model, text plus thinking, a null and a string stray block, two tool_use blocks (key priority, non-object input), tool_result error with an array content, compaction |
| q02 | state | generic-type memory over 17 events: reset by every event that prints nothing or a line of its own (codex quiet type, pi tool end with and without an error, claude hook, blocked rate limit, thinking-only assistant message, pi agent end), kept across same-type repeats |
| q03 | change | READ_FILE_RE anchored at the end: which read_file results still yield a path |
| q04 | trace | cellWidth over eleven code points: combining, wide, halfwidth, the table edges (U+034F, U+3099) and neighbours that are neither |
| q05 | state | muse delta buffer: true and 0 appended, flush at a tool result, drop at a terminal record, flush at end of stream when the last line has no newline |
| q06 | trace | result lines: status fallbacks, integer, boolean and non-integer turns, boolean and string cost, round-half-even cost both ways (1.125 down, 0.375 up), negative cost, an allowed rate limit |
| q07 | change | WORDSEP_SIMPLE also splitting at hyphens, followed with COLUMNS=60 (width 50) |
| q08 | state | restating-result suppression against the latest assistant text, with trimming on both sides and a tool call in between |
| q09 | trace | order of argument checks (second file named before an unknown flag is reached) |
| q10 | control-trivial | name of the only export |
| q11 | trace | two-stage wrap: textwrap by code points, then cell-width split of the overflow, with ASCII words mixed into wide text (COLUMNS=32, width 23; the layout differs from the one at 22 and at 24) |
| q12 | state | mimo: session announced once per value and type (7, "7" and 7.0; true and "True"; "" and null ignored), error lines (data.message, name, event dump), step_finish |
| q13 | change | MIMO_TYPES shortened: events fall through to the codex error branch (event dump with a quote, backspace, form feed, array, boolean, null) and the generic branch |
| q14 | trace | codex events: numeric and string exit codes, junk file_change entries, tool call with a false server and no tool, error item, null token count, error with no message dumped Python-style (newline, tab, CR, `~`, DEL, non-ASCII) |
| q15 | state | generic-type memory is not reset by plain text and JSON scalars; an event with only "event" counts as its type; an event with neither falls back to "event"; a claude message that is a string takes the generic branch; padded plain line is trimmed |
| q16 | trace | --from is a byte offset that lands inside a multi-byte character (U+FFFD); the file ends with a truncated sequence (one more U+FFFD at the end of the data) |
| q17 | change | CONTROL widened to all of U+0000-U+001F: line feeds vanish after tabs and CR LF were rewritten |
| q18 | state | muse flush order (says before the session line), bookkeeping records never flush, whitespace-only buffer, a terminal record with an empty terminal field dropping the buffer and naming itself from its type, final flush |
| q19 | trace | two generic messages of 160 and 161 characters read from a file argument: the truncation boundary (`<=` against `<`) with the ellipsis, then wrap, indent and long-word break; answer is line lengths and the count of lines with an ellipsis |
| q20 | change | TOOL_KEYS reordered and shortened: claude tool_use lines and muse edit_facts both depend on it |
| q21 | state | only claude assistant text updates the remembered message (codex, pi and mimo texts do not; pi blocks other than text are ignored) |
| q22 | trace | muse tool.result facts: edit_facts against the JSON blob in text, read_file path in backticks after leading whitespace, outcome null, blob that is an array |
| q23 | control-undetermined | followed line carries the local time, so the exact text is not fixed by the inputs |
| q24 | state | follow mode: unterminated last line is shown before the end-of-stream flush of buffered deltas |
| q25 | trace | COLUMNS parsed with spaces, sign and underscore (50, so the 40-column floor), then the wrap with whitespace kept: a double space, a 45-character word broken in the middle of a partly filled line, an empty line inside the message (a time-only line) |
| q26 | change | LINE_BOUNDARY reduced to LF: a lone CR no longer ends a line in follow mode (the file ends with a lone CR) |

## Change questions: what the constant changes

| id | constant | answer with the real value | answer with the new value |
|---|---|---|---|
| q03 | READ_FILE_RE | read_file: a.txt, read_file: b.txt, read_file: c d.txt, read_file | read_file, read_file: b.txt, read_file: c d.txt, read_file |
| q07 | WORDSEP_SIMPLE | `says: run the `, `  pre-existing-condition-handling-routine then `, `  re-check the well-known-edge-cases today` | `says: run the pre-existing-condition-handling-`, `  routine then re-check the well-known-edge-cases `, `  today` |
| q13 | MIMO_TYPES | session m1, says: hi, bash, error: " (the name), done | session m1, says: hi, tool_use, error: {event dump}, step_finish |
| q17 | CONTROL | `says: a    b`, `c`, `d` | `says: a    bcd` |
| q20 | TOOL_KEYS | Bash: ls, Read: /a.ts, Grep: TODO, write: x.ts | Bash: List files, Read: /b.ts, Grep, write: d |
| q26 | LINE_BOUNDARY | ab, cd, session s1 | ab, session s1 |

Every change alters the result, so "no effect" is never the answer.

## Checks on the question set

- Function coverage: every function of the module is entered by some run except `sleep`, which only
  runs while a followed process is still alive.
- Trial readings: in each of three rounds, three independent model agents were told to read only the
  module, the glossary and the questions and to run nothing. All 26 answers matched the ground truth in
  every round; last single-agent checks covered q06, q25 and q11, which were edited after the third round.
  The agents rated q06, q11 and q16 hard and flagged no prompt as ambiguous. This shows the questions
  can be answered by reading; it also means they will not separate strong readers from each other.
- Mutation probe: 212 single-token mutants of the module's logic (equality, relational and logical
  operators, numeric and boolean literals, output string pieces, a few statement deletions; every
  fifth candidate from two offsets; the code-point tables left alone) were each run through
  `ground-truth.ts` and compared with `answers.json`. 162 were detected (157 by a changed answer, 2 by
  hanging, 3 by failing to run) and 50 were not; the last edit to q11 detects one more of those.
  The probe drove several of the inputs above (the numeric exit code 0 in q14, the null block in q01,
  the final line without a newline in q05, the lone CR at the end of q26, the truncated last byte in
  q16, the 160/161 boundary in q19, COLUMNS=50, 60 and 32 in q25, q07 and q11, the odd tie in q06).
  What is left undetected: dead or equivalent code (the initial `width`, the `lw < 1` clamp, denormal
  and 2^52 branches of the cost formatter, `parseInt` radix, buffer sizes), polling and deadline
  constants that only a live process reaches, the held-back bytes of a split UTF-8 sequence at a
  64 KiB read edge, the `--help` branch, the exit statuses of three argument errors, the COLUMNS
  rejection rules (sign, underscore placement, zero), the fallback of 170 columns, and the `state`
  branches of `mimo` (see below).

## Dropped, and why

- `--help`: prints the first 18 lines of the module's own file, so the answer is the header comment
  (guessable from comments) and it reads the file named `view-stream.ts` beside the module, which a
  copy under another name would not have. Dropped.
- A bare `--` argument: Bun consumes it before the module sees it (verified: exit 0, input read), so the
  module's "unknown argument" branch cannot be asked about with `--`. Dropped.
- Following a live process: with a live pid the viewer waits for it (up to 30 s for a missing file),
  and liveness depends on the process table. Every followed question uses a process that has exited.
- A pi tool-argument priority question: redundant with q01, q20 and q22, which already exercise the
  shared key priority.
- A change to TRAILING_NL: a plausible replacement has no observable effect (verified on CRLF and
  double-CR input), because JSON parsing and `pyTrim` already ignore a trailing CR. A change to
  UNDERSCORE or INT_SIGN_BODY would only restate q25. Dropped.
- Inputs that need the mimo `state` key (tool_use with an input or an error status): the prompt rule
  against the word "state" is applied to the whole prompt text, JSON keys included, so q13 uses a
  tool_use with only `part.tool`. The `state.status === "error"` and `state.input` branches of `mimo`
  are therefore not asked about.
- 64 KiB read boundaries and the held-back partial UTF-8 sequence at a chunk edge: unreachable with
  at most 25 short lines. Only the end-of-stream decode (q16 and the plain streams) is exercised.
- Panes of ten columns or fewer (width 1) and invalid COLUMNS values (a sign, a leading, trailing or
  doubled underscore, zero): they fall back to the 160-wide default or to one character per line, which
  makes poor questions next to q25; the rules are only exercised on their accepting side.
- The exit statuses of the "--follow needs --pid", "unknown argument" and "cannot read" branches: q09
  asks the order of two of the argument checks; a second argument question was not worth a slot.
- Divergences from Python that depend on JavaScript runtime facts the text does not show, verified by
  running and left out as unfair: integer-like keys come first in the error dump
  (`{"type":"error","2":"b","1":"a"}` prints `"1"`, `"2"`, `"type"`), numbers pass through doubles
  (12345678901234567890 prints 12345678901234567000, 1.0 prints 1), a leading byte order mark is eaten by
  the decoder, a cost like 1e23 prints its exact double.

## Hard to ask about

- There is no numeric named constant of the form `const NAME = <number>;`. `width` is a `let` that is
  reassigned at the start of every run, and `DUMP_SHORT`, `COMBINING` and `WIDE` carry type annotations;
  `QUIET`, `LSTRIP_RE` and `GENERIC` are not literals. So the change questions use array and regular
  expression literals only (one of them, TOOL_KEYS, spans several lines in the source; the ground truth
  replaces up to the first `;`).
- Wrapping is reachable with short inputs only in follow mode (width comes from COLUMNS, with a floor of
  40 where the pane allows it); outside follow mode the width is 160, so q19 uses 160- and
  161-character values. Follow-mode prompts therefore state COLUMNS (or that it is not set) and that
  standard output is a pipe, since `process.stdout.columns` is then undefined and the fallback of 170
  applies.
- Follow mode puts the local time on every line. Prompts tell the reader to drop the 8-character time
  and the one space after it; q23 is the question that does not, and its answer is "undetermined".
- The wrap keeps whitespace, so many correct outputs have leading or trailing spaces; prompts say that
  spaces are significant.
- q14 and q13 need layers of escaping in the answer (the printed line holds `\u00e9`, `\n` and `\"` as
  backslash sequences, which a JSON answer must double).
- A sum such as q04 can hide two offsetting mistakes; the code points were chosen so that the one
  binary-search mutation that would otherwise cancel out is caught.
- q16 and q11 ask for characters outside ASCII (U+FFFD, CJK); code points are named in the prompt.

## Ground truth

`ground-truth.ts` embeds the same data as `spec.json` and recomputes every answer by running the module
as `bun --no-env-file --config=/dev/null <module> <args>` with a pipe on stdout and the declared stdin
and environment (COLUMNS and POSTMASTER_PROC_ROOT removed unless the question sets them).

- `args` may hold `{dir}` (a fresh temporary directory holding the question's `files`) and `{deadpid}`
  (99999999, which no process can have, so the viewer sees "already exited" at once). A file given as
  `{utf8, appendHex}` is the text followed by raw bytes (q16).
- `extract`: `lines` (stdout lines), `lines-unstamped` (lines with the leading `HH:MM:SS ` removed, a
  time-only line becomes the empty string, a line with no time at all is reported as `NO-TIME:<line>`),
  `line-lengths`, `lengths-and-ellipses` (code points per line, and how many lines hold U+2026),
  `result-lines` (the stdout lines that start with `result:`), `exit-stderr` (exit status and the
  stderr text minus its final newline), `first-unstamped-or-undetermined` (the string "undetermined"
  when the first line opens with a time of day, else that line).
- A `call` question imports the module and calls the named export; `exports` returns the export name.
- A `change` question copies the module text to `<module dir>/<module name>.gt-<pid>-<id>.ts`, replaces
  the declaration `const NAME = <literal>;` (at the start of a line, an `export` prefix, indentation and
  a type annotation tolerated; exactly one match is required; the literal runs to the first `;`), runs
  that copy and deletes it.
- A question that fails to run (timeout 20 s, load error) answers `"ERROR: ..."` and the others go on.

Checks run on the final build: the printed object equals `answers.json` (same keys, same values) on the
checkout's module, twice, byte-identical, from a different working directory; on a plain copy of the
module under another file name it is equal too. The same script, one build earlier, was also run with
COLUMNS=33 and TZ=Asia/Tokyo in the ambient environment with the same result. The checkout's `git status`
stayed clean.
