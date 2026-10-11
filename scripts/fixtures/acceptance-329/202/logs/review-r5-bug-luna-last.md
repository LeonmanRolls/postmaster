The reach check can report clean after certain outside writes, and card diagnostics can expose absolute paths. These correctness and privacy gaps mean the patch is not ready as written.

Full review comments:

- [P1] Treat bare write operands as paths — /home/user/postmaster/.worktrees/202-rev-bug-luna/scripts/reach.ts:416-416
  When a lane runs `cd ~/other-project && touch newfile` or `mkdir newdir`, the new basename is neither an existing path nor slash- or extension-shaped, so this predicate drops it and records no write. Because the path is outside the target repository, the main-checkout scan cannot catch it, and the point can be logged clean. Treat non-option operands of known write commands as paths, or fail closed; this violates [D8](https://github.com/brindlewick/postmaster/blob/665a99f9d9c08e69c101d7fbfa927afc79b4f231/WORKHORSE-SPEC.md#L36).

- [P2] Mark unparsed MCP calls as unchecked — /home/user/postmaster/.worktrees/202-rev-bug-luna/scripts/reach.ts:731-732
  If a Codex lane uses a filesystem-capable MCP tool whose path is nested under `arguments`, this branch counts the call, but `directCallTouches` only looks for top-level path fields and a command. `readLane` therefore marks the stream checked without recording the write; writes outside the target repository can then pass unnoticed. Parse nested arguments or mark MCP calls without a usable path reader as not checked, consistent with [D8 and D13](https://github.com/brindlewick/postmaster/blob/665a99f9d9c08e69c101d7fbfa927afc79b4f231/WORKHORSE-SPEC.md#L36-L41).

- [P2] Redact paths from not-checked card reasons — /home/user/postmaster/.worktrees/202-rev-bug-luna/scripts/landing.ts:418-419
  If a supported lane's shell input contains an unresolvable absolute glob, the reader includes that raw token in the `not checked` reason. This branch prints the reason verbatim instead of applying `reachPath`, so the ship card can expose a home or other-project path in a public pull request. Redact paths in the diagnostic while keeping the full value in the run log, as required by [D18](https://github.com/brindlewick/postmaster/blob/665a99f9d9c08e69c101d7fbfa927afc79b4f231/WORKHORSE-SPEC.md#L46).