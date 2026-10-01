---
kind: trial
subject: whether a declarative rule format can express every rule of #135's private-data scanner
date: 2026-10-01
---

# Method

**Question.** Issue #208, criterion 3. #135's scanner keeps its rules as Python inside a bash
script: regular expressions, word lists, and code around them. A library would keep its rules
as data that people can read and extend without code. Which of #135's rules can such a format
express, exactly, and which need more?

**The format checked.** `apparatus/format.ts` defines it and runs it. A rule is a TOML table
shaped like a gitleaks rule: `id` (the rule name a finding reports), `regex` and `flags` (an
ECMAScript regular expression), `secretGroup` (the named group, or the first of a list of named
groups that took part, whose span is the finding; the whole match by default), `keywords`,
`minLength`, and `allowlists`, each a list of regular expressions tested against the secret,
the match, the line or a named group, any of which drops the finding. It adds two things gitleaks
does not have: `requires`, the same shape as an allowlist, all of which must match for the
finding to stand; and `check`, one name from a closed list of checks a regular expression cannot
make. The list holds one check, `ip-private`: an IPv4 or IPv6 address that is private,
link-local or in carrier-grade NAT space (RFC 6598), never loopback or unspecified, with the special-purpose
registries CPython 3.12's `ipaddress` carries.

**What #135's rules are.** `apparatus/load.py` reads `scripts/scrub-check.sh` from a git ref
with `git show`, takes the Python heredoc, drops its entry point and executes the rest, so the
rule table is the branch's own objects: `findings`, `RULES` and every compiled pattern. It
evaluates the scanner's own self-test fixtures, every `pos` and `neg` call, with the self-test's
own fragment assignments, so no value is written down anywhere in this trial.

**#135's rules in the format.** `apparatus/rules-135.toml`, written by hand, one entry per
pattern or function of #135's `findings`: 21 entries for 8 rules. Where Python's regular
expressions and ECMAScript's differ, the entry spells out Python's meaning: `\s`, `\S`, `\b`
and `.` (the file's header lists the classes used).

**The comparison.** `apparatus/check.ts`, run with Bun, compares the table's `findings` with the
format's on the same lines, rule by rule, as sets of (start, end, rule), offsets in code points:

- every line of every fixture of the self-test;
- generated lines: a seeded generator joins 1 to 7 fragments chosen from 36 kinds (key and value
  shapes, addresses, paths, hosts, tokens, trailers, punctuation, quotes, and the characters on
  which the two dialects differ: a no-break space, a byte-order mark, a zero-width space, an
  accented letter, a Han character and an emoji), and about a third of the lines open with a
  shape some rules anchor to the line's start. The fragments are built from pieces, as #135's
  self-test builds its own.

A rule is listed when the table names it and the format file has no entry for it; when an entry
is not valid in the format (an unknown key, a flag outside `imsuv`, a regular expression
ECMAScript cannot compile, a group that does not exist, a check not on the list); when the
format's findings differ from the table's on any line; or when the same entries find other spans
under Node than under Bun (`apparatus/node-run.ts`). For every entry the output gives the number
of lines it finds something on, so an entry that never fired cannot pass unseen. The output
names rules, fixtures, generated-line numbers and the fragments a line was built from, never a
line's text.

**Controls**, through the identical command:

- `apparatus/controls/table.sh`, a table in the same shape as #135's scanner with four rules and
  24 fixtures, and `apparatus/controls/rules.toml`. `ctl-widget`, a part number, is written in
  the format exactly: the positive control, expected not listed. Three negative controls, each
  expected listed for its own reason: `ctl-checksum`, a nine-digit serial with a check digit,
  whose entry is the nearest the format comes (nine digits, no check); `ctl-conditional`, whose
  entry keeps the table's Python conditional group, which ECMAScript cannot compile; and
  `ctl-missing`, which has no entry.
- Mutations of the real table: `--without <rule>/<field>` drops a field from every entry of a
  rule. Dropping the email allowlists, the UUID's account context, the IP check and the dotenv
  minimum length must each list that rule, which shows the comparison can fail on #135's own
  rules and not only on made-up ones.

**Probes.** `apparatus/probes.py` sends eight lines, built from fragments, through the
scanner's whole line pipeline (its `LineScanner`: ANSI stripping, JSON-string decoding,
markers), and prints the rules each produced. Each gap is paired with a control the scanner
finds: an assistant co-author trailer against Claude Code's documented default pull-request line
and its "Generated with" footer, with and without the emoji; a home path after an escaped newline
in a JSON string against the same path one level deeper, a JSON document held in a string; and,
alone, a thinking block whose reasoning is only in its encrypted `signature` and a reasoning item
with `encrypted_content`, both carrying 600 random bytes in base64.

**Versions.** `results/versions.txt`: the table at `1223cc0` on branch `135` (2026-10-01; the
branch is #135's run and not yet pushed), Bun 1.4.2, Node 24.21.0, Python 3.12.3. The branch
moved while this trial was written: round 5's `c47d246` changed the table. The entries stay
written against `1223cc0`, and the run also compares them with `c47d246`
(`results/table-later.txt`), to show what the change touched.

**Running it.** From the repository root,
`raw/trials/scanner-rule-format/apparatus/run.sh 1223cc0 c47d246` writes
`results/versions.txt`, `results/entry-points.txt` (each script's usage line, as the branch
states it), `results/table.txt` and `results/table-later.txt` (50,000 generated lines each),
`results/controls.txt` and `results/mutations.txt` (20,000 generated lines each) and
`results/probes.txt`, and exits 1 if a control does not behave. Every file in `apparatus/` scans
clean under the scanner it reads.

# Results

From `results/table.txt`: the format expresses all eight rules. 21 entries agree with the table
on all 50,093 lines (92 fixture lines, 50,000 generated), and Node finds the same spans as Bun on
every line. Every entry found something: from 110 lines for the dotenv entry to 4,327 for the
private path entry.

What that took, entry by entry, from `apparatus/rules-135.toml`:

- **One named check.** The IP entries keep `ip-private`; no regular expression in the file says
  which addresses the special-purpose registries hold.
- **`requires`.** A UUID counts only on a line with account context, and a secret field only
  when its value is 20 or more characters of a narrow class. Neither is an allowlist.
- **A list of value groups.** The key and value rules quote a value three ways, and the path
  rule has five shapes; the finding is whichever group took part.
- **Lookahead captures.** The path rule trims trailing punctuation from what it reports and
  checks the untrimmed user name against the placeholders. The entry captures both at once, in
  a regular expression of 1,290 characters.
- **Python's classes spelled out.** ECMAScript's `\s` takes a byte-order mark and leaves out
  five characters Python counts (four information separators and the next-line control); its
  `\b` and `\w` know only ASCII letters; its `.` stops at a carriage return. Each entry spells
  out Python's meaning (the file's header has the classes).
- **The dotenv function as one expression.** 36 lines of Python, with quoting, comments and a
  metacharacter test, become one regular expression of 1,098 characters. It agrees on every
  line; whether anyone would maintain it in that form is a judgement this trial does not make.

Controls (`results/controls.txt`): `ctl-widget` is expressed; `ctl-checksum` is listed for
disagreeing with the table on 135 lines, `ctl-conditional` because ECMAScript refuses its entry,
and `ctl-missing` for having none; the run exits 1. Mutations (`results/mutations.txt`): dropping
the email allowlists, the UUID's context, the IP check and the dotenv minimum lists each rule,
on 1,275, 457, 1,474 and 14 lines.

Against the later table (`results/table-later.txt`, 113 fixture lines, 21 of them new), the same
entries no longer agree for three rules: `account-id` on 416 lines, `key` on 140 and `token` on
78, beginning with new fixtures for compound field names and bare ids. Five rules are unchanged.

Probes (`results/probes.txt`): the trailer and the depth-1 path are found. Claude Code's default
pull-request line and both footers are not, the depth-2 path is not, and neither encrypted block
produces a finding.

# What it settles

Facts about this format and #135's table at `1223cc0`. Every rule of the table can be written as
data in the format, given one named check, `requires`, value-group lists, and Python's classes
spelled out, and the written rules agree with the table on every line compared, under Bun and
under Node. Agreement on these lines is evidence, not proof: a line no generator produced could
still separate them. A rule whose meaning rests on a check outside the closed list, as the
check-digit control's does, is beyond the format, so that list is the format's boundary. It does
not settle whether the format is pleasant to write, whether a gitleaks-compatible format (RE2,
with no lookaround) could express the same rules, or whether a library should be published.
