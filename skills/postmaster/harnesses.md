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
`review` runs a lane's bug-review form at the harness's top level on the named base-to-HEAD
range; `skill` prints the prompt that invokes a harness's own security review skill (Own review
skills, below). The script and this file change together, and a form the script refuses (agy
resume or a bug-review form the harness does not have) is a form this file has not recorded.

For a launch in a run, `<tool>/scripts/host.sh run --out` passes the events path to `launch.sh`.
After the harness exits, `launch.sh` reads the thread id from that stream and writes the durable
session under `<dispatch>/sessions/<lane>/<thread-id>`. Codex, Claude Code and pi sessions are
copied from their durable stores; grok, Muse Code and MiMo Code use their export command;
Antigravity has no export command, so its complete event stream is kept as the session transcript.
The export and event stream are separate files in the project-local run record.

`thread-id <events-file>` prints the thread id a stream records, from its shape; `transient
<err-file> [<stream-file>]` exits 0 when a leg's end is a transient provider error this file
names (below).

| harness | thread id in its stream |
|---|---|
| codex | `thread_id` |
| claude | `session_id` |
| grok | `id` on a session record, else `session_id`, `sessionId`, `conversation_id` or `conversationId` |
| agy | `conversationId` |
| pi | `id` on the `session` record |
| muse | `stream.id` on a `session` record |
| mimo | `sessionID` |

## Transient provider errors, any harness

Some ends are the provider's, not the leg's: the model stream dropped, a gateway failed, the
connection reset. Those are worth resuming on rather than escalating. The set is enumerated in
`<tool>/scripts/launch.sh` (`transient`), which matches it against the leg's durable record:
its `.err` file and the error records in its stream tail, never a prompt or a user message.
This file names the same set:

| name | what it looks like |
|---|---|
| model stream idle timeout | `model stream idle timeout`, `stream idle timeout` |
| gateway failure | `bad gateway`, `service unavailable`, `gateway timeout`, `overloaded`, `502`, `503`, `504`, `529` |
| stream drop | `stream disconnected`, `SSE error`, `connection reset`, `connection aborted`, `broken pipe` |

The adapter answers one question: may the watcher resume this ending by itself? The
answer is positive and narrow. An ending resumes only when it carries one of the
signatures above and no wall-like token anywhere in it; everything else wakes the
postmaster. A wall is **never** transient: any token stem of quota, limit, exhaust,
exceed, throttle, billing, budget, credit, payment, usage, slow, quick or too many
vetoes the resume wherever it appears in what the ending says, in any spelling and at
any distance — there is no span limit and no word boundary to hide behind. What the
ending says is its message text: the `.err` lines, non-JSON stream lines, and every
string value of its error records, under any key. `host:` notice lines in
`.err` are the host's words, not the child's, and the veto reads past
them, as the refusal check does. JSON keys,
field names and numeric payloads are structure, not text, and never count: a `usage`
key, a `rate_limit` key, a token count of 1429 and a UUID holding 429 are not walls.
The codes `429` and `402` count only status-shaped, as whole numbers in text or as the
value of a status or code field. The one exclusion is Claude's `rate_limit_event`
slowdown notice, which is not an ending and never vetoes. A false veto is a wake,
which costs one look; a missed wall would be an automatic remount against a wall. The
fifteen stems live once in `launch.sh` (`wall_tokens`, printed by `launch.sh
wall-tokens`); the veto matrix is built from that list, a quote corpus beside it
covers real provider messages verbatim, and each stem is pinned alone, so a stem that
stops vetoing fails loudly. Usage-bearing codex and claude streams from real runs
stand beside the corpus as fixtures that must resume. `try again later` and `server
is busy` carry no stem on purpose: that is transient-overload language, and resuming
on it is right.

An error record is one the adapter marks: an error-indicating key at any
depth — `error`, `fail` or `exception` in a type, event, kind, payload
type, subtype or status value, a truthy `error`, `errors`, `is_error`
or `error_message` field, or an `outcome` of `error` — wherever in the
record it sits. Only a truthy value marks: null, false and empty values
never do. The `.err` lines and non-JSON stream lines are stderr chunks
and always count. Per harness, as observed:

- codex: the generic rule, with nested `item.type: error` attested in
  `raw/trials/codex-resume-forms/`. Usage-bearing `turn.completed`
  records are not error records.
- claude: the generic rule plus `is_error` on `result` records.
  Usage-bearing assistant messages are not error records.
- mimo: the generic rule only; no mimo-specific error shape is attested.
  Unmarked text parts are ordinary messages, so those streams classify
  from the `.err` text.
- muse: the generic rule plus `outcome: error` payloads, and
  `run.terminal.failed` with its `reason` under the generic rule.
- pi: the generic rule only (see the exclusion below).
- grok, agy: the generic rule; unobserved.

Deliberately excluded, at every depth: tool-result subtrees — a record
or subtree whose type or name is `tool_result` or `tool_execution_end`,
or that sits under one of those keys. That covers claude's nested
`tool_result` records and pi's `tool_execution_end` records, and any
other harness's tool-result shape the adapter identifies. A failed tool
call's text is the tool's, not the provider's: a coachman's failing
gate prints cap and limit words all the time, and a provider wall still
ends the turn through the harness's own error record, where the veto
sees it: tool output contributes no signal anywhere — not a veto, not
transient prose, and not a structured code, type or unknown. The
exclusion is narrow on purpose: a `payload_type` of `tool.result`
(muse `outcome: error` payloads) is an error record, not a tool's.

Where a record carries a status code or an error type, values come in three classes
over every post-skip line: the known-transient set (`502`, `503`, `504`, `529`,
connection-reset and overloaded types) resumes on any record;
known-harness-internal values (a `completed` status, a `rate_limit_event` slowdown,
a `2xx`/`3xx` status, an exit code, a generic timeout) are ignored; any other
numeric status under a code key wakes wherever it sits, and any other string
under a code or error-name key
wakes on an error record while on another record it is progress noise. Bare
record-shape keys (`type`, `name`) are labels, not classifications. Per harness,
as observed: mimo
reports errors as prose in text parts, and muse reports prose in the `reason` of
`run.terminal.failed`. Codex error items and grok, pi and agy error shapes are
unobserved, so those read prose. Claude additionally emits `rate_limit_event`, which is
a slowdown notice, not a wall — it appears in successful legs. No harness has yet been
observed emitting numeric codes or error-type fields; when one does, the structured
layer reads them.

Every lane runs in a process space of its own when `confine = "on"` (Confinement below).
Its writes are kept apart by its worktree (`coachman.md`, Lane capability),
and the bypass form below is passed on every launch AND every resume. The interactive postmaster
runs unrestricted too, in its harness's interactive form (below). Nothing in the flow depends on
one session messaging another; the postmaster polls files.

## Confinement

With `confine = "on"`, each lane's harness is wrapped in the system's own process isolation at
the point `launch.sh` runs it. The harness form is unchanged, bypass flag included. A lane
whose confinement cannot start runs unconfined, with a warning naming the cause.

| system | mechanism | what it does |
|---|---|---|
| Linux | Bubblewrap, new PID namespace, fresh /proc | A lane cannot signal a process it did not start. |
| macOS | `sandbox-exec`, Seatbelt profile denying signals to external processes | Same, via Seatbelt. Untested here; #205 checks it. |
| other | none | The lane runs unconfined, with the warning. |

The wrap is outside the harness command, so one mechanism covers every harness. Files, network
and sockets are not restricted; those are a separate ticket. The coachman, its fallback and the
postmaster are never confined.

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
prompt, and must have the `WORKHORSE-SUMMARY.md` / `WORKHORSE-BLOCKED.md` contract spelled
out in full, together with the line that the run's one approved spec is already at
`WORKHORSE-SPEC.md` in its worktree. The
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
and is this table's executable form; its tests beside it fail when the two disagree. Harnesses that
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
  `WORKHORSE-SUMMARY.md` / `WORKHORSE-BLOCKED.md` contract and the approved-spec line.
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

Under a review lens, a lane whose harness has its own review skill for that lens runs it in
place of postmaster's brief. Under the security lens that is `security-review`
(`coachman.md`, Security lens): `<tool>/scripts/launch.sh skill <lane> security-review` prints
the prompt that invokes it, and exits 3 when the lane's harness has none. The prompt goes in
the lane's prompt file and the launch is the ordinary launch form. Under the bug lens the form
is run by `<tool>/scripts/launch.sh review`, below, and no brief is written. A lane whose
harness has no code-review skill does not review for bugs at all: unlike the security lens
there is no fallback to the brief.

### Security review skill

| harness | security review skill | source |
|---|---|---|
| claude | `/security-review` | a trial, 2.1.283 (`raw/trials/claude-security-review/`) |
| codex | none: `codex exec review` takes `--uncommitted`, `--base <branch>`, `--commit <sha>` or a prompt of its own, and has no security preset | its help, 0.157.1 |
| pi | none: its help lists no review command, and its skills come from files (`--skill <path>`) | its help, 0.87.0 |
| muse | none among its built-in skills | `muse skills list`, 1.4.0 |
| grok | none: its slash commands have no review command; skills, plugins and workflows could add one | its documentation (docs.x.ai, Modes and Commands), 2026-09 |
| agy | none: its slash commands have no security review; Google's security extension (`/security:analyze`) is for Gemini CLI only | its documentation (antigravity.google, CLI Reference), 2026-09 |

MiMo Code has none either: its `/review` is a general code review (its commands, 0.1.15), covered
under Code review skill below. OpenAI's Codex Security is a CLI of its own
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

### Code review skill

The bug lens runs each harness's own code-review skill on the run's change, never postmaster's
brief. Every form below names that change explicitly: a skill left to choose its own diff
cannot be trusted in a review scratch, which is a worktree detached at the snapshot with no
upstream. `<tool>/scripts/launch.sh review <lane> <cwd> <base>` runs the form on the change
from `<base>` to the scratch's `HEAD`, and exits 3 for a harness with none. It runs every
review at its harness's top level and names that level on every launch: `max` for claude and
codex, and `high` for MiMo Code on MiMo V2.6 Pro, whose variants stop there, whatever effort
the lane is configured at. `<tool>/scripts/review-forms.sh has <harness>` answers whether a
harness has one, and is what the scripts ask instead of carrying their own copy of the table.

| harness | code-review skill | source |
|---|---|---|
| claude | `/code-review` | a trial, 2.1.283 (`raw/trials/code-review-scope/`) |
| codex | `codex exec review` | a trial and its help, 0.157.1 (`raw/trials/code-review-scope/`) |
| mimo | `/review`, `mimo run --command review` | a trial and its commands, 0.1.15 (`raw/trials/code-review-scope/`) |
| pi | none: its help lists no review command | its help, 0.87.0 |
| muse | none among its built-in skills | `muse skills list`, 1.4.0 |
| grok | none: its slash commands have no review command | its documentation (docs.x.ai, Modes and Commands), 2026-09 |
| agy | none recorded: its CLI reference lists no code-review form | its documentation (antigravity.google, CLI Reference), 2026-09 |

**claude's `/code-review`.** The form is its ordinary launch form with the prompt
`/code-review <level> <BASE>...HEAD`, level `max`:

| | |
|---|---|
| command | the launch form, prompt `/code-review max <BASE>...HEAD` |
| the change | `<BASE>...HEAD` named in the prompt; the skill's own diff rule is `git diff <target>` then `git diff HEAD` |
| level | the form always names it. `/code-review` given no level reuses the level the user last typed in an interactive session (read from the 2.1.283 code), so the form never leaves it unset. At `max` its prompt asks for ten finder angles, through subagents where it has them, then verification of each finding and a sweep for gaps |
| findings | at `low`, one `path:line — …` line per finding in the final message; at `medium`, a findings-tool call inside the forked task (`file`, `line`, `summary`, `short_summary`, `failure_scenario`, `category`; no severity) and the findings again in its final message in a shape of its own; at `xhigh` and `max`, a JSON array in the final message (read from the 2.1.283 binary, not run). Prose around the array may cite a location only when it names a filed finding's file and line; anything else outside the array fails the normalize and is read by hand |
| known findings | cannot be given: the argument parser reads the first word as the level and joins the rest into the target (read from the 2.1.283 code), so extra instructions would land in the review target |
| tool calls | not in the `-p` stream. `/code-review` runs as a forked task; its tool calls, and at `medium` its findings tool call, are in the task's output file under `/tmp/claude-<uid>/`, which the stream's `task_notification` names. The harvest copies that file into the run's logs |

Given no target, at `low` and at `medium`, it looked at the last commit alone first and
reached the whole change only because the branch list showed the target's default branch
(`trunk`), not by rule. Named `<BASE>...HEAD`, it ran one `git diff` of that range and
reported the planted bug at its line, in 2 runs of 2 (trial).

**codex's `codex exec review`.** The form is `codex exec review --base <BASE>` with its launch
form's flags (`--json`, `-o`, `-m`, `-c model_reasoning_effort="max"`, the bypass flag, and
`--skip-git-repo-check` in a detached scratch):

| | |
|---|---|
| command | `codex exec review --base <BASE> --json -o <last> -m <model> -c model_reasoning_effort="max" --dangerously-bypass-approvals-and-sandbox [--skip-git-repo-check]` |
| the change | `--base <BASE>`; codex takes a commit and computes the merge base itself, then the review thread runs `git diff` against the base commit |
| level | `-c model_reasoning_effort="max"` on every launch |
| findings | the `-o` message is `- [P<n>] <title> — <absolute path>:<start>-<end>` with a body; its session file holds the same findings structured (`review_output`: title, body, priority, confidence, file, line range) |
| known findings | a custom prompt is an alternative to `--base`; whether the two combine is untested. The form does not pass one |
| tool calls | in the `--json` stream (`command_execution`); the review thread's model, effort and prompt are in the rollouts under `~/.codex/sessions/YYYY/MM/DD/` |

Given no target it exits 1 before any model call: `Specify --uncommitted, --base, --commit, or
provide custom review instructions` (trial).

**MiMo Code's `/review`.** The form is its ordinary launch form with `--command review`, and
`<BASE>...HEAD` in the prompt file:

| | |
|---|---|
| command | the launch form with `--command review` and `--variant high`; the prompt file (stdin) holds `<BASE>...HEAD` |
| the change | `<BASE>...HEAD` in the prompt file. MiMo Code's arguments are free text, and `mimo run` appends its stdin to them (read from the 0.1.15 code), so the range rides in the prompt file, not as a bare argument. Its rules read a bare SHA as one commit (`git show <sha>`) |
| level | `--variant high`, the top of MiMo V2.6 Pro's variants (`low`, `medium`, `high`) |
| findings | free markdown in the final message; no severity or confidence fields |
| known findings | free text in the same arguments; the form carries the range alone so nothing else lands there |
| tool calls | a subtask's calls stream inline under the parent's session id. Its subtask launch fails in every run (`subagent_type build`, where only `explore` and `general` exist); the review runs because the model recovers |

Given no target it reviewed uncommitted changes, found none in a clean scratch, and exited 0
(trial). Named `<BASE>...HEAD` it reviewed the range and reported the planted bug at its line.

## Interactive form: the postmaster and a spec session

The postmaster is an interactive session (`SKILL.md` spawns it through `host.sh spawn`), and a
spec session is another (`postmaster.md`, Spec review): both run in their harness's bypass
mode, like every launch, named for their project or their ticket. The same table serves both.

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
there, and the user answers it in the pane. A fixture copy's postmaster runs headless
(`SKILL.md` step 8, `hosts.md` none), so it never meets the question. A row not checked here
takes its bypass flag from the headless form above; run it once before relying on it.

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

## Usage

`bun <tool>/scripts/usage.ts` is this file's executable form for what a launch cost: it reads the
input and output tokens each harness reports, and the cost where the harness reports one, from
the launch's own event stream or session record. A figure the harness did not report is omitted
and never written as zero; a harness that reports nothing is named as reporting nothing. Its
paired controls (`bun test <tool>/scripts/usage.test.ts`) are one made-up stream per harness
that reports usage and one that does not, in each harness's exact event shape below.

| harness | where it reports | input / output | cost | shape source |
|---|---|---|---|---|
| codex | the last terminal turn event (`turn.completed`, `turn.failed`, `turn.interrupted`) of `codex exec --json`; turns report cumulative session usage | `usage.input_tokens`, `usage.output_tokens` | not reported | [Codex event type](https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts), recorded turns |
| grok | the terminal `type: "end"` event; chunk-level usage is ignored | `usage.input_tokens`, `usage.output_tokens` | `total_cost_usd` on that event | [Grok headless event format](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md) |
| agy | the last `event: "result"` event; results report cumulative session usage | `result.usageMetadata.promptTokenCount`, `.candidatesTokenCount`, or `result.usage.input_tokens`, `.output_tokens` | not reported | Gemini-family usageMetadata, [Antigravity CLI headless mode](https://antigravity.google/docs/cli/headless/) |
| claude | the `result` events of `--output-format stream-json` (usage summed, cost from the last), else the assistant messages | `usage.input_tokens`, `usage.output_tokens` | `total_cost_usd` | [Claude Code stream-json output](https://code.claude.com/docs/en/agent-sdk/overview), a live resumed thread |
| pi | assistant `message.usage` on `message_end` | `input` / `input_tokens`, `output` / `output_tokens` | `usage.cost.total` | [Pi RPC event format](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md) |
| muse | the session record's `model_completed` events (`muse export`), not the event stream | `usage.input_tokens`, `usage.output_tokens` | not reported | a recorded `muse export` |
| mimo | each `step_finish` part of `mimo run --format json` | `part.tokens.input`, `part.tokens.output` | `part.cost` | [MiMo Code JSON mode](https://github.com/XiaomiMiMo/MiMo-Code) |

Codex and Antigravity figures are cumulative across the stream, so the last report carrying
a figure wins and summing would count every token twice. Claude's `result` usage is
per-invocation and is summed across the appended stream, while its `total_cost_usd` is
cumulative across the session and is taken from the last result; a stream that ends without
one falls back to summing its assistant messages. Mimo and pi per-step figures are summed.
Muse Code's `goal_usage_attribution` repeats its `model_completed` values per call, so the
reader takes `model_completed` alone.

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
