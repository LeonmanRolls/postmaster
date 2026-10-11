# The writer's report

Its final reply, word for word, with its folder written as `<writer>`.

---

I've written ten laws in `laws.ts` and `LAWS.md` (name, statement, inputs, and the ticket's words for each). All ten load and their generators run against the stand-in (about 3 seconds). Laws 1, 2 and 9 pass against it trivially and the other seven fail, which says nothing about real code. The laws haven't been run against any real implementation; they are ready to lock.

**The laws**

1. **every-part-is-judged**: Commands joined by `;`, `&&`, `||` or `|`, or placed inside `$(…)`, report each path with the strongest access that any one of them reports for it on its own.
2. **bash-lc-is-unwrapped**: Wrapping a command in `/bin/bash -lc '…'` or `bash -lc '…'`, with its own single quotes escaped either usual way, changes nothing that is reported.
3. **git-reads-only-by-the-list**: A git call aimed outside the lane's folder is a read note when its subcommand is one the ticket lists as a read and a write finding otherwise, and one aimed at the lane's own folder reports nothing.
4. **git-is-aimed-by-every-form**: `git -C`, `--git-dir`, `--work-tree`, `GIT_DIR=` and a `cd` before it each aim a git call at the folder they name, whether they name it absolutely or relative to the lane's folder.
5. **outside-writes-are-findings**: A path outside the lane's folder that a redirect writes, or that is a target of cp, mv, rm, mkdir, touch, tee, sed -i, ln or install, is a write finding about the lane at the place the ticket names, in the home folder and system folders too.
6. **reads-are-notes-not-findings**: A command that writes nothing outside the lane's folder makes no finding and reports each outside path it names as a read note, and quoted text that looks like a redirect, a separator or `$(…)` changes neither.
7. **paths-resolve-like-the-shell**: A written path is reported where the shell would resolve it, from the lane's folder or the folder the `cd`s before it lead to, with `~`, `$HOME`, relative paths, `..` and links resolved.
8. **refused-needs-the-words**: An attempt is a refused note when its result says Permission denied, Operation not permitted or Read-only file system; without those words a write is a write finding and a read a read note, whatever the exit status and whatever other error the result reports.
9. **unreported-paths**: Paths inside the lane's folder, paths in the places the ticket calls normal for that access, and paths that need another variable or a glob are never reported.
10. **real-writes-are-reported**: Every path outside the lane's folder that a command really changes when bash runs it in a sandbox is reported as a write finding about the lane at that path, a folder holding it, or a path inside it.

**How I checked the laws themselves.** I tested the generators against bash only, never calling a classifier, using two temporary scripts that are now deleted:
- Every generated command is valid bash.
- Every `bash -lc` wrapping hands bash exactly the inner command.
- Law 7's expected paths are where bash actually writes.
- Law 5's commands change only the paths it names, and law 6's and law 9's change nothing outside the lane's folder.

This caught one flaw in law 10, now fixed: a real `ln` leaves a link behind, and a correct, link-resolving classifier would then rightly report the write somewhere else. `ln` stays covered by law 5.

**Notes for whoever runs them**
- Law 10 needs bwrap (Linux) or sandbox-exec (macOS). It runs a control first and skips if no sandbox starts.
- `~` and `$HOME` are the real home folder. Paths there are named but never created.
- The run's tool checkout and the lane's data folder sit inside the temporary folder, not under the home folder. Otherwise an implementation that resolves them up front would crash every law. The cost: law 5 no longer checks that writes to the tool checkout are findings.

**Unclear in the ticket**
- **"The strongest wins."** I read this per path. An implementation that gives every git target in a command the single strongest git access would fail law 1.
- **Refused versus read.** The ticket doesn't rank them (both are notes), or say whether a refusal message must name the path or needs a non-zero exit. My laws pass either reading.
- **"A read of a missing path."** It doesn't say whether this is judged from the disk or from the output. Law 9 assumes such a read inside the lane's folder is still not reported.
- **Harness folders.** It's unclear whether `~/.codex`, `~/.claude` and the others are normal for every lane or only the lane's own harness. D7's "the lane's tool's own data folder" may also mean they are normal for writing too, while the notes list them for reading only. Not tested.
- **`mv` and `ln`.** It doesn't say whether `mv`'s source counts as written, or which argument is `ln`'s "target". I used only the last argument.
- **Git commands that only show something but aren't listed** (`shortlog`, `reflog`, `branch -a`, `tag -l`, `stash show`, `config --list`). D9's principle and the closed list disagree. Avoided.
- **Not listed, so avoided:** splitting on newlines and `&` (codex commands often span lines), `<` redirects, `${HOME}`, and `$PWD`.
- **Where a `--git-dir=<folder>/.git` call is reported:** at the `.git` path or the folder above it. My laws accept either.
- **Where `user` and `source` on a Touch are set:** in this function or later. Not tested.

Files are in <writer>:
- laws.ts
- LAWS.md
