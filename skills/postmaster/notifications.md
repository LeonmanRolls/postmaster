# Notification channel: Telegram

Once set up, the user gets a short Telegram message when something needs them
or a run lands, and none for anything else. This file is where the channel's
facts live; the flow reaches it through one script,
`<tool>/scripts/run notify`. `<tool>` is the postmaster repo, as the runbook
that sent you here found it.

**Off until set up.** With no `[notify]` table, or `channel = "none"`, the flow
behaves as today: nothing sends, nothing is asked, and no setup step fails for
it. A person's project settings may switch messages off for that project alone.

## What sends

- **The watcher's scan**, on every look, where messages are on: one request
  with a line per thing that came up — a run's waiting question, a ship card
  that awaits the user's word, a lane on its provider's usage limit, a run
  that landed. Held runs are read too: a hold stops the watcher's steps, not
  the user's messages. Things that came up together go in one message, a line
  each; no reminders, and no message for anything else (D2).
- **The booking clerk**, once per ticket, when its draft is first ready.
- **The test message**, `notify test`, which confirms setup.

A message holds only what came up, the project's name, the ticket's number and
title, where to answer when one is needed (the postmaster's session for a run,
the clerk's session for a draft; a landing names none), and for a usage limit
the lane and its reset in the machine's time zone. No link, no path, no record
text, no provider message. A tracker of kind `other` has no title to read, so
its messages carry the number alone.

## Configuration

```toml
[notify]
channel = "telegram"
env_file = "~/.postmaster/telegram.env"
```

The token and the chat live in the user's own file, refused when it sits in a
repository or others can read it:

```
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_CHAT_ID=<chat>
```

The file is read by `run notify` itself, never through argv or the environment,
and every error is redacted before it is printed or recorded. `setup` asks for
these messages and the file, which the user writes themselves; `notify test`
confirms them. Where the machine limits network hosts, the user allows
`api.telegram.org`; the flow never changes which hosts a machine allows.

For tests only, the file may name `TELEGRAM_API_ORIGIN=http://127.0.0.1:<port>`.
Any other origin is refused, so a stray setting cannot send the token
elsewhere.

## Records and failures

Every message sent is logged through `run log-action` as `notify`, with its
kind, its ticket and the text sent. What a run has been messaged is read back
from those lines; what predates messages is the run's `.notify-state.json`.
A send that fails leaves its events unsent for the next look, until they go or
are no longer needed. The first failure is written once to the watcher's
`watch.err` and once to the watched root's ledger, and nothing more until a
send succeeds; the postmaster tells the user once when it reads that failure.
A failure never stops or holds up a run or a clerk.

## Telegram specifics

One `POST` per message to `/bot<token>/sendMessage` on `https://api.telegram.org`,
`{ chat_id, text }` as JSON, plain text with no parse mode so a title is never
read as markup. A message is capped at 4096 characters; past that the lines
are cut and the message says how many more there are. Each send has a few
seconds of patience. The bot only sends; answers stay in the sessions and on
the page of open decisions.
