# Workhorse spec: #98 A fixture run's postmaster runs headless, so it never stops at a trust prompt

_One spec, rewritten with the user on 2026-09-30 for the rewritten ticket; both workhorses
implement from it._

## Summary

When the front door would spawn a postmaster for a fixture copy, it starts it headless instead,
on every host, in the headless form `skills/postmaster/hosts.md` already gives, so it never meets
Claude Code's trust question. `fixture.sh new` marks the copy, the front door reads the mark and
says `headless`, and `SKILL.md` launches it that way. Nothing writes any harness's trust
settings. Both scripts are #109's TypeScript port, copied unchanged from commit b8e5e6485f77 and
then changed.

## Technical context

- **Language and version**: TypeScript run by Bun, 1.4.2 or newer, for both scripts this ticket
  changes, by the user's word (2026-09-30). `fixture.sh` and `front-door.sh` become the port's
  two-line wrappers, and the bash they held leaves this branch. No Python is added.
- **Base**: the branch holds main at 653ba2e or later before the copy. The port's `fixture.ts`
  predates #159's change to `fixture.sh`, which is ported too (Decisions). A workhorse whose
  branch does not hold 653ba2e stops and writes `WORKHORSE-BLOCKED.md`.
- **Dependencies used or added**: none. At run time, only Bun's built-ins and Node's standard
  modules. Main's `package.json` and `bun.lock` stay as they are.
- **Testing**:
  - After the copy commit and before any change, `scripts/fixture.sh --self-test` and
    `scripts/front-door.sh --self-test` pass as copied. On a scratch copy of main at 653ba2e
    they passed 63 and 45 controls.
  - `bun --no-env-file test scripts/fixture.test.ts` (AC1, AC4), each control a pair through
    the same call:
    - `new` marks the copy, the mark reads back as the fixture ticket, and the copy is still one
      commit with a clean tree; a repository `new` did not make carries no mark;
    - `new` leaves a scratch home's harness configs as they were (`.claude.json` and
      `.codex/config.toml` among them, present before or absent), and a control that writes one
      is caught by the same comparison.
  - `bun --no-env-file test scripts/front-door.test.ts` (AC2, AC5):
    - a spawn into a fixture copy says `headless` with host Herdr, tmux and none alike; the same
      copy with its mark removed gives exactly the decision it gave before this change;
    - a `self` decision in a fixture copy stays `self`, and a target that is not a fixture copy
      gives exactly the output it gave before.
  - The copied self-tests still pass, #159's lane-scoring control runs, and each copied
    self-test runs its new test file as one control, so a gate that runs only the self-tests
    covers them.
  - `scripts/skill-refs.sh` and `scripts/wiki-lint.sh`.
  - `bun run lint`, main's Oxlint, exits 0. Its warnings on the copied code are left as copied.
  - `bun x -p typescript@7.0.2 tsc --noEmit -p tsconfig.json`, where TypeScript can be
    fetched: no error in a file this ticket copies or writes.
  - The run's gate, via `verify.sh run .` as the brief gives it.
  - AC7 is a fixture run dispatched from this branch, which the postmaster runs after the card;
    no workhorse command shows it.
- **Constraints**: the port's files are copied unchanged and committed on their own before the
  change. The decision is the front door's script, and the runbooks only follow it. The mark
  leaves the copy's tree clean. Nothing writes a harness's trust settings (AC4). New code is a
  pure core with side effects at the edges.

## Direction check

- Reuse the headless postmaster form: `SKILL.md` step 8 already launches it where there is no
  host, through `host.sh run`; a fixture copy takes the same path on every host.
- The decision stays in the front door's script: `front-door.ts` reads the mark and decides;
  `SKILL.md` follows what it prints.
- The mark leaves the tree clean: it is kept in the copy's own git config, not in a file.
- No trust writes: a headless start never asks, so nothing needs trusting.
- Every script this ticket changes is TypeScript on Bun, copied from #109's port first so #109's
  later merge of main meets the same files; new tests sit beside their targets as
  `<name>.test.ts`.
- Every count has a control: each test above is a positive and a negative control.
- Script paths in `skills/postmaster/` go through `<tool>`.

## Structure

- Copied unchanged from b8e5e6485f77, in a commit of their own:
  - `scripts/fixture.ts` and its wrapper `scripts/fixture.sh`;
  - `scripts/front-door.ts` and its wrapper `scripts/front-door.sh`;
  - `scripts/lib/data.ts`, `scripts/lib/paths.ts`, `scripts/lib/proc.ts`,
    `scripts/lib/selftest.ts` and `scripts/lib/text.ts`, which those two import;
  - `bunfig.toml`, which the wrappers name; `tsconfig.json` and `types/bun.d.ts`, for the
    types; `biome.json`, for the formatting.
- Then changed: `scripts/fixture.ts`, for the mark, its header, #159's change and a self-test
  control; `scripts/front-door.ts`, for the `headless` decision, its header and a self-test
  control.
- New: `scripts/fixture.test.ts` and `scripts/front-door.test.ts`.
- `skills/postmaster/SKILL.md`: steps 3, 4, 6 and 8, for the `headless` decision.
- `skills/postmaster/hosts.md`: its section for no host says a fixture copy's postmaster uses
  that headless form on every host.
- `skills/postmaster/harnesses.md`: the note on claude's trust question says a fixture copy's
  postmaster runs headless, so it never meets it.
- `wiki/concepts/fixture-runs.md`, and one entry appended to `wiki/log.md`.

## Decisions

- **Copy the port first, unchanged.** Each file under Structure comes from
  `git show b8e5e6485f77:<path>`, the two wrappers executable as they are there, and is
  committed on its own before any change. Reading those files from that commit is allowed. Not
  copied: `package.json` and `bun.lock`, since main's own carry its Oxlint setup and #109 merges
  its own when it lands; `scripts/text.sh` and `scripts/fixtures/text-goldens.json`, which only
  `lib/text.ts`'s own self-test uses; and every script this ticket neither changes nor needs,
  `launch.sh` and `host.sh` among them. The copied `scripts/lib/` modules are not changed.
  Tests a copied file carries inside it stay there. `WORKHORSE-SUMMARY.md` names the copy
  commit and the files copied.
- **Main's later change is ported too.** The port merged main at 980090c. Since then main
  changed `fixture.sh` once, for #159 ("A fixture run scores each lane's own branch against the
  hidden tests"): `score`'s hidden-tests line adds each lane's counts from
  `scripts/fixture-lanes.ts`, the header says so, and the self-test runs
  `fixture-lanes.test.ts`. The wrapper replaces that bash, so the change is made in
  `fixture.ts`, printing what main's `fixture.sh` prints. A later change main makes to
  `fixture.sh` or `front-door.sh` before this branch takes it is ported the same way.
- **The mark.** `makeAndFile` sets `postmaster.fixture` in the copy's own git config, to the
  fixture ticket's name, after the ticket is filed and before the success lines. It lives in
  the repository's config, so the tree stays one commit and clean, and a worktree of the copy
  reads it too. If it cannot be set, the copy is unmade and `new` fails, like a ticket that
  cannot be filed.
- **The decision.** When the decision is `spawn` and the target carries the mark, the front door
  also prints a `headless` line with its reason: the target is a fixture copy made by
  `fixture.sh new`. It does so whatever the session host, since it never reads the host. `self`
  stays `self`: that session is already at a terminal in the copy. Every other line and every
  exit code is as it was, so a target without the mark gives exactly the output it gave before.
  The mark is read with git under the guard the script already has against a caller's
  `GIT_DIR`.
- **The runbooks follow the decision.** `SKILL.md` step 3 says what `headless` means. Step 4's
  launch card shows it. Step 6 writes the brief line a headless postmaster gets. Step 8 starts
  it in the headless form `hosts.md` gives under none, through `host.sh run` so it shows in the
  host like any headless launch, whatever `host.sh detect` says, and never through
  `host.sh spawn`. As that section says, a headless postmaster needs a harness with a resume
  form, so the user can answer an escalation by resuming it.
- **No trust writes.** Nothing in this change writes `.claude.json`, a codex config or any other
  harness setting, and no folder is trusted by the tool.
- **Functional style.** The decision is a pure function of the session's report, the config and
  whether the target carries the mark; the edges run git, read files and print. A parsed value
  is never mutated; a new one is built. The copied `scripts/lib/` helpers are used where they
  fit.
- **House style: the copied files'.** `node:` imports, `.ts` extensions on local imports, the
  CLI behind `import.meta.main`, strict types under the copied `tsconfig.json`, and the copied
  `biome.json`'s formatting. The headers name the mark and the `headless` line.
- **Tests beside their targets.** New tests go in `scripts/fixture.test.ts` and
  `scripts/front-door.test.ts`, using `bun:test`, on scratch repositories and a scratch home
  only, naming each control as the self-tests do. A test that changes an environment variable
  restores it. #109 is moving the copied files' own tests into files of the same names; its
  merge combines the two.
- **The run's gate runs the new tests.** Each copied self-test runs its new test file with
  `bun --no-env-file test` as one control, as main's `fixture.sh` does for
  `fixture-lanes.test.ts`. Main's gate runs them again through `bun test ./scripts`.

## Tasks

- [ ] T001 [AC1] [AC2] Copy the files under Structure unchanged from b8e5e6485f77, the two
  wrappers executable, and commit them on their own. Check that `scripts/fixture.sh --self-test`
  and `scripts/front-door.sh --self-test` pass as copied. Name the commit and the files in
  `WORKHORSE-SUMMARY.md`.
- [ ] T002 [AC1] Port main's change to `fixture.sh` since 980090c into `scripts/fixture.ts`:
  #159's lane counts on the hidden-tests line, its header lines, and its self-test control that
  runs `fixture-lanes.test.ts`, printing what main's `fixture.sh` prints.
- [ ] T003 [AC1] [AC4] In `scripts/fixture.ts`, set the mark in `makeAndFile` and name it in the
  header. Write `scripts/fixture.test.ts` with the pairs under Testing, and add the self-test
  control that runs it.
- [ ] T004 [AC2] [AC5] In `scripts/front-door.ts`, add the `headless` decision and name it in the
  header. Write `scripts/front-door.test.ts` with the pairs under Testing, and add the self-test
  control that runs it.
- [ ] T005 [AC3] Update `skills/postmaster/SKILL.md` steps 3, 4, 6 and 8, the section for no
  host in `skills/postmaster/hosts.md`, and the note on claude's trust question in
  `skills/postmaster/harnesses.md`. Paths through `<tool>`.
- [ ] T006 [P] [AC6] Update `wiki/concepts/fixture-runs.md`: a fixture run's postmaster runs
  headless, and trusting the fixtures folder never spared a copy the prompt, because the trust
  search stops at the git root and every copy is its own repository. Append one entry to
  `wiki/log.md`.
- [ ] T007 [AC1] [AC2] [AC3] [AC4] [AC5] [AC6] Run the checks under Testing and the run's gate
  via `verify.sh run .`; fix what fails.
- [ ] T008 [AC7] Say in `WORKHORSE-SUMMARY.md` that AC7 is shown by a fixture run the postmaster
  dispatches from this branch after the card.
