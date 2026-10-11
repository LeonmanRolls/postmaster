The effective-config loader has observable resolution and credential-handling defects, and concurrent acceptance updates can lose stored approvals. The newly parallelized check also exposed a race in the host self-test.

Full review comments:

- [P2] Preserve credential checks for tracked settings — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/lib/effective-config.ts:1202-1203
  When local settings contain a credential-like value, this path skips the scanner, and `write local` also scans only the shared file. Since local settings may be force-tracked and shared, a token in a valid field such as `tracker.binding` can enter the repository; keep credential detection enabled while allowing legitimate local paths, as required by [skills/postmaster/SKILL.md#L180-L181](skills/postmaster/SKILL.md#L180-L181).

- [P2] Require machine settings for a standalone config — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/lib/effective-config.ts:1117-1120
  If the global config is absent and `settings.toml` contains only legacy metadata such as `[tracker] binding = "board"` or `[project]` facts, this treats it as usable even though `stripLegacy` removes those values from the effective config. The loader then succeeds with no machine settings, and `tracker-kind` can default to GitHub instead of reporting the missing config; determine usability from the remaining effective machine settings.

- [P2] Keep project roots out of per-project overrides — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/lib/effective-config.ts:1128-1129
  When `.postmaster/settings.toml` sets `projects_roots`, this merge overrides the global value, contrary to [AGENTS.md#L246-L248](AGENTS.md#L246-L248). `project-settings effective` exposes the wrong roots and `run-meta` persists them; exclude this key from the local override merge.

- [P3] Serialize acceptance-store updates — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/lib/effective-config.ts:821-822
  If two sessions accept settings for different repositories at the same time using the same config directory, both can read the same store here and the last atomic rename drops the other session's entry. That file will then wait for acceptance again; lock the read-merge-write sequence, since atomic replacement alone does not prevent lost updates.

- [P2] Make the host self-test safe under parallel runs — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/package.json:6-6
  With the new default of four test workers, `bun run check` failed the tmux host self-test because it observed pane output before the `_run` child recorded `@postmaster_state=running`; running `scripts/host.test.ts` serially passed. This makes the default check flaky under parallel load; have the test wait for the state or keep it out of parallel execution.