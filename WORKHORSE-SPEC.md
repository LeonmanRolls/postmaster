# Workhorse spec: 135 Scan every commit for private data before it can merge

## Summary

A raw task transcript landed under `raw/` carrying session context: an email alias, an
organization id, the full text of a private instructions file, and assistant attribution.
Nothing enforced the scrub. This workhorse adds `scripts/scrub-check.sh`, which walks every
commit from base to head, flags added lines whose shape looks like private data, reports
each suspect by commit, path, line and kind without printing any matched value, and is
wired into the project's checks so no change ships unscanned.

## Technical context

- **Language and version**: Bash with a Python 3.11 heredoc, matching `scripts/skill-refs.sh`
  and `scripts/ticket-check.sh`. Executable, `set -uo pipefail`, header comment, `--help`,
  `--self-test`.
- **Dependencies used or added**: none beyond git and Python 3 already required by the repo.
- **Testing**: `scripts/scrub-check.sh --self-test` prints every control as an `ok` line and
  exits 0 only when all pass. The project gate runs it via `.postmaster/project.toml`.
  `bash -n scripts/scrub-check.sh` and the full `verify.sh run .` gate also apply.
- **Constraints**: no real private values anywhere; patterns recognise shape and context,
  never a values list; the script's own source must scan clean; fixtures are invented values
  in scratch git repos under mktemp; no output path ever prints a matched value; side-effect
  free (read the repo, print, exit); every path quoted.

## Direction check

| Direction / rule | How this plan meets it |
|---|---|
| Match by shape and context, never a file of real private values | Patterns are regexes over key/value context, token prefixes, path shapes, RFC 1918 ranges, attribution trailer forms. No values file exists; the allowlist holds only user-ruled values and ships empty. |
| A file holding all the private values is still bad | No values file is designed, read or created. Fixtures are invented at runtime in mktemp scratch repos. |
| The script's own patterns must not flag its own source | Patterns are written so their source form is not a match of themselves (character-class breaks in literals, values required after keys). Verified by scanning this branch clean before ship. |
| Lanes use made-up fixture values only | Self-test fixtures use example domains, example keys, obviously fake ids. Nothing under `~/.postmaster` or the real private instructions file is read. |
| Nothing repo-specific | The script discovers the repo from its own location / the scanned git root. |
| Deterministic work in `scripts/` | The whole feature is `scripts/scrub-check.sh` plus a committed `scripts/scrub-check.allow` (empty) and `.postmaster/project.toml`. |
| Every count needs a control | `--self-test` has positive and negative controls per kind, plus deleted-line, allowlist and history controls. |
| A prompt lives in argv / never print a matched value | Suspect lines carry commit, path, line, kind only. Diagnostics and self-test output use kind names and fixture labels, never values. |
| Read-only scan | The script reads git objects and the allowlist; it writes nothing. |

## Structure

- `scripts/scrub-check.sh` — the scanner, `--help`, `--self-test`, `<base> <head>`, `--history [ref]`.
- `scripts/scrub-check.allow` — allowlist file, committed empty (no entries).
- `.postmaster/project.toml` — committed with `git add -f`; declares a `scrub` check that
  joins the default gate (`[checks.scrub]`, no `[checks.gate]`).
- `raw/README.md` — names the script as how a raw file's scrub is checked (AC7).
- `WORKHORSE-SPEC.md` (this file), `WORKHORSE-SUMMARY.md` at the end.

## Complexity tracking

None: the plan follows the ticket's direction without departure.

## Decisions

1. **Kind names** (the `<kind>` in output): `key`, `email`, `account-id`, `home-path`,
   `private-host`, `token`, `attribution`, `private-instructions`. Short, stable, one per
   AC1 class.
2. **Matching approach**: line-oriented regex over each added line. `key` matches a known
   sensitive key name with a `:` or `=` value and reports the value span. The other kinds
   match their shape on the line and report the matched span. One suspect per match; a line
   can yield several suspects of different kinds.
3. **Self-avoidance**: literal phrases that must be recognised (attribution trailers,
   instructions-file sentences) are written with a one-character character-class break in
   the pattern source (e.g. `Co[-]Authored-By`) so the source text is not a match of its own
   pattern. Key names in patterns appear bare and only match with a following value. Paths,
   hosts and tokens use metacharacter-heavy regexes whose source form does not satisfy them.
4. **Email rule**: flag any address-shaped token except those whose local part is a public
   no-reply name (`noreply`, `no-reply`, `donotreply`, `do-not-reply`, `no_reply`) and those
   at documentation domains (`example.com`, `example.org`, `example.net`, `example.invalid`).
   Fixture addresses use non-documentation domains so positive controls fire.
5. **account-id**: opaque id shapes (`org_`, `acct_`, `account_` prefixes with a long token)
   and UUIDs that sit on a line with account/org/user/identity/credential context, so a bare
   example UUID in prose does not fire. Keyed forms (`organizationUuid: <id>`) are `key`.
6. **home-path**: `/home/<user>/…`, `/Users/<user>/…`, `/root/…` with further segments, and
   harness scratch prefixes (`/tmp/` + harness name + `-` + id, `~/.claude/`, `~/.postmaster/`,
   `~/.ssh/`, `~/.config/`). Pattern source is written so `/home/` in the regex is not itself
   a path with a user segment.
7. **private-host**: RFC 1918 and link-local IPv4 literals; hostnames ending in `.local`,
   `.lan`, `.internal`, `.home`, `.private`, `.intranet`, `.corp`. IPv6 unique-local
   (`fc`/`fd`) and link-local (`fe80`) are included.
8. **token**: known key prefixes (OpenAI `sk-`, GitHub `ghp_`/`gho_`/`ghu_`/`ghs_`/`github_pat_`,
   AWS `AKIA`, Slack `xox[baprs]-`, PEM private-key armor) and a generic shape for a long
   unbroken token in a value position (after `:`/`=`/`Bearer `). Plain 40-hex git SHAs are
   not flagged.
9. **attribution**: trailer/footer forms that credit an assistant or vendor: a `Co-Authored-By`
   trailer line, a `Generated with` footer naming an assistant product, a `generated-with`
   footer token. Discussion of the policy without a trailer colon+value does not fire.
10. **private-instructions**: sentences of the kind a private standing-instructions file
    carries, detected by phrase shape (ownership of a machine by a person/handle; a committer
    identity binding; a directive not to identify the account holder; a ban on AI attribution
    markers; an opening that names standing instructions for agents on a machine). Pattern
    source is self-avoiding as in (3).
11. **History implementation**: `--history [ref]` runs `git rev-list <ref>` (every commit)
    and scans each commit's own patch against its first parent (root commits against the
    empty tree). Same suspect format; exit 1 when any exist, 0 when clean. Default ref `main`.
12. **Allowlist path**: `scripts/scrub-check.allow` at the scanned repo's root (the git
    top-level of the range being scanned). Missing file = no entries. Blank lines ignored.
    Suppression: exact equality with the matched value span, or with the whole added line.
13. **AC5 wiring**: a committed `.postmaster/project.toml` (force-added past the gitignore)
    declares `[checks.scrub]` with `command = "scripts/scrub-check.sh main HEAD"` and a
    `shows` line. No `[checks.gate]` is declared; the stand-in gate remains the default gate
    and the scrub check joins it through `verify.sh`. The command scans the branch's commits
    against `main`; an empty range is clean.
14. **Line numbers**: the hunk's `+` lines are numbered as they appear in the new file, from
    the hunk header's new-file start, so `<line>` is a line number a reader can open.
15. **Merge commits**: scanned as ordinary commits against their first parent; a pure merge
    usually adds nothing and is clean. Every non-merge commit in the range is scanned, which
    is what catches a line added and later deleted.

## Tasks

- [ ] T001 [P] [AC2] Create `scripts/scrub-check.sh` with `--help`, pattern engine, allowlist
  reader and scan of `base..head` added lines, never printing a matched value.
- [ ] T002 [AC1] Implement all eight kinds (`key`, `email`, `account-id`, `home-path`,
  `private-host`, `token`, `attribution`, `private-instructions`) as shape-and-context
  regexes that do not match their own source.
- [ ] T003 [AC3] Emit `<commit>:<path>:<line>: <kind>` on stdout only for suspects, notices
  on stderr, exit 0 clean / 1 suspects / 2 usage; no value ever printed.
- [ ] T004 [AC4] Read `scripts/scrub-check.allow`; suppress on exact match of value span or
  whole line; ship the file with no entries.
- [ ] T005 [AC8] Implement `--history [ref]` (default `main`) over every commit of the ref's
  history, same output and exit codes, no values printed.
- [ ] T006 [AC6] `--self-test` with, for each kind, a positive control (fixture flagged) and
  a negative control (clean fixture passes); a control that a line added and then deleted is
  still flagged; a control for an allowed match and a not-yet-allowed match; usage and empty
  range controls; all printed as `ok` lines.
- [ ] T007 [AC5] Commit `.postmaster/project.toml` (`git add -f`) declaring `[checks.scrub]`
  that runs `scripts/scrub-check.sh main HEAD`, joining the default gate without redeclaring
  it.
- [ ] T008 [AC7] Extend `raw/README.md` to name `scripts/scrub-check.sh` as how a raw file's
  scrub is checked before promotion.
- [ ] T009 [AC1] [AC2] Run `scripts/scrub-check.sh main HEAD` on this worktree's own commits
  and ship the branch clean: patterns catch fixtures but not their own source or the docs.
- [ ] T010 [AC3] [AC6] Confirm with a positive and a negative control that stdout carries
  only suspect lines and that no control output prints a matched value.
