The privacy gate has reachable bypasses, raw promotion can escape its intended repository boundary, and the bundle check does not ensure the executed bundle matches its sources.

Full review comments:

- [P1] Scan personal data on regex-declaration lines — /home/brindlewick/postmaster/.worktrees/216-rev-bug-luna/scripts/scrub-core.ts:826-826
  When a scanned line starts with a pattern such as `const EMAIL = /.../` and contains personal data later on that line, `PATTERN_CODE` sets `codePattern` and this branch skips `scanPersonal` for the entire line; for example, `const EMAIL = /.+/; // alice@company.co` produces no finding. This lets personal data pass the privacy gate; restrict the exemption to the regex text instead of suppressing the whole line.

- [P2] Clear disabled rules before card validation — /home/brindlewick/postmaster/.worktrees/216-rev-bug-luna/scripts/landing.ts:497-499
  `run()` merges this environment with `process.env`, so if the postmaster process has `SCRUB_CHECK_DISABLE=email`, the description scan skips email detection and can accept a card containing an unlogged email. Clear `SCRUB_CHECK_DISABLE` for this security-sensitive scan.

- [P2] Reject symlinked promotion destinations — /home/brindlewick/postmaster/.worktrees/216-rev-bug-luna/scripts/raw-promote-main.ts:345-345
  If `raw/archive` is a symlink to a directory outside the checkout, a destination such as `raw/archive/record` passes the lexical path check; this recursive `mkdir` and the later rename follow the symlink and write the promoted copy outside the project. Reject symlinked destination ancestors or verify the physical destination stays within the repository.

- [P2] Verify bundle contents, not only the source hash — /home/brindlewick/postmaster/.worktrees/216-rev-bug-luna/scripts/bundle-scrub.ts:92-92
  In `--check` mode, a matching hash in the bundle header causes an early return without checking the generated body. Editing or corrupting `scrub-check.ts` or `raw-promote.ts` while retaining that header therefore passes the check even though the wrappers execute divergent code; compare the bundle with a fresh build or verify a digest of its contents.