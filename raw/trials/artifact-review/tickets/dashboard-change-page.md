## Problem / feature
#214 found that the user reviews a change best on a page made for the phone and the iPad, and the user chose on 2026-10-03 that the lasting version is a page of the dashboard (#126), which only shows, rather than an app of its own that could take comments: any agent on the machine runs as the user and could post a comment that looks like theirs. Until it exists, a review page is published as an artifact. The dashboard's run page (#147) shows a run's cards and timings, but not its change.

## Acceptance criteria
1. A run's page on the dashboard has a change view with tabs for the ticket, the spec, the change's summary, the diff and the files as they stand at the head. On a wide screen the ticket, spec and summary sit beside the diff and files, and the layout follows the window's width at the widths #146 names. Check: it opens at phone width with no sideways scroll, and from 700 CSS pixels shows the two columns.
2. A tap on a line, or a second tap for a range, copies a reference to paste into the chat: the file, the line numbers and the lines' text. The page writes nothing anywhere. Check: the copied text names the file, the lines and their text, and the change view makes no request that changes anything.
3. A large change stays readable: files are grouped in a reading order, folded when there are many, and loaded only when opened; a long file is drawn in slices. Check: with #109's merged change (pull request 215, 175 files), the change view's list shows on a phone before any diff is loaded, and opening a file loads only that file.
4. Everything shown comes from the flow's records and git, read through the scripts that already read them, and is escaped, as the dashboard's rules in `wiki/concepts/dashboard.md` say. Check: the change view's data comes through one script with a `--json` form and its tests.

## Direction
Build on #146 and #147, with the dashboard's rules, and on the design #238 settles. Reuse the review page's layout from #214 and from the stopgap review page, so the user meets the same page. Read-only: the verdict and any comment go through the chat with the session.

## Turnpikes
default

## Notes
The user's word on 2026-10-03, in #214's session: "we can file a ticket to make this into something that is not dependant on claude code harness, so a standalone webapp", then choosing a page of the dashboard. Depends on #146 and #147. Related: #126, #214, #238.
