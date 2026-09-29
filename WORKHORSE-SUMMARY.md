# Workhorse summary: 163 The coachman contract is defined in one place, and a script decides when a change touches it

## Commits

- `572b93b` `#163 workhorse spec: the coachman contract in one place` — `WORKHORSE-SPEC.md`, committed alone before any code.
- `6708e82` `#163 define the coachman contract in one place, and detect changes to it` — `skills/postmaster/contract.md`, region markers in the runbooks and scripts, `scripts/contract.sh` with its self-test.
- `c96d504` `#163 the flow uses contract.sh for the fixture condition, not judgment` — waybill field, `postmaster.md` Stage B and Stage F, `AGENTS.md` pointer, gate list, `README.md` script list, `wiki/concepts/fixture-runs.md` pointer.
- `b8102a1` `#163 self-test: ticket prose that names the contract is not a touch` — the control that the script never decides from a ticket's prose.
- (this file) `#163 workhorse summary`

## Checks

`/home/brindlewick/.postmaster/tool-pins/601bfd9cccd1b2980be60a5be183c89cd0e734d1/scripts/verify.sh run .` printed, just before this summary was written:

```
gate: pass, exit 0, 688s: bash -c 'for f in scripts/*.sh; do bash -n "$f" || exit 1; done && scripts/skill-refs.sh && scripts/wiki-lint.sh && for n in cut-scratch export-session fixture front-door front-door-acceptance github host launch link-skills local log-action parallel-runs-acceptance plane project-settings review-decide review-findings review-forms review-round reviewers run-log run-meta run-times runs-status runs-watch setup skill-refs stage style-findings ticket-check tool-faults turnpikes verify verify-examples verify-journey verify-library view-stream wait-for-markers wiki-lint; do scripts/$n.sh --self-test || exit 1; done'
```

One line per check the brief names:

- `gate` [declared:project]: the command above; **pass, exit 0** (688s).

Other commands run, with their exits:

- The project's declared gate with `contract` added (the same command as the brief's, plus `contract` in the self-test list): **exit 0**, `GATE_OK`, every control behaved. Written to `/tmp/163-gate4.log`. Two earlier full-gate runs failed only in `host.sh` timing controls ("a launch is still running"; six controls), the flake the brief names; `host.sh --self-test` alone and the clean full run both passed with zero failures.
- `scripts/contract.sh --self-test`: **exit 0**. Positive controls: renaming a marker names `markers`; adding a waybill section names `waybill`; changing the turnpike table names `turnpikes`; adding a stage names `stages`; changing completion detection names `completion`. Negative controls: a docs-only change is no; ticket prose that names the contract is no; a runbook wording fix outside the contract is no; a new harness entry is no. Merge controls: a merge of main that brought in a contract change is yes and names the part; one that brought in none is no. The real tree marks every part outside the definition.
- `scripts/contract.sh 601bfd9cccd1b2980be60a5be183c89cd0e734d1 HEAD`: **exit 1**, this change is a contract change, naming `completion: scripts/handoff-check.sh:16`, `definition: skills/postmaster/contract.md:1`, `legs: scripts/turnpikes.sh:62`, `markers: scripts/host.sh:33`, `stages: scripts/stage.sh:25`, `turnpikes: scripts/turnpikes.sh:48`, `waybill: skills/postmaster/SKILL.md:253`.
- `scripts/contract.sh <BASE> <BASE>` (empty range): **exit 0**.
- `scripts/skill-refs.sh`: **exit 0**.
- `scripts/wiki-lint.sh`: **exit 0**.
- `bash -n` on every `scripts/*.sh`: **exit 0**.

## Decisions

- **Where the definition lives.** `skills/postmaster/contract.md`, beside the runbooks it governs. `AGENTS.md` points to it instead of restating the contract.
- **How parts are marked.** `<!-- contract:part=NAME -->` … `<!-- /contract:part=NAME -->` region markers in the implementation passages, with a `# ` comment prefix in shell. A file-level rule is too coarse (`coachman.md` holds both contract and prose); line anchors would drift. Prose outside the markers is not the contract.
- **Part list.** `markers`, `waybill`, `turnpikes`, `legs`, `stages`, `completion` — the parts the ticket names. Hand-off sections are part of `completion`, since they are how a leg's end is detected.
- **Script interface.** `contract.sh <base> <head>` exits 0 for no, 1 for yes, 2 for usage or git errors; on yes it prints `part: file:line` per touched part. `--parts` lists the names. For "what a merge of main brought in" the caller passes `<merge>^1` and `<merge>`; no second mode.
- **What counts as a touch.** A change inside a marked region, a region added or removed, or a change to that part's section in `contract.md`. A change to `contract.md` outside any part region is named `definition`. The detector script itself is excluded from the scan: its self-test fixtures carry marker strings, and the detector is not the contract.
- **When the waybill field is filled.** The waybill carries `fixture run: <yes|no>`. At dispatch the postmaster records it from `contract.sh` on the change as of dispatch (`BASE..HEAD` of the synthesis worktree), which is `no` for a fresh cut because the change does not exist yet. The binding decision is Stage F's, on the final branch; the postmaster writes that answer back to the waybill field. The ticket says "at dispatch, the waybill records"; a fresh change is not yet made at dispatch, so the field is the run's recorded standing from the script, rebound at the card where the change exists.
- **Repeat after a merge of main.** `contract.sh <merge>^1 <merge>` names what the merge brought in. Yes repeats the fixture run from the final branch; no lets the clean score stand.
- **Gate list.** The new script's self-test joins `.postmaster/project.toml`'s declared gate (39). The run's recorded check stays the 38 it was dispatched with; this summary lists both.
- **host.sh timing flake.** Two full-gate runs failed only `host.sh` controls that wait on a launch's marker ("a launch is still running"); `host.sh --self-test` alone and the clean full run passed. Per the brief, that is a load flake, not this change's. The change only adds comment markers to `host.sh`'s header.

## What I did not do

- No fixture run. The ticket says this change lands with one; a fixture run is the merge condition the flow will hold it to, not something a workhorse dispatches mid-implementation.
- No changes for #124's two-leg contract, #101's merge authority, or #155's stale gate names. This change defines the contract as it is at BASE and the flow that decides the fixture condition.
- No push. Commits stay on `wb/163-mimo`.

## Verdict against the acceptance criteria

1. **The coachman contract is defined in one place** — **met.** `skills/postmaster/contract.md` names every part (markers and who writes them, the waybill's sections and fields, the turnpike table, the legs and stages, how a leg's end is detected) and where each is implemented (runbook and script). Region markers in those files mark exactly the contract passages.
2. **A script answers whether a change touches the contract** — **met.** `scripts/contract.sh <base> <head>` exits 0 for no and 1 for yes, names each part and the file:line that touched it, and never reads a ticket.
3. **The flow uses its answer instead of judgment** — **met.** The waybill records `fixture run:` at dispatch from the script; Stage F runs the script on the final branch and a yes makes a fixture run from that branch the merge condition; a merge of main into a branch with a clean fixture run repeats only when the script says that merge brought in a contract change.
4. **The script's self-test has controls** — **met.** Positive controls for renaming a marker, adding a waybill section, changing the turnpike table, adding a stage, and changing completion detection each answer yes and name the part. Negative controls for a docs-only change, ticket prose naming the contract, a runbook wording fix outside the contract, and a new harness entry each answer no. Merge-of-main controls cover both kinds of incoming change.
5. **`AGENTS.md` points to the definition** — **met.** It names `skills/postmaster/contract.md` and `scripts/contract.sh` instead of restating the contract.
