## Problem / feature
Spec reviews happen in a shared Claude Docs document (#211). The user also wants to open the files a spec links to: scripts, runbooks and files that exist only in a run's worktree. #214 tried three ways on the user's phone on 2026-10-02. GitHub links land on the lines but do not wrap long lines, take no comment on a line, and cannot show a file that exists only in the worktree. A tab of the spec's document shows a Markdown file well, and code without colour. A viewer page with the files published beside it shows code in colour, at the linked lines, and takes a comment on a line. The user's choice: Markdown files as tabs of the spec's document, and code files in one viewer page linked from the spec.

## Acceptance criteria
1. The spec session adds a tab to the spec's document for each Markdown file the spec names, placed whole by upload, so the tab holds the file's text exactly. Check: each tab's block hash equals the SHA-256 prefix of its file's text, and the spec links each tab with a tab chip.
2. The code files the spec names go in one viewer page, published with the files beside it, which shows each in colour with line numbers, wraps long lines, and opens at the lines a link names. The spec links each file at the lines it cites. Check: a link naming lines other than the page's default opens the page at those lines.
3. A comment on a line in the viewer page is pinned to that line and starts with the file and the lines, and the session reads it when the user says they have commented, having stopped its watch on the page right after the publish. Check: a saved comment's anchor names its line, and its text starts with the file and the lines.
4. The document's tabs and the viewer page pass the published-page check before they are published. Check: the spec session's runbook names the check before each publish.

## Direction
Extend the spec session's brief and runbook (`skills/postmaster/spec-session.md`, `scripts/spec-session.ts`); any script is TypeScript run by Bun, with its tests beside it. The files are copies at the spec's commit. The viewer page's template lives in the repository, reusing #214's trial page (`raw/trials/artifact-review/spec-files/apparatus/viewer.html`). Every page stays private to the user's account.

## Turnpikes
default

## Notes
The user's words on 2026-10-02 and 2026-10-03, in #214's session: "the tab is great for md files. not so much for code", "the viewer looks great", and "I prefer the doc tab for md files". Depends on the published-page check. Related: #211, #214, #229.
