The patch can ignore project settings for subdirectory targets, apply global limits to standalone project launches, and violate documented boundaries for local settings. These are actionable correctness and security issues.

Full review comments:

- [P2] Resolve project settings from the Git root — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/front-door.ts:141-141
  When `target` is a subdirectory of a repository, `repoOf(target)` later treats it as the same project, but this call uses the subdirectory as the config root. It misses the repository-root `.postmaster/settings.toml` (or errors when there is no global config), so front-door can select the global postmaster instead of the project override. Resolve the Git top-level before loading settings.

- [P2] Pass the project to standalone host launches — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/host.ts:1634-1635
  Project-specific limits are loaded only when `--project` is supplied. The postmaster command in [skills/postmaster/SKILL.md#L259-L261] passes it only to the child `launch`, and the watcher command in [skills/postmaster/harnesses.md#L629-L632] omits it, so those host processes use global/default limits. Pass `--project` to the outer `host run` calls.

- [P2] Keep projects_roots out of local overrides — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/lib/effective-config.ts:982-983
  If `settings.toml` contains `projects_roots`, this function retains it and the merge replaces the global value. `project-settings effective` and the recorded run config then report project roots even though they must come from the global config, as documented in [AGENTS.md#L244-L249]. Exclude this key from the local overlay.

- [P2] Reject credentials in local settings — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/lib/effective-config.ts:1193-1194
  Local settings are never scanned for credentials (the read path also passes `false`), and validation accepts nested config fields such as `tracker.api_key`. Such a value enters the effective config and `run.json`, and can be committed with a tracked settings file, despite [settings.example.toml#L6-L7] requiring keys to stay in env files. Preserve local path allowances while rejecting credential fields and values.