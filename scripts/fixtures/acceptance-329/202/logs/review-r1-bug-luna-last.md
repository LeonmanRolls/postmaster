The added tests pass for the covered cases, but a successful outside write can be downgraded to a refusal note, allowing synthesis to proceed without the required escalation. The patch also misclassifies some routine reads, fails to fully restore worktrees for hyphenated lane names, and inserts unescaped paths into the ship card.

Full review comments:

- [P1] Preserve successful writes when a later command is refused — /home/user/postmaster/.worktrees/202-rev-bug-luna/scripts/reach.ts:693-700
  When one shell call contains multiple commands, `commandTouches` applies the combined tool output to every split command. If a write outside the project succeeds and a later command is denied, the permission error turns the successful write into a refused note; because that path is outside the checked checkout, nothing else recovers the finding, and the workhorse check can continue without escalation. Classify refusal per command so a completed write remains a finding.

- [P2] Allow routine reads outside the project and home — /home/user/postmaster/.worktrees/202-rev-bug-luna/scripts/reach.ts:309-309
  A read from a path such as `/mnt/shared/...` outside both the repository and `$HOME` falls through this allowlist and becomes a reach note, making the stream check exit 3. The reach policy treats reads outside the home and project as routine; allow those reads while continuing to report writes.

- [P2] Resolve the full lane name when restoring a branch — /home/user/postmaster/.worktrees/202-rev-bug-luna/scripts/reach.ts:1643-1645
  If a configured lane name contains a hyphen, this greedy match captures only the suffix after the final hyphen: `wb/T-codex-lane` maps to `.worktrees/T-lane`. Restore then falls back to `update-ref` without resetting the actual worktree, so a reviewer’s reset or checkout there can leave its index and files at the post-round state. Derive the worktree name from the complete suffix after `wb/${info.ticket}-`.

- [P2] Escape recorded paths before inserting them in Markdown — /home/user/postmaster/.worktrees/202-rev-bug-luna/scripts/landing.ts:420-422
  An in-project filename containing `<!--` is emitted verbatim in the Reach block, so the ship-card comment guard rejects the card; a filename containing backticks can also escape the inline-code span and inject Markdown. Escape or encode path text before rendering it.