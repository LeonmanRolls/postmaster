A PR branch can gain an unapproved switch-off after the pre-PR check and be merged before the mismatch is noticed. Legacy runs also mishandle refusal and missing-reason statuses, and symlinked settings changes omit the diff needed for review.

Full review comments:

- [P1] Revalidate switch-offs against the head that lands — /home/brindlewick/postmaster/.worktrees/268-rev-bug-luna/skills/postmaster/postmaster.md:566-568
  On the pull-request route, this check runs before the PR opens. If a later push adds a suppression or changes check settings, the user can merge that new head without the postmaster checking it; the later `already-landed` check can notice the mismatch only after the merge. Revalidate and hold the exact head to be merged so an unapproved switch-off cannot land.

- [P2] Route legacy refusals and missing reasons back to the leg — /home/brindlewick/postmaster/.worktrees/268-rev-bug-luna/skills/postmaster/postmaster.md:704-706
  Legacy Stage F treats every nonzero status as an entry to present to the user and record. Exit 3 means a comment lacks its required reason, and exit 4 means the user has already refused it; neither should prompt for another approval. In both cases, withhold and send the discrepancy back to the coachman, as current Stage F does.

- [P2] Show the resolved diff for symlinked settings — /home/brindlewick/postmaster/.worktrees/268-rev-bug-luna/scripts/lib/switch-offs.ts:997-998
  When an unchanged settings symlink points to a file whose contents change, `changedAliases` selects the symlink, but Git sees no diff at that path. The listing therefore shows “(no textual diff)” instead of the change the user is being asked to approve. Generate the displayed diff from the resolved target blobs.