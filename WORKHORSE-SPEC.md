# Workhorse spec: 158 measure synthesis lane contributions

## Summary

Measure how synthesis text is distributed across the two lane diffs and the coachman's own contribution, separated into code and documentation, then show and persist those measurements alongside the coachman's `took=` report.

## Technical context

- **Language and version**: Bash scripts with Python in heredocs, matching the repository's existing script conventions.
- **Dependencies used or added**: Git and Python 3; no new dependencies.
- **Testing**: Run `scripts/synthesis-shares.sh --self-test` for the four exact-result attribution controls; `scripts/log-action.sh --self-test` for structured persistence; and `/home/brindlewick/.postmaster/tool-pins/73fca4e4a513d8915bf067723d54871b4b8ba728/scripts/verify.sh run .` for the project gate.
- **Constraints**: Work from the synthesis-end Git diffs; match runs of words; exclude oracle and spec files; keep the coachman's `took=` explanation; measurements inform ranking without deciding it.

## Direction check

Use word-run matching against Git diffs to classify synthesis text as present only in lane one, only in lane two, in both, or in neither. Report code and documentation separately, with oracle and spec files excluded. Keep the existing self-reported `took=` field and put the measured shares beside it in the checkpoint and a machine-readable run record. The measurement is evidence for the ranking, not an automatic ranking rule. Persist synthesis-time results through the append-only action log; `run.json` is written once at dispatch and is not the place for this measurement. Use the repository's Bash/Python script style and test through the script's self-test and project gate.

## Structure

- `scripts/synthesis-shares.sh`: measure word-run shares from the synthesis and lane Git diffs; provide the exact-result self-test controls.
- `scripts/log-action.sh`: accept a dedicated `synthesis-shares` action and persist its measurement object in the run and project audit logs.
- `skills/postmaster/coachman.md`: invoke `<tool>/scripts/synthesis-shares.sh` at synthesis completion, preserve its structured result through the action log, and show it beside the `SYNTHESIS` line on checkpoint 1.
- `WORKHORSE-SPEC.md`: this approved-plan candidate.

## Decisions

- Use the four categories lane one only, lane two only, both lanes, and coachman only, with code and documentation measured independently.
- Measure eligible added words in the final `BASE..HEAD` synthesis diff against each lane's added-word diff from the same `BASE`. Normalize words by case and punctuation; a word covered by an exact contiguous match of at least four words in a lane diff is attributed to that lane. Presence in both is shared, and presence in neither is coachman-only.
- Classify files under `docs/` and files ending in `.md`, `.mdx`, `.rst`, `.txt`, or `.adoc` as documentation, and other eligible text files as code. Exclude oracle paths/files and spec files, including `WORKHORSE-SPEC.md`, from either class.
- Report each category as a share of eligible synthesis words in its file class, and persist exact counts, shares, and the denominator in a structured measurement object on the `synthesis-shares` action so the shares can be audited from the stored record.
- Keep the existing `synthesize` action carrying the coachman's `SYNTHESIS` line; add a dedicated measurement action to the append-only audit log, and leave immutable `run.json` unchanged.
- The ticket omits its title, so this spec uses the concise title “measure synthesis lane contributions.”

## Tasks

- [ ] T001 [P] [AC1] Implement `scripts/synthesis-shares.sh` to classify word runs in the synthesis diff against both lane diffs, separately for code and documentation, excluding oracle and spec files.
- [ ] T002 [AC3] Add exact-result self-test controls to `scripts/synthesis-shares.sh` for lane-one-only, split-across-both, identical-in-both, and coachman-only synthesis text.
- [ ] T003 [AC2] Update `scripts/log-action.sh` and `skills/postmaster/coachman.md` so checkpoint cards show measured shares beside `SYNTHESIS` and a structured `synthesis-shares` action preserves the counts and shares for audit.
- [ ] T004 [AC4] Preserve the coachman's `took=` reasons beside the measurement in `skills/postmaster/coachman.md`, without using the measurement to decide lane ranking.
