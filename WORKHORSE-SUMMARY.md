# Workhorse summary: #160 Record each launch's tokens and cost where its harness reports them

## Built

- `b1bf26a` Read harness usage streams for #160: added the Bun adapter, per-harness recorded fixtures, and paired controls for usage and no-usage streams.
- `660d965` Record launch usage by role and lane: record each run launch after session export; forward explicit host role and preserve coachman leg attribution, including fallback launches.
- `1911103` Close runs with summed usage records: sum by role and lane, refresh the closing run log and ship card, document harness fields, and include the Bun tests in the project gate.
- `5bfda02` Keep fixture directory references out of script lint: describe the recorded fixtures without making the fixture directory look like an executable script path.

No approved task was dropped. Added implementation task T007 during the work: refresh the final usage block when the postmaster closes the run, after every launch has written its sidecar.

## Checks

- `gate [default:gate]` — `/home/brindlewick/.postmaster/tool-pins/ffe37821779aa7cc77275860573a8fdd43cd6e2d/scripts/verify.sh run .`, exit 0. It printed:

  ```text
  gate: pass, exit 0, 781s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
  ```

  The verifier used the dispatch-recorded gate, which predates this change. The committed `.postmaster/project.toml` also runs `bun test scripts/usage.test.ts` on future gate runs.
- `bun test scripts/usage.test.ts` — exit 0; 17 pass, 0 fail, 45 expectations. An earlier attempt exited 1 before the Pi/MiMo field mappings and explicit-zero control were corrected.
- `scripts/host.sh --self-test` — exit 0. An earlier run was interrupted with exit 130 while correcting the role-forwarding control.
- `scripts/launch.sh --self-test` — exit 0. Its first integration run exited 1 because the reviewer and coachman fixtures lacked a logs directory; the fixture setup was corrected.
- `scripts/stage.sh --self-test` — exit 0. An earlier run exited 1 because the usage-record fixture lacked `schema_version` and the assertion expected the wrong sum text; both were corrected.
- `scripts/skill-refs.sh` — exit 0. The first required verifier attempt exited 2 because the fixture directory was mistaken for a script reference; the wording was corrected before the passing run.
- `bash -n scripts/host.sh`, `bash -n scripts/launch.sh`, `bash -n scripts/stage.sh` — each exit 0.
- `git diff --check` — exit 0.
- TOML parse of `.postmaster/project.toml` — exit 0.

## Decisions

- Keep the reader and sum in a standalone TypeScript script run by Bun, with no package or TypeScript setup added.
- Store one whole-stream usage record beside each launch stream. Re-reading a stream replaces its sidecar, so resumes do not double-count.
- Preserve explicit zero and omit absent fields. Sums show partial coverage per figure and say `not reported` for missing values; harnesses with no reported figures are named.
- Take role from the host's explicit `--role`, pass it only to `launch.sh`, and remove it before the harness starts. Workhorse and reviewer lanes use the launch name; coachman records use the leg name. The fallback runbook now passes `--leg` so the record has the same attribution.
- Read Muse usage from its exported session record and ignore duplicate goal-attribution events. If that record is unavailable, save an unreadable record without inventing figures. Use the last Antigravity result because its usage is cumulative.
- Keep usage recording best-effort so it does not change the harness exit status. If summing fails at closure, write the error as unreadable.
- Refresh the cost block again at terminal stage. Stage 4 runs before its own launch sidecar is written, so this final pass ensures the closing run log and ship card include the last resume.
- Use made-up event and session fixtures only; no usage was estimated from text length.

## Not done

- Did not push the branch, as the workhorse brief forbids pushing.
- Did not dispatch and score a fixture run. The repo's coachman-contract rule requires that before merge; this workhorse run does not merge.
- Did not run live harness sessions. The adapter controls use recorded invented streams and session records for every harness.

## Acceptance

- AC1 — Met. Each run launch records its harness-reported input tokens, output tokens, and cost where present, with role and lane attribution.
- AC2 — Met. Terminal closure sums by role and lane, names harnesses that report nothing, preserves missing figures as missing, and refreshes both closing records after the final launch exits.
- AC3 — Met. Per-harness readers are behind the adapter and every harness has a positive and no-usage recorded-stream control.
