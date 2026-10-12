The new checks can be bypassed for sensitive content, and raw promotion can emit malformed JSONL. The committed acceptance oracle also exposes false-positive findings and a full-history census that exceeds the landing limit.

Full review comments:

- [P1] Clear the test override before production scans — /home/user/postmaster/.worktrees/216-rev-bug-luna/scripts/scrub-core.ts:517-517
  When `SCRUB_CHECK_DISABLE=email` is inherited, the shared scanner suppresses email findings. `raw-promote` does not clear it before either scan, so it exits 0 and copies an unredacted email into `raw/` (reproduced); the `bun run check` chain also honors the variable outside `verify.ts`. Keep this control for tests, but clear it in production entrypoints before scanning.

- [P1] Fail closed when reasoning traversal hits its depth limit — /home/user/postmaster/.worktrees/216-rev-bug-luna/scripts/tree-check.ts:28-28
  For a new raw JSONL record with more than 64 nested objects or arrays before `encrypted_content`, this returns false before visiting the payload. The subsequent text scan does not classify that field, so the tree gate exits 0; I reproduced this with 66 wrappers. Use iterative traversal or fail closed when the limit is reached.

- [P2] Preserve JSON delimiters when removing markers — /home/user/postmaster/.worktrees/216-rev-bug-luna/scripts/raw-promote-main.ts:53-53
  When a valid marker appears at the end of a JSON string in a JSONL row, the trailing remainder match consumes the closing quote and brace too. The verification pass checks privacy findings but not JSON syntax, so `raw-promote` exits 0 with a malformed record. Strip only the marker span while preserving the enclosing syntax, or reject this placement.

- [P2] Restrict generic `id` fields to account identifiers — /home/user/postmaster/.worktrees/216-rev-bug-luna/scripts/scrub-core.ts:540-543
  A JSON event such as `{"id":"item_0"}` is classified as `account-id`: only `thread` IDs are exempt, and this value passes the length-and-digit check. The existing Codex trial transcripts contain this shape, causing the committed C24 whole-tree scan to fail. Require stronger account/session context or exclude generic event IDs.

- [P2] Make the census limit compatible with full history — /home/user/postmaster/.worktrees/216-rev-bug-luna/scripts/landing.ts:475-475
  The committed oracle's C8 scan currently returns 236 rows for the full history, but this rejects any census over 50. If the census records that scan's findings, the required block cannot be generated; reduce the candidate set or let the census aggregate counts beyond this cap.

- [P2] Surface unreadable detection logs instead of suppressing TELL — /home/user/postmaster/.worktrees/216-rev-bug-luna/scripts/runs-status.ts:48-51
  If `detections.jsonl` exists but cannot be read, this catch returns an empty set just as if no findings were logged. `hasUntoldDetections` then emits no `TELL`, so the postmaster can miss the required notification. Treat only `ENOENT` as an empty log and surface other read failures.