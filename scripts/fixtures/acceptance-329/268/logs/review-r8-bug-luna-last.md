The new approval check can miss a suppression moved into a different code context, and its approval report can omit effective settings or be misleading for crafted filenames. These gaps undermine the user-approval control introduced by the patch.

Full review comments:

- [P1] Detect suppressions moved to a different code context — /home/brindlewick/postmaster/.worktrees/268-rev-bug-luna/scripts/lib/switch-offs.ts:867-867
  If an existing line suppression moves between blocks that contain identical code after the comment, the entries have the same file, comment text, occurrence, and span, so this comparison drops the change and reports the branch as clear. The suppression can then cover a different binding or type-check context without user approval; include enclosing context in the comparison while still allowing harmless line shifts.

- [P2] Show resolved content for changed settings symlinks — /home/brindlewick/postmaster/.worktrees/268-rev-bug-luna/scripts/lib/switch-offs.ts:1010-1010
  When a settings symlink itself changes target, `isAlias` is false and this diffs the symlink path, showing only the old and new target names rather than the effective configuration changes. The user is asked to approve a settings change without seeing the rules it changes; include the resolved target diff for changed links too.

- [P2] Escape paths before rendering the approval list — /home/brindlewick/postmaster/.worktrees/268-rev-bug-luna/scripts/lib/switch-offs.ts:1106-1106
  Git permits newlines in filenames, and a changed source path ending in `.ts` is interpolated here without escaping. A crafted path can inject extra Markdown lines or fake suppression bullets into the ship card, misleading the user about what they are approving; encode newlines and escape Markdown-sensitive path text before rendering.