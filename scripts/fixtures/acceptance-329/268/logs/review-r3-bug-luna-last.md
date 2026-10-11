A Biome-ignore approval can survive changes to code within the suppressed node, allowing a changed suppression scope to reach landing without renewed approval. The approval logger also accepts records that omit the user's words required for the audit trail.

Full review comments:

- [P1] Hash the full Biome-suppressed node — /home/brindlewick/postmaster/.worktrees/268-rev-bug-luna/scripts/lib/switch-offs.ts:687-689
  For a Biome ignore before an implicitly continued expression, such as `const x = foo +` followed by `bar;`, `depth` stays zero on the first code line and this loop stops before hashing `bar`. If that continuation changes after approval, the identity remains unchanged and the checker reuses the approval for a different suppressed node. Include implicit continuations in the identity or conservatively invalidate approval when the node boundary is uncertain.

- [P2] Require user words after the entry — /home/brindlewick/postmaster/.worktrees/268-rev-bug-luna/scripts/log-action.ts:281-283
  When the entry is a one-token settings path, `approved bunfig.toml` passes this check and `approvals()` accepts the resulting record, even though no user words were recorded. Require a separate nonempty user-words portion so the ledger preserves the evidence the runbook says to capture.