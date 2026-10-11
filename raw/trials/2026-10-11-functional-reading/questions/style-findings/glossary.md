# Glossary: what `style-findings.ts` imports from other files

Each line was checked by running the helper. A "string constant" here is regular-expression source text: it is embedded with `+` or `${...}` into a `new RegExp(..., "u")`.

## From `./lib/proc.ts`

- `run(cmd, args, options?)`: runs `cmd` with `args` to completion, without a shell, and returns `{ code, out, err, timedOut }`; it never throws. `out` and `err` are the child's standard output and standard error as strings. `code` is the exit status: 127 (and `err` is `"<cmd>: command not found\n"`) when `cmd` does not exist, 126 when it cannot be executed, 128 plus the signal number when a signal ended it, and 128 with `timedOut` true when `options.timeout` (milliseconds) ran out. The other options are `cwd`, `env` and `input` (text written to the child's standard input).

## From `./lib/thrown.ts`

- `thrownCode(e)`: `e.code` when `e` is a non-null object, otherwise `undefined` (for a caught file-system error `code` is a string such as `"ENOENT"`).
- `thrownMessage(e)`: `e.message` when `e` is a non-null object, otherwise `undefined`.

## From `./lib/text.ts`

- `PY_S_CLASS`: string constant, the body of a character class (it is used inside `[` and `]`) that matches exactly these 29 characters: U+0009 to U+000D, U+001C to U+001F, U+0020, U+0085, U+00A0, U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F and U+3000. It differs from JavaScript's `\s`: it has U+001C to U+001F and U+0085 and lacks U+FEFF. U+200B is not in it.
- `PY_DOT`: string constant `"[^\\n]"`, an atom for any one character except line feed (a carriage return does match).
- `DOT_ALL`: string constant `"[\\s\\S]"`, an atom for any one character including line feed.
- `END_OF_STRING`: string constant `"(?![\\s\\S])"`, a zero-width test that is true only at the very end of the input; it is false just before a final line feed.
- `W_CLASS`: string constant `"\\p{L}\\p{N}_"`, the body of a class that matches one Unicode letter, one Unicode number or an underscore (a hyphen is not in it).
- `BOUND_R`: string constant `"(?![\\p{L}\\p{N}_])"`, a zero-width test that is true when the next character is not a Unicode letter, number or underscore, or when there is no next character.
- `pyLower(s)`: `s.toLowerCase()`.
- `pyTrim(s)`: `s` without its leading and trailing characters that are in the `PY_S_CLASS` set.
- `pyWords(s)`: `pyTrim(s)` split on every run of `PY_S_CLASS` characters, `[]` when nothing is left; `pyWords("a\u0085b  c")` is `["a","b","c"]` and `pyWords("a​b")` is `["a​b"]`.
- `digitValue(s)`: the string of ASCII digits that a string of Unicode decimal digits stands for (`"٤٥"` gives `"45"`); it throws an `Error` when `s` is empty or holds any character that is not a decimal digit (`"1a"`, `"4.2"` and `"²"` throw).

## From `node:fs` and `node:path` (standard Node.js; the cases the module relies on)

- `existsSync(p)`: true when `p` exists.
- `readFileSync(p, "utf8")`: the file's text; it throws when the file cannot be read, and the error's `code` is `"ENOENT"` when the file is missing.
- `join(...parts)`: the parts joined with `/` and normalized; `resolve(p)`: `p` made absolute against the working directory; `basename(p)`: the last segment, so `basename("/x/runs/T-1")` is `"T-1"`; `dirname(p)`: the parent, so `dirname("/x/runs/T-1")` is `"/x/runs"`.
- `posix.basename(p)`: the last path segment (`posix.basename("a/b.sh")` is `"b.sh"`).
- `posix.dirname(p)`: the parent path, and `"."` when there is none: `posix.dirname("package.json")` is `"."`, `posix.dirname("a")` is `"."`, `posix.dirname("a/b")` is `"a"`, `posix.dirname(".")` is `"."`.
- `posix.normalize(p)`: collapses `.` and `..` segments: `posix.normalize("a/./b/../c")` is `"a/c"`, `posix.normalize("a/..")` is `"."`, `posix.normalize("..")` is `".."`, `posix.normalize("../a")` is `"../a"`.
- `posix.join(a, b)`: joins with `/` and normalizes: `posix.join("", "a")` is `"a"`, `posix.join(".", "x")` is `"x"`, `posix.join("web/src", "../../api")` is `"api"`, `posix.join("sub", "..")` is `"."`, `posix.join("web", "../..")` is `".."`.
