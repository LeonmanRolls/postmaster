# Workhorse summary: #114 Pin runs to the dispatched postmaster version

## Built

- `50130fa #114 record pinned tool approach` records the implementation plan before code changes.
- `d052d89 #114 pin the tool worktree per run` adds shared pin acquisition, release, and run metadata.
- `f20e8f6 #114 route coachman legs through pinned tool` routes each run leg through the pinned checkout, preserves old waybills, and updates the runbooks and `AGENTS.md`.
- `64c014b #114 pin the exact dispatch commit` binds acquisition to the commit recorded by `run-meta.sh` and updates its launch fixtures.
- `60943ef #114 isolate verifier fixture path` keeps the verifier's journey-path self-test within its temporary worktree when the gate supplies `POSTMASTER_VERIFY`.

## Checks

- `/home/brindlewick/postmaster/scripts/verify.sh run .` printed: `gate: pass, exit 0, 283s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch fixture front-door front-door-acceptance github host launch link-skills local log-action plane review-round reviewers run-log run-meta run-times runs-status setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint tool-pin; do scripts/$n.sh --self-test || exit 1; done'` (exit 0).
- `scripts/tool-pin.sh --self-test` (exit 0).
- `scripts/run-meta.sh --self-test` (exit 0).
- `scripts/host.sh --self-test` (exit 0).
- `scripts/front-door-acceptance.sh --self-test` (exit 0).
- `POSTMASTER_VERIFY=<worktree>/.postmaster/verify scripts/verify.sh --self-test` (exit 0).
- `scripts/skill-refs.sh`, `scripts/wiki-lint.sh`, `git diff --check`, and `bash -n scripts/tool-pin.sh scripts/run-meta.sh scripts/launch.sh` (exit 0).
- A standalone `scripts/launch.sh --self-test` passed before the exact-commit argument change; a later standalone run was interrupted by OOM. The final gate passed the launch self-test after that change.
- Earlier completed gate attempts exited 2: one reported a front-door acceptance control that passed on standalone rerun, one hit the documented intermittent host control (#85) that passed on standalone rerun, and one found the verifier self-test environment leak fixed in `60943ef`. A later attempt was interrupted by the machine upgrade. The final gate above passed.

## Decisions

- Keep managed worktrees under `~/.postmaster/tool-pins/<commit>` and share one checkout by full commit id across runs.
- Use one reference file per dispatch as the in-flight count. Release it in Stage G after the run is terminal, all coachman leg exit markers exist, and the synthesis and workhorse worktrees are removed. On abandonment, release only after processes stop and run worktrees are removed. The last released reference removes the shared checkout.
- Pass the postmaster commit already captured by `run-meta.sh` to acquisition, so a concurrent change to the main checkout cannot make the pin differ from `run.json`.
- Keep legacy waybills on the explicit tool path they already name.
- The repo has no tracked gate builder. Add `tool-pin.sh --self-test` to the waybill profile guidance and this run's verification profile.
- Scope the `verify.sh` self-test's temporary worktree to its own `POSTMASTER_VERIFY` path. The verifier sets that variable for checks; this avoids changing runtime behavior while keeping its fixture isolated.

## Not done

- No fixture run was dispatched. The fixture-run rule for coachman contract changes remains a merge condition and should be satisfied before landing.
- No push or pull request was made. This lane does not push; the postmaster handles landing and the user merges.

## Acceptance

- AC1 — met: dispatch records the exact postmaster commit and shared checkout path in `run.json`; the waybill names that checkout.
- AC2 — met: launches, resumes, takeovers, host scripts, launch scripts, and coachman runbooks resolve through the pinned tool; legacy waybills retain their existing tool path.
- AC3 — met: `tool-pin.sh --self-test` advances its source fixture after dispatch and verifies the pinned runbook and script with positive and negative controls.
- AC4 — met: one locked reference per run shares the checkout; teardown releases references and removes the checkout only after the last run is no longer in flight.
- AC5 — met: `AGENTS.md` describes dispatch-version pinning, removes the fleet-idle contract restriction, and keeps the fixture-run quality rule.
