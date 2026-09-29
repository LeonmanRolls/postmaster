# Workhorse summary: #121 Keep the postmaster watcher running

## Built

- `9831091` — `#121 Add workhorse spec`
- `db7ae25` — `#121 Add runs watcher`
- `5804e18` — `#121 Document watcher supervision`
- `#121 Record workhorse summary` — this final workhorse record

Added `scripts/runs-watch.sh`. It polls `runs-status.sh` on the configured interval, filters ignored and held tickets, prints the table and actionable NEXT values, and exits 3 with the last table on timeout. Updated Stage D and the harness guide to describe background startup, restart, hold and release.

## Checks

- `gate [default:gate]`: `/home/brindlewick/postmaster/scripts/verify.sh run .` — exit 0. It printed: `gate: pass, exit 0, 448s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'`
- `scripts/runs-watch.sh --self-test` — exit 0; all positive and negative controls behaved.
- `bash -n scripts/runs-watch.sh` — exit 0.
- `scripts/runs-watch.sh --help` — exit 0.
- Inline Python CLI controls — exit 0; timeout returned 3 with a table, actionable state returned 0 with its ticket name, and the run-root path contained spaces.
- `scripts/skill-refs.sh` — exit 0.
- `scripts/skill-refs.sh --fix` — exit 0.
- `git diff --check` — exit 0.
- `git status --short --branch` — exit 0; clean on `wb/121-luna` before the summary commit.
- `git fetch origin wb/121-luna` — exit 128; the remote ref does not exist.

## Decisions

- Poll immediately at startup, then sleep for `postmaster.poll_seconds`; use 120 seconds when the config or value is absent or invalid.
- Treat every NEXT value except `WAIT`, `USER` and `-` as actionable. Read the held list on each poll, match exact ticket names, and ignore blank lines and surrounding whitespace.
- Accept finite, non-negative timeout seconds. Check status once immediately, including for a zero timeout; on timeout print the latest table and exit 3.
- Use `host.sh run` for each listed postmaster harness because it returns after starting a detached watcher and keeps it alive beyond the harness call. If a harness cannot invoke it, check `runs-status.sh` in the foreground on each available conversation turn.

## Not done

- Did not push, as instructed.

## Acceptance

- AC1: Met. The watcher polls at the configured interval or 120-second default, prints the table and names actionable runs, then exits 0.
- AC2: Met. `WAIT`, `USER`, `-`, and ticket names in `<runs>/postmaster/held` do not wake it.
- AC3: Met. `--timeout` prints the last table and exits 3 when no unheld actionable run appears.
- AC4: Met. Self-test covers `RULE`, `READ`, `DISPATCH`, `REMOUNT`, `INSPECT`, `GATE`, `WAIT`, `USER`, `-`, and a held run.
- AC5: Met. Stage D directs background startup, action on each report, immediate restart, and hold/release through the held list.
- AC6: Met. The harness guide covers claude, pi, codex, grok, agy, muse and mimo, with foreground status polling as the fallback when a harness has no nonblocking route.
