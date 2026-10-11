Tracked local settings can accept credentials, project-specific roots override a documented global-only setting, and the postmaster host launch ignores project-specific resource limits. These are actionable correctness and security gaps.

Full review comments:

- [P1] Reject credentials in tracked local settings — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/lib/effective-config.ts:891-892
  When a tracked `.postmaster/settings.toml` contains a credential, such as a token field under `[tracker]`, this read disables scanning and local validation does not inspect nested credential values. `project-settings accept` can therefore approve a file that may then be committed, contrary to the rule that keys stay in env files ([skills/postmaster/SKILL.md:181](skills/postmaster/SKILL.md#L181)). Keep allowing local paths, but reject credential fields and token-shaped values.

- [P2] Pass the project to the host limits lookup — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/skills/postmaster/SKILL.md:261-261
  When the project overrides `[limits]` and per-launch limits are available, `--project` here reaches only the child `launch` command because it appears after the host command's `--`. `host run` consequently uses global or default caps while the child uses the target settings; pass `--project "$TARGET_ROOT"` to `host run` before `--`.

- [P2] Keep projects_roots global — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/lib/effective-config.ts:981-983
  `stripLegacy()` leaves `projects_roots` in the local override, so this merge replaces the global roots with any value from `.postmaster/settings.toml`; `project-settings effective` and `run-meta` then report/store a project-specific value despite the global-only exception ([AGENTS.md:248](AGENTS.md#L248)). Exclude this key from local overrides.