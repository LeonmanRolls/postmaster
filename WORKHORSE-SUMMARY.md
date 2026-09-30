# Workhorse summary: #160 Record each launch's tokens and cost where its harness reports them

## What I built

- `scripts/usage.ts` — the harness adapter's usage reading, run by Bun:
  `read` prints the figures a harness reports in one event stream (or its session
  record); `record` writes one usage record per launch beside that launch's events
  stream under `<dispatch>/logs/`; `sum` prints the closing block per role and lane,
  naming harnesses that report nothing and never writing a missing figure as zero.
- `scripts/usage.test.ts` — `bun test` pairs for every harness in `harnesses.md`'s
  table: one made-up stream that reports usage and one that does not, read through
  the identical command, plus record and sum controls.
- `scripts/fixtures/usage/` — that paired corpus (codex, grok, agy, claude, pi,
  muse, mimo), made-up values only, in each harness's exact event shape.
- `scripts/launch.sh` — after `export-session.sh` on every run launch, resume and
  review, records usage from the same events stream through Bun, with role and lane
  passed from the launch site. Best-effort: a recording fault never changes the
  harness's exit.
- `skills/postmaster/harnesses.md` — a Usage subsection naming where each harness
  reports input/output tokens and cost (event type and field path, or the session
  record), with `usage.ts` as that reading's executable form.
- `skills/postmaster/coachman.md` — Stage 4 and the ship card carry `usage.ts sum`'s
  block as the cost, quoted, never hand-recomputed and never zero for a figure no
  harness reported.
- `.postmaster/project.toml` — the gate runs `bun test scripts/usage.test.ts` and
  the shows line says so.

## Commits

- `7461139` `#160, read a launch's cost from its harness stream: usage.sh and its controls`
  (first cut as bash/Python with `--self-test`; replaced in the next commit once the
  shared spec revision settled on TypeScript on Bun)
- `8fcbf59` `#160, record each launch's cost beside its stream from launch.sh`
  (`scripts/usage.ts` and `scripts/usage.test.ts`, launch wiring, bash script removed)
- `bc5c9f0` `#160, the adapter names where each harness reports cost; the closing record quotes it`
  (harnesses.md Usage subsection, coachman.md cost block, project.toml gate)
- `b5a60f4` `#160, tick the spec tasks done`

## Checks

`/home/brindlewick/.postmaster/tool-pins/ffe37821779aa7cc77275860573a8fdd43cd6e2d/scripts/verify.sh run .`
run just before this summary:

- `gate`: **pass, exit 0, 809s** — `bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'`

The brief's checks are `gate [default:gate]` only; that is the line above. The run
was armed with the gate as recorded at dispatch, which does not yet name `bun test`;
`bun test` was run on its own (below) and is in `project.toml` for the next dispatch.

Other commands run:

- `bun test scripts/usage.test.ts` — exit 0 (17 pass, 0 fail)
- `scripts/skill-refs.sh` — exit 0
- `scripts/wiki-lint.sh` — exit 0
- `scripts/launch.sh --self-test` — exit 0 (including the new control that a run
  launch records usage beside the stream and omits figures the harness did not report)
- `bash -n` over `scripts/*.sh` — exit 0

## Decisions

1. **Field paths per harness** (behind the adapter, in `usage.ts` and named in
   `harnesses.md`): claude `result.usage` / `result.total_cost_usd`; codex
   `turn.completed.usage`; mimo `step_finish` `part.tokens` and `part.cost`;
   muse session-record `goal_usage_attribution` `quantity`; pi `message.usage`
   (and its `usage` rows); grok `usage` / `token_usage` with OpenAI-compatible
   names; agy `usageMetadata` (`promptTokenCount` / `candidatesTokenCount`).
2. **Role and lane come from the launch site** (`launch.sh` sets them from `CMD`,
   `NAME` and `--leg` and passes `--role` / `--lane`), never guessed from paths.
   A review is a reviewer on its lane; a `--leg` is the coachman on that leg;
   anything else is a workhorse on its lane.
3. **Claude's `result` is the run's own report** and is taken whole; a stream that
   ends without one is summed from its assistant `message.usage`. Codex and mimo
   per-step reports are summed. AgY/grok repeats of one request's usage are
   deduped as consecutive identical figures.
4. **Absent figures are omitted keys, never 0.** `sum` prints `not reported`, marks
   partial coverage as `X (n of m launches)`, and names a harness with no figures
   at all as `reports nothing`.
5. **One record per events stream**, overwritten with the whole-stream reading on
   each launch or resume, so a remount never double-counts. For muse, the exported
   session under `sessions/<name>/` is merged in (max, not sum, against the stream).
6. **Fixtures are made-up values only**, never trimmed from real run records (the
   shared spec's rule). Shapes come from documented result objects, recorded
   `codex exec --json` turns, the MiMo StepFinishPart schema, a recorded Muse
   export, pi's message usage shape, and OpenAI/Gemini-compatible usage names.

## What I did not do

- Did not add `usage.ts` to `controls.md`: recording cost is bookkeeping, not a
  control that decides whether work is checked, so a fault in it does not stop a leg.
- Did not put figures in `run.json` (written once at dispatch) or `actions.jsonl`;
  per-launch records live beside each events stream, and the sum is quoted into the
  closing narrative and the ship card.
- Did not invent cost where a harness reports none (codex, muse, agy); those lines
  read `cost not reported`.
- The first commit was a bash/Python cut; the shared spec revision settled on
  TypeScript on Bun mid-run, so it was replaced rather than kept as a second form.

## Acceptance criteria

1. **Each launch records the input and output tokens its harness reports, and the
   cost where the harness reports one, in the run's records, per role and lane.** —
   met. `launch.sh` records one `<stream>-usage.json` under `<dispatch>/logs/` on
   every run launch, resume and review, with role and lane from the launch site.
2. **The run's closing record sums them per role and lane, and says which harnesses
   report nothing, never recording a missing figure as zero.** — met. `usage.ts sum`
   prints one line per (role, lane) with summed figures, `not reported` for an absent
   figure, partial coverage marked, and `harness X reports nothing`; `coachman.md`
   quotes that block in the final `run-log.md` entry and on the ship card.
3. **The per-harness reading lives behind the harness adapter, with a self-test
   control per harness from a recorded stream: one that reports usage, and one that
   does not.** — met. The reading is `usage.ts`, documented per harness in
   `harnesses.md`; `bun test scripts/usage.test.ts` runs a with-usage and a
   no-usage stream for each of the seven harnesses through one command, the positive
   reading non-zero figures and the negative reading absent and never zero.
