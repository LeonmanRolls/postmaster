# Workhorse summary: #201 Lane confinement setup probe

## Built

- 816952f Copy the specified #109 Bun setup port unchanged from c70e592819302001e8ef3a358781a9ca4b5b5232.
- 11d642c Add the Linux and macOS confinement probe, its two-line wrapper, and stubbed controls.
- 5037889 Add the setup choice, config example, setup controls, setup conversation, launch-card line, and README entry.

The implementation follows the approved spec at 5f2261f7143264647e0e17f5bb932c83101ca6e9.

## Checks

- Pinned /home/brindlewick/.postmaster/tool-pins/56b7a04cb7758bdb2a292f583e81fd51300cfb2c/scripts/verify.sh run . — exit 0. It printed one check:
- gate: pass, exit 0, 967s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && bun test scripts/usage.test.ts && scripts/skill-refs.sh && scripts/wiki-lint.sh && bun test scripts/clean-checkout.test.ts && for n in cut-scratch discover-project export-session fixture front-door front-door-acceptance github host landing launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done && bun test scripts/run-clash.test.ts && bun install --frozen-lockfile && bun test ./scripts ./lint && bun run lint'
- bun test ./scripts — exit 0; 133 tests passed.
- bun test scripts/setup.test.ts scripts/probe-confine.test.ts — exit 0; 39 tests passed before the added explicit-off control.
- bun test scripts/setup.test.ts — exit 0; 33 tests passed.
- bun test scripts/probe-confine.test.ts — exit 0; 7 tests passed.
- /bin/bash scripts/setup.sh --self-test — exit 0; 33 tests passed.
- bun run lint — exit 0.
- Pinned scripts/skill-refs.sh skills/postmaster/SKILL.md — exit 0.
- Pinned scripts/skill-refs.sh --fix skills/postmaster/SKILL.md — exit 0; no rewrite.
- /bin/bash scripts/probe-confine.sh — exit 0; this machine reported ready.
- /bin/bash scripts/probe-confine.sh --verdict — exit 0; printed only ready.
- git diff --check — exit 0.

## Decisions

- The probe checks missing packages first and gives one package-manager command for all of them. It checks the Bubblewrap launch after the tools are present.
- A failed Bubblewrap launch on restricted Ubuntu 24.04 or later names the supplied /usr/bin/bwrap AppArmor profile and its activation. A file's presence alone is not treated as proof that the rule works.
- On macOS, sandbox-exec and ripgrep on PATH yield ready, with an explicit notice that macOS has not been tried. Other platforms and failures without a known remedy yield unavailable.
- Setup accepts on for ready or partial, refuses it for unavailable, accepts off on any machine, and writes off by default. A missing key in an existing config means off.
- The probe has an --verdict output for setup, while its default output is the table and footer. Test-only platform, sysctl, and OS-release inputs let the controls force all verdicts without changing the machine.
- The copied Bun setup port no longer had the shell script's --self-test switch. The recorded gate still calls it, so setup.ts forwards that switch to its adjacent Bun tests.

## Not done

- No lane launch wrapper was changed; ticket #200 owns the launch-time read of confine.
- No package was installed and no AppArmor rule was written or activated. The probe prints those actions for the user.
- macOS was checked with stubs, not on macOS hardware.
- Nothing was pushed.

## Acceptance criteria

- AC1 met: the probe exits zero with a table and footer, reports ready, partial or unavailable, and names the next step for partial.
- AC2 met: the restricted Ubuntu control reports partial with the bwrap-only AppArmor rule and activation command.
- AC3 met: missing-package controls report an install command with a known manager and unavailable without one.
- AC4 met: the macOS control reports ready with sandbox-exec and ripgrep and says the path has not been tried.
- AC5 met: setup asks once after showing the probe, validates on/off, refuses on when unavailable, and writes the top-level key.
- AC6 met: the launch-card instructions say whether lanes will run confined, treating a missing key as off.
- AC7 met: stubbed probe controls cover ready, partial and unavailable.
