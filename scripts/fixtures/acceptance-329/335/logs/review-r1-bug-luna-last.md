The new project-config behavior is inconsistent across readers and acceptance paths: reviewer lookup rejects supported standalone settings, role assignments are mishandled, and some errors or acceptance notices are silently lost. These cases can cause valid configurations to fail or project-specific settings to be ignored.

Full review comments:

- [P2] Let reviewer lookups use a standalone project config — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/reviewers.ts:78-79
  When `--project` points to a complete `.postmaster/settings.toml` and the global config is absent, the unconditional `existsSync(configPath)` check above this branch returns before `effectiveConfigForProject` can load the project file. Reviewer listings and eligibility therefore fail despite the project settings containing the needed lanes and reviewers; move the existence check into the no-project branch. Standalone settings are documented in `settings.example.toml:7-8`.

- [P2] Allow standalone files to resolve their legacy roles — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/lib/effective-config.ts:1126-1129
  When no global config exists but a complete local settings file includes `[lanes]` and the backward-compatible `[roles]` table, this check rejects `project-settings write ... local` solely because the global file is absent, even though the effective loader can resolve those roles against the local config. Validate against the candidate local config when it is complete, requiring a global config only when it supplies missing role definitions. The compatibility and standalone behavior are documented in `settings.example.toml:7,25-30`.

- [P2] Validate role references before accepting settings — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/lib/effective-config.ts:758-759
  A tracked file can contain valid TOML and valid `[roles]` syntax while naming a lane absent from the resolved `[lanes]`. Acceptance checks only `validateCommon` before saving the hash, so acceptance succeeds but the next effective-config read fails in `applyRoles`. Validate the candidate against the resolved config before recording acceptance.

- [P2] Expand explicit config paths before probing them — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/lib/effective-config.ts:1010-1010
  When `project-settings effective <repo> <machine-config>` receives a valid path beginning with `~`, `globalPath` remains unexpanded and `isFile(globalPath)` treats it as absent; the command then fails or may use project settings alone instead of merging the global config. The previous `loadMachine` path expanded `~`; normalize the explicit path before probing it and deriving the acceptance-store path.

- [P2] Preserve pending notices for subprocess callers — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/project-settings.ts:98-100
  When a tracked settings file is pending, this notice is sent to stderr, but callers such as `discover-project` and `turnpikes` capture successful `project-settings inspect/report` results and consume only stdout. They therefore silently ignore the file and cannot prompt the user to accept it; propagate successful subprocess stderr or expose the pending state in the parsed output. The postmaster runbook requires reporting the pending state and asking for acceptance (`skills/postmaster/SKILL.md:166-170`).

- [P2] Report invalid project settings instead of silently falling back — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/runs-watch.ts:567-569
  If project settings fail to parse or validate, `effectiveConfigForProject` returns an error, but this branch silently falls back to global poll and capacity values while the watcher continues dispatching. A malformed project file can therefore bypass its intended run cap without any visible failure; report the error or stop watching instead of treating invalid settings as absent.