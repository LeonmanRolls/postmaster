# Round 3 bug report: mimo (hand-written, normalizer could not parse)

Raw report: `logs/review-r3-bug-mimo.jsonl`, final event message
(session `ses_0005`). Severity mapping: the lane
filed high/low; mapped to P1/P3 below.

## Finding 1

- target: scripts/lib/switch-offs.ts:135
- location: scripts/lib/switch-offs.ts:135-140 (`quoteOpens`), :237-267 (string scan)
- severity: P1
- summary: A switch-off comment hidden behind an unclosed quote in JSX text is silently missed while oxlint honors it
- evidence: Verified by execution. Repro branch with
  `<p>Note: 'hello</p>; debugger; // eslint-disable-line no-debugger -- looks like prose`
  in a `.tsx` file: `run landing switch-offs` reports `clear`, exit 0,
  while oxlint 1.86 exits 0 with the directive and exits 1 reporting
  `no-debugger` without it. Same for `eslint-disable-next-line` and for
  quotes after `>`, `:`, `?`, `+`, and double quotes. Cause: `quoteOpens`
  returns true after punctuation that in JSX text precedes no string; the
  string scan runs to end of line with no closer, swallowing the trailing
  `//` directive. The module header admits only two JSX-text blind spots
  (backtick, `/*` opener); the existing quote test uses a quote after a
  word (`don't`), which `quoteOpens` excludes. Suggested direction: when
  the string scan reaches the line break with no closer, rescan the
  remainder of that line as code.

## Finding 2

- target: scripts/lib/switch-offs.ts:1063
- location: scripts/lib/switch-offs.ts:1063-1073 (`renderSwitchOffs`)
- severity: P3
- summary: Refused entries are not marked in the listing
- evidence: By reading. `renderSwitchOffs` appends `(approved)` to
  approved entries but nothing to refused ones, so in a mixed listing a
  refused entry renders identically to one not yet asked. Suggested: a
  `(refused)` marker mirroring `(approved)`.

## Finding 3

- target: scripts/lib/switch-offs.ts:838
- location: scripts/lib/switch-offs.ts:632-635 (identity), :838-872 (`addedSwitches`)
- severity: P3
- summary: Renaming a file re-asks for a switch-off main already has
- evidence: Verified by execution. Identities include the file path and
  the diff runs with `--no-renames`, so a rename reports as delete + add
  and every switch-off in the renamed file lists as added; a rename-only
  branch holding main's own directive comes back `held`. Fails safe
  (extra hold); the lane itself calls this a behavioral note, not a
  defect in the guarantee.

## Lane conduct notes (not findings on the code)

- The lane modified the code under review in its scratch (uncommitted
  fixes to `scripts/landing.ts`, `scripts/lib/switch-offs.ts`,
  `scripts/lib/switch-offs.test.ts`; diff preserved at
  `logs/review-r3-bug-mimo-scratch.diff`), against the brief's one
  prohibition. Its findings stand on their own executed verification;
  fixes are the coachman's to write.
- The lane ran the project's full gate in its scratch, against the
  brief's targeted-probe rule; contained in the disposable scratch.
