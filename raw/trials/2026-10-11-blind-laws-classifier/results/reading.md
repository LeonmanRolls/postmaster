# The reading

Every failure below was read against the text of #202 ([`writer/ticket-202.md`](../writer/ticket-202.md)),
after the laws were committed. `<repo>` is the repository the law built, `<lane>` the lane's own folder.

## The control

The page's newline law, through the identical command ([`control-b8056c9.jsonl`](control-b8056c9.jsonl),
[`control-b8056c9-without-newline-split.jsonl`](control-b8056c9-without-newline-split.jsonl)):

| version | result |
|---|---|
| `b8056c9` | passed, 300 inputs |
| `b8056c9` with the newline taken out of `splitShell`'s separators | failed after 7 inputs on `cat <repo>/f1` and `touch <repo>/f1` joined by a newline |

The census, below, has the same control: 0 failures in 300 inputs at `b8056c9`, 70 in 300 without the newline
([`census-control-b8056c9.jsonl`](census-control-b8056c9.jsonl),
[`census-control-b8056c9-without-newline-split.jsonl`](census-control-b8056c9-without-newline-split.jsonl)).

## The laws, run as written

fast-check stops at a law's first failing input and shrinks it, so each failing law reports one input
([`laws-3abedd7.jsonl`](laws-3abedd7.jsonl), [`laws-b8056c9.jsonl`](laws-b8056c9.jsonl)). The census runs
each law's own predicate on 400 inputs from its own generator and keeps every failure
([`census-3abedd7.jsonl`](census-3abedd7.jsonl), [`census-b8056c9.jsonl`](census-b8056c9.jsonl)): 400 is the
largest number of runs any law sets for itself.

| law | first failing input at `3abedd7` | census failures, `3abedd7` | census failures, `b8056c9` | what the failures show |
|---|---|---|---|---|
| 1 every-part-is-judged | none | 0 | 0 | |
| 2 bash-lc-is-unwrapped | none | 0 | 0 | |
| 3 git-reads-only-by-the-list | `git -C <repo> branch zz-x` reported as a read note | 6 | 0 | bug-4: a branch or tag name read as a listing |
| 4 git-is-aimed-by-every-form | `git --git-dir=<synthesis>/.git log -1` reported at `<repo>/.git/worktrees`, in the main checkout | 126 | 126 | a defect no review found, below |
| 5 outside-writes-are-findings | `echo x > '<repo>/my dir/notes.txt'` reported as a write to `<repo>/my` and a read of `<lane>/dir/notes.txt` | 69 | 0 | style-1's defect, through a quoted path with a space |
| 6 reads-are-notes-not-findings | `echo "fix: > ../../a.txt"` reported as a write | 98 | 5 | style-1, quoted `>` (55); style-1's defect through quoted spaces (38); `install`'s source read as written (5) |
| 7 paths-resolve-like-the-shell | a quoted path with a space, as in law 5 | 56 | 0 | style-1's defect |
| 8 refused-needs-the-words | `cat '<other worktree>/my dir/notes.txt'` split in two | 83 | 0 | style-1's defect |
| 9 unreported-paths | none | 0 | 0 | |
| 10 real-writes-are-reported | a quoted path with a space, run for real | 114 | 0 | style-1's defect |

**style-1's defect.** At `3abedd7`, `splitShell` drops the quotes, and `commandTouches` splits the words again,
so quoted text is read as shell syntax. A quoted `>` becomes a redirect, which is the symptom the finding
describes, and a quoted path with a space becomes two words. One change fixed both: at `b8056c9`,
`splitShell` keeps the quotes. Laws 5, 7, 8 and 10 report only that defect first, which hides anything else
they might reach.

**A defect no review found (law 4).** At `3abedd7`, `workTreeForGitDir` follows a worktree's `.git` file to
its `gitdir:` line and returns the parent of the folder named there, `<repo>/.git/worktrees`, where the
worktree is the folder that holds the `.git` file. A real linked worktree has the same file. So
`git --git-dir=<worktree>/.git ...` and `GIT_DIR=<worktree>/.git git ...` are reported in the main checkout,
not in the worktree #202 names ("`--git-dir` ... and `GIT_DIR=` ... aim git at a folder"; "any other path
under `.worktrees/` is another worktree"). A write there then reads as a change to the main checkout. The
same line is in `scripts/reach.ts` at every review snapshot from round 1 (`3abedd7`) to round 7 (`47e43ca`),
and the run removed the classifier in `addd072`. No finding of any round is about how the classifier reads
`--git-dir` or `GIT_DIR=` in a command; bug-14 (round 2) is about the check's own git calls inheriting
`GIT_DIR`.

**`install`'s source (law 6).** `install -m 644 <repo>/x ./installed.txt` reports `<repo>/x`, the source, as
written; #202 counts only the targets of `install` as written. Round 7 found it as bug-48, at P3, so it is not
among the serious findings.

**False alarms: none.** Every failing input shows a defect by #202's text: style-1's, bug-4's, the
`--git-dir` one and `install`'s source.

## The eight findings

What the laws' generators produced is counted from every call the laws made to `commandTouches` during the
census at `b8056c9`, where the fewest laws stop early: 5,481 calls
([`shapes-b8056c9.txt`](shapes-b8056c9.txt), by [`apparatus/shapes.ts`](../apparatus/shapes.ts)).

| finding | first reading | found | the law, or why not |
|---|---|---|---|
| 202/bug-1, refusal attribution hides a successful write beside a denial | neither | no | Law 10 states it: a path a command really changes is a write finding. No input pairs a successful write with another command's refusal; law 10 keeps every path inside its sandbox, where nothing is refused. |
| 202/bug-2, a write after a newline reads as a read | cheap | no | No law states it. Law 1 covers the separators #202 lists, `;`, `&&`, `\|\|`, `\|` and `$(…)`, and the newline is not among them; the writer's report says it left newlines out for that reason. No input holds a newline. |
| 202/bug-3, bare cd and cd under an environment variable ignored | cheap | no | Law 7 states it: a path resolves from the folder the `cd`s lead to, with `$HOME` resolved. No input has a bare `cd`; four have `cd $HOME`, none of them before a relative path. |
| 202/bug-4, the git block misses escapes | heavy | **yes** | Law 3: `git -C <repo> branch zz-x` and `git -C <worktree> tag zz-v1` reported as read notes, 6 of 400 inputs; all six pass at `b8056c9`. |
| 202/bug-5, the shell-group rewrite flips inside reads to notes | cheap | no | Law 9 states it: a path inside the lane's folder is never reported. Law 9 passes no result text, so no refusal words ever meet an inside read. |
| 202/sec-2, git configuration values never skipped | heavy | no | Law 3 states it: a git read by its subcommand is a read note. No input has `git -c`. |
| 202/sec-3, refs named by git reads counted as writes | cheap | no | Law 6 states it: a command that writes nothing outside the lane's folder makes no finding. No git read names `refs/heads/`; the 11 inputs that do are `update-ref`. |
| 202/style-1, quoted shell text misread as a redirect | cheap | **yes** | Law 6: `echo "fix: > ../../a.txt"` reported as a write, 55 of 400; laws 5, 7, 8 and 10 fail on the same defect through quoted paths with spaces. All pass at `b8056c9`. |

**Counts.** Found: 2 of the 8, and 1 of the 5 cheap ones (style-1). Of the six not found, five are stated by a
law whose generator never produced the input, and one, bug-2, is stated by none.

**More inputs (not counted).** Law 7 run on 4,000 inputs, ten times its own number, fails on 591 at
`3abedd7` and on none at `b8056c9`. Thirty of the failures put `cd $HOME` or `cd "$HOME"` before a write,
and 18 of those have no quoted space, so they show bug-3 alone, for example
`cd "$HOME"; pwd && printf x >> '../..<repo>/.worktrees/4507-codex/up/README.md'`.
Here `../..<repo>` is the repository's path written relative to the home folder ([`law7-4000.txt`](law7-4000.txt)).
The other four unreached findings need an input their generators never make: a `-c` option, a ref name in a
read, refusal words in law 9's results, and a refusal beside a successful write.

## The page's failure tests

| test | result |
|---|---|
| the laws find fewer than a third of the eight | met: 2 of 8 |
| the laws fail on code the review later found clean, read as a false alarm | not met: no false alarm |
| the generators take more than a day | not met: the writer took 65 minutes |
