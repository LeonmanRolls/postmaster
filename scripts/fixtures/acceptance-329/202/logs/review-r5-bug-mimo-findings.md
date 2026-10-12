# Round 5 bug-mimo findings, read by hand

Raw report: `logs/review-r5-bug-mimo.jsonl`, the longest `text` part
("## Review: reach check for #202"). The normalizer cannot parse mimo's
review output, as in every round.

## mimo-1 (high): unresolvable file-tool paths read clean

- target: scripts/reach.ts, `directCallTouches`
- location: scripts/reach.ts:1172-1173 (quoted)
- severity: not provided (called "high"; "would not merge without fixing")
- summary: `expandPath` failing on a direct tool-call path silently
  skips it, so Claude `Write`/`MiMo `write`/codex `file_change` with a
  `$VAR` or glob path reads clean (exit 0) where the shell equivalent is
  `not checked` (exit 3).
- evidence: verified by execution, table of six calls with exit codes.

## mimo-2 (medium): `git branch --flag=value` writes read as reads

- target: scripts/reach.ts, `gitLists`
- location: scripts/reach.ts:647-659 (quoted)
- severity: not provided (called "medium")
- summary: write flags match whole tokens only, so
  `--set-upstream-to=origin/main` falls through to the list fallback and
  reads as a note (exit 3) where the space form is a finding (exit 2).
- evidence: verified by execution, both forms shown.

## mimo-3 (medium): paths inside quoted program text invisible

- target: scripts/reach.ts shell judging
- location: none quoted (example command only)
- severity: not provided (called "medium")
- summary: `python3 -c "open('/abs/out.txt','w')"` exits 0 clean; D17 is
  cited for unknown commands reading the paths they name.
- evidence: verified by execution (one command, exit code shown).

## mimo-4 (medium): restore runs even when check exits 1

- target: skills/postmaster/coachman.md, review-loop reach block
- location: coachman.md:938-944 (quoted)
- severity: not provided (called "medium")
- summary: the block saves `REACH_EXIT` but never consults it, so a
  faulting check (exit 1) is followed by a restore from a snapshot the
  check could not read.
- evidence: by reading.

## mimo-5 (minor): sed script operand treated as a path

- target: scripts/reach.ts, sed in-place judging
- location: none quoted
- summary: `sed -i s/a/b/ out.txt` records `s/a/b/` as an expected
  write; the real write is still found. Fail-closed direction.
- evidence: stated behavior.

## mimo-6 (minor): fixture fails the score on void as well as findings

- target: scripts/fixture.ts, `checkReach`
- location: none quoted
- summary: C17 lists missing points, findings and supported-reader
  `not checked`; failing on a void may be stricter than the ticket.
- evidence: by reading; conditional ("only matters if ...").
