# Workhorse summary: #158 Measure each lane's share of the shipped synthesis from git

## Commits

- `abe184f` #158, workhorse spec: measure synthesis shares per lane
- `abd91a2` #158, measure each lane's share of the synthesis in runs of six words
  (`scripts/synthesis-shares.ts`, `scripts/synthesis-shares.test.ts`,
  `scripts/bunfig.empty.toml`, `package.json`, `bun.lock`, `.gitignore`)
- `c148124` #158, Oxlint on Bun with the test-beside-target rule
  (`.oxlintrc.json`, `lint/plugin.ts`, `lint/test-beside-target.ts`,
  `lint/test-beside-target.test.ts`)
- `eed7ab8` #158, coachman measures each lane's share beside the SYNTHESIS line
  (`skills/postmaster/coachman.md`)
- `c954e57` #158, parse synthesis-shares arguments without mutation

## Checks

`/home/brindlewick/.postmaster/tool-pins/73fca4e4a513d8915bf067723d54871b4b8ba728/scripts/verify.sh run .`
printed:

```
gate: pass, exit 0, 768s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

Other commands, from the worktree root:

| command | exit | result |
|---|---:|---|
| `bun test ./scripts ./lint` | 0 | 13 pass, 0 fail, 73 expect() calls |
| `bun run lint` | 0 | `bun x --bun oxlint`, no problems |
| `scripts/skill-refs.sh` | 0 | every `scripts/` path in the runbooks resolves |
| `bun test ./scripts` | 0 | 10 pass (synthesis-shares controls) |
| `bun test ./lint` | 0 | 3 pass (test-beside-target controls) |

An earlier `verify.sh run .` failed one control in `front-door-acceptance.sh --self-test`
("stale postmaster general") while several other runs' gates were on the machine. The same
self-test passed alone and the re-run above is completely clean; the stand-in gate names only
`review-round.sh` and `host.sh` as load flakes, so this is recorded as a load flake of the same
kind and not of this change.

## Decisions

1. **Six-word runs, as the audit used.** Not compared to a simpler measure on the audit's
   runs: those lane branches are outside this worktree and the brief forbids reading other
   branches. Stuck to the direction's default.
2. **Two kinds, code and docs, by file type** (`.md`, `.mdx`, `.rst`, `.adoc`, `.txt` are
   docs; the rest is code, tests included). The audit also split out *tests* for fixture runs;
   AC1 names only code and docs.
3. **`bun --config=scripts/bunfig.empty.toml`, not `--config /dev/null`.** Bun refuses
   `/dev/null` as a config ("Module not found") and treats space-separated `--config FILE`
   as the script path. An empty config the tool owns, passed in the `--config=` equals form,
   keeps the target's `bunfig.toml` preload from running. Documented in the script header and
   in `coachman.md`.
4. **Exclusions by path kind, not one set.** Oracle files and lane records
   (`WORKHORSE-SPEC.md`, `WORKHORSE-SUMMARY.md`, `WORKHORSE-BLOCKED.md`) are matched by exact
   path at a worktree's root; lockfiles by basename wherever they sit; generated files by
   `git check-attr`. A path is not left out just because a word like `oracle` appears in it.
5. **Lanes by name, any number of them** (`--lane name=head`, repeatable). The groups are
   per-lane-only, `shared` (two or more), and `neither`. With two lanes `shared` is the
   ticket's "both". The card line uses `shared=`.
6. **`--json` prints the record; `--record <dispatch>` writes `<dispatch>/shares.json`.**
   Exact integer counts live in the JSON; the card line is percentages plus `n=`.
7. **A merge commit in the synthesis range is refused** (Decision 7), so a merge cannot
   smuggle other work in as the coachman's own.
8. **Three-lane control uses one file per text** so a run of words cannot span two texts and
   split across categories.

## Not done, and why

- **Fixture run scored clean.** This change edits `coachman.md`, so the merge rule for a
  coachman-contract change applies. Dispatching and scoring a fixture run is ship-side duty
  on the branch, not this workhorse's gate; the ticket's checks list only the gate.
- **Simpler measure compared on the audit's runs.** The audit's lane branches are not
  readable from this worktree (blinkers).
- **Tests and lint added to the stand-in gate.** The spec leaves that to #171; the stand-in
  gate's script list is frozen at BASE's 40. The new script's `bun test` is run and recorded
  here instead.

## Verdict

| criterion | met | how |
|---|---|---|
| 1. A script measures each lane's share from git, code and docs separate, oracle and spec files out | yes | `scripts/synthesis-shares.ts`; 10 bun tests including exclusions |
| 2. Checkpoint card shows the shares beside SYNTHESIS; records keep them for a later audit | yes | `SHARES:` on checkpoint-1 beside the SYNTHESIS line; `<dispatch>/shares.json` |
| 3. Self-test controls: wholly one lane, split, identical in both, coachman alone, each exact | yes | `scripts/synthesis-shares.test.ts`, read back as exact integers |
| 4. `took=` stays; the measurement sits beside it | yes | `coachman.md` keeps the SYNTHESIS line and `took=` and adds `SHARES:` beside it |
| 5. Oxlint on Bun fails a test file with no sibling target or in a test folder, passes one beside its target | yes | `lint/test-beside-target.ts` + three controls through `bun x --bun oxlint` |
