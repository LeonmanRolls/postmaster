The reach control can miss writes expressed with valid shell syntax, and its restore command can act on a caller-selected worktree when Git overrides are inherited. These defects undermine the new check and restoration behavior.

Full review comments:

- [P1] Clear inherited Git overrides before restoring — /home/user/postmaster/.worktrees/202-rev-bug-luna/scripts/reach.ts:1819-1824
  If the coachman inherits `GIT_DIR` or `GIT_WORK_TREE`, Git honors those variables despite `-C`, so this `reset --hard` can target the caller’s worktree instead of this run’s synthesis worktree; earlier snapshots can also inspect the wrong repository. Unset these overrides for every Git subprocess in this control.

- [P1] Split conditional-OR chains before classifying commands — /home/user/postmaster/.worktrees/202-rev-bug-luna/scripts/reach.ts:478-481
  For a recorded command such as `false || touch ~/outside.txt`, `splitShell` leaves `||` in the same segment and `commandTouches` treats `false` as the command; the `touch` target is classified only as a read, so the write does not become a finding or escalation. Split `||` at the command boundary just as `&&` is split.

- [P2] Parse command substitutions inside double quotes — /home/user/postmaster/.worktrees/202-rev-bug-luna/scripts/reach.ts:458-460
  With a command such as `echo "$(touch ~/outside.txt)"`, this condition skips the substitution because `quote` is `"`; the inner `touch` is treated as part of `echo`’s argument, and `expandPath` cannot resolve that token, so the write is missed. Recognize `$()` substitutions inside double quotes too.