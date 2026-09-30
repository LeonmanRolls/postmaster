# Workhorse summary: #75 Dispatch refuses a run directory or branch that already exists

## Commits

- `dbf8a2d` — record the approved workhorse spec.
- `c64b3d8` — add the TypeScript run-clash check and Bun tests.
- `da29c6d` — call the check from Stage B and add it to the declared gate and README.
- `576b9c9` — mark the implementation tasks complete.

## Checks

- `gate` — `/home/brindlewick/.postmaster/tool-pins/ffe37821779aa7cc77275860573a8fdd43cd6e2d/scripts/verify.sh run .`, exit 0; printed: `gate: pass, exit 0, 810s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'`
- `bun test scripts/run-clash.test.ts` — exit 0; 8 tests passed with 20 assertions.
- `scripts/verify.sh checks .` — exit 0; the current declared gate includes `bun test scripts/run-clash.test.ts` and its `shows` description names those tests.
- `scripts/skill-refs.sh` — exit 0.
- `git diff --check` and `git diff --cached --check` — exit 0.
- `bun --version` — exit 0; Bun 1.4.2.
- `bun test --reporter=spec scripts/run-clash.test.ts` — exit 1; Bun 1.4.2 does not support the `spec` reporter (available: `junit`, `dots`).
- `ps -eo pid,ppid,etime,stat,comm` — exit 0; used to inspect the long-running gate while it ran.

## Decisions

- Use TypeScript on Bun with no package, TypeScript, or Bun config files; Bun is the only added dependency.
- Keep clash selection and formatting in a pure function, with filesystem and Git reads at the CLI edge.
- Treat a file or directory at the run path as a clash. Check local branches only: exact `<TICKET>` and every branch beginning `wb/<TICKET>-`; remote-tracking refs are out of scope.
- Return 0 for a free id, 1 for invalid input or an unreadable repository, and 2 for clashes. Reject empty ids, slash-containing ids, `.` and `..`, and values Git will not accept as a branch ref.
- Print the free result on success; on a clash, name each path and branch and tell the postmaster to ask the user whether to archive or rename the old run or choose another id. The script itself does not write or log.
- Place the guard first in Stage B, before ticket-check logging, to satisfy acceptance criterion 1 literally. This is earlier than the approved spec's suggested placement after base pre-flight; the approved spec's other decisions remain unchanged.
- Add no wiki page because this change adds a mechanism and no new project finding.

## What I did not do

- I did not rename, archive, remove, or otherwise change an existing run or branch. The postmaster leaves that decision and action to the user.
- I did not change local ticket ids or tracker migration behavior, and I did not inspect remote-tracking branches, as the approved scope leaves those out.
- I did not add shared Bun configuration or update unrelated documentation.
- I did not push or open a pull request, per the lane instructions.

## Verdict

- AC1: Met. Stage B runs the read-only check before its ticket-check log; the check names an existing run path and refuses it.
- AC2: Met. The check names an exact ticket branch and every matching local `wb/<TICKET>-*` branch, including multiple matches.
- AC3: Met. The adjacent Bun tests cover a clean pass, each clash type, combined clashes, and the near-miss id control.
- AC4: Met. Stage B calls the TypeScript script through Bun, presents refusals to the user, and performs no rename or removal; the declared gate includes the Bun tests.
