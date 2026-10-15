# Round 4 bug-mimo findings, read by hand

Raw report: `logs/review-r4-bug-mimo.jsonl`, text part
`prt_g001a10517ccc7001knk6IPNXw` (message `msg_g001a10517a4d6001qwGVIYOcR`,
"## Review: `40d50ce0...HEAD` (reach control for #202)"). The normalizer
cannot parse mimo's review output, as in rounds 1-3.

## mimo-1: write-redirect + `$(...)` target demoted to a read

- target: scripts/reach.ts, `outerWrites`
- location: scripts/reach.ts:425-431 (quoted), redirect table in `shellWords`
- severity: not provided (called a "Bug"; "1 and 2 before this ships")
- summary: the raw-text regex in `outerWrites` matches only `>>`, `>`,
  `2>`, `&>`; the `2>>`, `&>>`, `>|`, `2>|`, `1>`, `1>>` forms fall
  through, so a write redirect onto a substitution target classifies as a
  read note instead of a write finding.
- evidence: verified by execution against `reach.ts stream` with codex
  records: `echo x > $(echo /outside)` and `>>` give `finding write`
  (exit 2); `2>>`, `&>>`, `>|`, `2>|`, `1>`, `1>>` give `note read`
  (exit 3). Literal forms of the same operators are findings.

## mimo-2: globs and unresolvable `$vars` dropped, writes read clean

- target: scripts/reach.ts, `expandPath`
- location: scripts/reach.ts:377-389 and :847 (quoted)
- severity: not provided (called a "Bug"; "1 and 2 before this ships")
- summary: `expandPath` returns null for globs and for variables other
  than `$HOME`/`$TMPDIR`, and every caller treats null as no path, so
  e.g. `rm -rf $HOME/*` or `echo x > $NOTSET` records nothing.
- evidence: verified by execution: `rm -rf $HOME/*`, `rm -rf
  $HOME/outside*`, `echo x > $HOME/*`, `echo x > $NOTSET` all `clean`
  (exit 0).

## mimo-3 (minor): `cp`/`mv` source over-reported with substitution destination

- target: scripts/reach.ts, `commandTouches`
- location: scripts/reach.ts:1045-1048 (quoted)
- severity: not provided (called "Minor")
- summary: after `splitShell` peels the substitution, the outer command
  sees one path and takes it as the destination, so `cp /outside/src
  $(echo /dest)` reports a write for both paths.
- evidence: stated behavior of the CLI; not fail-open.

## mimo-4 (minor): workhorse list from `manifest.lanes`, not the team

- target: scripts/reach.ts, `expectedWorkhorseNames`
- location: scripts/reach.ts:1370-1375 (quoted)
- severity: not provided (called "Minor")
- summary: a workhorse in `config.team.workhorses` but missing from
  `manifest.lanes` is skipped silently instead of `not checked`.
- evidence: by reading; the runbook orders the check after every
  workhorse is harvested, so unreachable on the happy path.
