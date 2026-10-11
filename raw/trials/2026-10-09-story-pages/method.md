---
kind: trial
subject: a change and a ticket told as story pages that scroll, and which form the user chose for reading them on a phone and an iPad
date: 2026-10-09
---

# Method

**Question.** [Issue #321](https://github.com/brindlewick/postmaster/issues/321): where can a page serve
the user better than text, starting with a code review told as a story that scrolls? The trial built such
pages for one merged change and for one ticket, and the user judged each form in turn.

**What was built.** Three pages, each one HTML file published as a private artifact from Claude Code. A
script builds each from a story file, which holds the session's words and what each step shows, and from
the repository's own text at a commit.

1. `change-text/`: pull request 336, which did #332, told in 29 steps: an opening, a section for each of
   #332's four acceptance criteria, and a closing list of the changed lines that no step shows. The panel
   beside the story shows the ticket's text, the pull request's text or the code, with the step's lines lit.
2. `change-drawn/`: the same change in 43 steps, with ten drawings placed before the code they explain.
   Each drawing is an SVG with named states that the steps switch between.
3. `ticket-352/`: #352 told for review before it is built, in 35 steps: a picture in the style of the
   project's poster, a plain welcome, a section for each criterion (its words, a drawing, the code it builds
   on as it stands at the ticket's base, the check the run must pass), the decisions, and the code the
   ticket cites.

Each folder holds `story.json`, its drawings in `diagrams/`, the builder it was made with in
`tool/build.ts` and the page in `out/index.html`. The ticket's folder also holds the picture and the prompt
that drew it, in `art/`. A builder runs with Bun from its folder:
`bun --no-env-file --config=/dev/null tool/build.ts <repository> <folder> <output folder>`. The builders
grew from one to the next; each folder's is the one its page was made with.

**How a page works.** On a phone the panel holds the top half of the screen and the story scrolls beneath
it; from 900 pixels wide the story runs beside the panel. The step told is the one on a reading line, at
74% of the height on a phone and 45% on a wider screen. It is outlined, with a notch toward the panel, and
the others fade. The panel shows that step's scene: a drawing in one of its states, code with the step's
lines lit and its key words marked, the ticket's own words, or a Markdown file formatted. In the ticket's
story only the words a step is about are shown, set large, and the whole ticket comes near the end. The
colours and type are those of the review page in `skills/review-pages/`, in light and dark.

**Coverage.** Every changed line of the change, or every line the ticket cites, is on a step or in the
closing list, and the builder checks that on the rows it writes. The text form put 268 of 624 changed
lines on steps and listed 356. The drawn form put 242 on steps and listed 382. The ticket's story put all
19 cited lines on steps and named in its list the one whole file the ticket links. Control: the text form
built without one step moved that step's 14 lines into the list.

**The picture.** Codex CLI 0.157.1, logged in with a ChatGPT account, has its `image_generation` feature on.
The call `codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -c
model_reasoning_effort='"low"' -i docs/poster.jpg - < prompt`, run in an empty folder, returned a 1536 by
1024 PNG through Codex's image tool in 112 seconds, using about 39,000 tokens. The ribbons' and the
waybill's words came out as the prompt gave them. The prompt is `ticket-352/art/opening-prompt.txt`; the
PNG was saved as a JPEG at 82% quality, 486 KB.

**How the pages were checked.** Each page was rendered in headless Firefox at 390 by 844 and at 1180 by
820, light and dark, and every drawing was rendered on one sheet in every one of its states. Firefox's
headless screenshot draws a page from its top even after a jump to a step, which leaves a sticky panel's
place blank, so a later step was checked in a copy that starts on that step.

# Results

The user read each page on a phone and an iPad and judged it in the session. In order, from 2026-10-09 to
2026-10-10:

- On the first text form: the whole page should be told by scrolling, the opening included, with a section
  for each criterion, and the step being told needed a clearer box. Both were made: one scroll from the
  title to the closing list, and a box with a notch on the step at the reading line.
- Between the text form and the drawn form: the drawn form is better, and its 43 steps are no problem
  because steps are easy to scroll.
- On what it is for: the user reviews tickets more often than changes, so a story should tell a ticket
  too, showing the code it will touch.
- On the ticket's story: opening on the ticket's text was intimidating, and the start should be simple and
  inviting, with a picture in the style of the project's poster. A hand-drawn engraved plate was judged
  nothing like the poster; Codex, given the poster as its reference, drew a picture the user kept.
  Markdown files should show as formatted text, not as code.
- The ticket's story was judged good. #352 was signed off to build it, and #434 was filed to have the
  booking clerk make a story for every ticket it prepares.

# What it settles

How one user, reading on a phone and an iPad, judged these forms for one change and one ticket over two
days. It measures neither the time a review takes nor what a reader catches, and one change and one ticket
are a small sample. It does settle that such pages fit an artifact's limits (the largest is 729 KB with
its picture), that the coverage check holds for these three stories, and that Codex can draw a picture in
the poster's style from the command line, with its lettering right on the first try here.
