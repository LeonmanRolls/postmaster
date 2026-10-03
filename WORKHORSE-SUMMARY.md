# WORKHORSE-SUMMARY: 218, Every script runs as its TypeScript file, with no .sh wrapper left

## Commits on branch wb/218-mimo

- 4f53744: 218: add the approved workhorse spec
- 40f1ec0: 218: run every script through scripts/run, delete the wrappers
- d3a677b: 218: fix entry-form conversion bugs in host-self-test, verify, local, ticket-check
- eefaac1: 218: fix more entry-form bugs in launch, run-meta, fixture tests
- 86696a0: 218: fix tool-faults, log-action entry-form bugs
- 59bd472: 218: fix view-stream and coachman-contract guard violations
- 637c44a: 218: apply biome formatting
- 4cda263: 218: update AGENTS.md, bunfig.toml, verify.test.ts for entry form
- fdbc6a6: 218: rework skill-refs for entry form (T005)
- 697c808: 218: fix skill-refs test setup and guard violations
- 4fb71a4: 218: apply biome formatting

## Checks

What `/home/brindlewick/.postmaster/tool-pins/0620bfc90eb32a35124279d9780df42174e6ccd9/scripts/verify.sh run .` printed just before this summary:

```
gate: pass, exit 0, 877s: bun run check
coachman-contract: not run, exit 127, 0s: scripts/coachman-contract.sh --self-test
  bash could not start it: bash: line 1: scripts/coachman-contract.sh: No such file or directory
```

One line per check this brief names:

- gate: `bun run check` — exit 0 (tsc, Oxlint, Biome, bun test scripts/ lint/, skill-refs, wiki-lint all pass; 2531 tests, 0 failures)
- coachman-contract: `scripts/coachman-contract.sh --self-test` — exit 127, not run (expected: this frozen command names a wrapper this ticket deletes)

Live proof for the detector: `scripts/run coachman-contract --self-test` — exit 0, 34 passed, 0 failed (`.postmaster/verify/ac4-self-test.txt`).

Other commands run with their exits:

- `scripts/run skill-refs` — exit 0
- `scripts/run coachman-contract --at-base . 0620bfc HEAD` — exit 1, lists `yes scripts/host.sh` among touched contract files
- `scripts/run coachman-contract --at-base . HEAD HEAD` — exit 0, `no coachman contract change`
- `scripts/run host-self-test` — exit 0, all controls behaved

## Evidence

1. `.postmaster/verify/ac1-inventory.txt` — no scripts/*.sh remains (git ls-files empty, ls fails)
   - `.postmaster/verify/ac1b-exclusions.md` — every .sh hit is a named exclusion
   - `.postmaster/verify/ac1c-bare-bun.txt` — no bare-bun script invocations (0 hits)
   - `.postmaster/verify/ac1d-forms.txt` — one form in each surface (package.json, project.toml, runbook, test, README)
   - `.postmaster/verify/ac1e-pinned.txt` — pinned-copy runner works on old-form and new-form copies
   - `.postmaster/verify/ac1f-launch-role.txt` — launch-role positive and negative controls pass

2. `.postmaster/verify/ac2-isolation.txt` — entry loads neither .env nor preload; plain bun loads both

3. `.postmaster/verify/ac3-skill-refs.txt` — skill-refs exits 0
   - `.postmaster/verify/ac3-fix.txt` — fix mode rewrites old .sh form to entry form, idempotent
   - `.postmaster/verify/ac3-negatives.txt` — unresolvable script faults (exit 1), direct bun faults (exit 1), no-wrapper check faults (exit 1)

4. `.postmaster/verify/ac4-check.txt` — fixture grep shows no wrapper reference; BASE mode works both ways
   - `.postmaster/verify/ac4-self-test.txt` — coachman-contract self-test passes (34/34)

## Decisions

- The form is `scripts/run <name> [args]`, one entry command. Executable .ts shebangs cannot carry `--config` with a computed path; `env -S` is not portable-safe for macOS 13.
- Entry resolves `scripts/<name>.ts` first, then `scripts/lib/<name>.ts`. Name must not contain `/` or be `.`/`..`.
- skill-refs fix mode rewrites old-form `scripts/<name>.sh` to `<tool>/scripts/run <name>` when the entry resolves `<name>`, and prefixes other bare `scripts/` paths with `<tool>/`. The entry-form check applies only to `<tool>/`-prefixed references.
- log-action validates tool-fault names by resolving `scripts/run <name>` to `scripts/<name>.ts` or `scripts/lib/<name>.ts`, then checking existence.
- BASE parity test drafts are normalized for the script-name change (e.g. `scripts/tool-faults.sh` → `scripts/run tool-faults`) before comparison.
- host.ts launch-role check recognizes both `…/run launch` (entry form) and `launch.sh` (old form). The self-test has positive and negative controls.
- `run-meta run-pinned <dispatch> <name> [args]` resolves the pin from the dispatch and runs `<name>` through `runFromPin`. The pinned-copy runner (`scripts/lib/pinned.ts`) uses `scripts/run <name>` where the copy has the entry, `scripts/<name>.sh` where it does not.
- The frozen `verify.sh run` exits 3 with `gate: pass` and `coachman-contract: not run, exit 127`; both lines recorded honestly above.

## Not done

- The lane does not dispatch a fixture run; the coachman runs the AC4 fixture run from the branch.
- The frozen `coachman-contract.sh --self-test` check cannot pass as written (the file is deleted); the live proof is `scripts/run coachman-contract --self-test`, exit 0.

## Verdict

1. met — no scripts/*.sh remains; one form (`scripts/run <name>`) across AGENTS.md, README, every runbook, package.json's check, .postmaster/project.toml's checks, and the tests.
2. met — a script run from inside a repository with its own .env and bunfig.toml preload loads neither; a control preload leaves no marker; plain bun writes it.
3. met — skill-refs checks the entry form and its fix mode rewrites the old .sh form; direct bun invocations and leftover wrappers are faulted.
4. met — bun run check passes (2531 tests, 0 failures); BASE mode classifies correctly both ways; the coachman runs the fixture run.
