# Workhorse blocked: #200

## Approved check

T006 and the approved spec's AC9 check require this lane to run `scripts/fixture.sh new`, then run a real confined harness against that fixture. The brief also says, "Never edit files outside your worktree."

`scripts/fixture.sh new` refuses a destination anywhere inside a Git repository. Every destination this lane may write is inside its worktree. Running the approved check therefore needs a ruling that expands the permitted write scope.

## Evidence

`.postmaster/verify/fixture-placement.log` records:

```text
command: scripts/fixture.sh new .postmaster/verify/fixture-200 remove
fixture: destination would be inside the git repository; a run's repo stands alone
exit: 1
```

The diagnostic above abbreviates the absolute paths; the transcript retains the complete output. The refusal happens before the fixture repository or its local ticket store is created. `scripts/fixture.ts:197` explicitly checks the destination's parent repository.

The baseline gate also needs temporary directories outside any Git repository. With `TMPDIR` set to `.postmaster/verify/tmp` to keep writes in this worktree, those tests discover the enclosing repository instead. Examples appear in `.postmaster/verify/baseline-gate.log` for `front-door.test.ts`, `clean-checkout.test.ts` and `run-clash.test.ts`.

## Proposed ruling

Permit one standalone scratch directory outside this worktree for the fixture repository and the gate's temporary directories. Keep implementation and evidence files in this worktree. This preserves the approved checks and the fixture command's refusal of nested repositories.

## Branch state

- Branch: `wb/200-astra`; starting commit: `91f610b`.
- No implementation files changed. `WORKHORSE-SPEC.md` is unchanged.
- Locked development dependencies are installed locally; dependency manifests are unchanged.
- Verification transcripts remain under `.postmaster/verify/` and are not committed.
- Only this blocked report is committed. No push, merge, rebase or project tracker operation was performed.

## Checks

- `bun install --frozen-lockfile --cache-dir .postmaster/verify/bun-cache`: exit 0. The initial gate had exited 127 because `tsc` was absent.
- `bun run check`, with `TMPDIR` inside this worktree: exit 1; 2508 passed, 23 failed, 2531 tests across 52 files. Transcript `.postmaster/verify/baseline-gate.log`. The type check, lint and format stages passed; the failed test stage prevented the later runbook-reference and wiki-lint commands from running.
- `scripts/coachman-contract.sh --self-test`: exit 0; 34 passed, 0 failed. Transcript `.postmaster/verify/coachman-contract.log`.
- `scripts/fixture.sh new .postmaster/verify/fixture-200 remove`: exit 1. Transcript `.postmaster/verify/fixture-placement.log`.
- `bwrap --unshare-pid --dev-bind / / --proc /proc --die-with-parent -- /bin/true`: exit 0. Transcript `.postmaster/verify/confinement-preflight.log`. Process confinement can start on this machine; that is not the block.
- `git diff --exit-code -- WORKHORSE-SPEC.md`: exit 0.

The ticket is not implemented. Work stops for the write-scope ruling required by the brief's blocked-report contract.
