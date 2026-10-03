---
name: review-pages
description: Show the user a change, or code named by a ticket, on a private claude.ai page made for a phone and an iPad. A review page has tabs for the ticket, the change's summary, the diff and the files as they stand, and takes comments on lines that the session reads and answers. A code viewer shows ticket-linked files in colour at cited lines. Use it when the user reviews a change with automatic merging off, or opens files named in a ticket. Claude Code only, until the dashboard shows changes.
---

# Review pages

Two pages the user shaped in #214: a **review page** for a change, and a **code viewer** for code named by a ticket. Both are private artifacts that only Claude Code can publish. `<tool>` is the postmaster repository: the folder two above this file once its link is resolved. Run the builder from the repository the change belongs to.

## A review page for a change

1. Build its data into a folder of your scratchpad:
   - A pull request: `bun <tool>/scripts/review-page.ts change <dir> --pr <number>`. The builder reads the pull request, its ticket and the change.
   - A run's branch before its pull request: `bun <tool>/scripts/review-page.ts change <dir> --base <base> --head <branch> --ticket <n> --summary <file>`. The summary is what the ship card says the change does.
   It prints one line with the files, lines and chunks, and how many email addresses it removed.
2. Before the first publish, read `review.json` and search the chunks for home paths, host names, private addresses and anything private. The builder removes email addresses and nothing else; publish nothing private.
3. Publish `<dir>/index.html` with the Artifact tool, `capabilities: {"db": {}}`, and `files` mapping `review.json` and each `chunks/<k>.json` to their paths. Then, at once, stop the watch on it (ArtifactComments, `action: watch`, `on: false`), as `AGENTS.md` says.
4. Give the user the link as `https://claude.ai/code/artifact/<uuid>`: read `review.json` back with the Artifact tool's `read` and `path`, and take the uuid from the folder it is saved in.
5. When the user says they have commented, read the comments: ArtifactData `list` of the collection `comments`. Each has `path`, `side` (`new` or `old`), `from`, `to`, `text` and `at`. Answer each one on the page with ArtifactData `set` in `comments`, `doc_id` `reply-<its id>`, data `{replyTo, path, side, from, to, by: "claude", text, at}`; the reply shows under the comment without a reload. Then act on what they asked in the conversation.
6. The verdict comes in the chat. The page has no verdict control and shows no checks or review findings, by the user's choice.

## A code viewer for ticket references

1. Markdown files named in the ticket's technical notes go in the Claude Docs document as tabs, placed whole by Claude Docs `set` in the `docs` collection, `doc_id` `file-<path>`, data `{path, lang, text}`. Keep `path` repo-relative.
2. Make the document's `index.html` from the template's `## Files` section. Keep its renderer, styles and scripts, and replace only the file list. All Markdown files are already tabs; the index tab is added automatically.
3. Publish with `capabilities: {"docs": {}}` and `files: [{path: "index.html", code: "<!DOCTYPE html>…"}]`. Read the document's id and present `https://claude.ai/code/artifact/<uuid>`.
4. Link each cited file at its cited lines, for example `https://claude.ai/code/artifact/<uuid>#/file/src/main.ts#L18-L27`. Tell the user which ticket references the page.

## The change, in the code viewer

1. Build it with `bun <tool>/scripts/review-page.ts files <dir> <ref> <path>...`; use only paths and lines the ticket names.
2. Publish `<dir>/index.html` with the Artifact tool, `capabilities: {"db": {}}`, and `files` mapping `files.json` and every `files/<k>.txt`. Stop its watch at once.
3. Give the user the artifact link and the ticket reference.
