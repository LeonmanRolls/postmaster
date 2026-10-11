The patch allows credentials in local settings, fails to preserve the global-only project-roots setting, and does not apply project-specific host limits to the postmaster launch. These are functional and security defects.

Full review comments:

- [P1] Restore credential checks for local settings — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/lib/effective-config.ts:398-400
  If a local settings file puts a token in an otherwise valid string such as `lanes.*.model`, this skips all scanning, and neither writing nor accepting the file checks it. The token can then be committed or propagated into launch configuration; allow machine paths while retaining credential detection, as the file guidance requires ([settings.example.toml#L6-L8]).

- [P2] Keep project roots global — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/lib/effective-config.ts:990-992
  When `.postmaster/settings.toml` sets `projects_roots`, this leaves it in the local overlay, so the merge replaces the global roots in the effective config and run record. Exclude it from local overrides; the project instructions reserve it to the global config ([AGENTS.md#L248-L249]).

- [P2] Pass project scope to `host run` — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/skills/postmaster/SKILL.md:261-261
  This `--project` comes after `--`, so it reaches `launch` but not `host run`; the host therefore uses global limits for the postmaster's process scope, ignoring any project-specific limits. Also pass `--project "$TARGET_ROOT"` before the separator, as required for direct host launches to use the project's effective config ([hosts.md#L126-L131]).