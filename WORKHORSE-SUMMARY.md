# Workhorse summary: #218

## Built

- `4f53744` 218: add the approved workhorse spec
- `ab4dc6c` Add isolated script entry command
- `d508555` Route scripts through isolated entry
- `8483340` Finish script reference and control migration
- `65ad692` Update test controls for script entry
- `6facc91` Use explicit ASCII classes in script checks
- `4c96742` Keep direct Bun control out of command inventory

## Checks

- Pinned verifier: `gate: pass, exit 0, 864s: bun run check`.
- Pinned verifier: `coachman-contract: not run, exit 127, 0s: scripts/coachman-contract.sh --self-test`. The wrapper was deleted by this ticket; the verifier exited 3.
- `bun run check` — exit 0; 2,531 tests passed.
- `scripts/run coachman-contract --self-test` — exit 0; 34 controls passed.
- `python3 .postmaster/verify/check-ac1.py` — exit 0.
- `bun test scripts/host.test.ts -t 'run role: the explicit host role'` — exit 0.
- `python3 .postmaster/verify/check-ac2.py` — exit 0.
- `python3 .postmaster/verify/check-ac3.py` — exit 0.
- `grep -rn '\.sh' fixtures/ package.json .postmaster/project.toml` — exit 0; the sole hit is the Bun website URL.
- `scripts/run coachman-contract --at-base . 0620bfc90eb32a35124279d9780df42174e6ccd9 HEAD` — exit 1 as expected; reports a contract change.
- `scripts/run coachman-contract --at-base . HEAD HEAD` — exit 0; reports no contract change.
- Optional `scripts/run host --live-test` — exit 1 on two real Herdr pane controls; the stubbed launch-role control passed.
- `bun --no-env-file --config=/dev/null /home/brindlewick/.postmaster/tool-pins/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/summary-evidence.ts WORKHORSE-SUMMARY.md .` — exit 0.

## Evidence

1. `.postmaster/verify/ac1-final.txt`
   - `.postmaster/verify/ac1-grep-raw.txt`
   - `.postmaster/verify/ac1-host-role-stub.txt`
2. `.postmaster/verify/ac2-final.txt`
3. `.postmaster/verify/ac3-final.txt`
4. `.postmaster/verify/ac4-gate.txt`
   - `.postmaster/verify/ac4-fixture-refs.txt`
   - `.postmaster/verify/ac4-base.txt`
   - `.postmaster/verify/coachman-contract-live.txt`
   - `.postmaster/verify/verify-final.txt`
   - `.postmaster/verify/summary-evidence-final.txt`

## Decisions

- Use `scripts/run <name> [args]` for every runnable script. It starts Bun with the tool's `bunfig.toml` and disables env file loading.
- Run scripts from pinned tool copies in each copy's own form. A copy dispatched before this migration still uses its wrapper.
- Resolve `text` through `scripts/lib/text.ts` in the entry, without a special command.
- Keep historical `.sh` records and deliberate old-form test inputs. Assemble the direct Bun negative test input across source lines so the command inventory stays clear.
- Record the frozen contract check as `not run` and use `scripts/run coachman-contract --self-test` for live proof, as the approved spec directs.

## Not done

- The coachman owns fixture dispatch and scoring from this branch. The lane converted fixture commands and passed the gate and contract classification checks.
- No push or merge; the run brief forbids both.
- The optional real Herdr smoke test's two pane UI failures were outside this migration. Its transcript is `.postmaster/verify/ac1-host-role.txt`.

## Verdict

1. Met.
2. Met.
3. Met.
4. Lane checks met; full acceptance awaits the coachman's fixture score.
