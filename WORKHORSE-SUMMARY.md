# Workhorse summary: 135 Scan every commit for private data before it can merge

## Commits on this branch

1. `6d2cbd6` Add workhorse spec for #135 — `WORKHORSE-SPEC.md`, committed on its own before
   any code.
2. `684fef0` Add scrub-check.sh: scan commits for private-data shapes — `scripts/scrub-check.sh`
   and `scripts/scrub-check.allow` (comments only, no entries).
3. `6e2c4d7` Wire scrub-check into the project checks and raw promotion —
   `.postmaster/project.toml` (force-added) and `raw/README.md`.
4. `0f9821d` Keep spec examples from matching scrub-check's own patterns — prose in the spec
   rewritten so the first commit's added lines scan clean under the finished patterns.

## Checks

the tool's `scripts/verify.sh run .` from the worktree root, run just
before this summary was written:

```
gate: pass, exit 0, 424s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

That is the run's only recorded check (`gate [default:gate]`). Other commands run, with
exit codes:

- `bash -n scripts/scrub-check.sh` — exit 0.
- `scripts/scrub-check.sh --help` — exit 0.
- `scripts/scrub-check.sh --self-test` — exit 0; all controls printed `ok`, including
  "this branch scans clean".
- `scripts/scrub-check.sh main HEAD` — exit 0, no suspects on this branch's commits.
- `bash -e -o pipefail -c 'scripts/scrub-check.sh main HEAD'` (the declared check's
  command form) — exit 0.
- `scripts/scrub-check.sh --history main` — exit 1, 1329 suspects, values not printed.
  This is AC8 working: the user rules on those history suspects.
- `scripts/verify.sh checks . --gate "bash -c 'true'"` —
  shows `gate [default:gate]` and `scrub [declared] scripts/scrub-check.sh main HEAD`.

## Decisions

- **Kind names**: `key`, `email`, `account-id`, `home-path`, `private-host`, `token`,
  `attribution`, `private-instructions`. One per AC1 class.
- **Matching**: line-oriented regex; `key` matches a known sensitive key with a value and
  reports the value span; the others match their shape and report the matched span. One
  suspect per match. Template placeholder values after a key (`<id>`, `...`, `null`) are
  not suspects.
- **Self-avoidance**: literal phrases use a one-character class break in the pattern source
  (`Co[-]Authored-By`, `identif[y]`) so the source is not a match of itself; keys match only
  with a following value; home-path regexes require a user or path segment after the root.
  Self-test fixtures are composed at runtime from split pieces in scratch git repos under
  mktemp, so no matchable form appears in `scripts/scrub-check.sh`.
- **Email rule**: flag every address except a public no-reply local part (`noreply`,
  `no-reply`, `donotreply`, and kin). Fixture addresses use invented non-example domains.
- **account-id**: opaque `org_`/`acct_`/`account_` tokens, or a UUID on a line with
  account/org/user/identity/credential context.
- **home-path**: home-directory roots with a user segment, harness temp-dir prefixes, and
  private dot-directories with a path segment after them.
- **private-host**: RFC 1918 and link-local IPv4, unique-local and link-local IPv6, and
  hostnames in private TLDs (`.local`, `.lan`, `.internal`, and kin).
- **token**: known key prefixes plus a generic unbroken token after a value marker; bare
  git SHAs are not tokens.
- **attribution**: trailer and footer forms that credit an assistant or vendor, with a
  colon and value so discussion of the policy does not fire.
- **private-instructions**: sentences of a private standing-instructions file (ownership of
  a machine, committer identity binding, a directive not to identify the account holder, a
  ban on AI attribution, a standing-instructions heading).
- **History**: `--history [ref]` runs `git rev-list <ref>` and scans each commit's own
  patch against its first parent (root commits against the empty tree). Default ref `main`.
- **Allowlist**: `scripts/scrub-check.allow` at the scanned repo's root; missing file means
  no entries; `#` comments and blank lines ignored; suppression by exact equality with the
  matched value span or the whole added line. Shipped with no entries.
- **AC5 wiring**: a committed `.postmaster/project.toml` declares `[checks.scrub]` with
  `command = "scripts/scrub-check.sh main HEAD"`. No `[checks.gate]` is declared; the
  stand-in gate stays the default gate and the scrub check joins it through `verify.sh`.
  The command scans the branch's commits against `main`; an empty range is clean.
- **Line numbers**: hunk `+` lines numbered as they appear in the new file, from the hunk
  header's new-file start.

## Not done, and why

- No changes to the stand-in gate command text: the brief forbids redeclaring the gate
  until #17.
- No values file and no reading of the real private instructions file or anything under
  the postmaster home for values: the ticket forbids both.
- No entry in `scripts/scrub-check.allow`: the brief says the tree must scan clean by
  design of the patterns, not by self-allowing.
- `--history` on the real `main` reports existing suspects (1329 lines) and exits 1. That
  is AC8 doing its job; those are for the user to rule, not for a workhorse to scrub or
  allow.

## Acceptance criteria

- **AC1** — met. `scripts/scrub-check.sh <base> <head>` walks every commit in the range and
  matches all eight kinds by shape and context.
- **AC2** — met. No file lists real private values. Fixtures are invented at runtime in
  mktemp scratch repos. Patterns are shape-and-context only.
- **AC3** — met. The script decides nothing: exit 0/1/2, stdout is only
  `<commit>:<path>:<line>: <kind>` lines, never a value. The gate's scrub check stops a run
  with those lines for the postmaster to put to the user.
- **AC4** — met. `scripts/scrub-check.allow` holds one exact allowed value per line; a
  match is suppressed when an entry equals the value span or the whole line. Shipped empty.
- **AC5** — met. `.postmaster/project.toml` (committed) declares the scrub check, which
  joins the default gate in `verify.sh`. No run reaches its card with an unruled suspect:
  the check fails the change while a suspect is unruled.
- **AC6** — met. `--self-test` has, for each kind, a positive control and a negative
  control, a line added-and-deleted still flagged (range and history), an allowed and a
  not-yet-allowed match, usage and empty-range controls, and a clean scan of this branch.
  All printed `ok` and the run exits 0.
- **AC7** — met. `raw/README.md` names `scripts/scrub-check.sh <base> <head>` as how a raw
  file's scrub is checked before promotion.
- **AC8** — met. `--history main` reports suspects in main's existing history in the same
  form, exit 1, no value printed, for the user to rule.
