---
name: review-pages
description: Show the user a change, or code named by a ticket, on a private claude.ai page made for a phone and an iPad. A review page has tabs for the ticket, the change's summary, the diff and the files as they stand, and takes comments on lines that the session reads and answers. A code viewer shows ticket-linked code files in colour at the lines the ticket cites. A story page tells a finished change, or a ticket, as one scroll: the change drawn first, then shown in code beside the ticket's words. Use it when the user reviews a change with automatic merging off, or opens files named in a ticket, and to tell a finished change in the order of the ticket's criteria. Claude Code only, until the dashboard shows changes.
---

# Review pages

Two pages the user shaped in #214 ("Research: review a change in an artifact page instead of in
code-server"): a **review page** for a change, and a **code viewer** for code files a ticket names.
Both are private artifacts that only Claude Code can publish. `<tool>` below is the postmaster
repository: the folder two above this file once its link is resolved. Run the builder from the
repository the change belongs to.

## A review page for a change

1. Build its data into a folder of your scratchpad:
   - a pull request: `<tool>/scripts/run review-page change <dir> --pr <number>`. The title,
     its text as the summary, and the ticket it names (`#<n>, <title>`) come from GitHub.
   - a run's branch before its pull request: `<tool>/scripts/run review-page change <dir>
     --base <base> --head <branch> --ticket <n> --summary <file>`, the summary
     being what the card says the change does.
   It prints one line with the files, lines and chunks, and how many email addresses it removed.
2. Before the first publish, read `review.json` and search the chunks for home paths, host
   names, private addresses and anything private. The builder removes email addresses and
   nothing else; publish nothing private.
3. Publish `<dir>/index.html` with the Artifact tool, `capabilities: {"db": {}}`, and `files`
   mapping `review.json` and each `chunks/<k>.json` to their paths. Then, at once, stop the watch
   on it (ArtifactComments, `action: watch`, `on: false`), as `AGENTS.md` says.
4. Give the user the link as `https://claude.ai/code/artifact/<uuid>`: read `review.json` back
   with the Artifact tool's `read` and `path`, and take the uuid from the folder it is saved in.
5. When the user says they have commented, read the comments: ArtifactData `list` of the
   collection `comments`. Each has `path`, `side` (`new` or `old`), `from`, `to`, `text` and
   `at`. Answer each one on the page with ArtifactData `set` in `comments`, `doc_id`
   `reply-<its id>`, data `{replyTo, path, side, from, to, by: "claude", text, at}`; the reply
   shows under the comment without a reload. Then act on what they asked in the conversation.
6. The verdict comes in the chat. The page has no verdict control and shows no checks or review
   findings, by the user's choice.

## A code viewer for a ticket's files

1. Markdown files the ticket names go in the ticket's Claude Docs document as tabs, placed whole by
   upload so the text is exact: upload each file to the document's artifact (Artifact `publish`
   with `url`, `asset: true`), create a blob from it in the document, and fill a new tab from
   the blob; the Docs connector's `topic.uploads` and `topic.tabs` say how. Link each tab from
   the ticket with a tab chip.
2. Code files go in one viewer: `<tool>/scripts/run review-page files <dir> <ref> <path>...`
   writes `index.html`, `files.json` and `files/<k>.txt`. Read them as step 2 above says, then
   publish `index.html` with `capabilities: {"comments": {}}` and `files` mapping `files.json`
   and each `files/<k>.txt`, and stop the watch at once.
3. Link each file from the ticket at the lines it cites:
   `https://claude.ai/code/artifact/<uuid>#f<k>-L<a>-L<b>`, where `f<k>` is the file's `id` in
   `files.json`.
4. A comment from the viewer is pinned to its first line and starts with the file and the
   lines. When the user says they have commented, read it with ArtifactComments `read`.

## A story page for a ticket

1. Write the story beside the ticket: a `story.json` naming the sections (the opening, one
   per acceptance criterion, the end), the scenes (the picture; the ticket's text, as
   excerpts or whole; a drawing per part with named states; code and Markdown files at the
   ticket's base with the cited lines lit; the list of cited code no step shows) and the
   steps (a title, two to four sentences, the scene, what it lights, and whether the
   ticket's words show as an excerpt), with each drawing as an SVG beside it. Draw the
   mechanism, not its name; label the arrows; keep text at 11 to 13 pixels in a view box
   about 360 wide; take every colour from the page's tokens; give each drawing a caption.
   The opening's image scene names the picture's prompt file, which asks Codex's image
   tool for one picture saved as `picture.png`, in the style of `<tool>/docs/poster.jpg`,
   with the exact words of every ribbon.
2. Build it: `<tool>/scripts/run story-page build <repo> <story-dir> <dir>
   --ticket-body <ticket.json>`, where `ticket.json` holds the ticket's title and body
   (`gh issue view <n> --json title,body` writes it) and `<repo>` is the repository the
   ticket cites. The builder draws the picture through `<tool>/scripts/run story-picture`
   with the postmaster poster as its style; each picture counts against the Codex limit
   the Codex lanes use. It refuses a section that shows code before any drawing, a state
   the story does not declare, and a link at another commit, and writes `index.html`,
   `sheet.html` and the picture file only when every check passes.
3. Look at the picture, its lettering included, in the picture file beside the page, and
   at every drawing in every state in `sheet.html`, at phone width in light and dark,
   before publishing. Rebuild, for a newly drawn picture, if a word comes out wrong.
4. Read `index.html` back for home paths, host names, private addresses and anything
   private, as step 2 of the review page says: the builder removes email addresses and
   nothing else.
5. Publish `index.html` as one file with no capabilities (`{}`), and no files beside
   it — the picture and the data are inline — then stop the watch on it at once, as
   `AGENTS.md` says.
6. The page is for reading: it takes no comments and has no verdict. The user answers in
   the chat and edits the ticket in its document, as now.

## A story page for a finished change

The change drawn first, then shown in code: one scroll from an opening through a section per
acceptance criterion to what is left out, with the ticket's words, a drawing or the code in the
panel beside each step. Build it for a change that is verified and not yet pushed, or already
merged. The review page stays the place for comments on lines.

1. Write the story in a folder of your scratchpad:
   - `ticket.md`: the ticket's signed-off text, cut before the pipeline's own sections.
   - `diagrams/<name>.svg`: one drawing per part, with named states. Draw the mechanism, not
     its name; label the arrows; keep text at 11 to 13 pixels in a view box about 360 wide.
     Classes: `dg` on the svg, `bx`, `t1`, `t2`, `t3`, `mono`, `ok`, `bad`, `ln`, `dash`,
     `ah`. `on-<state>` shows an element only in that state, `hl-<state>` lights it,
     `dim-<state>` fades it; every state a class names is declared in the scene.
   - `story.json`: `title`, `ticketLabel`, `ticketTitle`, optionally `ticketUrl`, `eyebrow` and
     `footer` (the closing line; the default is written for the user who asked for the page and
     points comments to the chat, so set it, and the eyebrow, for a page that others will read); `base` and `head`, the commits the change is read between; `sections` (`id`,
     `label`, `title`: the opening, one per criterion, the tests, the end); `scenes`; `steps`.
   - Scenes, each with an `id`: `{kind: "doc", from: "file", file, title, label, chip}` for
     the ticket; `{kind: "diagram", svg, states, label, chip, caption}`; `{kind: "head", file,
     from, to}` for a file as it stands at the head, its changed lines marked; `{kind: "base",
     file, from, to}` for a file as it stood at the base; `{kind: "leftovers", label, chip}`
     for the list of changed lines no step shows.
   - Steps: `id`, `section`, `scene`, `title`, `text` of two to four sentences, and what the
     scene needs: `focus` as `[from, to]` line ranges lit in a code scene, `marks` as `{line,
     text: [words]}` on a lit line, `find` as ticket strings lit (each in exactly one block
     of the ticket), `state` for a diagram. The first step has `kind: "title"`; a step that
     opens a criterion has `kind: "criterion"`. The last step shows the leftovers scene, and
     its text may use `{shown}`, `{changed}` and `{left}` for the counts.
2. Check it: `<tool>/scripts/run story-change check <repo> <story-dir>`. It names every
   problem at once: a mark not on its line, a focus outside its window, a state a drawing does
   not declare, a ticket string in no block or in two, a changed line no step shows and no list
   holds. Fix them and run it again until it prints its one line.
3. Build it: `<tool>/scripts/run story-change build <repo> <story-dir> <dir>`. It writes
   `index.html`, `preview-light.html` and `preview-dark.html` only when every check passes, and
   prints the steps, lines and email addresses it removed.
4. Look at the page, not only the data: the two previews at desktop and phone width, in light
   and dark, with every drawing in every state. Nothing scrolls sideways, the fonts load and the
   console is clean.
5. Read `index.html` back for home paths, host names, private addresses and anything private, as
   step 2 of the review page says: the builder removes email addresses and nothing else.
6. Publish `index.html` as one file with no capabilities (`{}`), then stop the watch on it at
   once, as `AGENTS.md` says, and give the user the link as step 4 of the review page says.
7. The page is for reading: it takes no comments and has no verdict.

## Never

- Share a page, or publish one that holds a credential, a home path, a host name, an email
  address, a link to this machine, or a value from `~/.config`, `~/.claude` or `~/.postmaster`.
- Delete a page without the user's word.
- Record a page's link in a repository.
