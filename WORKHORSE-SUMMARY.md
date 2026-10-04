# WORKHORSE-SUMMARY

## Commits

- `e4c1d1b Use platform boot and signal identities`
- `c12e5d5 Handle Mac task roots and ticket prefixes`
- `09103a3 Tailor setup and notes for macOS`
- `bdfba1a Bound Herdr checks and write launch environments atomically`
- `a13e73c Print large environment handoff controls`
- `4e91ad5 Fix Herdr timeout test arguments`
- `0cbbbec Format macOS portability changes`
- `6d47b90 Keep portability tests valid on mapped filesystems`

## Checks

The final `scripts/run verify run .` printed:

- `gate: pass, exit 0, 1227s: bun run check`
- `coachman-contract: pass, exit 0, 10s: scripts/run coachman-contract --self-test`
- `exit: 0`

Acceptance checks on the final code:

- C1, `bun .postmaster/verify/c1-check.ts`: exit 0.
- C2, `bun run check` in the final verifier: exit 0.
- C3, `bun .postmaster/verify/c3-check.ts`: exit 0.
- C4, `bun test scripts/lib/proc.test.ts`: exit 0; also passed in the final gate.
- C5, `bun test --test-name-pattern 'harvest accepts the Claude task folder' scripts/review-findings.test.ts`: exit 0; also passed in the final gate.
- C6, `bun test --test-name-pattern 'prefix is found in-process' scripts/discover-project.test.ts`: exit 0; also passed in the final gate.
- C7, `bun test --test-name-pattern 'macOS omits launch limits|Linux keeps its eight' scripts/setup.test.ts`: exit 0; also passed in the final gate.
- C8, `bun test --test-name-pattern 'interactive setup on macOS reports uncapped launches once' scripts/setup.test.ts`: exit 0; also passed in the final gate.
- C9, `bun .postmaster/verify/c9-check.ts`: exit 0.

Other checks and setup commands:

- `scripts/run coachman-contract --self-test`: exit 0.
- `bun test --test-name-pattern 'boot checks use the boot session UUID|a bwrap is vetted only on a root-owned chain|macOS omits launch limits' scripts/lib/processes.test.ts scripts/probe-confine.test.ts scripts/setup.test.ts`: exit 0.
- `bun test --test-name-pattern 'guard: no hand-written' scripts/lib/text.test.ts`: exit 0.
- `bunx tsc --noEmit`: exit 0.
- `bunx oxlint`: exit 0, with existing warnings.
- `bunx biome format scripts types lint package.json tsconfig.json biome.json .oxlintrc.json`: exit 0.
- `bunx biome format --write scripts/host-self-test.ts scripts/host.test.ts scripts/lib/proc.test.ts scripts/lib/processes.test.ts scripts/lib/processes.ts scripts/review-round.test.ts scripts/setup.test.ts scripts/setup.ts`: exit 0.
- Draft `summary-evidence` check: exit 0. Final root summary check: `scripts/run summary-evidence WORKHORSE-SUMMARY.md .`, exit 0.
- `bun install --frozen-lockfile`: exit 0; installed missing local development dependencies.
- The first verifier attempt before installation exited 3 because `tsc` was unavailable. After installation, one gate attempt found a readonly test argument, another found formatting issues, and a full run found the source guard and a root-ownership test assumption. Those were fixed. The earlier failure transcripts are `.postmaster/verify/verify-missing-dependencies.txt` and `.postmaster/verify/gate-before-portability-fixes.txt`.

## Decisions

- D1: put the remaining macOS differences in the README.
- D2: document only differences that remain, with no source file names.
- D3: omit limit settings from setup's settings list when setup does not ask for them.
- D4: ask about launch limits only on Linux.
- D5: leave macOS launches uncapped and tell the user once in setup.
- D6: describe Muse and MiMo confinement as unknown until tried on a Mac.
- D7: keep the lock-file guard when `flock` is absent and document its rare lost-entry race.
- D8: leave named-user tilde paths literal and show that path in errors.
- D9: retain replacement decoding for invalid argument bytes.
- D10: keep review limits tied to the wall clock and document clock corrections.
- D11: document time-zone launch tracking loss without changing process start-time checks.
- For environment transfer, use a private temporary JSON file followed by atomic rename so the pane receives large environments without a FIFO size limit.
- Keep Linux boot identity reads unchanged; prefer `kern.bootsessionuuid` on macOS, fall back to boot-time seconds, and compare legacy records by seconds.
- Make the existing confinement test derive its expected result from the observed ownership chain, since this container maps system-path ownership to a non-root ID.

## What was not done

- No test ran on a physical Mac. The Mac paths were forced on Linux as specified. Native macOS CI belongs to #258.
- No fixture run was needed because the change does not touch the coachman contract.
- The Mac launch caps, Muse and MiMo data-location trial, and time-zone tracking fix remain out of scope under #140, #205 and D11.
- No push was made.

## Evidence

1. `.postmaster/verify/c1.txt`
   - `.postmaster/verify/summary-evidence-transcript.txt`
2. `.postmaster/verify/gate.txt`
3. `.postmaster/verify/c3.txt`
   - `.postmaster/verify/gate.txt`
4. `.postmaster/verify/gate.txt`
5. `.postmaster/verify/gate.txt`
6. `.postmaster/verify/gate.txt`
7. `.postmaster/verify/gate.txt`
8. `.postmaster/verify/gate.txt`
9. `.postmaster/verify/c9.txt`
   - `.postmaster/verify/gate.txt`

## Verdicts

1. Met: with a hanging Herdr, close and host detection return within the limit without closing a pane; the `timeout` control also passes.
2. Met: Herdr and tmux receive the full 100,000-byte and 1,000-byte caller environments, and the command marker lands.
3. Met: UUID changes report a restart; corrected boot-time formatting and legacy records remain valid. The seconds fallback passes.
4. Met: signal exits use runtime signal numbers; the macOS SIGUSR1, SIGBUS and SIGSYS values are verified.
5. Met: harvest accepts both Claude temporary roots and refuses task output outside them.
6. Met: the ticket prefix is found in-process when grep exits with an error.
7. Met: Darwin setup omits launch-limit settings and ignores supplied limit answers; Linux retains the settings and validation.
8. Met: Darwin setup prints the uncapped-launch notice once in interactive and answers modes; Linux does not print it.
9. Met: the README lists D5–D11 and the archived Linux-only checks, says what users see, and names no files.
