# Workhorse blocked: #98

## Question

May the approved scope be revised to include the existing launcher so AC4 is met for a Codex
postmaster?

The approved spec excludes `scripts/launch.sh` and says no harness trust setting is written.
However, the existing `scripts/launch.sh launch` appends the fixture repository to
`~/.codex/config.toml` with `trust_level = "trusted"` whenever the configured harness is
Codex. The new headless postmaster form still calls `launch.sh launch`, so a Codex fixture
postmaster writes that trust setting even though it never asks the interactive trust question.
This conflicts with AC4 and the direction that nothing writes any harness's trust setting for
a fixture copy.

## Options and recommendation

- **Recommended:** revise the spec to copy `scripts/launch.ts` and its wrapper from the named
  #109 commit in a separate commit, then skip the Codex trust write only when the current repo
  carries the fixture mark. Add a scratch-config test for marked and unmarked repositories.
  Commit the spec revision and stop for approval as the planning rule requires.
- Keep the approved file list. The Codex trust write remains reachable for fixture copies, so
  AC4 cannot be claimed as met.

## Branch state

- Approved spec: `095d82f`.
- TypeScript port copies: `18f50a1`.
- Fixture marking and front-door route: `97bca0b`.
- Runbook and wiki updates: `f9834c7`.
- Focused tests and self-tests, skill references, wiki lint and lint pass. The full TypeScript
  check reports errors in existing `fixture-lanes.test.ts` and `synthesis-shares{,.test}.ts`,
  with none in this ticket's changed files.
- The final gate has not been run, and `WORKHORSE-SUMMARY.md` has not been written.
