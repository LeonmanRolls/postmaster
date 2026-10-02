---
title: A lane stays inside its worktree only when a sandbox wraps its harness
type: concept
standing: claimed
sources: [trials/confine-lanes, trials/mimo-headless-forms]
updated: 2026-10-01
---

# A lane stays inside its worktree only when a sandbox wraps its harness

**Claim.** Blinkers rest on each lane having a worktree of its own, and in bypass mode nothing
holds a lane to it. Asked to, every harness the team uses wrote into the target's main checkout,
read another lane's worktree and read a file elsewhere in the home directory. The guards a harness
has of its own either switch off with bypass mode or check what a tool call names, and a shell
redirect gets past those. A sandbox that the launch puts around the whole harness process holds
whatever the harness does: sandbox-runtime stopped every reach on all five harnesses, and every
lane still passed the gate and committed. It runs on Linux and macOS. On Linux it needs Bubblewrap
to be allowed user namespaces, which Ubuntu 24.04 and later refuse until root allows them.
Whatever confines it, a worktree shares its repository's store, so a lane can read another lane's
commits through git; a shared clone per lane closes that.

**Standing: claimed.** One trial on one Linux machine [@trials/confine-lanes]. No run has
dispatched confined lanes yet, and nothing was tried on macOS.

## What a lane needs, and what it must never reach

| access | what | why |
|---|---|---|
| read and write | its worktree, or its reviewer scratch | the work |
| read and write | the repository's git directory, for a worktree; for a shared clone, the repository's objects read only | a worktree commits into the store it shares; a clone borrows objects from it |
| read and write | a temp folder of its own | tests make temp folders: the fixture's failed under sandbox-runtime until the lane had one |
| read and write | its harness's own config, session store and login: `~/.codex`; `~/.claude` and `~/.claude.json`; `~/.config/muse` and its own data directory; MiMo Code's own data directory and cache; `~/.pi/agent` | the harness keeps its thread there and refreshes its login |
| read and write | the package manager's cache | installs |
| read, or write where the harness writes it | the files its launch names: a prompt file, codex's final-message file | Muse Code reads its prompt from a file, and stopped before its first call when the file was hidden |
| read only | the system, the harness installs, git's user config, the tool's own repository and the skills folder that links into it | git stops when it cannot read its user config |
| network | its harness's API and login hosts, the project's package registries, its git host | the run, installs and fetches; research goes through the harness's own web search where the provider runs it |
| never | another lane's worktree or clone, the main checkout's files, the rest of the home directory, any other login or key, a session host's socket, processes it did not start | blinkers, and the user's own files |

All of it comes from the trial's runs [@trials/confine-lanes/method.md]. Two points are reasoning,
not tested. The harness installs stay read only because a harness that updates itself, as Muse
Code does unless told not to, would otherwise let a lane replace the binary every later launch
runs. And the environment carries keys of its own: a launch keeps its caller's variables apart
from the session identity #102 strips, so `SSH_AUTH_SOCK` still reaches a lane, and only a
sandbox that blocks Unix sockets keeps a lane from using the user's SSH agent.

## What each harness offers of its own, with bypass mode on

| harness | its own confinement | with bypass mode on | the trial |
|---|---|---|---|
| codex | a sandbox, Bubblewrap on Linux and Seatbelt on macOS (unverified here); its `:workspace` profile refuses writes outside the workspace and reads anywhere | `--dangerously-bypass-approvals-and-sandbox` turns it off; `-s workspace-write` keeps it with no prompts (from its help, not tried) | open, it wrote and read everything [@trials/confine-lanes/results/digests/codex-open.txt]. Its sandbox, driven alone, could not start until Bubblewrap was allowed, then refused the write, read both files, and could not stage a commit, since a worktree's git directory lies outside the workspace [@trials/confine-lanes/results/codex-own-sandbox.txt] |
| Claude Code | a sandbox for shell commands only, Bubblewrap and socat on Linux and Seatbelt on macOS; permission rules for its file tools ([its docs](https://code.claude.com/docs/en/sandboxing)) | the sandbox stays on but covers no file tool; deny rules, and `permissions.blockReadsOutsideWorkingDirectories`, hold in every mode ([its docs](https://code.claude.com/docs/en/permission-modes)) | with both rules, it refused reading the other lane by `Read` and by `cat`, and refused reading outside its working directory; a shell write into the main checkout went through [@trials/confine-lanes/results/digests/claude-own.txt]. Its sandbox, required, refused to start while a dependency was missing [@trials/confine-lanes/results/claude-own-sandbox.txt] |
| Muse Code | a sandbox for shell commands, Bubblewrap on Linux (its help) | `--yolo` turns it off; `--disable-approval --trust-workspace` keeps it (from its help, not tried) | open, its file tools wrote and read everything [@trials/confine-lanes/results/digests/muse-open.txt] |
| MiMo Code | no sandbox; permission rules, among them `external_directory` for paths outside the project | a rule that denies still holds: bypass approves only what no rule denies | with `external_directory` denied, it refused its file tools and a `cat` outside, and `echo OUTSIDE > <file outside>` in its shell still wrote into the main checkout [@trials/confine-lanes/results/digests/mimo-own.txt] [@trials/confine-lanes/results/digests/mimostub-own.txt]. Asked to search, it searches the whole home directory [@trials/mimo-headless-forms] |
| pi | none: its own docs say real isolation must come from the operating system or a container | nothing to keep on | open, on a stand-in provider, it wrote and read everything [@trials/confine-lanes/results/digests/pi-open.txt] |

## Confining any harness from outside

| way | what it blocks | what it breaks | what it costs | macOS |
|---|---|---|---|---|
| sandbox-runtime: Bubblewrap on Linux, Seatbelt on macOS | the home directory hidden and paths re-opened; writes only where allowed; the network by host; Unix sockets; signals to other processes, in a PID namespace of its own | inside, eleven placeholders in the working directory (`.bashrc`, `.mcp.json`, `.vscode`…) make `git add -A` fail and show in `git status` [@trials/confine-lanes/results/srt-inside-worktree.txt]; a write outside reports success and is lost; a harness's own report to Herdr through its socket | an npm package, a research preview; on Linux `bubblewrap`, `socat` and `ripgrep`, and on Ubuntu 24.04 or later an AppArmor rule added by root | yes, through Seatbelt, needing only `ripgrep` ([its README](https://github.com/anthropics/sandbox-runtime)); not tried |
| Landlock, a ruleset the launch applies ([`landlock.py`](../../raw/trials/confine-lanes/apparatus/landlock.py)) | the filesystem, allow-only, read and write separately; not the network by host (this kernel's ABI 4 limits TCP ports only), Unix sockets, or signals; later kernels add scoping for some of them (unverified: from the kernel's documentation, not tried) | nothing the trial's lanes needed [@trials/confine-lanes/results/shell-landlock.txt] | no root and no dependency; Linux 5.13 or later | no |
| Bubblewrap directly | as sandbox-runtime, without its network filter | as sandbox-runtime | the same root change, and a mount list written per harness | no |
| a separate Unix user per lane | everything the user owns: files, sockets, signals, other processes | every harness login: each lane user needs its own, and a login kept in a Keychain does not cross users; worktrees need a shared group, and git refuses a repository another user owns until it is marked safe | root to create the users and a sudo rule | yes, with users made through the system's directory service |
| a container per lane | everything not mounted into it | the image must carry every harness and the target project's own toolchain for the gate; a Keychain login does not reach it | a container runtime and an image per project | only inside a Linux VM |

The Unix-user and container rows, and the harness's own report to a host's socket in the first row, are reasoned from how each works and not tried here (unverified).

On this evidence sandbox-runtime is the one way that covers both systems at no cost to the work:
the four model lanes and pi passed the gate and committed inside it, and none reached outside
[@trials/confine-lanes/results/scores.txt]. Landlock does the filesystem half with no root, the
fallback for a Linux machine where Bubblewrap is refused. What sandbox-runtime needed first, a temp
folder of the lane's own, its own install readable and the launch's own files opened, is now part
of the table above. Inside it the lane is told a write outside worked; nothing reaches the disk.

The signals row is not academic. On 2026-10-01 a reviewer lane killed every process its user could
signal, the session host and every other run with them (unverified: from the machine's system log,
not promoted). A PID namespace per launch, which sandbox-runtime gives, stops that.

## How the flow would notice a lane that reaches out anyway

- **The main checkout.** `check-target.sh` on the main checkout after the workhorses run, and again
  before the card, finds a write that reached it. In a fixture run on 2026-09-27 a codex workhorse
  wrote a test file into the main checkout, and nothing in the flow looked until the merge
  (unverified here: issue #107 records it, and the run is not promoted).
- **Each lane's own stream.** A lane's events stream names the paths its tools touched: codex's
  file changes name the absolute path, Claude Code's and pi's tool calls carry it in their input,
  MiMo Code's in its tool events and Muse Code's in its tool results. A scan for paths outside the
  lane's worktree finds a reach, done or attempted, before the coachman synthesizes. A shell
  command names paths only in its text, so a scan of it is a best effort.
- **What a confinement leaves.** Inside sandbox-runtime a read outside fails with `No such file
  or directory` and a write outside reports success and never lands; under Landlock both fail with
  `Permission denied` [@trials/confine-lanes/method.md]. Either way the attempt is in the stream,
  and only there: a read leaves nothing on the disk.
- **Another lane's work through git.** Nothing on the disk shows a lane reading another's commits
  in the store a worktree shares. A shared clone per lane removes the reach instead
  [@trials/confine-lanes/results/clone-open.txt].

## What would change it

- Runs dispatched with confined lanes, fixture runs first, scoring clean and shipping: toward
  supported. A confined lane that cannot finish a ticket names what the table above lacks.
- A trial on macOS, where sandbox-runtime uses Seatbelt.
- A harness that keeps its own sandbox on in bypass mode and covers its file tools would need no
  wrapper of the flow's.

## Open

- On Linux sandbox-runtime blocks every Unix socket or none, since seccomp cannot filter by path. A
  project whose gate needs one, a database or Docker, needs an exception per project.
- Each harness's API hosts were found by trial, and a harness that starts using another breaks
  until its list has it.
- A lane cut as a shared clone needs the coachman to fetch its branch at harvest instead of
  reading a branch the repository already holds.
- A worktree lane's confinement leaves the repository's shared git directory writable, since a
  commit writes there, and a hook or a config change made there takes effect for every later
  commit in the repository, outside the lane's confinement. sandbox-runtime protects `.git/hooks`
  and `.git/config` only where `.git` is a directory in the working directory, and its source says
  a worktree, where `.git` is a file, is skipped ([its README, Mandatory Deny Paths](https://github.com/anthropics/sandbox-runtime);
  `linux-sandbox-utils.js` in 0.0.77). So the confinement has to keep those two paths read-only
  for the lane, or each lane is cut as a shared clone, whose own `.git` directory it does protect
  and where nothing shared is writable. From its documentation and source; no trial of it is
  recorded here.
