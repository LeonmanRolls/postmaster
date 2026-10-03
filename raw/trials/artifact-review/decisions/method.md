---
kind: trial
subject: how a decision the user makes on a page gets back to the session - a comment on a line, a choice among options, and a verdict - and what the user sees when the session is not watching
date: 2026-10-03
---

# Method

**Question.** #214's criterion 2: for a comment on a line of the diff, a verdict (approve,
changes, ask) and a choice among options, what reaches the session, how, and how long after the
user acts; and what the user sees when the session is not watching.

**Versions.** Claude Code 2.1.287, in bypass permission mode; pages at runtime contracts 0.2.66
(the viewer page of `../spec-files/`) and 0.2.67 (the review page of `../prototypes/`).

**Two ways in.**

- **Claude.ai's comments.** The viewer page of `../spec-files/` declared the comments capability.
  Version 1 opened claude.ai's own comment box on the lines chosen; version 2 wrote the comment
  from the page's own box with `anchorFor` on the first chosen line and `sendToClaude`, its text
  starting with the file and the lines. While this session watched the page, Claude Code
  answered each comment sent to Claude on its own and told the session afterwards.
- **The page's database.** The review page of `../prototypes/` declared the database
  capability. A comment, with its file, side, lines, text and time, and a choice on a finding
  were saved there by the page. The session read them with the `ArtifactData` tool when the user
  said they had acted, and wrote its reply into the same collection, where the page showed it
  under the comment. No watch was kept on this page: from 2026-10-03 the user's rule, now in
  `AGENTS.md`, is to stop the watch right after each publish.

Times are as each tool printed them, in UTC: a comment's own time from the page's clock, and
the store's `updatedAt` beside it.

# Results

| action | way in | the user acted | the session received | between |
|---|---|---|---|---|
| comment on lines 304–324 (viewer, version 1) | claude.ai's comments, sent to Claude | 2026-10-02 23:24 | an automatic reply in the same minute; a task notification at the session's next turn | under a minute to the reply |
| comment on lines 304–324 (viewer, version 2) | claude.ai's comments, from the page's own box | 23:52, and again at 23:53 | the same, for each | under a minute to each reply |
| comment on line 946 of `scripts/host.sh` (review page) | the page's database | 2026-10-03 04:52:48 | read at 04:57, when the user said "ok I've done that" | 4 min 38 s, which is the user's own message |
| choice "Accept as is" on example finding F1 (review page) | the page's database | 04:52:27 | read at 04:57, with the comment | 5 min |
| the session's reply to the comment | the page's database, written by the session | written at 04:58:00 | shown under the comment without a reload; the user confirmed by 04:59 | under 2 min |
| verdict on #145 | the chat with the session | 05:04, "I think it's okay to merge now." | at once: the message is the session's turn | none |

- **What came back through claude.ai's comments.** Each comment's text, its author as "the user
  (owner)", "sent to you", and its anchor as a path into the page. Version 1's anchor was
  `#code > div:nth-of-type(1)`, the box holding the whole file: a range across lines falls back to
  the element around it, as the comments guide says of a selection it cannot quote, and the comment
  tool read that path against the published source, where the box holds only "Loading the file…".
  The automatic reply took the anchor for that placeholder and told the user to use the button
  they had used. Version 2's anchor was `#f4-L304`, the first chosen line, and its text named
  the file and the lines.
- **What came back through the database.** Each document whole, with the page's own fields and
  the store's version and time. Nothing told the session that a document had arrived.
- **The verdict.** The page's verdict bar was removed before it was used: the user gives verdicts
  in the chat with the session.

**What the user sees when the session is not watching.** On the review page, a saved comment
shows under its line at once with the time it was saved, and the bar at the bottom says "Comment
saved 04:52. Claude reads it when you tell your session." Nothing more happens until the user
tells the session, and nothing answers in the meantime. With claude.ai's comments and the watch
on, a reply appeared within the minute, written by Claude Code on its own while the session was
not in a turn; the session learned of it only afterwards.

# What it settles

Facts about these tools on 2026-10-02 and 2026-10-03, in bypass mode. A decision made on a page
reaches the session only when the session reads it: through the database when the user says
so, or through claude.ai's comments while a watch answers on its own. An automatic reply can come
before the session has seen the comment, and once read a wrong anchor as a loading placeholder.
The chat stays the one channel that reaches the session at once. It does not settle how often a
session would need to look to catch a decision the user did not announce.
