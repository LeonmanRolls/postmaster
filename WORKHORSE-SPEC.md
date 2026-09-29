# Workhorse spec: 165 Close finished tabs and every run worktree's space

## Summary

A finished launch's tab stays open, so a run's space accumulates history (36 tabs with one
live in #38) and the user's workspace list fills with finished work; teardown closes only the
synthesis worktree's space. This workhorse makes `host.sh` close a finished launch's tab by
the placement it recorded (never by a label), refuse a launch that names no run space rather
than open one, and gives teardown one form that closes the space of every worktree the run
created — including clone scratches that `git worktree list` does not show.

## Technical context

- **Language and version**: bash with Python in heredocs, as every script in `scripts/`.
  Python 3.11+ and jq are the project's stated runtime.
- **Dependencies used or added**: none. Herdr and tmux are already the two hosts behind
  `scripts/host.sh`; the self-test keeps using the stub `herdr`/`tmux` it builds on PATH.
- **Testing**: `scripts/host.sh --self-test` (stub hosts only) carries the controls;
  `/home/brindlewick/.postmaster/tool-pins/997f1901ea6ec0cf4342b4db3ea9132dd5522401/scripts/verify.sh
  run .` runs the run's gate just before the summary. The four AC5 controls are run through
  the identical tab count on the Herdr stub and the tmux stub.
- **Constraints**: the direction sentence — close finished tabs by what `host.sh` recorded of
  its own launches, never by matching labels or text. AC2 keeps #105's rule: a pane or tab
  `host.sh` did not open is never closed. Design rules: deterministic work in `scripts/`, a
  prompt lives in argv, every count needs a control.

## Direction check

| Direction / rule | How this plan meets it |
|---|---|
| Close finished tabs by what host.sh recorded of its own launches | Every placement `host.sh` opens is written to `POSTMASTER_HOST_STATE/placements` with its ids, cwd, name and run; the close paths read those records and close by id. The finish close looks up the launch's own record (handed to the runner in its spec) and never scans labels. |
| Never close by matching labels or text | Window names and tab labels are never matched to find something to close. `@postmaster_cwd` stays only as a fallback for a single-pane tmux window `host.sh` opened and no longer has a record for; a window whose panes it cannot vouch for is left alone. |
| AC2: a pane or tab host.sh did not open is never closed | The finish close and `close`/`close-run` close only ids named in `host.sh`'s own placement records, and only when the ownership checks pass (Herdr `postmaster=launch` tokens; tmux recorded pane ids). A user-split pane survives, so its tab survives with it. |
| Nothing harness-specific in the flow | One placement record shape and one close routine for both hosts; the host difference sits inside `host.sh`, which `hosts.md` already names as the adapter. |
| Deterministic work in scripts | The run's worktree enumeration for teardown is `host.sh close-run`, not prose. |
| Every count needs a control | The AC5 pair "a resumed leg leaves one tab" / "a finished review round leaves no reviewer tabs" reads 1 and 0 through one count; teardown and the split pane carry their own controls; the refusal carries one too. |

## Structure

- `scripts/host.sh` — placement records for both hosts; the finish close; `--under`
  enforcement; `close-run <dispatch>`; self-test and live-test updates.
- `skills/postmaster/hosts.md` — the new forms and the rules, in the same voice as today.
- `skills/postmaster/postmaster.md` — Stage G step 2 and the abandon paragraph call
  `close-run` instead of closing the synthesis worktree alone.

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| AC4 read as binding for run-role launches and for anything outside a repository's own main checkout | `host.sh run` with no `--under` is also the documented form of the project-level watcher and the headless postmaster, which have no dispatch to name. | Refusing every `--under`-less run would break `harnesses.md`'s watcher form and `hosts.md`'s headless postmaster form, which this ticket does not ask to change. |
| No resume-reuse of a finished leg's tab | AC1 offers "closes" or "a resume reuses it" as alternatives, and the direction sentence names closing. Closing already leaves a resumed leg with exactly one tab while it runs. | Reuse would keep a finished leg's tab as history whenever no resume comes, which contradicts "a run's space shows its live launches, not its history". |
| No fixture run | The fixture rule covers a change to the coachman contract; `skills/postmaster/coachman.md` is unchanged here. The run's declared check is the gate. | A fixture run dispatches a live multi-model fleet run, which is not a workhorse's lane; flagged in the summary for the coachman to rule on if `hosts.md` counts as the coachman contract. |

## Decisions

1. **AC1's "or"**: the closing clause is implemented. The finish close runs when the launch
   process is gone (the marker, where one is set, is the external signal; a launch without a
   marker also closes). A resumed leg therefore shows one tab while it runs, none once it
   ends.
2. **A split tab at finish**: only `host.sh`'s own pane closes; the user's pane and with it
   the tab survive. Closing the whole tab would close a pane `host.sh` did not open.
3. **The run space dies with its last tab.** Herdr destroys a childless space with its final
   tab (probed 2026-09-29, already modelled in the stub). No spare keeper tab is added: #105
   removed the run space's shell tab on purpose. The next launch of the run reopens the
   space, so between legs the space appears and vanishes with its live launches — which is
   what "shows its live launches, not its history" asks for and what the Moshi list should
   show.
4. **`--under` enforcement** (AC4): `--role lane|coachman|reviewer` must pass `--under`; any
   launch without `--under` must be in a repository's own main checkout that is not a scratch
   clone (the watcher, the headless postmaster). Anything else refuses and opens nothing,
   instead of the legacy placement that gave each lane and each clone a space of its own.
5. **`host.sh close-run <dispatch>`** enumerates the run's worktrees from the waybill's
   synthesis worktree, the `<repo>/.worktrees/<prefix>*` directory listing (which sees clones
   `git worktree list` does not) and the cwds in the placements recorded for the run; it then
   closes each one's recorded tabs and space. It refuses while any of those worktrees still
   has a registered launch.
6. **tmux placements are recorded too**, so a finished window is closed by its recorded
   window/pane ids. `close` keeps `@postmaster_cwd` only as a fallback for a window `host.sh`
   opened, has no record for, and holds a single pane; a split window's `host.sh` pane is
   closed by its record alone.
7. **Test control measurement**: "a resumed leg leaves one tab" is read while the resumed leg
   runs — the moment a leg is live and should show exactly one tab, never two. Its negative
   twin reads 0 after a finished review round, through the identical count.

## Tasks

- [ ] T001 [P] [AC4] Refuse a launch that names no run space: in `scripts/host.sh` `run_cmd`,
  require `--under` for `--role lane|coachman|reviewer`, and require a repository's own
  non-scratch main checkout for any launch without `--under`; refuse before any placement.
- [ ] T002 [P] [AC2] Record every placement `scripts/host.sh` opens (Herdr space/tab/pane and
  tmux session/window/pane) with cwd, name and run under `POSTMASTER_HOST_STATE/placements`,
  and drive every close from those records.
- [ ] T003 [AC1] Close a finished launch's tab or window once nothing else runs in it, from
  the runner in `scripts/host.sh`: `herdr tab close` when every pane of the tab is one
  `host.sh` opened, else only its own pane; `tmux kill-window` when the window holds only its
  own pane, else `kill-pane` that pane.
- [ ] T004 [P] [AC3] Add `close-run <dispatch>` to `scripts/host.sh`, closing the recorded
  tabs and the space of every worktree the run created — the synthesis worktree, each lane's,
  each review scratch including clones `git worktree list` does not show.
- [ ] T005 [AC1] [AC5] Self-test controls in `scripts/host.sh`: "a resumed leg leaves one
  tab" and "a finished review round leaves no reviewer tabs", through one tab count, under
  the Herdr stub and the tmux stub.
- [ ] T006 [AC2] [AC5] Self-test control in `scripts/host.sh`: "a pane the user split into a
  run's tab survives" under the Herdr stub and the tmux stub.
- [ ] T007 [AC3] [AC5] Self-test control in `scripts/host.sh`: "teardown leaves no space for
  any of the run's worktrees" under the Herdr stub and the tmux stub.
- [ ] T008 [AC4] Self-test control in `scripts/host.sh`: a launch that names no run space
  refuses and opens no space or window, under the Herdr stub and the tmux stub.
- [ ] T009 [AC1] [AC2] Rework the existing self-test and live-test controls in
  `scripts/host.sh` that assume a finished launch's tab stays open, and the `--under`-less
  run forms, for the new behaviour.
- [ ] T010 [AC1] [AC3] [AC4] Document the forms and rules in `skills/postmaster/hosts.md`, and
  point Stage G step 2 and the abandon paragraph in `skills/postmaster/postmaster.md` at
  `close-run`.
- [ ] T011 [AC1] [AC2] [AC3] [AC4] [AC5] Run the gate and
  `/home/brindlewick/.postmaster/tool-pins/997f1901ea6ec0cf4342b4db3ea9132dd5522401/scripts/verify.sh
  run .`, then write `WORKHORSE-SUMMARY.md`.
