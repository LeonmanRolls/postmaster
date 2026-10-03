---
title: A change is reviewed on a page made for the phone, an artifact now and the dashboard later
type: concept
standing: claimed
sources: [trials/artifact-review]
updated: 2026-10-03
---

# A change is reviewed on a page made for the phone, an artifact now and the dashboard later

**Claim.** The user reviews a change best on a page laid out for the phone and the iPad, with the
ticket, the spec and what the change does beside the diff and the files as they stand. Comments
pinned to lines are useful there; checks, review findings and verdict buttons are not, and the
verdict belongs in the chat with the session. Such a page can be an artifact on claude.ai today,
built by the `review-pages` skill, and is to become a page of the dashboard ([[dashboard]]),
which only shows. A spec's code opens in the same kind of viewer, and its Markdown files as tabs
of the spec's document.

**Standing: claimed.** Trials on one machine with one user over two days, 2026-10-02 and
2026-10-03 [@trials/artifact-review]. No run has used a review page yet.

## Why

Reviews that need the user's eyes were offered as a code-server link: an editor on the machine,
opened on the branch. In the user's words, "code-server is not optimised for mobile, but it's
fine on ipad", and nothing in it reaches the session that waits for a decision. Most review now
happens at the spec stage ([[planning-stage]]); a change is reviewed when the user has switched
automatic merging off.

## What an artifact page can do for a review

| capability | tried | what came of it |
|---|---|---|
| comments that reach the agent | yes [@trials/artifact-review/spec-files/method.md] [@trials/artifact-review/decisions/method.md] | a comment on a line, sent to Claude; pinned to a line only once the page anchors on one line's element |
| a shared database | yes [@trials/artifact-review/decisions/method.md] [@trials/artifact-review/prototypes/method.md] | comments, choices and load times saved by the page, read and answered by the session, the answer shown live |
| a question put to the agent from the page | no | |
| who is viewing | no | |
| stored files | no | |
| a page saving new versions of itself | no | |
| a file given to the viewer | no | |

The five untried were skipped on the user's word on 2026-10-03, once the lasting review page was
to be a page of the dashboard. No negative control was run for the two tried; the type
definitions say an undeclared capability resolves `null` to the page (Claude Code 2.1.287's
artifact guide, runtime contract 0.2.45, read 2026-10-02), unverified here.

Limits met or read, with their source:

- A page and each text file published beside it: 16 MB (the Artifact tool's description,
  read 2026-10-02). #109's page carried 8.3 MB of data in six files and fetched one only when
  opened [@trials/artifact-review/prototypes/method.md].
- Libraries: scripts only from five CDNs, stylesheets only from Google Fonts. highlight.js from
  cdnjs coloured every page [@trials/artifact-review/spec-files/method.md].
- A database document: 256 KiB; documents per page: the tool reported 25,000, where the
  contract 0.2.45 guide says 5,000.
- A comment: 4 KiB of text (comments guide, read 2026-10-02).
- A Claude Docs tab: 32 KiB of text per connector call, or 1 MiB from an upload; an embed only
  of the document's own drawings, so a tab cannot hold another page
  [@trials/artifact-review/spec-files/method.md].
- Phone width: every page was laid out by window width; GitHub's own code view does not wrap long
  lines on the phone [@trials/artifact-review/spec-files/method.md].

## How a decision gets back to the session

[@trials/artifact-review/decisions/method.md]

- **Through the page's database**: a comment or a choice is saved with its lines and time. The
  session reads it when the user says they have acted, which the user's message makes minutes;
  its reply, written into the same store, shows under the comment without a reload.
- **Through claude.ai's comments**: while the session watches a page, Claude Code answers a
  comment sent to Claude on its own, within the minute, and tells the session afterwards. One
  such reply read a wrong anchor as the page's loading placeholder. Since 2026-10-03 the watch is
  stopped right after each publish (`AGENTS.md`), after a reply on another session's spec
  document landed where that session never saw it (unverified here).
- **Through the chat**: the verdict. It reaches the session at once.

When the session is not watching, a comment saved on the page shows under its line with its time,
and the page says the session reads it when told. Nothing answers in the meantime.

## The prototypes

Three review pages, for #145, #179 and #109 (1, 6 and 175 files)
[@trials/artifact-review/prototypes/method.md]. The largest was reviewable with its files in ten
groups in a reading order, every file folded and fetched when opened, and long files drawn 400
lines at a time; its index drew in under a second on the iPad. The user shaped the page in four
versions to tabs for the ticket, the spec, the summary, the diff and the files, and asked for it
to be built, then to be replaced by a version that does not depend on Claude Code.

## What may go on a published page

A published page goes to an outside service, which may keep a copy after a delete. A page holds:

1. nothing the commit check of #216, "The private-data check is TypeScript run by Bun, and flags
   little of the project's own code", refuses: personal data and secrets;
2. no credential and no configuration value, from `~/.config`, `~/.claude`, `~/.postmaster` or an
   env file;
3. no home path, host name, tailnet name or private address, and no link to this machine;
4. no email address outside the reserved example domains (the `review-pages` builder replaces
   them, line numbers unchanged);
5. nothing private to a run's records but the approved spec.

Every page stays private to the user's account unless the user says otherwise, an agent shares
none, and deleting one is the user's call. Each page is read whole before its first publish, and
no page's link is recorded in a repository. A script to refuse these cases before a publish is a
proposed ticket of #214.

## Where a review page fits

- **It replaces** reviewing a change in code-server on the phone. On the iPad code-server stays
  usable, and **editing stays in code-server**.
- **The spec review pages of #211** are Claude Docs documents the user edits: another page type.
  A spec's Markdown files go in as tabs of that document, and its code in the same code viewer
  the review page uses for its files.
- **Pages for a review-round decision** are not a page type of their own: the user takes those
  decisions in the chat, and does not want findings on the change page. A round's findings
  belong on the dashboard's run page (#147).
- **The dashboard of #126** is where the review page goes to last, as the change view of a
  run's page: read-only, with a tap on a line copying a reference for the chat instead of saving
  a comment, since anything a page could save, an agent running as the user could save too. The
  user chose it on 2026-10-03 over an app of its own that takes comments. Its design is settled
  first, by #238's prototypes.

**Recommendation.** Use the `review-pages` skill now, for a change the user reviews and for a
spec's files; build the dashboard's change view once #146 and #147 stand, in #238's design;
keep verdicts and decisions in the chat. **What would change it**: Claude Code waking the
session itself, with its own context, for each comment, which would let a page take decisions;
#238's design choosing otherwise; or the user wanting comments on the dashboard, which needs a
way to tell their input from an agent's.

## Open

- How a review page reads at phone width for a change of a thousand lines or more: no load was
  recorded there.
- How often a session would have to look to catch a comment the user did not announce.
