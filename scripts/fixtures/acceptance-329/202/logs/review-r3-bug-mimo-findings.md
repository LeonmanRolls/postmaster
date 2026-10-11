# Bug findings, round 3, lane mimo (hand-read)

Raw report: the final text part of
`/home/brindlewick/postmaster/.postmaster/runs/202/logs/review-r3-bug-mimo.jsonl`
(`normalize` cannot parse mimo's review output; read by hand per the runbook).
Verified by execution against the real interface; no severity given.

## bug-mimo-r3-1: fd-duplication redirects invent a path write

- target: scripts/reach.ts:redirectTargets
- location: `shellWords` tokenizes `2>&1` / `1>&2` / `>&2` / `2>&-` as a file
  redirect; `redirectTargets` hands the `&1`-shaped token to `add()` with no
  `isPathToken` check, and `expandPath` resolves it under the workdir
- summary: A codex-shaped stream with `cd <repo> && bun test 2>&1` reports
  `finding write <repo>/&1 (main checkout)`, exit 2. Same for other commands
  after a `cd` out of the lane folder. From the lane's own folder the phantom
  path lands inside and stays expected, so it fires exactly when the lane has
  `cd`'d out. A write finding voids a reviewer's verdict and escalates a
  workhorse check, so any lane capturing stderr after a `cd` blocks the leg on
  a path that does not exist.
- evidence: verified by execution (probes `cd <repo> && bun test 2>&1`,
  `cd <repo> && git status 2>&1`, `cd $HOME && … 2>&1`).
- fix direction (lane's): treat `N>&M`, `>&M`, `N>&-`, `N<&M` as fd operations
  (no path operand); keep `N>file` and `2>file` as file writes.

## Note (not filed by the lane)

- `git config --list`, `git remote -v` and other listing subcommands classify
  as writes. Matches the spec ("every other subcommand writes"), fail-closed
  by design; not a defect.
