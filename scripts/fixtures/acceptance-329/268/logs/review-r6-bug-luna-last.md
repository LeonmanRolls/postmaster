The switch-off check can miss a suppression added through an unchanged source symlink and incorrectly report the branch clear. The selected tests pass, but this leaves a bypass in the patch's central landing safeguard.

Full review comments:

- [P2] Include changed targets of symlinked inputs — /home/brindlewick/postmaster/.worktrees/268-rev-bug-luna/scripts/lib/switch-offs.ts:785-785
  If `src/example.ts` is a tracked symlink to a non-source filename such as `shared.txt`, a change that adds a directive only in `shared.txt` is dropped by this filter before the unchanged `.ts` link can be resolved, so the check can report `clear` and let the suppression land without approval. `settingsChanges` has the same issue when a symlinked config points to a generically named target. Include unchanged aliases whose resolved targets changed.

- [P3] Resolve the latest supported 7.x release — /home/brindlewick/postmaster/.worktrees/268-rev-bug-luna/scripts/refresh-parser.ts:105-107
  If npm's `latest` tag moves to 8.x, the no-argument path reads only that tag and rejects it instead of finding the latest available 7.x release, contrary to the command's documented behavior. Select the latest version matching major 7 from registry metadata.

- [P3] Detect `require` calls beyond the exact substring — /home/brindlewick/postmaster/.worktrees/268-rev-bug-luna/scripts/refresh-parser.ts:47-47
  If a future parser bundle adds an external dependency using valid syntax such as `require ("./chunk")`, this check misses the call and writes a bundle that cannot load because the dependency was not vendored. Detect calls with optional whitespace rather than checking only the exact `require(` spelling.