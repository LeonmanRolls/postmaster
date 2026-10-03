---
kind: trial
subject: three ways to open the files a spec links to, judged on a phone - GitHub links pinned to the base commit, a tab per file in the spec's Claude Docs document, and an HTML viewer page published with the files
date: 2026-10-02
---

# Method

**Question.** Asked by the postmaster for #214 on 2026-10-02, from the user: spec reviews now
happen in a shared Claude Docs document, and the user also wants to open the files the spec
links to, scripts, runbooks and files that exist only in a run's worktree. Does that need a
custom web app? Three lighter routes were tried and judged on the user's phone: (1) GitHub
links pinned to the run's base commit; (2) one tab per file in the spec's own document, linked
from the spec by a tab chip; (3) an HTML page that publishes the files beside itself and shows
them in a viewer. For each: syntax colour, landing on the linked lines, a comment on a line,
and the size it takes.

**Versions.** Claude Code 2.1.287, whose bundled artifact guides describe runtime contract
0.2.45; the viewer page was stored at contract 0.2.66. The Claude Docs connector and its
guides as served on 2026-10-02. highlight.js 11.11.1 from cdnjs. The user's phone, an Android
phone with Chrome. The iPad was not tried.

**Content.** A made-up spec for #179, "A workhorse shows every acceptance criterion working,
and keeps at it until it can", which merged as pull request 213, labelled as made up on the
page. It links five files of this repository: `skills/postmaster/coachman.md` (1283 lines,
95,591 bytes), `skills/postmaster/workhorse-spec-template.md` (59 lines) and
`docs/coachman-contract.toml` (93 lines) at the pull request's base `faf1873`, and
`scripts/summary-evidence.ts` (438 lines, 18,558 bytes) and `scripts/summary-evidence.test.ts`
(590 lines, 23,554 bytes) at its head `c84220e`, standing in for files that exist only in a
run's worktree. Each file was read whole before it was published.

**What was published.** Two pages, private to the user's account and shared with no one:

1. A Claude Docs document made from the Docs type. Its spec tab carries the spec and a table
   giving each file three ways to open it. Three more tabs were each filled by uploading a
   file to the document and placing it whole in one connector call
   (`apparatus/tab-sources.sh`): `summary-evidence.ts` as a code block tagged `ts`, the spec
   template as a code block tagged `markdown`, and the runbook as Markdown, which the document
   renders.
2. An HTML page, `apparatus/viewer.html` as its version 2 stands. It fetches the files
   published beside it, colours them with highlight.js, numbers the lines, wraps long lines
   unless told not to, opens at `#f<n>-L<a>-L<b>`, and selects a line, or a range with a second
   tap. Version 1 held all five files and the composer-only comments capability, and its
   "Comment on these lines" opened claude.ai's own comment box on a range from the first chosen
   line to the last. Version 2 holds the three code files and the full comments capability:
   its own box anchors the comment on the first chosen line (`anchorFor`) and sends it to
   Claude (`sendToClaude`), the text starting with the file and the lines.

**Controls.**

- GitHub at the base (`results/github-at-base.txt`): the three files on main are there; both
  worktree files answer 404.
- The document's code tabs hold the files byte for byte (`apparatus/hash-check.py`,
  `results/hash-check.txt`). A connector read prints `h` for each block, the first 8 hex of the
  SHA-256 of its text: the empty paragraph a new document starts with read `e3b0c442`, the
  SHA-256 of nothing (positive control). Each code block's `h` equals its file's without the
  final newline; the same file with one byte changed does not (negative control).
- A document tab holding another page: an embed naming the viewer page was refused, and
  nothing landed (`results/doc-and-comments.txt`). The connector's guide documents one embed,
  a node of the same document.

**What the user did and said, on the phone.**

- GitHub: the link to the spec template's lines 10-55 opened in the browser on those lines,
  highlighted and in colour. Long lines did not wrap: about 40 characters of each line showed,
  the rest behind a sideways scroll. "for some reason those links open in a way that doesn't
  display well on mobile". Their screenshot is not kept.
- The document's tabs: "the tab is great for md files. not so much for code", and "code tab
  has no syntax highlighting".
- The viewer page, opened from a link ending `#f4-L304-L324`: "the viewer looks great".
  Whether the link's `#f4-L304-L324` reached the page is not shown: version 2 opens at the same
  lines when no link names any.
- Comments, each sent to Claude (`results/doc-and-comments.txt`): one from version 1, anchored
  on the box that holds the whole file rather than the lines, and two from version 2, anchored
  on line 304 with `scripts/summary-evidence.ts, lines 304–324` at the head of their text. Each
  had a reply in the same minute that Claude Code posted on its own, as it does when the
  session's permission mode needs no approval for it, and this session was told by a task
  notification at its next turn.

**Not tried.** The iPad; a comment on one line of the document's code tab; GitHub's own app;
the GitHub link without `?plain=1` that the spec tab offers as a control; a viewer link naming
lines other than the page's default.

# Results

| route | colour | lands on the linked lines | a comment on a line | a file only in the worktree | size |
|---|---|---|---|---|---|
| GitHub link at the base commit | yes | yes; a Markdown file needs `?plain=1` | no | no, 404 | not reached |
| a tab per file in the document | Markdown renders; code shows no colour | the chip opens the tab at its top | not tried | yes, uploaded | 1 MiB per uploaded file; 32 KiB per call when typed |
| viewer page with the files | yes | not shown: the page opened at its default lines, which the link also named | yes, after version 2 | yes, published with the page | 16 MB per file |

The size limits are the guides' own, read on 2026-10-02: the Claude Docs connector's
`refusal.row_too_large` for the document, and the Artifact tool's description for the page.
The `?plain=1` rule is GitHub's, from "Creating a permanent link to a code snippet", retrieved
2026-10-02.

- **Version 1's line comment lost its lines.** A range across lines degrades to the element
  that holds them, as the comments guide says of a selection the platform cannot quote, and the
  comment tool resolved that anchor against the published source, where the box holds only the
  loading placeholder. The automatic reply read it as the placeholder and told the user to use
  the button they had used. Version 2 anchors on one line's element, whose id names the file
  and line, and writes the file and lines into the comment.
- **The upload road places a file exactly.** The document took the 95,591-byte runbook in one
  call and rendered it: its 18 headings and 4 tables, and the heading-like lines inside one of
  its fences kept as code.

# What it settles

Facts about these services on 2026-10-02, judged on one Android phone. A link to GitHub cannot
show a file that exists only in a run's worktree, takes no comment on a line, and on this phone
does not wrap long lines. A Claude Docs tab shows a Markdown file well and code without colour,
and cannot hold another page. A page that publishes the files beside itself shows code in
colour and carries a comment on a line to Claude, once the page anchors on one line and names
the lines in the comment. It does not settle whether a link from the spec reaches a chosen line
in that page, anything about the iPad, or how such pages behave with a real run's files.
