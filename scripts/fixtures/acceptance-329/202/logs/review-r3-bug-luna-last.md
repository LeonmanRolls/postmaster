The patch misses ignored checkout changes, can fail to restore a reviewer-modified synthesis branch, and can treat unreadable Claude task records as checked. It also renders unescaped branch names into a card block that the landing validator rejects.

Full review comments:

- [P2] Restore the synthesis branch from the round snapshot — /home/brindlewick/postmaster/.worktrees/202-rev-bug-luna/scripts/reach.ts:1845-1845
  If a reviewer detaches or switches the synthesis worktree, this precondition fails before restoration can run. The snapshot stores the commit and file status but not the symbolic branch, so `restoreRound` exits 1 instead of putting the worktree back as it was, stopping the review leg. Record and restore the original branch.

- [P2] Detect ignored files in checkout changes — /home/brindlewick/postmaster/.worktrees/202-rev-bug-luna/scripts/check-target.ts:81-81
  When an unrecorded lane write creates or modifies a gitignored file in the main checkout, `git status` omits it even with `--untracked-files=all`; `reachTarget` then reports the checkout as clean instead of finding the unexplained change. The status-based synthesis snapshot also misses ignored files, so they can remain after restore.

- [P2] Treat unreadable Claude task logs as not checked — /home/brindlewick/postmaster/.worktrees/202-rev-bug-luna/scripts/reach.ts:804-804
  If a copied Claude task transcript is unreadable or contains malformed JSON, `parseTaskFile` converts it to an empty event list. The parent stream can still contain a recognized task call, causing the lane to be marked checked while the subagent's file accesses disappear from the reach results. Propagate task-log parse failures so the lane is reported as not checked.

- [P2] Escape branch names in the rendered card — /home/brindlewick/postmaster/.worktrees/202-rev-bug-luna/scripts/landing.ts:396-396
  A valid Git branch name can contain `<!--` (for example, `x<!--`), but this interpolation emits the branch and default-branch names raw. The resulting mandatory card block contains an HTML comment opener, which the landing validator rejects, preventing the run from producing a valid ship card. Escape both branch fields as the path and reason fields are escaped.