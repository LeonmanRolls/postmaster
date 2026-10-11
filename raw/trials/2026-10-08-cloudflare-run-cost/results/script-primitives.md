# Scripts by what they lean on

69 scripts of the flow under scripts/ and scripts/lib/. 7 more, which test the flow itself (self-tests, oracles and acceptance runs), and every `.test.ts`, are left out. Patterns are tested against code, not comments, and a target project's package-manager lock file names are blanked first.

| What a script does | Scripts | Of |
| --- | --- | --- |
| starts child processes | 13 | 69 |
| signals processes or process groups | 6 | 69 |
| imports the shared process helpers (lib/proc, lib/processes) | 44 | 69 |
| reads /proc | 5 | 69 |
| uses systemd scopes or cgroup limits | 1 | 69 |
| uses bwrap or sandbox-exec, to wrap a harness or to probe for them | 2 | 69 |
| drives herdr or tmux | 1 | 69 |
| makes symbolic links | 2 | 69 |
| names a marker, pid or lock file, waits on markers or creates a file exclusively | 10 | 69 |
| runs git worktree commands (not herdr's own worktree commands) | 6 | 69 |
| reads the home directory or ~/.postmaster | 18 | 69 |

## The files behind each count

- starts child processes: aftercare.ts, clean-checkout.ts, export-session.ts, fixture-lanes.ts, host.ts, launch.ts, lib/confine.ts, lib/proc.ts, run-clash.ts, run-meta.ts, summary-evidence.ts, synthesis-shares.ts, verify.ts
- signals processes or process groups: aftercare.ts, clean-checkout.ts, host.ts, launch.ts, lib/processes.ts, verify.ts
- imports the shared process helpers (lib/proc, lib/processes): aftercare.ts, check-target.ts, clerk.ts, coachman-contract.ts, cut-scratch.ts, discover-project.ts, export-session.ts, find-projects.ts, fixture.ts, front-door.ts, github.ts, host.ts, landing.ts, launch.ts, link-skills.ts, local.ts, log-action.ts, plane.ts, premises.ts, probe-confine.ts, probe-trackers.ts, project-settings.ts, reach.ts, review-page.ts, review-round.ts, reviewers.ts, run-meta.ts, runs-status.ts, runs-watch.ts, setup.ts, stage.ts, style-findings.ts, synthesis-shares.ts, ticket-check.ts, ticket-ready.ts, tool-faults.ts, tracker-kind.ts, turnpikes.ts, verify-examples.ts, verify-journey.ts, verify-library.ts, verify.ts, view-stream.ts, walls.ts
- reads /proc: host.ts, lib/proc.ts, probe-confine.ts, review-round.ts, runs-watch.ts
- uses systemd scopes or cgroup limits: host.ts
- uses bwrap or sandbox-exec, to wrap a harness or to probe for them: lib/confine.ts, probe-confine.ts
- drives herdr or tmux: host.ts
- makes symbolic links: fixture.ts, link-skills.ts
- names a marker, pid or lock file, waits on markers or creates a file exclusively: aftercare.ts, fixture.ts, host.ts, local.ts, review-round.ts, run-meta.ts, runs-status.ts, runs-watch.ts, wait-for-markers.ts, walls.ts
- runs git worktree commands (not herdr's own worktree commands): aftercare.ts, clean-checkout.ts, cut-scratch.ts, link-skills.ts, local.ts, run-meta.ts
- reads the home directory or ~/.postmaster: clerk.ts, export-session.ts, find-projects.ts, fixture.ts, front-door.ts, host.ts, launch.ts, link-skills.ts, plane.ts, probe-trackers.ts, project-settings.ts, reach.ts, reviewers.ts, run-meta.ts, runs-watch.ts, setup.ts, tool-faults.ts, tracker-kind.ts
