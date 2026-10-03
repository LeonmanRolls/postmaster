---
kind: trial
subject: what an artifact page on claude.ai can do for reviewing a change, tried page by page for #214
date: 2026-10-02
---

# Method

**Question.** Issue #214 asks what a code review in an artifact page looks like, whether it can
replace reviewing in code-server, and what it would take to build. Each trial in this folder
publishes a small page, tries one thing for real, and records what came back. Each has its own
`method.md`.

**Versions.** Claude Code 2.1.287. Its bundled artifact guides, read on 2026-10-02, describe
runtime contract 0.2.45: `artifact-capabilities` (the capability list and the type definitions
under `0.2.45/`) and `artifact-design` (the page contract). New pages were stored at contract
0.2.66. The Claude Docs connector's guides (`topic.index`, `topic.tabs`, `topic.editing`,
`topic.comments`, `topic.uploads`, `topic.diagram`, `topic.charts` and the `refusal.*`
entries) as it served them on 2026-10-02. Claude Code's own page on artifacts,
<https://code.claude.com/docs/en/artifacts>, retrieved 2026-10-02.

**What may be published.** Every page holds public text only: this repository's merged pull
requests, their diffs and checks, and made-up examples labelled as examples where the text has
none. No page holds a credential, a home path, a host name, a link to this machine or an
address. Every page is private to the user's account and shared with no one. Each page was read
whole before its first publish. A trial records what was published and what happened, never
where: no page's link is kept here.

**The user** judges each page on their phone and iPad and says what worked. Their words are
quoted; their screenshots are not kept.

# Trials

| folder | what it tries |
|---|---|
| `spec-files/` | three ways to open the files a spec links to, on a phone: GitHub links, tabs in the spec's Claude Docs document, and an HTML viewer page published with the files; line comments sent from the viewer |
