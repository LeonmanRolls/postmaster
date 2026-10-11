The patch permits credentials in local settings, can silently disable confinement through a typo, violates the global-only `projects_roots` rule, and regresses stdin machine-config handling. The targeted tests pass but do not cover these cases.

Full review comments:

- [P1] Keep credential checks on local settings — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/lib/effective-config.ts:399-400
  If `.postmaster/settings.toml` contains a credential such as `[tracker] api_key = "..."`, this path skips scanning it, and local validation permits arbitrary tracker keys. The merged config is then recorded in `run.json`, and the file can be force-added for sharing; the [settings format](https://github.com/brindlewick/postmaster/blob/45ddbf8a086ab8bdb7320353302cf2ae78506710/settings.example.toml#L3-L8) says keys belong in env files. Retain credential checks for local settings while allowing their intended machine-specific paths.

- [P2] Reject invalid local confinement values — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/lib/effective-config.ts:663-665
  When a project setting contains a typo such as `confine = "onn"`, this check accepts it because it only verifies the type; launch enables confinement only for the exact value `"on"`, so the typo silently runs lanes unconfined. Require the value to be exactly `"on"` or `"off"`.

- [P2] Keep project roots from the global config — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/lib/effective-config.ts:972-978
  If local settings include `projects_roots`, this copy leaves the key in the override and the later merge replaces the global value; `project-settings effective` and `run.json` then report project-specific roots. The project contract says this setting always comes from the global config ([AGENTS.md#L246-L249](https://github.com/brindlewick/postmaster/blob/45ddbf8a086ab8bdb7320353302cf2ae78506710/AGENTS.md#L246-L249)); exclude it from the local merge.

- [P2] Preserve stdin machine configs in effective — /home/brindlewick/postmaster/.worktrees/335-rev-bug-luna/scripts/lib/effective-config.ts:1077-1081
  When `project-settings effective <repo> -` receives the machine config as JSON on stdin, this check treats `-` as a missing file instead of using the existing `loadMachine("-")` behavior. With no local settings it errors; with local settings it silently omits the piped config. Preserve stdin handling for this argument.