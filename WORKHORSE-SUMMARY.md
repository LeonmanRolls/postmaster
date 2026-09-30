# Workhorse summary: #92 Setup installs the skill links, and the postmaster checks them

Implemented from the approved shared spec at `ff4a0a1`.

## Commits on this branch

- `654b48c` Workhorse spec for #92: skill links checked at setup and postmaster start (this lane's draft; replaced by the shared spec)
- `ff4a0a1` Shared spec for #92 from the two lane specs, on the user's word (approved; not rewritten)
- `7218743` link-skills.sh --check names missing or blocked links and never installs
- `5b99cec` Setup and the postmaster start check skill links; install on the user's word
- `9a70818` Tick #92 tasks done through the runbook and README updates
- this commit: tick T006 and the summary

## What was built

- `scripts/link-skills.sh --check`: read-only over the existing `plan`. Names each missing
  (`to link`) or blocked (`IN THE WAY`) path via `report()`, then
  `link-skills: run scripts/link-skills.sh to install`, exit 1. A complete set prints
  `link-skills: every link is in place` and exits 0. Install and remove paths are unchanged.
- `--self-test` controls (identical `check_links` command): a complete set passes and changes
  nothing; a removed link is reported with the install command and nothing is installed; a
  folder in the way is reported.
- `AGENTS.md` step 1 runs `scripts/link-skills.sh --check` beside the config check and says
  what to do when config or links are missing. Setup shows the dry run and installs only on
  the user's word.
- `skills/postmaster/SKILL.md` preconditions run `<tool>/scripts/link-skills.sh --check`, name
  missing links and `<tool>/scripts/link-skills.sh` as the install command, and keep install
  on the user's word.
- `README.md` lists `--check` and describes it in "Installing the skills".
- `WORKHORSE-SPEC.md` tasks ticked in later commits (T001–T006).

## Checks

`/home/brindlewick/.postmaster/tool-pins/ffe37821779aa7cc77275860573a8fdd43cd6e2d/scripts/verify.sh run .`
printed:

```
gate: pass, exit 0, 817s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs spec-decisions spec-review-link stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

One check recorded: `gate` (project), exit 0. The waybill lists only `gate [default:gate]`.

Other commands run:

| Command | Exit |
|---|---|
| `bash -n scripts/link-skills.sh` | 0 |
| `scripts/skill-refs.sh` | 0 |
| `scripts/link-skills.sh --self-test` (during work; includes the new controls) | 0 |
| Scratch HOME: install, then `scripts/link-skills.sh --check` (complete set) | 0 (`link-skills: every link is in place`) |
| Scratch HOME: remove `~/.claude/skills/postmaster`, then `--check` | 1 (names that path; `run scripts/link-skills.sh to install`) |

## Decisions made for myself

1. **Problem verdicts.** `--check` fails on `link` and `in-the-way` only. `absent`,
   `shared` and `no-folder` pass, as the shared spec's decision 3 says.
2. **Output.** Problem lines reuse `report()` so a missing link is named the same way as in
   a dry run. The install command in the check's closing line is `scripts/link-skills.sh`;
   `SKILL.md` names the `<tool>/` form a session can actually run.
3. **Self-test placement.** The new controls sit after the CLAUDE_CONFIG_DIR case, while the
   hermetic set is still complete, then the postmaster link is restored before the resolver
   controls that need it.
4. **Extra control.** Besides AC4's missing/complete pair, a folder in the way is reported,
   because the check's decision 3 claims that case fails.
5. **"Say which of these you found"** in `SKILL.md` now includes missing skill links, so a
   cold start cannot report only the config.

## What was not done

- `wiki/concepts/skill-links.md` left alone (shared spec decision 5: no wiki claim changes).
- `make_links` / `remove_links` behaviour unchanged: still links only, never copies, nothing
  replaced.
- No new script; `--check` is a mode of `scripts/link-skills.sh` so the existing gate
  self-test covers AC4.

## Verdict on the acceptance criteria

1. **Setup runs `--dry-run`, shows the user, installs on their word.** Met. `AGENTS.md` setup
   says show the dry run and install only on the user's word; the dry-run-then-install block
   is gated that way.
2. **`AGENTS.md` step 1 reports missing links.** Met. Step 1 runs `scripts/link-skills.sh
   --check` beside the config check and treats a failure as part of "not set up".
3. **`SKILL.md` checks the links and names missing ones with the install command.** Met.
   Preconditions run `<tool>/scripts/link-skills.sh --check` and name
   `<tool>/scripts/link-skills.sh`.
4. **Self-test control: missing reported, complete passes.** Met. `link-skills.sh --self-test`
   covers both through the identical `check_links` command; the gate run passed.
