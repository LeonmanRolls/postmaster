The approval identity can alias distinct suppressions, and the landing flow can miss new suppressions added while it waits for a merge word. The settings scan also misses a supported Oxlint configuration filename.

Full review comments:

- [P1] Give identical suppressions distinct approval identities — /home/brindlewick/postmaster/.worktrees/268-rev-bug-luna/scripts/lib/switch-offs.ts:677-677
  When two identical directives in the same file cover identical code windows, these hash inputs are identical, so both entries receive the same ID. Approving one then marks both approved, allowing the branch to land without the user's decision on the second suppression. Include a stable per-occurrence discriminator that survives line moves.

- [P2] Recheck switch-offs after the merge-word wait — /home/brindlewick/postmaster/.worktrees/268-rev-bug-luna/skills/postmaster/postmaster.md:566-568
  On the local landing route with user merge authority, this check runs before the postmaster waits for the merge word, but Stage F later merges the current ticket branch without checking it again. If the branch advances during that wait and adds a suppression, the postmaster can merge it without approval; bind the merge to the checked HEAD or rerun the check before merging.

- [P2] Detect Oxlint JSONC configuration changes — /home/brindlewick/postmaster/.worktrees/268-rev-bug-luna/scripts/lib/switch-offs.ts:903-903
  If a project uses Oxlint with a `.oxlintrc.jsonc` config, changing that file is omitted because this matcher recognizes only `.oxlintrc.json`. Stage F can then report the branch clear without user approval for a check-settings change; include the supported JSONC filename.