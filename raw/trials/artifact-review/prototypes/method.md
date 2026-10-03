---
kind: trial
subject: prototype review pages, published as private artifacts, for three merged pull requests of different sizes, shaped with the user on a phone and an iPad
date: 2026-10-03
---

# Method

**Question.** #214's criterion 3: what a review page published as an artifact looks like for a
change of a few dozen lines, one of about a thousand, and the largest available, and whether the
largest can be reviewed that way.

**Versions.** Claude Code 2.1.287; pages stored at runtime contract 0.2.67; highlight.js 11.11.1
from cdnjs. The user's phone (Android, Chrome) and iPad.

**The changes**, chosen with the user on 2026-10-03, all merged, so all public:

| ticket | pull request | files | lines added and removed |
|---|---|---|---|
| #145 | 152 | 1 | +89 −5 |
| #179 | 213 | 6 | +1,142 −13 |
| #109 | 215 | 175 | +70,399 −30,561 |

**The builder.** `apparatus/make-review.py <pull request> <extras.json> <out-dir>` reads the
pull request and its ticket through `gh api`, diffs the head against its merge base as GitHub
does, and writes `review.json` and `chunks/<k>.json` (each file's diff and its text at the head,
at most about 1.5 MB a chunk). Its totals are held to the API's: each `check.txt` reads `match`.
It replaces every email address outside the reserved example domains with `<address removed>`,
line numbers unchanged: 0 for #145, 1 for #179 and 28 for #109, most of them test fixtures.
`apparatus/extras-<pull request>.json` holds what the pull request's text does not: the made-up
example spec for each, two made-up example findings for each, and #109's reading order. None of
the three pull requests carries a spec in its history.

**The page.** `apparatus/review-page.html`, the template all three pages used, as it stood at
version 4 of #145's page. How it changed, by the user's word:

1. Version 1: an overview with the checks from the pull request's text, the example findings
   with three choices each, and a verdict bar (approve, changes, ask); views for the diff and for
   the files as they stand; a comment on a line saved in the page's database.
2. Version 2: the verdict bar removed. "we don't need the approve changes and ask buttons because
   these are done via chatting with the session".
3. Version 3: tabs for the ticket and the spec added, the checks and findings folded away. "I
   don't think having checks or review findings are useful. I think having the original ticket
   text and the spec as tabs would be useful."
4. Version 4: the pull request's description moved beside the ticket and the spec. "That “what
   the change does” is good, it can be another section on the side next to the ticket and the
   spec."

#179's and #109's pages are version 4 with their own data. #109's page groups its 175 files in
ten groups in a reading order (`apparatus/extras-215.json`): the runtime and the gate first, then
the shared library, then one small port to read end to end, then the rest by area. With more
than 12 files every file starts folded and its diff is drawn only when opened; a long diff or
file is drawn 400 lines at a time.

# Results

**Size.** #145: page 36 KB, `review.json` 5 KB, one chunk of 207 KB. #179: `review.json` 12 KB,
one chunk of 243 KB. #109: `review.json` 48 KB and six chunks, 8.3 MB in all; a page fetches only
the chunk a file sits in, when it is opened.

**Load time**, as each page measured it from its script's start until its first view was drawn,
and saved in its database: #145 at 1314×842, 1,170 ms with its one diff drawn; #109 at 580×650,
643 ms, and at 1314×842, 272 ms, with every file folded. #179 recorded none. No review page
recorded a load at phone width.

**Taps to reach a chosen hunk.** #145 and #179: one tap (Diff) on the phone, then a scroll; none
on the iPad, where the diff is open beside the ticket. #109: two taps on the phone (Diff, then the
file), one on the iPad, then a scroll.

**What the user said.** On #145's page: "this is good", then the three changes above. On the
#179 and #109 pages: "ok I think this is a good first iteration, we can file a ticket to make
this into something that is not dependant on claude code harness, so a standalone webapp." Asked
whether that should be a page of the dashboard of #126, which only shows, or its own app that
saves comments, the user chose the dashboard.

# What it settles

Facts about these pages on 2026-10-03. A review page published as an artifact can show a change
of 175 files and about 100,000 lines, folded and in a reading order, with its index on screen in
under a second on the iPad. The user wants the ticket, the spec and the change's summary beside
the diff and the files as they stand, and does not want checks, review findings or a verdict
control on it. It does not settle how such a page reads at phone width for the two larger
changes, which no load recorded.
