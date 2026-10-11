# Bug findings, round 1, lane mimo (hand-read)

Raw report: the final text part of
`/home/user/postmaster/.postmaster/runs/202/logs/review-r1-bug-mimo.jsonl`
(`normalize` cannot parse mimo's review output; read by hand per the runbook).
The lane verified each numbered bug by execution with a targeted probe against
`reach.ts`; `reach.test.ts` passes 27/27 beside them.

## bug-mimo-1: Multi-line shell commands are not split; writes become reads

- target: scripts/reach.ts (splitShell / shellWords)
- location: splitShell treats newline as ordinary whitespace; only `;`, `|`,
  `&&` start a new command
- severity: not provided (lane's highest priority with bug-mimo-2)
- summary: A write after a newline is classified with the first command's name,
  so `rm`/`tee`/`>` never run the write path; records note/read exit 3 where
  `;`/`&&` form records finding/write exit 2.
- evidence: probe `echo hi\nrm /home/user/target.txt` records `note read`
  (exit 3); same with `;`/`&&` records `finding write` (exit 2). Verified by
  execution.

## bug-mimo-2: Bare `cd` and `cd $HOME` are ignored; relative writes land in the wrong tree

- target: scripts/reach.ts:727
- location: commandTouches updates cwd only when the cd target is set, does not
  start with `-`, and does not contain `$`
- severity: not provided (lane's highest priority with bug-mimo-1)
- summary: Bare `cd` goes to $HOME in a shell but the parser leaves cwd at the
  worktree; `expandPath` already understands `$HOME` but the `includes("$")`
  guard discards it. False clean for a write under the lane's home.
- evidence: probes `cd && echo x > leaked.txt` and `cd $HOME && echo x >
  leaked3.txt` record `expected write` exit 0; `cd ~ && ...` correctly records
  finding exit 2. Verified by execution.

## bug-mimo-3: `git branch <name>` and `git tag <name>` are treated as reads

- target: scripts/reach.ts (gitRead, branch/tag bare check)
- location: `words.length <= subIndex + 1` matches a single name argument as
  well as bare listing
- severity: not provided (lane's next tier with bug-mimo-4)
- summary: Creating a branch/tag is a ref write the control tries to catch via
  checkout -b / update-ref; this path misses it. Any single non-flag argument
  should count as a write.
- evidence: probes `git branch sneaky` and `git tag v9` record clean exit 0;
  `git checkout -b sneaky2` and `git branch -d wb/T-codex` record findings.
  Verified by execution.

## bug-mimo-4: Refusal matching rewrites `expected` touches to notes

- target: scripts/reach.ts:886 (shell-group refusal rewrite)
- location: when combined output matches REFUSAL and exit != 0, every non-write
  stream touch is forced to refused/note, including kind expected inside the
  lane's folder
- severity: not provided (lane's next tier with bug-mimo-3)
- summary: A clean lane can be pushed off exit 0 by file contents or a failing
  command whose output happens to contain refusal words. The rewrite should
  skip expected touches and should not use the whole multi-command output for
  earlier groups.
- evidence: probe `cat in.txt` (own worktree) with output `permission denied`
  exit 1 becomes `note refused (inside)`, stream exit 3. Verified by execution.

## bug-mimo-5: Command-substitution writes are invisible

- target: scripts/reach.ts (splitShell $(...) handling)
- location: `rm -rf $(echo /path)` splits to `rm -rf` (no path tokens) plus
  `echo /path` (read); the delete is never recorded as a write
- severity: not provided (lane rates lower but real)
- summary: `;`/`&&` form is caught; substitution form is a known static limit
  only if the ticket accepts it, and as written the reader claims to split
  substitutions and treat writes as findings.
- evidence: probe described above. Verified by execution.

## bug-mimo-6 (note): One synthesis-worktree touch claims every unexplained file change

- target: scripts/reach.ts (roundChanges)
- location: `touch.path === ticketWorktree` lets a single write touch own every
  unexplained file change under the synthesis worktree
- severity: not provided (smaller note)
- summary: One reviewer touch can own unrelated dirt and stop
  unassignedTracked from voiding the round.
- evidence: by reading.

## bug-mimo-7 (note): runOwnedWrite vs branch-delete finding disagree

- target: scripts/reach.ts (runOwnedWrite)
- location: `git branch -d wb/T-codex` is a finding on the run-owned ref, but
  runOwnedWrite calls that run-owned
- severity: not provided (smaller note)
- summary: Inconsistent with the escalate rule ("outside this run's
  branches") — either class is defensible, not both.
- evidence: by reading.

## bug-mimo-8 (note): `|&` is not a separator

- target: scripts/reach.ts (splitShell)
- location: splitShell does not treat `|&` as a separator
- severity: not provided (smaller note)
- summary: Worth one line in the reader notes if newlines are fixed.
- evidence: by reading.
