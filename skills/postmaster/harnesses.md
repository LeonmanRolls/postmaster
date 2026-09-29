# Harness adapters

Every harness-specific fact in the flow lives here and nowhere else. The runbooks say "launch
form", "resume form", "thread id", "final message" and "ambient context"; this file says what
each of those means for each harness. When a harness changes, this file changes and the
runbooks do not. `<tool>` is the postmaster repo, as the runbook that sent you here found it.

**Every form below runs in the foreground and writes its event stream to stdout.**
`<tool>/scripts/host.sh run` adds the redirect to the lane's events file, runs it where the user can
watch it, and lands its marker on exit (`hosts.md`); that is what makes one wrapper in the
runbooks correct for every harness and every host.

Coachman legs use `<tool>/scripts/host.sh leg`, which owns the stream path, marker lifecycle and
attempt record. It calls the form below through `launch.sh`; a resume appends to its launch's
stream and a takeover begins a new stream after preserving the old one. `launch.sh` marks an
attempt `refused` before its preflight and marks it `started` only after the env file loads and
the harness is still callable. The leg command records the final outcome before the host lands
the exited marker.

**`<tool>/scripts/launch.sh` is the executable form of this file.** `launch.sh form <name>` prints the
exact launch and resume commands for a configured lane or role; `launch` and `resume` run them;
`skill` prints the prompt that invokes a harness's own review skill (Own review skills, below).
The script and this file change together, and a form the script refuses (agy resume) is a form
this file has not recorded yet.

For a launch in a run, `<tool>/scripts/host.sh run --out` passes the events path to `launch.sh`.
After the harness exits, `launch.sh` reads the thread id from that stream and writes the durable
session under `<dispatch>/sessions/<lane>/<thread-id>`. Codex, Claude Code and pi sessions are
copied from their durable stores; grok, Muse Code and MiMo Code use their export command;
Antigravity has no export command, so its complete event stream is kept as the session transcript.
The export and event stream are separate files in the project-local run record.

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
| muse | `muse exec` | `--json` | `AGENTS.md` in a trusted workspace, and Claude Code's user rules | yes, `--prompt-file` |
| mimo | `mimo run` | `--format json` | `AGENTS.md`, a `CLAUDE.md` beside a short one, and Claude Code's user rules | yes, on stdin |

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
keeps one per name, and muse lists it once.

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
- Resume, from the worktree the thread was launched in, appending to the same stream:

  ```sh
  cd <wt> && codex exec resume <thread_id> --json -o <dispatch>/logs/<lane>-last.md \
    -m <model> -c model_reasoning_effort="<effort>" --dangerously-bypass-approvals-and-sandbox \
    -- "<prompt>"
  ```

  These are the launch's flags without `-C` and `--skip-git-repo-check`, with `--` before the
  prompt. After `resume`, codex refuses `-C` and `-s` with "unexpected argument", and reads a
  prompt that starts with `-` as a flag and exits 2 unless `--` comes first. A resume that
  names no model or effort runs on codex's configured default, not on the thread's own, so both
  go on every resume. Without the bypass flag a resume runs `workspace-write` in a trusted
  worktree and read-only in an untrusted one, so the bypass goes on every resume, reviewers
  included. The resumed stream opens with the launch's `thread.started`. codex's own `--last`,
  in place of the id, is safe only when no other codex thread has run since; otherwise recover
  the id from the events log or `~/.codex/sessions/YYYY/MM/DD/`.
  [Why every resume names its model](../../wiki/concepts/codex-resume-model.md)
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

## muse (Muse Code)

```sh
cd <wt> && env XDG_DATA_HOME=<harness-data>/muse/<key> muse exec --json \
  --prompt-file <abs prompt-file> --model <model> --reasoning-effort <effort> --yolo < /dev/null
```

- `--yolo` is the bypass form. It turns off tool approval and Muse Code's sandbox, and trusts
  the workspace for the run. The sandbox uses Bubblewrap, which needs unprivileged user
  namespaces, so a machine that blocks them still runs the launch. `--reasoning-effort` takes
  `none`, `minimal`, `low`, `medium`, `high` (its default), `xhigh`, `max` and `ultra`.
- Stdin: Muse Code reads its stdin to the end before it starts, and an open pipe held a launch
  for as long as the pipe stayed open. The launch gives it `/dev/null`.
- The prompt: `--prompt-file` delivers the file byte for byte. `turn.input.user` carries it,
  and the echo provider answered with it unchanged.
  [Why the form matters](../../wiki/concepts/prompt-delivery.md)
- `--json` writes one JSON record per line. Each carries `stream` (`kind` `session`, and its
  `id`), a `sequence`, and a `payload_type` with its `payload`.
- Thread id: `stream.id` of the first record, a UUID.
- Resume: the launch form with `--session-id <thread id>`, the model and the effort passed
  again. `muse resume` opens the interactive picker and is not used. Given an id its data
  directory does not hold, Muse Code opens a new thread under that id and exits 0. So
  `launch.sh` refuses a resume unless Muse Code's own export (`muse export --session <id>`)
  finds the thread in the launch's data directory. It is only there from the same directory,
  name, leg and run. Resumed from another directory with its launch's data, Muse Code refuses
  on its own, with exit 1. [Why the exit is not enough](../../wiki/concepts/resume-exit-status.md)
- Final message: `payload.text` of the last `run.terminal.*` record, `run.terminal.completed` on
  success. A run that fails, on a model that does not exist say, ends on `run.terminal.failed`
  with no text and exit 1, and says why on stderr.
- The model: `run.model.configured` carries `model_id`, with `source` `startup` on a launch and
  `replay` on a resume. No record carries the effort.
- Tool calls: each ends in a `tool.result`, whose `correlation_facts` name the tool and its
  outcome. For `bash`, `payload.text` is JSON text with the command and its output; the pane
  shows the command and leaves the output out. The full response is in `payload.text` on the
  last `run.terminal.*` record.
- **Its data, per lane and per leg.** Muse Code keeps its sessions under `XDG_DATA_HOME`, and a
  memory that outlives them (`add_memory`, `read_memory`): a fresh session there recalled a word
  an earlier one had been asked to remember. So `launch.sh` gives each lane and each coachman leg
  its own `XDG_DATA_HOME`, under `POSTMASTER_HARNESS_DATA` (default
  `~/.postmaster/harness-data`), keyed by run, directory, name and leg. A resume finds its
  session there, and no lane, leg or run finds another's through Muse Code's own memory; a lane
  can still read files elsewhere on the machine.
- Ambient context: in a trusted workspace, which `--yolo` makes it, `AGENTS.md`, and a
  `CLAUDE.md` only where no `AGENTS.md` sits beside it. It also loads other agents' personal
  rules and skills, Claude Code's user rules among them, unless `--no-foreign-personal-context`
  is passed. The launch keeps them, as a claude lane reads the same file.
- Key: `META_API_KEY` in the environment, from the lane's or the role's `env_file`. On Linux,
  `muse login` fails to save its credential to the keychain.
- It updates itself in the background unless `MUSE_NO_AUTO_UPDATE=1` is set. A run records the
  version it was dispatched with, and a later leg may run a newer one.
- Source: trials of Muse Code 1.4.0 (R4302.1), `raw/trials/muse-headless-forms/`, and for the
  prompt and resumes, `raw/trials/muse-mimo-controls/`.

## mimo (MiMo Code)

```sh
cd <wt> && env XDG_DATA_HOME=<harness-data>/mimo/<key> MIMOCODE_DISABLE_CLAUDE_IMPORT=1 \
  mimo run --format json -m <provider/model> --variant <effort> --dangerously-skip-permissions \
  < <abs prompt-file>
```

- The prompt arrives on stdin. MiMo Code reads its stdin to the end before it starts, so an
  open pipe holds a launch, and the prompt file is the only stdin a launch ever has. The model
  receives the file byte for byte, after one newline MiMo Code puts before it. A message
  argument that holds a space arrives wrapped in double quotes with its own quotes escaped, and
  `-f` only attaches a file to a message. [Why the form matters](../../wiki/concepts/prompt-delivery.md)
- `--dangerously-skip-permissions` is the bypass form: it approves whatever no rule denies.
- The model is `provider/model`, and a key works only with the provider id of the plan it
  belongs to. `--variant` sets the effort: MiMo V2.6 Pro's variants are
  `low`, `medium` and `high`. The key is `XIAOMI_API_KEY`, from the lane's `env_file`.
- `--format json` writes one event per line: `step_start`, `text`, `tool_use` and `step_finish`,
  each with its `sessionID` and a `part`. A `tool_use` names its tool and input in `part`.
- Thread id: the `sessionID` on the first event.
- Resume: the launch form with `-s <thread id>`, the model and the variant passed again. A
  resume that names no variant runs without one, as `mimo export <session>` shows: it records
  each message's provider, model and variant. Given an id its data directory does not hold, it
  exits 0 with no event at all, having sent nothing, and says `Session not found` only on
  stderr. Resumed from another directory with its launch's data, it continues the thread and
  runs its tools in that directory. So `launch.sh` refuses a resume unless `mimo export <id>`
  finds the thread in the launch's data directory. It is only there from the same directory,
  name, leg and run. [Why the exit is not enough](../../wiki/concepts/resume-exit-status.md)
- Thread name: `--title <text>` on a launch, which `launch.sh` passes from
  `POSTMASTER_LAUNCH_NAME`.
- Final message: the `part.text` of the last `text` event; `step_finish` with reason `stop`
  closes the run. **A run that fails exits 0 all the same**: on a model that does not exist it
  wrote one `error` event and no text. Read a failure from the events, never the exit.
- **Its data, per lane.** MiMo Code keeps its sessions under `XDG_DATA_HOME`, with a `memory`
  tool's notes and one session-notes file that every session there shares
  (`memory/sessions/current_session_id/notes.md`): a fresh session in the same data directory
  recalled a word an earlier one had been asked to remember. So `launch.sh` gives each lane its
  own `XDG_DATA_HOME`, as it does for Muse Code. That closes MiMo Code's own channel, not the
  filesystem: a lane asked to search can still read files anywhere on the machine. In a new data
  directory MiMo Code first copies in Claude Code's session history, 69 MB here, which
  `MIMOCODE_DISABLE_CLAUDE_IMPORT=1` turns off.
- Ambient context: `AGENTS.md` up to the repository's root, and a `CLAUDE.md` too when the
  `AGENTS.md` is under 500 characters; its own config's `AGENTS.md`; and Claude Code's user rules,
  `~/.claude/CLAUDE.md`. `MIMOCODE_DISABLE_CLAUDE_CODE_PROMPT=1` turns off both `CLAUDE.md` files.
  The launch keeps them, as a claude lane reads the same files.
- From Claude Code's settings: it started the MCP server a project's `.claude.json` names, and
  did not run a project's Claude Code hook (trial). Its code also reads `~/.claude.json`'s MCP
  servers and Claude Code's commands. The launch keeps the MCP servers and the commands, as a
  claude lane has them; no Claude Code hook guards a MiMo Code launch.
- Source: trials of MiMo Code 0.1.15, `raw/trials/mimo-headless-forms/`, and for the prompt and
  resumes, `raw/trials/muse-mimo-controls/`.

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

MiMo Code has none either: its `/review` is a general code review (its commands, 0.1.15). OpenAI's Codex Security is a CLI of its own
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
| muse | `muse --model <model> --reasoning-effort <effort> --yolo` | flags from its help |
| mimo | `mimo -m <provider/model> --dangerously-skip-permissions`; its effort is set inside, having no flag | flags from its help |

Bypass mode does not skip claude's question, on first start in a folder it has never opened,
whether to trust it; headless `claude -p` does not ask. The first spawn in a new target stops
there, and the user answers it in the pane. A row not checked here takes its bypass flag from
the headless form above; run it once before relying on it.

## Keeping the watcher running

Stage D keeps one `<tool>/scripts/runs-watch.sh <runs>` going per project, acts on the runs it
names, and starts it again at once. The watcher is a long wait that must outlive a turn and must
not hold the conversation, so it is started the way any launch is, through
`<tool>/scripts/host.sh run`, which returns as soon as the watcher has started and keeps it in a
session of its own: a host's pane where there is one, a detached process where there is none
(`hosts.md`).

```sh
<tool>/scripts/host.sh run "watch · <project>" "<repo>" \
    --out "<runs>/postmaster/watch.out" --err "<runs>/postmaster/watch.err" \
    --marker "<runs>/postmaster/.watch-exited" \
    -- "<tool>/scripts/runs-watch.sh" "<runs>"
```

Wait for its return in the conversation with `<tool>/scripts/wait-for-markers.sh`:

```sh
<tool>/scripts/wait-for-markers.sh "<runs>/postmaster" '.watch-exited' 1 86400
```

Exit 0 means the watcher returned: read `watch.out`. Exit 3 means nothing returned in a
day: wait again. If the wait itself is cut short by the harness, run it again: a marker
already landed is collected at once.

When `.watch-exited` lands, `watch.out` holds the table and the `needs` lines: act on them,
then start the watcher again before anything else. Check `watch.err` too: a held line that
matches no run warns there. The marker lands whatever the exit, so no `needs` lines means
the watcher failed instead of waking: the reason is in `watch.err` — read it, fix the
cause, and only then start the watcher again. If `watch.err` is empty too, the watcher was
killed rather than exiting: start the watcher again.

| harness | nonblocking form | where the session cannot keep it in the background |
|---|---|---|
| claude | the `host.sh run` form above; never its own background tasks, which are reaped at about 29 minutes (its section above) | the foreground poll below |
| codex | the `host.sh run` form above | the foreground poll below |
| grok | the `host.sh run` form above | the foreground poll below |
| agy | the `host.sh run` form above | the foreground poll below |
| pi | the `host.sh run` form above | the foreground poll below |
| muse | the `host.sh run` form above | the foreground poll below |
| mimo | the `host.sh run` form above | the foreground poll below |

The foreground poll is `<tool>/scripts/runs-watch.sh <runs> --timeout <postmaster.poll_seconds>`,
run in the conversation and started again at once: it returns with the table every interval. It
is the only form that blocks the conversation, and only for one interval. Never keep the
watcher anywhere but `host.sh run`: no other keeping has a documented lifetime, and on
2026-09-28 a watcher kept outside it was killed when memory ran short (#121).

## The pane view

`<tool>/scripts/view-stream.sh` is the other executable half of this file: it renders an events
stream as wrapped blocks for a host's pane (`hosts.md`) and for anyone reading a stream by hand.
What an agent says and what it runs shows in full, every line, wrapped to the pane and never cut
short; tool output stays out. It knows claude's, muse's and mimo's events, checked against recorded
streams; codex's
and pi's, written from the event names this file records and not yet checked against a recorded
stream;
any other harness shows by event type, once per run of the same type. A harness whose events it
shows badly gets its rules there, and a line here saying they were checked.

## Walls, any harness

A lane that never launched is lame for that round: DEGRADED. Recognise a wall by the provider's
own error string and quote it in `run-log.md`: a `402 Payment Required`, a usage-limit message,
a quota wall, a spawn misfire, a stale session lock. The fix is restoring the lane on the next
round, never suppressing the label.
