The patch’s approval identity can remain valid after changes to code still covered by Biome or partially enabled linter suppressions. It also misses legacy landing runs and does not verify that the ship card contains the generated switch-off section.

Full review comments:

- [P1] Include the full Biome-suppressed node in the approval identity — /home/user/postmaster/.worktrees/268-rev-bug-luna/scripts/lib/switch-offs.ts:434-435
  Biome’s `biome-ignore` suppresses the next syntax node, but this identity hashes only its next physical line. If an approved directive precedes a multiline node, changing code later within that node leaves the ID unchanged, so the landing check accepts the old approval for changed, still-suppressed code. Include the full covered node in the identity or invalidate approval when any covered code changes.

- [P2] Match block enables to the rules they re-enable — /home/user/postmaster/.worktrees/268-rev-bug-luna/scripts/lib/switch-offs.ts:422-423
  An `eslint-disable` for rules `a, b` followed by `eslint-enable a` leaves rule `b` disabled, but this stack pops the whole block at that enable. The identity then excludes code after the enable; adding code still suppressed by `b` leaves the approved ID unchanged and the check can report clear. Track which rules remain disabled before ending the block’s covered scope.

- [P2] Check legacy landing runs for switch-offs — /home/user/postmaster/.worktrees/268-rev-bug-luna/skills/postmaster/postmaster.md:566-568
  This check is added to contract-2 Stage F, but runs without `coachman_contract` 2 follow Legacy Stage F, which still grants or withholds without running `landing switch-offs` or asking for approval. Such a run can therefore land a newly added suppression without the user’s word, contrary to the stated behavior for runs dispatched before this check existed. Add the check to the legacy landing path as well.

- [P2] Validate the card’s switch-off section against the final branch — /home/user/postmaster/.worktrees/268-rev-bug-luna/skills/postmaster/coachman.md:1049-1051
  The coachman is told to paste this section, but landing does not verify it: the existing card check validates only the `card-block`, and no new check compares `## Switch-offs` with the current command output. A card that omits or has a stale list can still pass landing, so the ship card may not show the final branch’s entries as required. Add and run a deterministic card-section check; this also follows [AGENTS.md:219-220].