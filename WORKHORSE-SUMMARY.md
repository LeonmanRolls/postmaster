# Workhorse summary: #98 A fixture run's postmaster runs headless

## Commits

- `18f50a1` copies the named #109 TypeScript port files unchanged.
- `97bca0b` marks fixture copies, routes marked spawn decisions headless, adds paired test
  controls, and carries main's #159 fixture-lane scoring change into TypeScript.
- `f9834c7` updates the front-door, host and harness runbooks and the fixture-runs wiki page.
- `e118234` records the launcher scope question; `1c21f95` removes that blocker after the
  user's no-scope-change ruling.

## Checks

- `/home/brindlewick/.postmaster/tool-pins/e902378fd4a4b39aa41870da2c771b6963525517/scripts/verify.sh run .`
  — exit 0, 991 seconds. It printed: `gate: pass, exit 0, 991s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'`.
- `scripts/fixture.sh --self-test` — exit 0, in the passing gate.
- `scripts/front-door.sh --self-test` — exit 0, in the passing gate.
- `bun --no-env-file test scripts/fixture.test.ts` — exit 0, 4 tests passed.
- `bun --no-env-file test scripts/front-door.test.ts` — exit 0, 3 tests passed.
- `scripts/skill-refs.sh` — exit 0.
- `scripts/wiki-lint.sh` — exit 0.
- `bun run lint` — exit 0; two inherited warnings remain in copied `scripts/lib/text.ts` at
  lines 875 and 1130.
- `bun x -p typescript@7.0.2 tsc --noEmit -p tsconfig.json` — exit 1. Diagnostics are in
  `scripts/fixture-lanes.test.ts`, `scripts/synthesis-shares.test.ts`, and
  `scripts/synthesis-shares.ts`. `git diff --name-only 095d82f..HEAD` exited 0 and showed
  none of these paths among this ticket's changed files.
- `git diff --check` — exit 0.
- `git diff --name-only 095d82f..HEAD` — exit 0; used to compare the TypeScript diagnostics
  with the ticket's changed files.

## Decisions

- Store `postmaster.fixture` with the fixture ticket name in the copy's local git config after
  its ticket is filed. This keeps the new repository at one commit on `main` with a clean tree.
- The front door adds the `headless` route only when it would spawn a postmaster for a marked
  fixture copy. A `self` route and every unmarked target retain their prior decision.
- Use the existing `hosts.md` headless launch form through `host.sh run` on every host. The
  brief tells a headless postmaster to write `<runs>/postmaster/ESCALATION.md` when it needs the
  user.
- **User ruling: no scope change.** The Codex `trust_level` append in the generic launcher is
  pre-existing behavior, is unchanged by this ticket, and the approved spec excludes
  `launch.sh`. AC4 applies to harness settings written by this change. Keep the observation for
  the postmaster as a possible follow-up; do not change the launcher here.

## What was not done

- No changes were made to `launch.sh` or `host.sh`, per the approved spec and the user's ruling.
- AC7's end-to-end fixture run must be dispatched from this branch by the postmaster after its
  launch card. The workhorse has not performed that dispatch or scoring run.
- No push or pull request was made, as directed for this worktree.

## Acceptance criteria

- AC1: met. `fixture.sh new` writes the local mark; tests verify the copy remains one commit on
  `main` with a clean tree and an ordinary repository has no mark.
- AC2: met. Paired controls show marked spawn decisions route headless, while unmarked and
  `self` decisions keep their prior output.
- AC3: met. The front door follows the existing headless host form on every host, and the brief
  describes headless escalation handling.
- AC4: met as scoped by the user's ruling. This change writes no harness trust setting; the
  fixture tests verify the scratch harness configs remain unchanged.
- AC5: met. The marked and mark-removed controls use the same front-door command.
- AC6: met. The fixture-runs wiki page explains the headless route and why parent-folder trust
  does not cover a repository copy.
- AC7: pending the postmaster's fixture run from this branch.
