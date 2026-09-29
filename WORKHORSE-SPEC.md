# Workhorse spec: 163 The coachman contract is defined in one place, and a script decides when a change touches it

## Summary

The coachman contract (markers, waybill shape, turnpike table, legs and stages, leg completion) is currently one sentence in `AGENTS.md` and the judgment of whoever reads a ticket. This change defines every contract part in one place — `skills/postmaster/contract.md` — with its writers, readers, and implementation sites; marks exactly those passages in the runbooks and scripts; adds `scripts/contract.sh`, which given a base and a head exits 0 for no contract change and 1 for yes, naming each part and the file:line that touched it; and makes the flow use that answer at dispatch, at the card, and after a merge of main, instead of judgment.

## Technical context

- **Language and version**: Bash with Python 3 in a heredoc, the repository's existing style. Python 3.11+ is already required.
- **Dependencies used or added**: none. git and Python 3 only.
- **Testing**: `scripts/contract.sh --self-test` with the positive and negative controls the ticket names; the project's full gate (38 self-tests plus the new one); `scripts/verify.sh run .` at the end.
- **Constraints**: A file-level rule is too coarse (`coachman.md` holds both contract and prose). The definition must mark exactly which parts are contract. The script never decides from a ticket's prose. A fixture run repeats after a merge of main only when that merge brought in a contract change. Nothing harness-specific. Deterministic work in `scripts/`. Every count needs a control.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| What a contract is should be well-defined | `skills/postmaster/contract.md` is the one definition: each part, its substance, who writes/reads it, and where it is implemented (runbook and script). |
| A file-level rule is too coarse; mark exactly which parts are contract | Implementation passages carry `<!-- contract:part=NAME -->` … `<!-- /contract:part=NAME -->` markers (a `#` comment prefix in shell). Prose outside them is not contract, so a wording fix in `coachman.md` stays out and a change to the hand-off rules comes in. |
| The script never decides from a ticket's prose | `contract.sh` reads only git revisions and the marked regions in them. |
| A fixture run repeats after a merge of main only when that merge brought in a contract change | The repeat decision is `contract.sh` on what the merge brought in (`<merge>^1` vs `<merge>`); no means the clean score stands. |
| Deterministic work goes in `scripts/` | The detector is `scripts/contract.sh` with self-test controls, not prose. |
| Every count needs a control | The self-test has both kinds: contract-touching changes answer yes and name the part; non-contract changes answer no. |
| Nothing harness-specific in the flow | The change is runbook prose plus one script; no harness names. |
| Skill paths go through `<tool>` | New runbook references use `<tool>/scripts/contract.sh`. |

## Structure

- `skills/postmaster/contract.md` — the one definition of the coachman contract (new).
- `scripts/contract.sh` — base/head detector and self-test (new).
- Markers inserted in the implementation passages of:
  - `skills/postmaster/coachman.md` (markers, legs, completion)
  - `skills/postmaster/SKILL.md` (waybill template)
  - `scripts/runs-status.sh` (marker names and what the poll reads)
  - `scripts/host.sh` (process-exit marker landing)
  - `scripts/turnpikes.sh` (turnpike table, legs)
  - `scripts/stage.sh` (stages)
  - `scripts/handoff-check.sh` (hand-off sections a leg ends on)
- `skills/postmaster/SKILL.md` — waybill template gains `fixture run: <yes|no>`.
- `skills/postmaster/postmaster.md` — dispatch records the field; the card runs the script on the final branch; a merge of main decides repeat from the merge's incoming side.
- `AGENTS.md` — points to the definition instead of restating the contract.
- `.postmaster/project.toml` — the declared gate runs the new self-test (39).
- `README.md` — the script list gains `contract.sh`.

## Complexity tracking

None.

## Decisions

- **Where the definition lives.** `skills/postmaster/contract.md`, beside the runbooks it governs, not `docs/` or the wiki: a runbook says what an agent must do; this file says what the roles agree on. `AGENTS.md` points to it.
- **How parts are marked.** HTML-comment region markers in the implementation files, with a `#` prefix in shell. A data file of line anchors would drift; region markers travel with the text and leave prose outside the region out of the contract. The definition file lists each part and names the files that carry its markers, so the two stay in step, and a control checks every named part has a region in the real tree.
- **Part list.** `markers`, `waybill`, `turnpikes`, `legs`, `stages`, `completion` — the parts the ticket names (each marker and who writes it, the waybill's sections and fields, the turnpike table, the legs and stages, how a leg's end is detected). Hand-off sections are part of `completion`, since they are how a leg's end is detected.
- **Script interface.** `contract.sh <base> <head>`: exit 0 for no, 1 for yes, 2 for usage or git errors. On yes, one line per touched part: `part: file:line`. Also `--parts` (list names) and `--self-test`. For "what a merge of main brought in", the caller runs it on `<merge>^1` and `<merge>`, so no second mode is needed; the runbook names that range.
- **What counts as a touch.** A change inside a marked region of any file for that part, a region added or removed, or a change to that part's section in `contract.md`. A change to `contract.md`'s structure that adds a part touches that part.
- **When the waybill field is filled.** The waybill carries `fixture run: <yes|no>`. At dispatch the postmaster records it from `contract.sh` on the change as of dispatch (`BASE..HEAD` of the synthesis worktree), which is `no` for a fresh cut. The binding decision is the card's: `contract.sh` on the final branch; a yes makes a fixture run from that branch the merge condition, and the postmaster writes that answer to the waybill's field so the run's record carries it. The ticket says "at dispatch, the waybill records"; a fresh change does not exist at dispatch, so the field is the run's recorded standing from the script, rebound at the card where the change exists.
- **Repeat after a merge of main.** `contract.sh <merge>^1 <merge>` names what the merge brought in. Yes repeats the fixture run from the final branch; no lets the clean score stand.
- **Gate list.** The new script has a self-test and joins the declared gate's list, so the next dispatch's gate runs it. The run's recorded check stays the 38 it was dispatched with; this workhorse also runs the new self-test and lists it under Checks.
- **Out of scope.** #124's two-leg contract and its landing script, #101's merge authority, #155's gate list stale entries. This change defines the contract as it is at BASE and the flow that decides the fixture condition.

## Tasks

- [ ] T001 [P] [AC1] Write `skills/postmaster/contract.md`: every part (markers, waybill, turnpikes, legs, stages, completion), who writes and reads each, and where each is implemented (runbook and script).
- [ ] T002 [P] [AC1] Insert `<!-- contract:part=… -->` region markers in the implementation passages of `skills/postmaster/coachman.md`, `skills/postmaster/SKILL.md`, `scripts/runs-status.sh`, `scripts/host.sh`, `scripts/turnpikes.sh`, `scripts/stage.sh`, and `scripts/handoff-check.sh`.
- [ ] T003 [P] [AC2] Implement `scripts/contract.sh <base> <head>`: exit 0/1, on yes name each part and the file:line that touched it; never read ticket prose.
- [ ] T004 [AC4] Self-test in `scripts/contract.sh --self-test`: positive controls for renaming a marker, adding a waybill section, changing the turnpike table, adding a stage, and changing completion detection (each yes and names the part); negative controls for a docs-only change, a runbook wording fix outside the contract, and a new harness entry (each no); merge-of-main controls (contract change yes, none no).
- [ ] T005 [AC3] Waybill template and `postmaster.md`: `fixture run: <yes|no>` at dispatch; the card runs the script on the final branch and a yes is the merge condition; a merge of main into a branch with a clean fixture run repeats only when the script says the merge brought in a contract change.
- [ ] T006 [AC5] `AGENTS.md` points to `skills/postmaster/contract.md` instead of restating the contract.
- [ ] T007 [AC2] Keep `skill-refs.sh` clean: every script path in the new runbook goes through `<tool>`; add the new self-test to the declared gate; run the full gate and `verify.sh run .`; write `WORKHORSE-SUMMARY.md`.
