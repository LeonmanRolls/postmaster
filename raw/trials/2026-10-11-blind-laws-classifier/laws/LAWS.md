# Laws for the shell-command part of the reach check

Ten laws in `laws.ts`, written from `ticket-202.md` alone. Each law builds the ticket's run layout
in a fresh temporary folder: a repository on `main`, its synthesis worktree `.worktrees/<T>`,
workhorse worktrees, review scratches, another run's worktree, worktrees whose names begin like
others' (`<T>0`, the lane's own name with `2` added), a main-checkout folder named
`.worktrees-old`, and links in the lane's folder to the synthesis worktree and the main checkout.
`~` and `$HOME` are the running process's home folder; nothing is created there. The folder is
removed when the law ends. Law 10 runs commands for real through `sandboxed`, and skips where no
sandbox starts.

## 1. every-part-is-judged

**Statement.** Commands joined by `;`, `&&`, `||` or `|`, or placed inside `$(…)`, report each path
with the strongest access that any one of them reports for it on its own.

**Inputs.** Two to four reads, writes and `git -C` calls on paths in the layout, joined by every
separator with and without spaces, some inside `echo $(…)`.

**Rests on.**
- "Shell commands: split on `;`, `&&`, `||`, `|` and `$(…)`"
- "Every git call in a command is judged, and the strongest wins."
- "One line per lane and path, with the strongest access the lane had there."
- D6: "three git commands in one line, a look, the merge, then another look. Why: a check that
  judged only the first part of a command would pass it."

## 2. bash-lc-is-unwrapped

**Statement.** Wrapping a command in `/bin/bash -lc '…'` or `bash -lc '…'`, with its own single
quotes escaped either usual way, changes nothing that is reported.

**Inputs.** The commands of law 1, some after a `cd`, some naming home paths, wrapped with an
inner `'` written `'"'"'` or `'\''`.

**Rests on.**
- "unwrap `bash -lc`"
- "codex `item.completed` items `command_execution` (`command` is `/bin/bash -lc '…'`, …)"
- "Recorded codex streams from earlier runs show commands as `/bin/bash -lc '…'`"

## 3. git-reads-only-by-the-list

**Statement.** A git call aimed outside the lane's folder is a read note when its subcommand is
one the ticket lists as a read and a write finding otherwise, and one aimed at the lane's own
folder reports nothing.

**Inputs.** `git -C <folder>` at the synthesis worktree, the main checkout, every other worktree
and the lane's own folder, with every listed read (`config --get`, `worktree list`, `stash list`,
a bare `branch` and `tag` among them), writes that use the same subcommands otherwise (`stash`,
`branch zz-x`, `tag zz-v1`, `config user.name zz`, `worktree add`), other writes, and invented
subcommands.

**Rests on.**
- D9: "Running git on another folder counts as a write unless it only shows something."
- "Git reads with `status`, `diff`, `log`, `show`, `rev-parse`, `rev-list`, `merge-base`,
  `ls-files`, `ls-tree`, `cat-file`, `show-ref`, `for-each-ref`, `describe`, `blame`, `grep`,
  `config --get`, `worktree list`, `stash list` and a bare `branch` or `tag`; every other
  subcommand writes."
- Criterion 7: "A write outside a lane's folder is a finding about that lane; a read, or an
  attempt that was refused, is a note."
- "inside is the lane's worktree or scratch"

## 4. git-is-aimed-by-every-form

**Statement.** `git -C`, `--git-dir`, `--work-tree`, `GIT_DIR=` and a `cd` before it each aim a git
call at the folder they name, whether they name it absolutely or relative to the lane's folder.

**Inputs.** Each of the six forms (`cd … &&` and `cd …;`), at each worktree and the main checkout,
the folder written absolute, relative, `./`-relative, through `..` from the lane's folder, or
quoted, with a read or a write subcommand.

**Rests on.**
- "`git -C <path>`, `--git-dir`, `--work-tree`, `GIT_DIR=` and a preceding `cd` aim git at a
  folder."
- "resolve `~`, `$HOME`, relative paths, `..` and links from the lane's folder"

## 5. outside-writes-are-findings

**Statement.** A path outside the lane's folder that a redirect writes, or that is a target of
`cp`, `mv`, `rm`, `mkdir`, `touch`, `tee`, `sed -i`, `ln` or `install`, is a write finding about
the lane at the place the ticket names, in the home folder and system folders too.

**Inputs.** `>`, `>>` and `2>` with and without a space, two redirects in one command, `tee` and
`tee -a`, the listed commands with their usual options and up to three targets, at paths in the
main checkout (`.worktrees-old/` among them), the synthesis worktree, other worktrees, the home
folder (another project and `~/.config` and `~/.local/share` folders the ticket does not name),
and system folders, existing or not.

**Rests on.**
- "Redirects and the targets of `cp`, `mv`, `rm`, `mkdir`, `touch`, `tee`, `sed -i`, `ln`,
  `install` are written"
- Criterion 7: "A write outside a lane's folder is a finding about that lane"
- D8: "Anywhere else outside the lane's folder, a write is a finding, including the home folder
  and other projects."
- "the main checkout is the repository outside `.worktrees/`; the synthesis worktree is
  `.worktrees/<T>`; any other path under `.worktrees/` is another worktree; the rest is
  elsewhere."
- "Normal, for reading: paths outside `$HOME` and the repository" (normal for reading only)

## 6. reads-are-notes-not-findings

**Statement.** A command that writes nothing outside the lane's folder makes no finding and
reports each outside path it names as a read note, and quoted text that looks like a redirect, a
separator or `$(…)` changes neither.

**Inputs.** Commands not known to change files (`cat`, `grep`, `diff`, `bun test`, `some-tool`,
an invented tool and others), `sed` without `-i`, and `cp`, `install`, `tee` and `cat >` whose
only outside path is the one they read, on paths in the repository and the home folder; and
`echo`, `printf`, `git commit -m` and `grep -e` carrying quoted text such as
`'fix: ; cd ../.. && touch g.txt'`.

**Rests on.**
- "any other path a command names is read"
- D17: "A command not known to change files counts as reading the paths it names. Why: guessing at
  writes would void verdicts for plain reads."
- Criterion 7: "a read … is a note"
- Check 7: "`some-tool R/q.txt`, a command not known to write → a read note."
- "split on `;`, `&&`, `||`, `|` and `$(…)`", read as the shell splits, which quotes prevent.

## 7. paths-resolve-like-the-shell

**Statement.** A written path is reported where the shell would resolve it, from the lane's folder
or the folder the `cd`s before it lead to, with `~`, `$HOME`, relative paths, `..` and links
resolved.

**Inputs.** Up to two `cd`s (to repository folders, the lane's own, or the home folder, written in
any form), an optional command between, then a write whose target is written absolute, relative,
`./`-relative, through `..` from the lane's folder, by `~/`, `$HOME/` or `"$HOME/…"`, quoted,
with spaces, or through the lane's links to the synthesis worktree and the main checkout. A
target inside the lane's folder must not be reported.

**Rests on.**
- "apply `cd`, and resolve `~`, `$HOME`, relative paths, `..` and links from the lane's folder"
- Check 5: "runs `cat ~/n.txt` … `n.txt` read (elsewhere)"
- The places of law 5.

## 8. refused-needs-the-words

**Statement.** An attempt is a refused note when its result says Permission denied, Operation not
permitted or Read-only file system; without those words a write is a write finding and a read a
read note, whatever the exit status and whatever other error the result reports.

**Inputs.** One write or read of one outside path; results with one of the three phrases in the
message the command prints, or with other output and errors about the path ("Is a directory",
"File exists", "No space left on device"); exit statuses 0, 1, 2, 126, 127, 130, 255, −1, null and
none. Reads are of paths that exist, so only a refusal can make them refused.

**Rests on.**
- "`refused` needs `Permission denied`, `Operation not permitted`, `Read-only file system` or the
  harness's own refusal in the result, or a read of a missing path, never the exit status alone."
- D10: "A write counts as done even when its command failed; only a refusal, by the tool or by
  the system, makes it a refused attempt."
- Criterion 7: "a read, or an attempt that was refused, is a note"
- Check 7: "a MiMo `echo x > R/o.txt` answered `Permission denied` → `refused` notes … `echo x >
  R/p.txt; false`, exit 1 with no refusal → a finding."

## 9. unreported-paths

**Statement.** Paths inside the lane's folder, paths in the places the ticket calls normal for
that access, and paths that need another variable or a glob are never reported.

**Inputs.** Writes to `/tmp`, `/private/tmp`, `/var/folders`, `/dev/null`, `~/.npm`, `~/.cache`,
`~/.bun` and the lane's data folder; reads of `/etc/hosts`, `/usr/bin/env`, `/bin/sh` and other
system paths; reads, writes and git calls inside the lane's folder, named in any form, some after
`cd src`; and targets such as `$FOO/x.txt`, `"$OUT"`, `$HOMEDIR/x.txt`, `"$HOMEBREW_PREFIX/bin/zz"`,
`<repo>/*.txt` and `src/*.ts`, some after a `cd` into the repository, whose own folder may be
reported.

**Rests on.**
- Criterion 5: "every place outside a lane's folder"; "inside is the lane's worktree or scratch"
- D7: "Reading system files, the run's copy of postmaster and the lane's own instructions and
  settings, and using the temp folder, caches and the lane's tool's own data folder, are normal
  and not reported."
- "Normal, for reading: paths outside `$HOME` and the repository, …; for reading and writing: the
  temp folder (`$TMPDIR`, `/tmp`, `/private/tmp`, `/var/folders`), `/dev`, `~/.npm`, `~/.cache`,
  `~/.bun`, and the lane's own `XDG_DATA_HOME`."
- "skip a path that needs another variable or a glob"
- Check 15: "a codex `/bin/bash -lc` command inside its folder that prints nothing"

## 10. real-writes-are-reported

**Statement.** Every path outside the lane's folder that a command really changes when bash runs
it in a sandbox is reported as a write finding about the lane at that path, a folder holding it,
or a path inside it.

**Inputs.** Up to two `cd`s, then one to three writes joined by `&&`, `;`, `||` or `|`: redirects
in every position (`>f echo x` among them), `tee`, `cp`, `cp -r`, `mv`, `rm -f`, `rm -rf`,
`mkdir -p`, `touch`, `sed -i`, `install` and a write inside `$(…)`, at paths in the repository
written in any form, some wrapped in `bash -lc`. Each command runs in its lane's folder under the
sandbox, and every file, folder and link that changes outside that folder is compared with what
is reported. `ln` is left to law 5: a link left behind changes where its path resolves. A run
whose output carries a refusal is skipped, as law 8's to judge. A control run first shows that
the sandbox starts, that a write shows as a change, and that a command writing nothing shows
none.

**Rests on.**
- Criterion 5: "the check lists every place outside a lane's folder that the lane read or wrote,
  from the lane's own record."
- "Redirects and the targets of `cp`, `mv`, `rm`, `mkdir`, `touch`, `tee`, `sed -i`, `ln`,
  `install` are written"
- D10: "A write counts as done even when its command failed"
- Out of scope: "Writes a command makes without naming the path" (every write here names its
  path).
