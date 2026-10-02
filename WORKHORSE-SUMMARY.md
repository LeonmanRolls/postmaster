# Workhorse summary: 182 A fixture run runs every agent at its harness's lowest effort

## Commits

- `d45ee07` Add the run's workhorse spec for #182 (user-approved text, verbatim)
- `d0c48f9` A fixture run runs every agent at its harness's lowest effort

## What was built

A fixture run launches every agent at its harness's lowest effort; a ticket run keeps its
configured levels. `fixture.sh new` writes `.postmaster/fixture` with a fixed one-line marker
(`postmaster.fixture`) before the initial commit. `run-meta.sh` detects the marker and records
every lane and role's effort lowered from one table (codex `none`, claude `low`, muse
`minimal`, mimo `low`); an unmapped harness keeps its effort with a warning on stderr; a lane
that names no effort stays without one. The machine config file is never changed. `launch.sh
review` takes the lane's recorded effort instead of a fixed top level; when the lane names no
effort, review names the harness top level (codex `max`, claude `max`, mimo `high`). A new
`run-meta.sh efforts <dispatch>` command prints the waybill's `efforts:` line from `run.json`.
`fixture.sh score` checks the waybill's `efforts:` line and each Team entry's effort against
`run.json`. The waybill template carries the `efforts:` line; `postmaster.md` Stage B step 7
pastes it from the script. `harnesses.md` and `coachman.md` name the run-recorded lane effort
instead of a fixed top level.

## Checks

From `/home/brindlewick/.postmaster/tool-pins/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/verify.sh run .`:

- `gate`: pass, exit 0, 860s: `bun run check`
- `coachman-contract`: pass, exit 0, 7s: `scripts/coachman-contract.sh --self-test`

Other commands run:

- `bun test scripts/fixture.test.ts`: 81 pass, 0 fail (exit 0)
- `bun test scripts/run-meta.test.ts`: 116 pass, 0 fail (exit 0)
- `bun test scripts/launch.test.ts`: 244 pass, 0 fail (exit 0)
- `scripts/skill-refs.sh`: exit 0

## Evidence

1. `.postmaster/verify/ac1-fixture-marker.txt` — `fixture.sh new` writes `.postmaster/fixture` with the fixed marker `postmaster.fixture\n` in the first commit; the copy is named independently of any path.
2. `.postmaster/verify/ac2-efforts-lowering.txt` — `run-meta.sh` records codex `none`, claude `low` on a fixture run; `sha256sum` of the machine config is identical before and after.
3. `.postmaster/verify/ac3-review-effort.txt` — `launch.sh review` uses the lane's recorded effort (29 review tests pass, including ticket-run reviews naming the configured level and an effortless lane naming top).
   - `.postmaster/verify/verify-run.txt` — `verify.sh run .` passes both checks.
4. `.postmaster/verify/ac4-efforts-line.txt` — `run-meta.sh efforts` prints the `efforts:` line; `fixture.sh score` passes a matching waybill and fails one with a mismatched effort.
5. `.postmaster/verify/ac5-control-matrix.txt` — identical form/review commands under a fixture run's dispatch name the lowest efforts and under a ticket run's the configured ones (3 AC5 tests pass).
   - `.postmaster/verify/summary-evidence-final.txt` — `summary-evidence.ts` confirms the evidence shape holds for 5 criteria.

## Decisions

- **Marker content**: `postmaster.fixture\n` — a fixed one-line string naming the format, holding no path or repository name. Tests assert it byte-for-byte.
- **Marker location**: `.postmaster/fixture` in the copy, tracked in the first commit. `makeRepo` accepts an optional marker parameter; only `new` passes it, so plain repos from `makeRepo` are unmarked.
- **Efforts table**: one table in `run-meta.ts` (codex `none`, claude `low`, muse `minimal`, mimo `low`). Applied to every lane and team role (coachman, coachman_fallback, postmaster, coachman_legs) that names a harness and an effort. One that names no effort stays without one.
- **Unmapped harness**: keeps its configured effort and is named on stderr with the kept effort.
- **Review effort source**: the lane's recorded `effort` from the selected config (recorded with `--run`, live without). When the lane names no effort, review names the harness top level (codex `max`, claude `max`, mimo `high`).
- **`efforts:` line format**: `efforts: <name>=<effort>, …` for every lane and coachman role with an effort, per-leg coachman as `coachman.<leg>`. The postmaster is left out.
- **Score checks**: the waybill's `efforts:` line pair by pair against `run.json`, and each Team entry's effort (its last `/` field) against the recorded one.

## Not done

- A fixture run scored clean on this branch is the merge gate's business, not this run's. The ticket's notes say "it lands after a fixture run scores clean."
- No wiki page is updated: the wiki records what a scored fixture run has shown.

## Verdict

1. **AC1 met.** `fixture.sh new` writes `.postmaster/fixture` with the fixed marker in the first commit; detection is name/path independent.
2. **AC2 met.** `run-meta.sh` records lowered efforts from one table on a fixture run; the machine config is never changed; a ticket run records the effective config unchanged.
3. **AC3 met.** `launch.sh review` runs at the lane's recorded effort; a ticket run's reviews run at the configured level; an effortless lane names top.
4. **AC4 met.** `run-meta.sh efforts` prints the `efforts:` line; the waybill carries it; `fixture.sh score` checks it against `run.json`.
5. **AC5 met.** Identical commands under a fixture run's dispatch name the lowest efforts and under a ticket run's the configured ones.
