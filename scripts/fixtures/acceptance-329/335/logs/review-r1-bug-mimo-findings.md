# Round 1 bug findings, lane mimo (hand-normalized)

Raw report: the final `text` part of
`/home/user/postmaster/.postmaster/runs/335/logs/review-r1-bug-mimo.jsonl`
(session `ses_0003`). The normalizer refused it
("review output cites scripts/reviewers.ts:74 outside its filed findings"),
so this file transcribes the report's 5 findings by hand. Severities are the
lane's own words (Medium/Low); the coachman assigns verified severity at
triage. The lane says every finding was reproduced against a live fixture.

## 1. reviewers --project still requires the global config

- target: `scripts/reviewers.ts:74-76`
- severity: Medium (lane's proposed)
- summary: `reviewers --project` gates on `existsSync(configPath)` before
  the project branch, so project-alone mode (complete
  `.postmaster/settings.toml`, no global config) fails with `no config
  at ...`. Every other reader was converted to bypass this; reviewers was
  missed.
- evidence: raw report item 1; lane says reproduced live. Proposed fix:
  move the check into the `project === ""` branch.
- confidence: not provided.

## 2. front-door vs. launch disagree on [team] postmaster

- target: `skills/postmaster/SKILL.md:260`
- severity: Medium (lane's proposed)
- summary: front-door reads `team.postmaster` from the project's effective
  config, but the headless runbook form launches without `--project`, so
  launch resolves it from the global config. With a project overriding
  `[team] postmaster`, the route decision and the spawned session disagree.
- evidence: raw report item 2; lane says reproduced live. Proposed fix: add
  `--project "$TARGET"` to the runbook forms (as the clerk launch does).
- confidence: not provided.

## 3. ~ in an explicit config path is silently ignored

- target: `scripts/lib/effective-config.ts:1017`
- severity: Low (lane's proposed)
- summary: the code checks `isFile(globalPath)` unexpanded but reads via
  `expandUser`, so a tilde path never passes the gate and the global config
  is silently dropped. Regression from the old `loadMachine` behavior.
- evidence: raw report item 3; lane says reproduced live. Proposed fix:
  expand once at the top.
- confidence: not provided.

## 4. runs-watch swallows load failures

- target: `scripts/runs-watch.ts` (no line given)
- severity: Low (lane's proposed)
- summary: runs-watch swallows load failures and reprints the
  pending-acceptance notice every poll (once per 120s by default, forever).
  Other readers fail loudly.
- evidence: raw report item 4; lane says reproduced live.
- confidence: not provided.

## 5. Roles validation inconsistent across accept/write/read

- target: `scripts/project-settings.ts` (`recordAcceptance`, `writeProfile`)
- severity: Low (lane's proposed)
- summary: `recordAcceptance` doesn't resolve `[roles]` against lanes (so a
  cross-machine file passes accept, then every reader dies), while
  `writeProfile` refuses to write roles without a global config that readers
  don't require.
- evidence: raw report item 5; lane says reproduced live.
- confidence: not provided.
