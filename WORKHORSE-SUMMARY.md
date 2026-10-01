# Workhorse summary: #98 A fixture run's postmaster runs headless, so it never stops at a trust prompt

## Commits

- `14e6e0d` User-approved spec for the rewritten ticket, shared by both lanes
- `9b706bf` #98 Copy fixture and front-door from #109's TypeScript port
- `bb91967` #98 Port #159's lane scoring into fixture.ts
- `9ecdd58` #98 Mark each fixture copy in its git config, with tests
- `2a7386b` #98 Front door says headless for a fixture copy, with tests
- `fbcd314` #98 Runbooks start a fixture postmaster headless on every host
- `0eb9d0d` #98 Wiki: a fixture run's postmaster runs headless
- `e4aea69` #98 Name the unused host loop variable so lint stays clean

### The copy commit

`9b706bf` copied these files unchanged from `b8e5e6485f77`, the two wrappers executable:
`scripts/fixture.ts`, `scripts/fixture.sh`, `scripts/front-door.ts`, `scripts/front-door.sh`,
`scripts/lib/data.ts`, `scripts/lib/paths.ts`, `scripts/lib/proc.ts`, `scripts/lib/selftest.ts`,
`scripts/lib/text.ts`, `bunfig.toml`, `tsconfig.json`, `types/bun.d.ts`, `biome.json`. Not
copied: `package.json` and `bun.lock` (main's carry its Oxlint setup), `scripts/text.sh` and
`scripts/fixtures/text-goldens.json` (only `lib/text.ts`'s own self-test uses them), and every
script this ticket neither changes nor needs. After the copy and before any change both
self-tests passed as copied.

## Checks

`/home/brindlewick/.postmaster/tool-pins/e902378fd4a4b39aa41870da2c771b6963525517/scripts/verify.sh run .`
printed when run just before this summary:

```
gate: pass, exit 0, 902s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

One line per check the waybill names:

| check | command | exit |
|---|---|---|
| gate | `verify.sh run .` (the command above) | 0 |

Other commands this workhorse ran, with their exit codes:

| command | exit | note |
|---|---|---|
| `scripts/fixture.sh --self-test` | 0 | after the copy, after #159's port, and after the mark |
| `scripts/front-door.sh --self-test` | 0 | after the copy, and after the headless decision |
| `bun --no-env-file test scripts/fixture.test.ts` | 0 | 3 pass |
| `bun --no-env-file test scripts/front-door.test.ts` | 0 | 4 pass |
| `scripts/skill-refs.sh` | 0 | |
| `scripts/wiki-lint.sh` | 0 | |
| `bun run lint` | 0 | warnings only on the copied `scripts/lib/text.ts`, left as copied |
| `bun x -p typescript@7.0.2 tsc --noEmit -p tsconfig.json` | 1 | no error in any file this ticket copies or writes; the errors are in main's `scripts/synthesis-shares.ts`, `scripts/synthesis-shares.test.ts` and `scripts/fixture-lanes.test.ts` |

Each copied self-test runs its new test file as one control (`bun --no-env-file test
scripts/fixture.test.ts` / `scripts/front-door.test.ts`), so the gate's self-tests cover them.

## Decisions

- **The headless line is additional, not a replacement.** `front-door.sh` still prints `spawn`
  with its reasons; when the target is a fixture copy it also prints
  `headless the target is a fixture copy made by fixture.sh new`. A non-fixture target's output
  is byte-identical to before. `self` in a fixture copy stays `self`.
- **The mark is `postmaster.fixture` in the copy's own git config**, set to the fixture ticket's
  name by `makeAndFile` after the ticket is filed and before the success lines. The tree stays
  one commit and clean; a worktree of the copy reads it too. A failure to set it unmakes the
  copy, like a ticket that cannot be filed.
- **`decide` is pure; the mark read is an edge.** `decide` takes a `fixture` boolean; the entry
  point reads `git config --get postmaster.fixture` under the guard that already strips the
  caller's `GIT_DIR`.
- **#159 is ported into `fixture.ts`**, not left as bash: `laneScores` calls
  `scripts/fixture-lanes.ts`, the hidden-tests line carries the lane counts, the header names
  them, and the self-test runs `fixture-lanes.test.ts`.
- **One call from `fixture.sh` names no harness.** The mark is harness-agnostic; nothing writes
  `.claude.json` or any other harness setting.

## Not done

- **AC7** (a fixture run dispatched from this branch reaches its score with nobody answering a
  prompt) is not shown by any command here. By the brief it is the postmaster's: a fixture run
  dispatched from this branch after the card. The first such run is also the first real test of
  the headless postmaster form (`hosts.md` none).

## Verdict

1. **Met.** `fixture.sh new` sets `postmaster.fixture` in the copy's git config to the ticket
   name; the copy is one commit on main with nothing untracked (self-test and `fixture.test.ts`).
2. **Met.** For a fixture copy the front door prints `headless` on any spawn, whatever the
   host; with the mark removed or on any other target the output is exactly as before
   (`front-door.test.ts`, self-test).
3. **Met.** `SKILL.md` steps 3, 4, 6 and 8 follow the `headless` line: step 8 starts the
   postmaster in `hosts.md`'s headless form through `host.sh run` on every host, never
   `host.sh spawn`; the brief says it runs headless and writes
   `<runs>/postmaster/ESCALATION.md`.
4. **Met.** Nothing in this change writes any harness's trust setting; `fixture.test.ts` shows
   a scratch home's `.claude.json` and `.codex/config.toml` unchanged by `new`, and a control
   that writes one is caught by the same comparison.
5. **Met.** `front-door.test.ts` and the self-test show the decision for a fixture copy and for
   the same copy with its mark removed, through the same command.
6. **Met.** `wiki/concepts/fixture-runs.md` says a fixture run's postmaster runs headless, and
   why trusting the fixtures folder never spared a copy: the trust search stops at the git root
   and every copy is its own repository.
7. **Not shown here.** AC7 is a fixture run the postmaster dispatches from this branch after
   the card.
