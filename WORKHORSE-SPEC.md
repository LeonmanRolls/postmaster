# Workhorse spec: #98 Trust each fixture copy when `fixture.sh new` makes it

## Summary

Every fixture run stalls at Claude Code's "do you trust this folder" prompt because trust is
per git repository and a copy is its own repo. This change records trust for the exact folder
`fixture.sh new` just made, through a per-harness trust form in `skills/postmaster/harnesses.md`
run by `scripts/launch.sh`, before any session starts in it.

## Technical context

- **Language and version**: Bash with Python in heredocs (the repo's standing shape). Python 3
  for the Claude Code config write (JSON, flock, atomic replace), as `scripts/local.sh` already
  does for its store.
- **Dependencies used or added**: none. stdlib only (`json`, `os`, `fcntl`, `tempfile` or a
  pid-suffixed temp path in the same directory).
- **Testing**:
  - `bash -n scripts/launch.sh scripts/fixture.sh` — parse.
  - `scripts/launch.sh --self-test` — trust-form controls: the made folder gains
    `hasTrustDialogAccepted`, every other key and every other project entry is kept, the file
    stays valid JSON, the write is under `<config>.lock` and replaces atomically; a harness with
    no form is refused or skipped as the form table says.
  - `scripts/fixture.sh --self-test` — a control that `new` records trust for the copy it made
    and leaves a folder it did not make untouched, against a scratch Claude Code config
    (`CLAUDE_CONFIG_DIR` in a temp dir), never `~/.claude.json`.
  - `scripts/skill-refs.sh` — new `scripts/` references in `harnesses.md` go through `<tool>`.
  - `scripts/wiki-lint.sh` — the fixture-runs page still lints.
  - The gate: `/home/brindlewick/.postmaster/tool-pins/e902378fd4a4b39aa41870da2c771b6963525517/scripts/verify.sh run .`
- **Constraints**:
  - Ticket direction: record trust per copy at `fixture.sh new` time through the harness
    adapter; never widen to `~/Code/fixtures` or any parent; a copy is the only folder whose
    contents the tool wrote.
  - AC3: only the folder `fixture.sh new` just made is trusted.
  - AC4: Claude Code's config write takes `<config>.lock`, re-reads, changes only
    `projects["<path>"].hasTrustDialogAccepted`, keeps every other key, and leaves a valid file
    if interrupted (write to a same-directory temp, fsync, `os.replace`).
  - Design rules: nothing harness-specific in the flow (fixture.sh must not name claude/codex);
    deterministic work in scripts; a form the script runs is recorded in `harnesses.md` and they
    change together.
  - Turnpikes: `default` (style, bug and security reviews) plus the project's gate. This is not
    a coachman-contract change, so no fixture run is required before merge beyond the gate
    standing in for #17.

## Direction check

| Constraint | How this plan meets it |
|---|---|
| Record trust per copy, at the moment `fixture.sh new` makes it | `make_and_file` calls `launch.sh trust <dest>` after the repo and ticket are ready and before it prints success; failure unmakes the copy. |
| Through the harness adapter | The form lives in `skills/postmaster/harnesses.md`; `launch.sh trust` is its executable form, as launch/resume/review already are. |
| Do not widen trust to `~/Code/fixtures` or any parent | The form receives only the absolute `$dest` the script just created. No dirname, no fixtures root. The self-test shows an unrelated folder unchanged. |
| A copy is the only folder whose contents the tool itself wrote | Nothing else is passed in. `fixture.sh` already refuses a dest inside another git repo and an existing dest. |
| Nothing harness-specific in the flow | `fixture.sh` calls `launch.sh trust <folder>` once. Which harnesses have forms, and what each form writes, stays in `harnesses.md` / `launch.sh`. |
| Deterministic work in scripts | The lock, re-read, one-entry edit and atomic replace are a Python block in `launch.sh`, not prose. |
| Script and harnesses.md change together | New trust form section in `harnesses.md` and matching `trust` command in `launch.sh`; `launch.sh --self-test` covers the write. |
| Script paths in skills go through `<tool>` | New references will be `<tool>/scripts/launch.sh`, checked by `skill-refs.sh`. |
| No new self-tested script outside the gate list | Trust is a `launch.sh` subcommand; `launch.sh` and `fixture.sh` are already in the gate's self-test list. |

## Structure

Files changed:

1. **`skills/postmaster/harnesses.md`** — a "Trust a folder" section: what the form is, that
   `launch.sh trust <folder>` runs it for each harness that asks, and one subsection per harness
   with a form (claude: the locked JSON edit; codex: the existing
   `[projects."<path>"] trust_level = "trusted"` append already recorded in its launch form). A
   harness that never asks has no subsection and `fixture.sh` records nothing for it.
2. **`scripts/launch.sh`** — `launch.sh trust <folder> <name?>` (see Decisions) plus the
   implementation of each form and self-test controls for the Claude Code write properties.
3. **`scripts/fixture.sh`** — `make_and_file` records trust for `$dest` via `launch.sh trust`;
   header comment no longer says the user answers the prompt once per copy; `--self-test` gains
   the scratch-config control (made copy trusted, other folder untouched).
4. **`wiki/concepts/fixture-runs.md`** — "What changed because of it" says copies are trusted
   when they are made, and why trusting their parent never covered them (trust search stops at
   the git root; a copy is its own repository).
5. **`wiki/log.md`** — one append-only entry for the wiki update (the project's wiki operation
   record).

## Complexity tracking

| Departure | Why needed | Simpler alternative rejected because |
|---|---|---|
| `launch.sh trust` runs every harness form that exists rather than only the postmaster's harness | AC2 says fixture.sh records nothing for a harness that never asks, which reads as iterating harnesses; the user's word is the folder trusted forever, for whichever harness starts there | Trust only `team.postmaster`'s harness from the config: narrower than AC2's wording and leaves the copy untrusted if another harness opens it |

## Decisions

1. **Interface: `launch.sh trust <folder> [<name>]`.** With only a folder, every harness that
   has a trust form runs. With `<name>` (a lane or role, including `postmaster`), only that
   name's harness runs. `fixture.sh` uses the one-argument form so it names no harness and no
   role, matching design rule 2 and the user's "trusted forever". The optional name is for a
   caller that already knows the postmaster's harness and wants one write.
2. **Which harnesses get a form.** Claude Code (asks interactively; bypass does not skip) and
   codex (has `projects."<path>".trust_level`, already written at launch). No form for muse
   (`--yolo` trusts the workspace for the run only), pi (`--approve` is a per-run flag), agy,
   grok or mimo (no recorded folder-trust store). If implementation finds another harness that
   asks, its form is added then; a harness with no form is skipped, never guessed.
3. **Claude Code config path.** `~/.claude.json` when `CLAUDE_CONFIG_DIR` is unset (this
   machine has that file). `$CLAUDE_CONFIG_DIR/.claude.json` when it is set, as the
   herdr-agent-lifecycle trial did and it worked. Lock is `<config>.lock`.
4. **Only `hasTrustDialogAccepted`.** That is what the trust prompt writes and what the ticket
   names. `hasCompletedProjectOnboarding` is a different prompt and is not touched.
5. **Idempotent trust.** An entry already carrying `hasTrustDialogAccepted: true` is left as it
   is; other keys in that entry (and every other entry and top-level key) are preserved.
6. **Failure of trust fails `new`.** The copy is unmade if trust cannot be recorded, like a
   ticket that cannot be filed: a fixture that would stall at a prompt is not a usable fixture.
7. **Self-test isolation.** `CLAUDE_CONFIG_DIR` points at a scratch directory in the test's
   tmp, holding a prepared `.claude.json`. `HOME` is already overridden in the existing
   `fresh_new` helper. The real `~/.claude.json` is never opened for write.
8. **Interrupted write.** Same-directory temp + fsync + `os.replace` (the pattern
   `scripts/local.sh` `write` already uses). A crash leaves either the old or the new file, both
   valid JSON. The lock is released on process exit whatever happens (`fcntl.flock` on a
   close-on-release fd), matching `local.sh`'s `locked()`.
9. **Folder argument.** Absolute path only, and it must exist: the form refuses a relative path
   or a missing folder so it cannot be pointed at a parent or at something `new` did not make.
10. **Wiki log entry.** Included so the wiki's own contract (append-only log) stays true when
    the fixture-runs page is revised.

## Tasks

- [ ] T001 [P] [AC2] Add a "Trust a folder" section to `skills/postmaster/harnesses.md`: the
  contract (`launch.sh trust <folder>` runs each harness's form; a harness that never asks has
  no form), a claude subsection (locked re-read, one-entry JSON edit, atomic replace,
  `projects["<path>"].hasTrustDialogAccepted`, `<config>.lock`), and a codex subsection (the
  existing `[projects."<abs path>"] trust_level = "trusted"` idempotent append). Paths through
  `<tool>`.
- [ ] T002 [AC2] [AC3] [AC4] Implement `launch.sh trust <folder> [<name>]` in
  `scripts/launch.sh`: resolve which harnesses run (all with a form, or the named role/lane's
  harness), refuse a non-absolute or missing folder, run each form. The claude form: flock
  `<config>.lock`, re-read, set only `projects[<folder>].hasTrustDialogAccepted`, keep every
  other key, write via same-directory temp + fsync + `os.replace`. The codex form: the existing
  idempotent config.toml append. Harnesses with no form are skipped.
- [ ] T003 [AC4] [AC5] Self-test controls in `scripts/launch.sh --self-test` on a scratch
  config only: a trust write sets the one entry, keeps other keys and other projects, leaves
  valid JSON, and is idempotent; a non-absolute folder is refused. Never touch the real config.
- [ ] T004 [AC1] [AC3] [AC5] In `scripts/fixture.sh` `make_and_file`, after the ticket is
  filed and before the success lines, call `"$HERE/launch.sh" trust "$dest"`; on failure unmake
  and fail. Pass only `$dest`. Update the header comment (no "the user answers it once per
  copy"). In `--self-test`, a control on a scratch `CLAUDE_CONFIG_DIR` config: the new copy is
  recorded trusted and a folder `fixture.sh` did not make is left untouched.
- [ ] T005 [AC6] Update `wiki/concepts/fixture-runs.md` "What changed because of it": copies
  are trusted when `fixture.sh new` makes them, through the harness adapter; trusting
  `~/Code/fixtures` never covered them because Claude Code's trust search stops at the git
  root of the folder it starts in, and every copy is its own repository. Append one entry to
  `wiki/log.md`. Keep front matter / standing as they are unless the claim itself changes.
- [ ] T006 [AC1] [AC2] [AC4] [AC5] [AC6] Run the gate with
  `/home/brindlewick/.postmaster/tool-pins/e902378fd4a4b39aa41870da2c771b6963525517/scripts/verify.sh run .`
  (bash -n, skill-refs, wiki-lint, and every named script's `--self-test`) and any extra
  commands the summary will list; fix what fails.
