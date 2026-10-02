# Workhorse summary: #182

## Built

- `d45ee07` Add the approved workhorse spec for #182.
- `aceeca8` Record fixture runs at minimum effort.
- `643cc29` Keep contract and text controls current.
- `0274484` Check coachman resume effort in fixture controls.

## Checks

- gate: pass, exit 0, 867s: bun run check
- coachman-contract: pass, exit 0, 6s: scripts/coachman-contract.sh --self-test

Other commands run while checking:

- `bun test scripts/run-meta.test.ts scripts/launch.test.ts scripts/fixture.test.ts`: exit 1 (the first AC5 test assertion used the unescaped form text; corrected).
- `bun test scripts/launch.test.ts -t 'run-recorded effort controls'`: exits 1, 1, 0, 0 (test assertion and coachman test model corrected; final run passed).
- `bun run check`: exits 127, 1, 1 before the final verifier (dependencies absent, formatting, then two stale controls; all corrected).
- `bun install --frozen-lockfile`: exit 0.
- `bunx biome format --write scripts/fixture.ts scripts/fixture.test.ts scripts/run-meta.ts scripts/run-meta.test.ts scripts/launch.ts scripts/launch.test.ts`: exit 0.
- `bunx tsc --noEmit`: exit 0; `bunx oxlint`: exit 0; `scripts/skill-refs.sh`: exit 0; `git diff --check`: exit 0.
- `bun test scripts/coachman-contract.test.ts scripts/lib/text.test.ts`: exit 0.
- `scripts/coachman-contract.sh --self-test`: exit 0.
- `/home/brindlewick/.postmaster/tool-pins/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/verify.sh run .`: exit 0 on the previous commit and exit 0 on the final code.
- `bun --no-env-file --config=/dev/null /home/brindlewick/.postmaster/tool-pins/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/summary-evidence.ts .postmaster/verify/summary-draft.md .`: exit 0.
- `bun --no-env-file --config=/dev/null /home/brindlewick/.postmaster/tool-pins/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/summary-evidence.ts WORKHORSE-SUMMARY.md .`: exit 0.

## Evidence

1. `.postmaster/verify/final-verify.txt`
   - `.postmaster/verify/logs/gate.log`
2. `.postmaster/verify/final-verify.txt`
   - `.postmaster/verify/logs/gate.log`
3. `.postmaster/verify/final-verify.txt`
   - `.postmaster/verify/logs/gate.log`
4. `.postmaster/verify/final-verify.txt`
   - `.postmaster/verify/logs/gate.log`
5. `.postmaster/verify/final-verify.txt`
   - `.postmaster/verify/logs/gate.log`
   - `.postmaster/verify/summary-evidence.txt`

## Decisions

- Keep the existing local Git config mark for headless fixture startup and add the committed fixture fact for run effort detection.
- Compare the entire printed `efforts:` line with `run.json` and check the Team entries separately.
- When `run.json` is absent, report that failure once through the existing `run.json` score check.
- Keep a lane without an effort unset at dispatch; its bug review names the harness's previous top level.

## Not done

- A scored live fixture run is the merge gate and follows this lane's work.
- No push, as the workhorse brief requires.

## Verdict

1. Met: fixture copies carry the committed fact and path-independent controls pass.
2. Met: marked dispatches lower recorded efforts and ticket dispatches keep the config.
3. Met: reviews use each recorded lane effort.
4. Met: waybills carry the recorded line and scoring checks it.
5. Met: paired form, resume and review controls pass.
