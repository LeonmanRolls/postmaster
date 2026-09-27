# Harness adapters

Every harness-specific fact in the flow lives here and nowhere else. The runbooks say "launch
form", "resume form", "thread id", "final message" and "ambient context"; this file says what
each of those means for each harness. When a harness changes, this file changes and the
runbooks do not. `<tool>` is the postmaster repo, as the runbook that sent you here found it.

**Every form below runs in the foreground and writes its event stream to stdout.**
`<tool>/scripts/host.sh run` adds the redirect to the lane's events file, runs it where the user can
watch it, and lands its marker on exit (`hosts.md`); that is what makes one wrapper in the
runbooks correct for every harness and every host.

**`<tool>/scripts/launch.sh` is the executable form of this file.** `launch.sh form <name>` prints the
exact command for a configured lane or role; `launch` and `resume` run it; `skill` prints the
prompt that invokes a harness's own review skill (Own review skills, below). The script and this
file change together, and a form the script refuses (muse; agy resume) is a form this file has
not recorded yet.

Every lane runs unrestricted. Its containment is its worktree (`coachman.md`, Lane capability),
so the bypass form below is passed on every launch AND every resume. The interactive postmaster
runs unrestricted too, in its harness's interactive form (below). Nothing in the flow depends on
one session messaging another; the postmaster polls files.

**Different CLIs, different output-format flags. Never copy one into another.**

| harness | headless form | stream flag | reads ambient context | prompt from a file |
|---|---|---|---|---|
| codex | `codex exec` | `--json` | `AGENTS.md`, natively | no, argv |
| grok | `grok --prompt-file`, or `grok -p` | `--output-format streaming-json` | `AGENTS.md`, natively | yes |
| agy (Antigravity CLI) | `agy -p` | `--output-format stream-json` | none | no, argv |
| claude | `claude -p` | `--output-format stream-json` | `CLAUDE.md` and what it imports | no, argv |
| pi | `pi --mode json` | `--mode json` | `AGENTS.override.md`, else `AGENTS.md` or `CLAUDE.md`, natively | yes, on stdin |
| muse | `muse exec` | not recorded here | none | `--prompt-file` |

A harness that reads no ambient context file must be handed the project's docs by name in its
prompt, and must have the `WORKHORSE-SPEC.md` / `WORKHORSE-SUMMARY.md` / `WORKHORSE-BLOCKED.md` contract spelled
out in full. The
others pick both up from the brief and the docs. A harness that reads a context file under a
different name needs that file present: a `CLAUDE.md` that is a symlink to `AGENTS.md` serves
both.

Prefer `--prompt-file` wherever a harness offers it. A prompt in argv is visible to every process
listing on the machine, and a process must never be selected by matching text that could appear
in a prompt: match on pid or working directory.

## Skills folders

A skill is installed as a link from a harness's user-level skills folder to that skill in the
postmaster repo's main checkout, never as a copy, and a session finds `<tool>`, the postmaster
repo, from the link (`SKILL.md`, first section). `<tool>/scripts/link-skills.sh` makes the links
and is this table's executable form; its self-test fails when the two disagree. Harnesses that
read one folder share one link there.

| harness | linked into | it also reads | only inside a project | follows a link | source |
|---|---|---|---|---|---|
| claude | `~/.claude/skills`, or `$CLAUDE_CONFIG_DIR/skills` when that is set | `.claude/skills` in the project | no | yes, tried | [trial](../../raw/trials/skill-folders/method.md), [docs](https://code.claude.com/docs/en/skills) |
| codex | `~/.agents/skills` | `~/.codex/skills`, `/etc/codex/skills`; `.agents/skills` from the cwd up to the repo root | no | yes, tried | [trial](../../raw/trials/skill-folders/method.md), [docs](https://learn.chatgpt.com/docs/build-skills) |
| grok | `~/.agents/skills` | `~/.grok/skills`, `~/.claude/skills`; `.grok/skills` and `.agents/skills` up to the repo root | no | not documented | [docs](https://docs.x.ai/build/features/skills-plugins-marketplaces), [guide](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/08-skills.md) |
| agy | none: its docs say `~/.gemini/antigravity-cli/skills`, its changelog puts the global config in `~/.gemini/config/`, and no trial has settled which it reads | `.agents/skills` at the workspace root | no | not documented | [docs](https://antigravity.google/docs/skills/), [changelog](https://github.com/google-antigravity/antigravity-cli/blob/main/CHANGELOG.md), [issue 103](https://github.com/google-antigravity/antigravity-cli/issues/103) |
| muse | `~/.agents/skills` | `$XDG_CONFIG_HOME/muse/skills`, `~/.claude/skills`, `~/.codex/skills`; `.agents/skills` in a trusted workspace | no | yes, tried | [trial](../../raw/trials/skill-folders/method.md), [docs](https://dev.meta.ai/docs/muse-code/extending) |
| pi | `~/.agents/skills` | `~/.pi/agent/skills`; `.pi/skills` and `.agents/skills` in a trusted project | no | yes, tried | [trial](../../raw/trials/skill-folders/method.md), pi 0.87.0 `docs/skills.md` |
| mimo | `~/.agents/skills` | `~/.config/mimocode/skills`, `~/.mimocode/skills`; `.agents/skills` and `.mimocode/skills` up to the repo root; not `~/.claude/skills` | no | yes, tried | [trial](../../raw/trials/skill-folders/method.md) |

Docs read and trial run on 2026-09-26. A harness with no folder in this table is pointed at
`<tool>/skills/postmaster/SKILL.md` by absolute path, and every brief names the skill's documents
by absolute path into `<tool>`, never a copy. grok and muse also read `~/.claude/skills`, so
where claude is installed they meet each skill twice, through two links to one checkout; grok
keeps one per name, and muse lists it once. mimo (MiMo Code) is in this table only: its launch
and resume forms are not recorded yet, so `<tool>/scripts/launch.sh` has no form for it.

## codex

Launch, workhorse or reviewer:

```sh
# Mark the worktree trusted first. The grep guard is idempotent on purpose:
# duplicate [projects] tables are invalid TOML.
grep -qF "[projects.\"<abs wt>\"]" ~/.codex/config.toml \
  || printf '\n[projects."%s"]\ntrust_level = "trusted"\n' "<abs wt>" >> ~/.codex/config.toml
codex exec -C <wt> --json -o <dispatch>/logs/<lane>-last.md -m <model> \
  -c model_reasoning_effort="<effort>" --dangerously-bypass-approvals-and-sandbox \
  "$(cat <dispatch>/<lane>-prompt.txt)"
```

- A detached reviewer scratch needs `--skip-git-repo-check`.
- Thread id: `grep '"thread_id"'` in the events stream.
- Final message: `<lane>-last.md` from `-o`, plus the last result line of the events stream.
- Resume: `codex exec resume <thread_id> --dangerously-bypass-approvals-and-sandbox "<prompt>"`.
  `codex exec resume` accepts no sandbox flag (`-s` errors with "unexpected argument") and a
  bare resume runs read-only, so the bypass flag goes on every resume that must write, reviewers
  included. `--last` is safe only when no other codex thread has run since; otherwise recover
  the id from the events log or `~/.codex/sessions/YYYY/MM/DD/`.
- Durable record: rollout jsonl under `~/.codex/sessions/YYYY/MM/DD/`. `codex resume
  <thread_id>` opens the full TUI on a finished thread. `codex archive <thread_id>` at teardown.
- Headless `codex exec` exposes no browser backend. A workhorse on codex cannot run the render gate;
  the coachman runs it.

## grok

Launch, coachman or lane:

```sh
cd <wt> && grok --prompt-file <dispatch>/<lane>-prompt.txt -m <model> \
  --reasoning-effort <effort> --max-turns 1000 --always-approve \
  --output-format streaming-json
```

- Thread id: the session uuid in the stream, minted at launch.
- Final message: the last result line of the events stream.
- Resume: `grok --resume <uuid> -p "<prompt>"` with the same flags, the caller appending to
  the same stream. This is the coachman's own resume form when the coachman runs on grok: the
  postmaster delivers a ruling this way.
- Durable record: its session store; `grok export` renders a thread as Markdown. Threads persist
  harmlessly; nothing to archive.
- No cross-session messaging.

## agy (Antigravity CLI)

```sh
cd <wt> && agy -p "$(cat <dispatch>/<lane>-prompt.txt)" \
  --model <model> --output-format stream-json \
  --dangerously-skip-permissions --add-dir <wt>
```

- No `--effort` flag for any model: effort is baked into the model NAME, so the lane's model
  string carries it (`gemini-3.7-flash-high`; the effort suffix is part of the id, and an id
  without one is not valid).
- `--sandbox` is opt-IN restriction. Never pass it to a lane.
- Reads NO ambient context file: not `AGENTS.md`, `GEMINI.md`, `AGENT.md`, `.agy/` or
  `.antigravity/`. The prompt must open by naming the project's docs and must spell out the
  `WORKHORSE-SPEC.md` / `WORKHORSE-SUMMARY.md` / `WORKHORSE-BLOCKED.md` contract.
- Thread id: `conversationId` in the stream.
- Final message: the last result line of the events stream.
- Resume: relaunch against its `conversationId`; `agy --help` for the flag. Not recorded here,
  so `launch.sh resume` refuses agy; a postmaster on agy is an interactive session on the
  session host (`hosts.md`) and is never resumed this way.
- Threads persist harmlessly; nothing to archive.
- No skills folder is linked for agy (Skills folders, above). A session on agy is pointed at
  `<tool>/skills/postmaster/SKILL.md` by its absolute path.

## claude

```sh
cd <wt> && claude -p "$(cat <dispatch>/<lane>-prompt.txt)" --model <model> \
  --output-format stream-json --verbose --dangerously-skip-permissions
```

- `--output-format stream-json` in print mode requires `--verbose`. `--effort <effort>` sets the
  effort where the lane has one.
- **Alternate backends.** The claude harness reaches an Anthropic-compatible endpoint through
  the environment: `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`, plus whatever the endpoint
  documents. A lane's `env_file` in the config is loaded before launch and holds exactly that;
  the key never enters the config or this repo. A model id the harness does not know needs the
  `[1m]` suffix (or the window the endpoint offers), or the harness assumes 200k and compacts
  early.
- Thread id: `session_id` on the first event of the stream.
- Thread name: `--name <text>`, which `launch.sh` passes from `POSTMASTER_LAUNCH_NAME` when
  `host.sh` sets it. Headless, it names the thread in the resume picker and does not set the
  pane's terminal title; `host.sh` sets that itself.
- Resume: `claude -p --resume <session_id> "<prompt>"` with the same flags.
- Ambient context: reads `CLAUDE.md` in the repo and the files it imports. A project that keeps
  its context in `AGENTS.md` needs a `CLAUDE.md` pointing at it; a symlink works.
- As the coachman's own harness: background tasks are reaped at about 29 minutes, and a long
  lane routinely outlives that. A launch through `<tool>/scripts/host.sh` is not one of its background
  tasks: it runs in a host's pane, or detached in a session of its own, and outlives the call
  that started it. The cap reaches only what the harness runs itself, such as a wait. A
  "stopped" notification without a quota error is that cap, not a failure: run the wait again,
  and resume a lane only once its marker has landed, never while it still runs. Instruct
  workhorses to commit incrementally.

## pi

```sh
cd <wt> && pi --mode json --approve --model <provider/model> \
  --thinking <effort> < <dispatch>/<lane>-prompt.txt
```

- **The prompt goes in on stdin, never as `@<file>`.** An `@file` argument is an attachment:
  pi sends it as `<file name="/abs/path">…</file>` with no instruction around it, so the
  lane is handed a file rather than told to do something, and the dispatch path ends up in
  the conversation. Stdin sends the prompt verbatim, which is the message every other
  harness gets. pi also reads stdin to EOF before it starts in every mode but rpc, so a
  launch that inherits an open pipe never begins; the redirect closes that case too.
- `--mode json` already selects non-interactive mode, so `--print` adds nothing.
- `--approve` trusts project-local resources for the run. Pi has no permission prompts; its
  built-in tools run unrestricted, with the worktree as the lane's containment.
- Reads `~/.pi/agent/AGENTS.md`, then one context file per directory while walking from the
  filesystem root to the worktree: `AGENTS.override.md` when present, otherwise `AGENTS.md`
  before `CLAUDE.md`.
- Thread id: `id` in the first `session` record of the JSON stream.
- Thread name: `--name <text>`, passed from `POSTMASTER_LAUNCH_NAME` as for claude.
- Final message: the last `message_end` record whose message has role `assistant`. The
  stream also emits `message_end` for the system and user messages.
- Resume: `pi --mode json --approve --session <id> --model <provider/model>
  --thinking <effort> < <prompt-file>`, appending to the same stream.
- **Resume from the directory the thread was launched in.** `--session` looks in the current
  working directory's sessions first. Given an id that exists only under another directory,
  pi prints "Session found in different project", asks "Fork this session into current
  directory? [y/N]" on stdin, reads the first line of the piped prompt as the answer, prints
  "Aborted." and exits 0 having done nothing. `launch.sh resume` always changes to the given
  directory first, so this bites only a caller that passes a different one.
- Durable record: session JSONL under `~/.pi/agent/sessions/--<path>--/`, where `<path>` is the
  working directory with `/` replaced by `-`. Threads persist harmlessly; nothing to archive.
- Use a provider-qualified model id when the same model name could match more than one provider.

## muse

- Installed as `muse`; headless form `muse exec`, takes `--prompt-file` and `--api-key-stdin`.
  Reads no ambient context file.
- **Not usable as a lane until this section records its stream flag, its bypass form, where
  its thread id appears and its resume form.** Fill those in from `muse --help` and a trial
  run before configuring a lane on it; the probe lists it so the gap is visible, not so it is
  chosen.

## Own review skills

Under the security lens, a lane whose harness has its own security review skill runs it in place
of postmaster's brief (`coachman.md`, Security lens). `<tool>/scripts/launch.sh skill <lane>
security-review` prints the prompt that invokes it, and exits 3 when the lane's harness has none.
The prompt goes in the lane's prompt file, and the launch is the ordinary launch form.

| harness | security review skill | source |
|---|---|---|
| claude | `/security-review` | a trial, 2.1.283 (`raw/trials/claude-security-review/`) |
| codex | none: `codex exec review` takes `--uncommitted`, `--base <branch>`, `--commit <sha>` or a prompt of its own, and has no security preset | its help, 0.157.1 |
| pi | none: its help lists no review command, and its skills come from files (`--skill <path>`) | its help, 0.87.0 |
| muse | none among its built-in skills | `muse skills list`, 1.4.0 |
| grok | none: its slash commands have no review command; skills, plugins and workflows could add one | its documentation (docs.x.ai, Modes and Commands), 2026-09 |
| agy | none: its slash commands have no security review; Google's security extension (`/security:analyze`) is for Gemini CLI only | its documentation (antigravity.google, CLI Reference), 2026-09 |

MiMo Code, which has no adapter here yet, has none either: its `/review` is a general code
review (its commands, 0.1.15). OpenAI's Codex Security is a CLI of its own
(`@openai/codex-security`), not a codex skill, and would need an adapter of its own.

**claude's `/security-review`** reviews the change from the merge base of `origin/HEAD` and
`HEAD`, reading it with `git diff origin/HEAD...`. Where `origin/HEAD` does not resolve, it exits
0 with an empty result after no turns, having reviewed nothing. A worktree scratch cannot give it
one: `refs/remotes/origin/HEAD` is shared by every worktree of a repository, and git 2.43
resolves no per-worktree copy. So the security lens reviews from scratch clones, cut with
`<tool>/scripts/cut-scratch.sh ... --clone <BASE>`, whose `origin/HEAD` is the branch the repository has
checked out. The cut, and the check before each launch, refuse a clone where that does not lead
back to BASE. When it verifies its findings
in background agents, a headless run ends with one result line per turn, and an earlier one can
say the agents are still running. Its report is the last result line, which is where the harvest
reads a lane's final message.

## Interactive form: the postmaster

The postmaster is the one interactive session (`SKILL.md` spawns it through `host.sh spawn`).
It runs in its harness's bypass mode, like every launch, named for its project:

| harness | interactive form | checked here |
|---|---|---|
| claude | `claude --model <model> --effort <effort> --name "<name>" --dangerously-skip-permissions` | yes |
| pi | `pi --model <provider/model> --thinking <effort> --name "<name>" --approve`; pi has no permission prompts | flags from its help |
| codex | `codex -m <model> -c model_reasoning_effort="<effort>" --dangerously-bypass-approvals-and-sandbox` | no |
| grok | `grok -m <model> --reasoning-effort <effort> --always-approve` | no |
| agy | `agy --model <model> --dangerously-skip-permissions` | no |

Bypass mode does not skip claude's question, on first start in a folder it has never opened,
whether to trust it; headless `claude -p` does not ask. The first spawn in a new target stops
there, and the user answers it in the pane. A row not checked here takes its bypass flag from
the headless form above; run it once before relying on it.

## The pane view

`<tool>/scripts/view-stream.sh` is the other executable half of this file: it renders an events
stream one line per event of interest, for a host's pane (`hosts.md`) and for anyone reading a
stream by hand. It knows claude's events, checked against a recorded stream; codex's and pi's,
written from the event names this file records and not yet checked against a recorded stream;
any other harness shows by event type, once per run of the same type. A harness whose events it
shows badly gets its rules there, and a line here saying they were checked.

## Walls, any harness

A lane that never launched is lame for that round: DEGRADED. Recognise a wall by the provider's
own error string and quote it in `run-log.md`: a `402 Payment Required`, a usage-limit message,
a quota wall, a spawn misfire, a stale session lock. The fix is restoring the lane on the next
round, never suppressing the label.
