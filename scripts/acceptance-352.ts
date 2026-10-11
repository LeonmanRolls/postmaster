// Oracle helper for #352: stage ticket stories, run the story builder as a
// subprocess, and read the built pages back as bytes. It never imports the
// change: the builder is driven through scripts/run, and every assertion
// reads the page's HTML, the stub adapter's log, or the run's own files.
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { run } from "./lib/proc.ts";

/** The checkout under test: this file lives in its scripts folder. */
export const REPO = dirname(import.meta.dir);
export const RUN = join(REPO, "scripts", "run");
export const TRIAL_352 = join(REPO, "raw/trials/2026-10-09-story-pages/ticket-352");

/** A 1x1 red PNG: the known image the stub adapter writes. */
export const KNOWN_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Stub picture adapter: logs its arguments, copies the known image to --out. */
export const STUB_ADAPTER_SH = `#!/bin/sh
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--out" ]; then out="$a"; fi
  prev="$a"
done
echo "$*" >> "$STUB_ADAPTER_LOG"
cp "$STUB_ADAPTER_IMAGE" "$out"
`;

/** One-state drawing shared by the #271 and scrub fixture stories. */
export const DRAWING_SVG = `<svg class="dg" viewBox="0 0 360 120" xmlns="http://www.w3.org/2000/svg">
<rect class="bx hot" x="20" y="20" width="150" height="80" rx="8"/>
<text class="t1" x="36" y="52">single-thread</text>
<text class="t2" x="36" y="72">one coachman</text>
<rect class="bx" x="190" y="20" width="150" height="80" rx="8"/>
<text class="t1" x="206" y="52">synthesis</text>
<text class="t2" x="206" y="72">lanes, then judge</text>
<path class="ln" d="M170 60 L190 60"/>
</svg>
`;

/** Picture prompt for the #271 fixture story (the stub ignores its words). */
export const PROMPT_271 = `Generate one image with your image generation tool and save it in the current directory as picture.png. Do not write any code to draw it; use the image generation tool.

Use the attached poster as the style reference: a Victorian hand-coloured engraved poster with fine cross-hatching, cream paper, oxblood-red and forest-green ribbon banners with cream lettering, brass posthorns, an ornate floral border and a warm muted palette. Wide landscape, 3:2.

Scene: the same post office counter. On the left, a single coachman writes at a desk. On the right, three horses pull one mail coach past the window. A red ribbon across the top reads "Which mode pulls better"; a green ribbon across the bottom reads "Eight criteria". No other text.

When the file is saved, reply with its path and its size in pixels, and nothing else.
`;

export interface TicketJson {
  title: string;
  body: string;
}

/** #352's title and body, snapshotted from the live ticket for the oracle. */
export const TICKET_352: TicketJson = {
  title: "A ticket can be read as a scrolling story before it is built",
  body: "## Problem / feature\n\nThe user reviews tickets on a phone or an iPad, in a document that holds the whole ticket at once. A ticket that changes code points at that code only through links in its notes, so the reader has to imagine what the code is and what will change.\n\nThe trials for [#321, Research: where artifacts can serve the user better, starting with scrollytelling for code reviews](https://github.com/brindlewick/postmaster/issues/321) told changes and tickets as stories that scroll. The last told this ticket: it opens on a picture in the style of the postmaster poster and a plain welcome, gives each acceptance criterion a section, draws each part before it shows the code it builds on as that code stands today, and keeps a panel beside the step being read that follows it. On 2026-10-09 and 2026-10-10 the user chose the drawn form, asked for a start that is simple and inviting, and asked for Codex to draw the opening picture.\n\nDone: when the user asks for a ticket's story, a session publishes such a page for it before the ticket runs, opening on a picture drawn for it. [#434, The booking clerk makes a story for every ticket it prepares](https://github.com/brindlewick/postmaster/issues/434) then has the booking clerk make one for every ticket it prepares.\n\n## Acceptance criteria\n\n1. A ticket can be published as a story page before it is built, with a section for each of its acceptance criteria.\n2. The story opens with a picture of what the ticket asks for, in the style of the postmaster poster.\n3. The panel beside the story always shows what the outlined step tells.\n4. Each section draws what it describes before it shows any code.\n5. The code the ticket cites is shown as it stands, each cited line in a step or in the list at the end.\n\n## Decisions\n\n### Not covered by the acceptance criteria\n\n- **D1 (given by the user)** Once this lands, the booking clerk makes a story for every ticket it prepares, by default, in #434; until then a session makes one when the user asks. Why: the user means to review tickets through their stories. Instead of: stories only when asked.\n- **D2 (proposed)** The page is for reading: it takes no comments and has no verdict, and the user answers in the chat and edits the ticket in its document, as now. Why: the ticket's document already takes comments and edits. Instead of: comments on each step.\n- **D3 (given by the user)** The page looks and scrolls like the trials the user chose: the review page's colours and type, the panel on top on a phone and beside the story on a wider screen, a box around the step being read, and drawings that change as the steps go. Why: the user chose them on 2026-10-09. Instead of: the dashboard's chosen look.\n- **D4 (given by the user)** The start is simple and inviting: a picture and a plain welcome come first, and the ticket's text does not. Why: the whole ticket as the first thing shown is intimidating. Instead of: opening on the ticket.\n- **D5 (proposed)** The ticket's words appear a step at a time, only the words a step is about, and the whole text comes near the end. Why: each step can be read at a glance, and the whole is easier to take in once each piece is known. Instead of: the whole ticket with the part being told lit.\n- **D6 (proposed)** Markdown files among the cited code are shown as formatted text, and other files as code. Why: instructions and runbooks read better formatted, as the user asked of the trial. Instead of: Markdown shown as raw code.\n- **D7 (proposed)** Codex draws the picture, with the postmaster poster as its style reference, and the session looks at it before the page is published. Why: Codex matched the poster on its first try, in about two minutes, on the user's ChatGPT plan, with nothing to paste. Instead of: a picture made by hand in the ChatGPT app each time.\n\n### Covered by the acceptance criteria\n\nEach of these is stated by a criterion above; it is here for its reason and the alternative it beat.\n\n- **D8 (given by the user)** Each part is drawn before its code is shown. Why: the user found the drawn version easier to follow, and the extra steps cost little because they are easy to scroll. Instead of: code and words alone.\n- **D9 (proposed)** The story shows the code as it really stands and lists the cited code it does not show. Why: an agent writes the story, and the reader must see the code behind each claim and know that nothing cited was skipped. Instead of: describing the code in prose.\n\n## Out of scope\n\n- A story for a merged or open change, the form for code reviews: a follow-up ticket.\n- A step for each decision, and refusing a story that points at code or text that is not there: a follow-up ticket.\n- The booking clerk making a story for every ticket it prepares: #434 (D1).\n- Comments or a verdict on the page (D2).\n- A ticket with no acceptance criteria: the clerk adds them first.\n- The dashboard's view of a ticket or a change, and any change to today's review page.\n\n## Direction\n\nThe story page is a page the review-pages skill publishes, so like the others it works in Claude Code only, until the dashboard shows changes. It must read on a phone and an iPad, in light and dark, and its tooling must run on Linux and macOS. No page may hold anything private, as the review-pages rules say. The picture comes from Codex through an adapter of its own, outside the files of the coachman's contract, so the change needs no fixture run; each picture counts against the Codex limit that the Codex lanes use.\n\nIt starts from the trials' files, which #321's report puts in the repository, so it waits for #321 to land.\n\n## Turnpikes\n\ndefault\n\n## For the agents\n\n*Everything above is what the user signed off. This part follows from it and adds nothing to it.*\n\n### Checks\n\n- **C1** Build a story for this ticket from the trial's story for #352, and a new story for #271 at its base, 5037e71 → each page opens with its picture and welcome, then has one section per acceptance criterion of its ticket, in the ticket's order (five for this ticket, eight for #271). **At the base:** no story builder exists, and no script or page names scrollytelling.\n- **C2** A story whose opening names a picture → the builder calls the picture adapter with `docs/poster.jpg` as the style reference and embeds what it returns; with a stub adapter that writes a known image, the page holds that image; with no adapter available, the builder says so and writes no page. One real Codex call, made by hand before the card, returns a picture in the poster's style with its lettering right. **At the base:** no picture adapter exists; Codex 0.157.1 lists `image_generation` as stable and on, and one call made a 1536 by 1024 picture in 112 seconds.\n- **C3** The function that picks the active step, given each step's box and the viewport, returns the step on the reading line, else the nearest one, for a step on the line, the gap between two steps, above the first and below the last, at 390 by 844 and at 1180 by 820. And for every step in a built page, its scene is in the page and what it lights is in that scene → both hold for both pages. **At the base:** no such function; the trial pages pick by the same rule in their inline script.\n- **C4** The story for this ticket → every section that shows code has a drawing before its first code step, and the page holds each drawing once and switches its state as the steps go. The same story with the first drawing of criterion 1's section removed → the builder exits non-zero naming that section and writes no page. **At the base:** the trial's builder draws but does not require drawings.\n- **C5** The coverage test reads the links in the ticket's text that point at lines of the repository's files, and the built page's rows, and lists every cited line that is on no step and not in the closing list → none, for both pages. Control through the same test: the story with one code step removed → that step's cited lines move into the list; a link at a commit other than the story's → refused, naming the link. **At the base:** the trial's builder found 23 cited lines in #352's earlier text, all on steps, and one whole file listed.\n\n### Technical notes\n\n- The trials are the reference: the ticket story of #352 (its story file, eleven drawings, the opening picture and its prompt, its builder and the page) and the drawn story of pull request 336, committed by #321's report under `raw/trials/`. The page the new builder makes for this ticket should match the trial's in structure, look and behaviour. (C1, C2, C3, C4, C5, D3, D4, D5, D6, D7, D8, D9)\n- The story file names sections (the opening, one per criterion, the end), scenes (the picture; the ticket's text, as excerpts or whole; drawings with named states; code at the ticket's base with cited lines lit; Markdown at the base as formatted text with the cited blocks lit; the list of cited code not shown) and steps (a title, two to four sentences, the scene, what it lights, and whether the ticket's words show as an excerpt). (C1, C3, C4, C5, D5, D6)\n- The picture: `codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox -c model_reasoning_effort='\"low\"' -i docs/poster.jpg - < <prompt>` in a scratch folder, the prompt asking for one image from the image generation tool, saved under a given name, with the style described and the exact words of every ribbon. Convert the PNG to a JPEG near 80% quality: the trial's 3.8 MB picture became 464 KB. Keep the call in an adapter of its own (design rule 2), not in `scripts/launch.ts`, which is in the coachman contract. The skill tells the session to look at the picture, its lettering included, before publishing. (C2, D7)\n- Code at the base: `git show <base>:<path>`, the base being the commit the ticket's links and its \"Verified at\" heading name. Cited code: every link `https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<a>-L<b>` in the ticket's text; a link without lines names a whole file, listed but not counted. (C5, D9)\n- Reuse from the review-page builder, moved to `scripts/lib/` where two scripts need them: `scrub`, which removes email addresses and keeps line numbers ([`scripts/review-page.ts` L63-L72](https://github.com/brindlewick/postmaster/blob/14bd42d/scripts/review-page.ts#L63-L72)), run before any text is shown, and `langOf` ([L54-L58](https://github.com/brindlewick/postmaster/blob/14bd42d/scripts/review-page.ts#L54-L58)). (C5)\n- Markdown at the base: headings, paragraphs, nested list items and code fences, each block knowing the source lines it came from, so a step lights the blocks its cited lines fall in. (C5, D6)\n- The review-pages skill ([`skills/review-pages/SKILL.md`](https://github.com/brindlewick/postmaster/blob/14bd42d/skills/review-pages/SKILL.md), its sections at L14, L39 and L56) gets a section on story pages: how a session writes the story, asks for the picture and looks at it, builds and checks the page, publishes it as one file with no capabilities, and stops the watch. `AGENTS.md` ([L321-L324](https://github.com/brindlewick/postmaster/blob/14bd42d/AGENTS.md#L321-L324)) names the story page as the page for a ticket's story. (C1, C2, D1, D2, D7)\n- The page as the trials built it: one HTML file with its data inline, the picture as a data URI in a frame of the poster's cream; highlight.js 11.11.1 from cdnjs; the review page's colour and type tokens for both themes, the opening headline in DM Serif Display; the panel 52% of the height on a narrow screen and beside the story from 900 pixels; the step being read outlined with a notch toward the panel, the others faded with no box; for an excerpt, only the blocks it names, set large. (C1, C3, D2, D3, D4, D5)\n- The reading line sits at 74% of the viewport's height on a narrow screen and 45% on a wide one; tapping a step scrolls it to the line. Keep the choice of step a pure function so C3 can test it without a browser. (C3, D3)\n- Drawings are SVG the session draws beside the story file. The story declares each one's states; in the SVG, `on-<state>` shows an element only in that state, `hl-<state>` lights it, `dim-<state>` fades it, and `data-shift-<state>=\"dx dy\"` moves an element that has an id; the builder writes the CSS and refuses a state the story does not declare. Draw the mechanism, not its name; label the arrows; keep text at 11 to 13 pixels in a view box about 360 wide; take every colour from the page's tokens; give each a caption and an `aria-label`. The builder writes a sheet of every drawing in every state for a look at phone width in both themes before publishing. (C4, D3, D8)\n\n### Verified at 14bd42d\n\n- `scripts/review-page.ts` L54-L58 hold `langOf` and L63-L72 hold `scrub`.\n- `skills/review-pages/SKILL.md` has \"A review page for a change\" at L14, \"A code viewer for a ticket's files\" at L39 and \"Never\" at L56.\n- `AGENTS.md` L321-L324 send a change the user reviews, or files a ticket names, to the review-pages skill.\n- `docs/coachman-contract.toml` lists `scripts/launch.ts`, and neither `skills/review-pages/` nor `scripts/review-page.ts`.\n- `docs/poster.jpg` exists.\n- `codex features list` (Codex 0.157.1) shows `image_generation` stable and on, and `codex login status` reports a ChatGPT login.\n- In the trial, the Codex call above, with the poster attached, saved a 1536 by 1024 PNG in 112 seconds through its image generation tool, its ribbons' words right; the trial's builder made this ticket's earlier story with 37 steps and 23 cited lines, all on steps.\n- #271's text holds 21 links at 5037e71.\n\n",
};

/** #271's title and body, snapshotted from the live ticket for the oracle. */
export const TICKET_271: TicketJson = {
  title: "Research: judge single-thread runs against synthesis runs by review rounds",
  body: "## Problem / feature\n\n#270 lets the postmaster make a run in synthesis mode or in single-thread mode, and a config setting picks the mode or alternates the two from ticket to ticket. That leaves the question the lane audit (#257) could not answer: does a run need its workhorse lanes, or does the coachman writing the change itself do as well?\n\nThis ticket is the look at the runs made in each mode. When the user asks, a research session compares this project's single-thread runs with its synthesis runs, whatever the setting said when they were dispatched. Each run is judged by the number of review rounds it needed, with its first-round findings, its time and its tokens beside it. Done means a wiki page that compares the modes, says what that many runs can and cannot show, and leaves the choice of default to the user.\n\n## Acceptance criteria\n\n1. The comparison covers every run of this project dispatched since #270 landed, each under the mode it ran in, whatever the setting said.\n2. A run whose mode the user named is listed apart and not compared.\n3. A run that ended before its card counts as its mode's worst result, unless the user says its mode played no part.\n4. The report compares the two modes on the review rounds their runs needed.\n5. Beside the rounds, the report gives each mode's serious first-round findings as the reviewers graded them, the share the coachman set aside, the time to the card and the tokens.\n6. The report backs every count with a control.\n7. The report says what that many runs can and cannot show, among them what changed in the flow and the models while they ran.\n8. The report is published as a wiki page, with its extraction and data beside it, in the shape of the lane audit's.\n\n## Decisions\n\n### Not covered by the acceptance criteria\n\n- **D3 (given by the user)** This ticket is a look made when the user asks, with no fixed count. Why: the modes come from #270's setting, and the look can come whenever there are enough runs in each. Instead of: a trial of 16 tickets with its own tool, rule and report.\n- **D6 (proposed)** A run's rounds are all the review rounds it ran, whether it ended on a clean round or on the user's word. Why: that is what the run cost, and it is how the lane audit counted them. Instead of: counting only the rounds that found something serious.\n\n### Covered by the acceptance criteria\n\nEach of these is stated by a criterion above; it is here for its reason and the alternative it beat.\n\n- **D2 (given by the user)** Each run is judged by the number of review rounds it needed. Why: review is where most of a run's time goes, and a run's rounds mostly follow its first round's findings. Instead of: judging by tests or by reading.\n- **D4 (proposed)** The serious findings of the first round, the time to the card and the tokens are reported beside the rounds. Why: rounds are a coarse count, mostly two to six, and say nothing of what single-thread mode saves. Instead of: rounds alone.\n- **D5 (proposed)** First-round findings are counted from what the reviewers wrote, and the share the coachman set aside is shown for each mode. Why: in single-thread mode the coachman rules on findings about its own work, and the rounds depend on those rulings. Instead of: counting only the findings the coachman verified.\n- **D7 (proposed)** A run that ended before its card counts as its mode's worst result, unless the user says its mode played no part; the session asks about each one when it writes the report. Why: leaving out the runs a mode could not finish would favour that mode. Instead of: leaving out every unfinished run.\n- **D8 (given by the user)** The comparison takes every single-thread run and every synthesis run, whatever the setting said when they were dispatched. Why: it only needs to compare single-thread runs with multi-model ones. Instead of: only the runs made while the setting said to alternate.\n- **D9 (proposed)** Runs from before #270 landed are not compared. Why: #270 changes how every run is tested, synthesis runs too, so earlier runs ran on a different flow. Instead of: counting them, which would add runs but mix two versions of the flow.\n\n## Out of scope\n\n- The setting and the alternation, which #270 makes.\n- Choosing the default mode, or a rule for it fixed beforehand: the report says what the numbers favour, and the user sets the default with #270's setting.\n- A mode with one workhorse lane, and changes to the reviewers, their prompts or the models.\n- Holding the flow or the models still while the compared runs are made.\n- Testing whether the result holds for another coachman model or another project.\n- A price in money for lanes that report none.\n\n## Direction\n\nThis ticket is not dispatched as a run. A research session works it when the user asks, once #270 has landed and there are runs in both modes. With eight runs in each mode the comparison can show a difference of about two rounds, and with fewer the report says how little it can show. It changes nothing in the flow, so no fixture run is needed.\n\n## Turnpikes\n\nnone\n\n## For the agents\n\n*Everything above is what the user signed off. This part follows from it and adds nothing to it.*\n\n### Checks\n\n- **C1** The extraction on this project's run records → lists every run whose record holds a mode, single-thread and synthesis alike, whatever the setting at its dispatch, each under its mode, in dispatch order; a record with no mode, from before #270, is left out. Control through the same function: a scratch record whose mode is `single-thread` under the setting `single-thread` is listed, and one with no mode is not. **At the base:** no run record holds a mode ([`run-meta.ts` L846-L868](https://github.com/brindlewick/postmaster/blob/5037e71/scripts/run-meta.ts#L846-L868)); #270 adds it, with its source and the setting's value.\n- **C2** A run whose record says the user named its mode → the extraction lists it apart and leaves it out of every median. Control: the same record with its mode from the setting is compared. **At the base:** no run has a mode to name.\n- **C3** A run that ended before its card → ranked above every finished run of its mode in the medians, unless the trial folder records the user's word that its mode played no part, in which case it is listed and left out. Control through the same function: rounds 2, 2, 3, 3, 4, 5 and two unfinished runs give a median of 3.5, and 3 with the two left out. **At the base:** a run is abandoned only on the user's word, logged as a `note` ([`postmaster.md` L679-L682](https://github.com/brindlewick/postmaster/blob/5037e71/skills/postmaster/postmaster.md#L679-L682)).\n- **C4** The report's table lists each compared run with its mode and rounds, and each mode's median and range of rounds. **At the base:** the lane audit counts rounds for synthesis runs only ([`lastRound`](https://github.com/brindlewick/postmaster/blob/5037e71/raw/trials/2026-10-03-lane-audit/apparatus/analyze.ts#L133-L140)).\n- **C5** The same table gives, for each run and as each mode's median, the serious first-round findings from the reviewers' raw reports, the ungraded ones, the share set aside, the time to the card and the tokens by role and harness. **At the base:** the lane audit counts severe findings from the coachman's verified list ([`results/reviews-round-one.md` L3](https://github.com/brindlewick/postmaster/blob/5037e71/raw/trials/2026-10-03-lane-audit/results/reviews-round-one.md#L3)).\n- **C6** Every count in the report has a positive and a negative control through the same function, in a controls table like the lane audit's. **At the base:** the lane audit has such a table for one mode ([`results/controls.md`](https://github.com/brindlewick/postmaster/blob/5037e71/raw/trials/2026-10-03-lane-audit/results/controls.md)).\n- **C7** The report has a limits section: the difference the per-mode counts can show, by the method of the technical notes rerun on the compared runs; the confounds; and each flow change and model change that landed while the modes alternated, with its date. **At the base:** the lane audit states its limits in this shape for one mode ([`several-lanes.md` L353-L365](https://github.com/brindlewick/postmaster/blob/5037e71/wiki/concepts/several-lanes.md#L353-L365)).\n- **C8** The wiki page, its index line and the trial folder with the extraction, the data and the method note exist; the lane audit's privacy scan exits 0 on them; `scripts/run wiki-lint` exits 0. **At the base:** `raw/trials` holds twenty trials, the lane audit's among them and none comparing modes, and `scripts/run wiki-lint` exits 0.\n\n### Technical notes\n\n- Which runs: every `run.json` under the project's `.postmaster/runs/`, parked folders included, that holds a mode, which every run dispatched since #270 landed does. Each gives the mode, where it came from and the setting at dispatch, as #270 records them ([`run-meta.ts` L846-L868](https://github.com/brindlewick/postmaster/blob/5037e71/scripts/run-meta.ts#L846-L868) is where the record is built). A record with no mode is from before #270 and is left out; a run whose mode the user named is listed apart. (C1, C2, D8, D9)\n- Rounds: as the lane audit counts them, the highest round any `review-launch`, `review-harvest` or `finding` line of the run's `actions.jsonl` names ([`lastRound`](https://github.com/brindlewick/postmaster/blob/5037e71/raw/trials/2026-10-03-lane-audit/apparatus/analyze.ts#L133-L140)); a launch's detail names its round, as `style round 1`. A reviewer relaunched within a round stays in it. Both modes stop by [`review-decide.ts` L16-L19](https://github.com/brindlewick/postmaster/blob/5037e71/scripts/review-decide.ts#L16-L19): round 2 runs when round 1 applied a fix, round r+1 when round r logged a verified P1 or P2, and round 3 caps it and escalates, so a round past the third follows the user's ruling. The report says for each run whether it ended on a clean round or on a ruling. (C4, D2, D6)\n- Findings as the reviewers wrote them: only the bug lens leaves a findings file, `logs/review-r<round>-bug-<lane>-findings.json` normalized from the reviewer's report with a missing severity left `not provided` ([`coachman.md` L621-L629](https://github.com/brindlewick/postmaster/blob/5037e71/skills/postmaster/coachman.md#L621-L629), [L773-L780](https://github.com/brindlewick/postmaster/blob/5037e71/skills/postmaster/coachman.md#L773-L780)), or a `-findings.md` the coachman writes by hand when normalizing fails ([L797-L800](https://github.com/brindlewick/postmaster/blob/5037e71/skills/postmaster/coachman.md#L797-L800)). The style lens runs in round 1 only and gates nothing ([L617-L620](https://github.com/brindlewick/postmaster/blob/5037e71/skills/postmaster/coachman.md#L617-L620)), and the style and security reviewers leave their report only as the last message of `logs/review-r<round>-<lens>-<lane>.jsonl`. Read every reviewer's raw report, the `-last.md` for a codex lane and the stream's final message otherwise, never the hand-written file. A serious finding is a distinct target per lens that the reviewer graded P1 or P2, or high or medium on a security skill's own scale; an ungraded one is counted apart. Count the same way in both modes. (C5, D4, D5)\n- The share set aside: the review checkpoint card lists each finding as `- [<severity>] <id>: <state>`, the state `open`, `closed round <r>`, `dismissed: <reason>` or `applied on user word, not re-reviewed` ([`coachman.md` L918-L922](https://github.com/brindlewick/postmaster/blob/5037e71/skills/postmaster/coachman.md#L918-L922)); the share is the dismissed P1 and P2 findings over all listed P1 and P2 findings, per mode. (C5, D5)\n- Time and tokens: `scripts/run run-times <dispatch>` gives each stage's time and its waiting, the time no coachman leg ran ([`run-times.ts` L1-L13](https://github.com/brindlewick/postmaster/blob/5037e71/scripts/run-times.ts#L1-L13)); the time to the card is the stages from `dispatched` up to `shipping`, less their waiting. A single-thread run never enters `workhorses-running`, and its coachman writes the change in `synthesis`, as #270 has it, so the modes are compared on the time to the card, not stage by stage. Tokens come by role and harness from `scripts/run usage sum <dispatch>`; a leg resumed after its usage record was written is read from its session record with `scripts/run usage read`, because the record undercounts it; the fix at the source is [the lane audit's candidate 6](https://github.com/brindlewick/postmaster/blob/5037e71/wiki/concepts/several-lanes.md#L442-L443), not yet filed. Compare tokens per role and harness and never sum them across harnesses, which count input differently. Record the number of runs in flight at each compared dispatch, since load shifts the times. (C5, D4)\n- Unfinished runs: a run is abandoned on the user's word with a `note` ([`postmaster.md` L679-L682](https://github.com/brindlewick/postmaster/blob/5037e71/skills/postmaster/postmaster.md#L679-L682)), or parked, its folder renamed `<ticket>-parked-<date>`. The session lists each with the reason the postmaster logged, asks the user whether its mode played a part, and records the answer in the trial folder; the medians rank a run counted as unfinished above every finished run of its mode. (C3, D7)\n- The apparatus: the extraction and the report reuse the lane audit's ([`raw/trials/2026-10-03-lane-audit`](https://github.com/brindlewick/postmaster/tree/5037e71/raw/trials/2026-10-03-lane-audit)): its parsers, records reader, tables, controls and privacy scan. Check each function on a run with no lanes, because the audit assumed workhorse lanes: [`workhorses`, `laneGate` and `singleLaneSufficed`](https://github.com/brindlewick/postmaster/blob/5037e71/raw/trials/2026-10-03-lane-audit/apparatus/analyze.ts#L15-L107) read them, and a single-thread run's SYNTHESIS line takes the form #270 gives it. Add the mode and its source to the run record. The trial folder sits beside the audit's, as `raw/trials/<date>-mode-comparison`, its apparatus run with `bun` as the audit's method runs its own ([`method.md` L167-L174](https://github.com/brindlewick/postmaster/blob/5037e71/raw/trials/2026-10-03-lane-audit/method.md#L167-L174)). (C1, C4, C5, C6, C8, D4)\n- How sure it can be: in the lane audit's data ([`results/numbers.md` L75-L82](https://github.com/brindlewick/postmaster/blob/5037e71/raw/trials/2026-10-03-lane-audit/results/numbers.md#L75-L82), [`results/reviews-round-one.md` L11-L28](https://github.com/brindlewick/postmaster/blob/5037e71/raw/trials/2026-10-03-lane-audit/results/reviews-round-one.md#L11-L28)), the 18 real runs took 2 to 20 rounds, median 4, and the 15 of six rounds or fewer a median of 3 with a standard deviation of 1.35, which needs 8 runs a side to show a two-round difference in means and 29 for one round (two-sided 5%, 80% power). Medians are noisy at these counts: drawing 8 runs a side 100,000 times from the 18 counts with no real difference, the two medians differ by a round or more in 59% of draws and by two or more in 22%; at 16 a side, in 53% and 13%. Beside each difference of medians, the report gives how often shuffling the mode labels among the compared runs gives a difference that large. (C7, D3)\n- The confounds: whether a run came from alternation or from a setting that held one mode, since a stretch in one mode meets a different stream of work; ticket size, load, the coachman's larger first leg in single-thread mode, the models in each role, the user's rulings past the third round, and that in synthesis mode a review brief may list where the lanes diverged while in single-thread mode there is nothing to list. A review brief names no mode, as #270 decides, so the reviewers judge both modes blind. (C7, D5, D6, D8)\n- Publication: a wiki page in the shape of the audit's, with a standing of claimed, citations of the form `[@trials/...]`, an index line and a log entry, beside the trial folder, in a pull request titled with this ticket's number. (C8)\n\n### Verified at 5037e71\n\n- `scripts/run-meta.ts` L846-L868 builds the run record with written, coachman_contract, project, run, project_settings, target, postmaster, config (the resolved config), confinement and harness_versions, and no mode.\n- `scripts/run stage --list` printed dispatched, bootstrapped, workhorses-running, synthesis, checkpoint-1, review, shipping, shipped, done and abandoned: there is no planning stage.\n- `skills/postmaster/postmaster.md` L679-L682 abandon a run only on the user's word, logged as a `note`; no runbook or script names parking.\n- `scripts/review-decide.ts` L16-L19 state the stopping rule the notes quote.\n- `skills/postmaster/coachman.md` L617-L620 run the style lens in round 1 only; L621-L629 and L773-L780 normalize the bug lens's reports, a missing severity left `not provided`; L797-L800 have the coachman write a findings file by hand where normalizing fails; L918-L922 give the checkpoint card's finding states.\n- `scripts/run-times.ts` L8-L9 define waiting; `scripts/run run-times` on run 201 printed the stage, started, took and waiting columns.\n- `scripts/run usage sum` on run 200 gave its review leg's coachman 36,223,586 input tokens, and `scripts/run usage read` on that leg's later session record gave 58,291,789; on run 201 it gave the security reviewer 26 input tokens over three rounds, where the codex reviewer's figure was 1,144,237.\n- Run 218's `logs/` hold `review-r1-bug-<lane>-findings.json` and `.md` and no findings file for its style or security reviewers; run 201's `actions.jsonl` names the round in each `review-launch` detail, as `style round 1`.\n- `git ls-tree -d --name-only HEAD raw/trials` listed twenty trials, `2026-10-03-lane-audit` among them and none comparing modes; `scripts/run wiki-lint` exited 0.\n- The lane audit at this base: `raw/trials/2026-10-03-lane-audit/results/reviews-round-one.md` L3 defines a severe finding as a verified gating P1 or P2 not dismissed and L11-L28 hold the rounds of its 18 runs; `results/numbers.md` L75-L82 give their median, spread and the runs needed a side; `apparatus/analyze.ts` L15, L42, L97 and L133-L140 hold `laneGate`, `workhorses`, `singleLaneSufficed` and `lastRound`; `apparatus/records.ts` L215 holds `privacyFaults`; `method.md` L167-L174 runs the apparatus with `bun`.\n\n",
};

/** The #271 fixture story: eight criterion sections at 5037e71, prompt-form hero. */
export const STORY_271: unknown = {
  alt: "Two modes side by side: one coachman alone, and lanes judged into one.",
  at: "5037e71",
  mode: "ticket",
  repoUrl: "https://github.com/brindlewick/postmaster",
  scenes: [
    {
      alt: "A placeholder picture standing in for the drawn opening.",
      chip: "for your reading",
      id: "hero",
      kind: "image",
      label: "Ticket #271",
      prompt: "art/opening-prompt.txt",
    },
    {
      chip: "what you sign",
      cut: "## For the agents",
      from: "issue",
      id: "ticket",
      kind: "doc",
      label: "Ticket #271",
      number: 271,
    },
    {
      caption: "One coachman alone, or lanes judged into one.",
      chip: "diagram",
      id: "d",
      kind: "diagram",
      label: "The question",
      states: ["all"],
      svg: "diagrams/d.svg",
    },
    {
      file: "skills/postmaster/coachman.md",
      from: 615,
      id: "coach",
      kind: "md",
      to: 632,
    },
    {
      file: "scripts/review-decide.ts",
      from: 10,
      id: "decide",
      kind: "ref",
      to: 25,
    },
    {
      file: "scripts/run-times.ts",
      from: 1,
      id: "times",
      kind: "ref",
      to: 20,
    },
    {
      chip: "list",
      id: "left",
      kind: "leftovers",
      label: "The code it cites",
    },
  ],
  sections: [
    {
      id: "open",
      label: "Start",
      title: "The ticket",
    },
    {
      id: "c1",
      label: "C1",
      title: "Criterion 1",
    },
    {
      id: "c2",
      label: "C2",
      title: "Criterion 2",
    },
    {
      id: "c3",
      label: "C3",
      title: "Criterion 3",
    },
    {
      id: "c4",
      label: "C4",
      title: "Criterion 4",
    },
    {
      id: "c5",
      label: "C5",
      title: "Criterion 5",
    },
    {
      id: "c6",
      label: "C6",
      title: "Criterion 6",
    },
    {
      id: "c7",
      label: "C7",
      title: "Criterion 7",
    },
    {
      id: "c8",
      label: "C8",
      title: "Criterion 8",
    },
    {
      id: "left",
      label: "Cited code",
      title: "The code it cites",
    },
  ],
  status: "draft for sign-off",
  steps: [
    {
      id: "title",
      kind: "title",
      scene: "hero",
      section: "open",
      text: "This ticket asks which mode pulls better: the coachman writing the change itself, or lanes judged into one. It takes a few minutes to scroll.",
      title: "Which mode pulls better",
    },
    {
      id: "hello",
      scene: "d",
      section: "open",
      state: "all",
      text: "Every run since #270 landed is judged by the review rounds it needed, with its findings, time and tokens beside it. Eight criteria below say what the report covers.",
      title: "Runs in each mode, compared",
    },
    {
      excerpt: true,
      find: ["The comparison covers every run"],
      id: "c1",
      kind: "criterion",
      scene: "ticket",
      section: "c1",
      text: "Every run counts, under the mode it ran in, whatever the setting said when it was dispatched.",
      title: "Every run, under its mode",
    },
    {
      id: "c1d",
      scene: "d",
      section: "c1",
      state: "all",
      text: "The setting may say one thing while a run went another way. The report reads the mode from each run's own record.",
      title: "Read from the run, not the setting",
    },
    {
      focus: [[617, 629]],
      id: "c1code",
      scene: "coach",
      section: "c1",
      text: "The runbook keeps the mode beside the run it dispatched, so the comparison can trust what each run says about itself.",
      title: "Where the mode is kept",
    },
    {
      excerpt: true,
      find: ["listed apart and not compared"],
      id: "c2",
      kind: "criterion",
      scene: "ticket",
      section: "c2",
      text: "A run the user steered onto a mode is shown on its own, outside the comparison it would tilt.",
      title: "Named modes stand apart",
    },
    {
      id: "c2d",
      scene: "d",
      section: "c2",
      state: "all",
      text: "Naming a mode is a choice about that run, not evidence about the modes. Listing it apart keeps the comparison honest.",
      title: "A choice is not evidence",
    },
    {
      excerpt: true,
      find: ["says its mode played no part."],
      id: "c3",
      kind: "criterion",
      scene: "ticket",
      section: "c3",
      text: "A run that never reached its card counts against its mode, unless the user says the mode played no part in it.",
      title: "Unfinished runs count",
    },
    {
      id: "c3d",
      scene: "d",
      section: "c3",
      state: "all",
      text: "Leaving unfinished runs out would flatter the mode that strands more of them. The default counts them.",
      title: "No flattery by omission",
    },
    {
      excerpt: true,
      find: ["compares the two modes on the review rounds"],
      id: "c4",
      kind: "criterion",
      scene: "ticket",
      section: "c4",
      text: "Review is where most of a run's time goes, so the rounds each mode needed are the head-to-head.",
      title: "Rounds are the head-to-head",
    },
    {
      id: "c4d",
      scene: "d",
      section: "c4",
      state: "all",
      text: "A run's rounds mostly follow its first round's findings. Fewer rounds means the first draft needed less repair.",
      title: "Fewer rounds, better draft",
    },
    {
      focus: [[16, 19]],
      id: "c4code",
      scene: "decide",
      section: "c4",
      text: "The loop's own rule decides when another round runs, so the count means the same thing for every run.",
      title: "The rule that counts rounds",
    },
    {
      excerpt: true,
      find: ["serious first-round findings as the reviewers graded them"],
      id: "c5",
      kind: "criterion",
      scene: "ticket",
      section: "c5",
      text: "Rounds are coarse, so the report sets the serious first-round findings, the set-aside share, the time and the tokens beside them.",
      title: "Beside the rounds",
    },
    {
      id: "c5d",
      scene: "d",
      section: "c5",
      state: "all",
      text: "Two modes can tie on rounds while one finds less, sets less aside, or costs less to reach its card.",
      title: "What rounds cannot say",
    },
    {
      focus: [[1, 13]],
      id: "c5code",
      scene: "times",
      section: "c5",
      text: "The time to the card comes from the run's own stage timings, read the same way for every run.",
      title: "Time from the run's record",
    },
    {
      excerpt: true,
      find: ["backs every count with a control"],
      id: "c6",
      kind: "criterion",
      scene: "ticket",
      section: "c6",
      text: "Every count in the report carries the control that says what was counted and what would have failed it.",
      title: "Every count, a control",
    },
    {
      id: "c6d",
      scene: "d",
      section: "c6",
      state: "all",
      text: "A count without a control is a claim about the reporter's care. The controls make each count checkable.",
      title: "Checkable, not claimed",
    },
    {
      excerpt: true,
      find: ["among them what changed in the flow"],
      id: "c7",
      kind: "criterion",
      scene: "ticket",
      section: "c7",
      text: "The runs are few and the flow kept moving under them, so the report says plainly what its counts can and cannot carry.",
      title: "What few runs can show",
    },
    {
      id: "c7d",
      scene: "d",
      section: "c7",
      state: "all",
      text: "Models changed, the flow changed, and tickets differ. The report names each of these beside its counts.",
      title: "Name what moved",
    },
    {
      excerpt: true,
      find: ["published as a wiki page"],
      id: "c8",
      kind: "criterion",
      scene: "ticket",
      section: "c8",
      text: "The report lands as a wiki page, with its extraction and data beside it, shaped like the lane audit's.",
      title: "A page, with its data",
    },
    {
      id: "c8d",
      scene: "d",
      section: "c8",
      state: "all",
      text: "The lane audit's shape is the project's standard for such looks: method, counts, controls, and the data to redo them.",
      title: "The audit's shape",
    },
    {
      id: "leftout",
      scene: "left",
      section: "left",
      text: "The ticket's notes cite {changed} lines of code as it stands at its base, and {shown} of them are on the steps above. The rest are listed in the panel.",
      title: "The code it cites",
    },
  ],
  ticket: 271,
  title: "Ticket story of #271",
};

export const SCRUB_TICKET: TicketJson = {
  title: "A page shows no address",
  body:
    "## Problem / feature\n\nWrite to " +
    "reviewer@com" +
    "pany.co for access, or to nobody@example.com for the samples.\n\n## Acceptance criteria\n\n1. The page shows no address.\n",
};

export const SCRUB_STORY: unknown = {
  title: "Ticket story of #999",
  mode: "ticket",
  repoUrl: "https://github.com/brindlewick/postmaster",
  ticket: 999,
  at: "HEAD",
  status: "draft for sign-off",
  sections: [
    { id: "open", label: "Start", title: "The ticket" },
    { id: "c1", label: "C1", title: "Criterion 1" },
  ],
  scenes: [
    {
      id: "hero",
      kind: "image",
      label: "Ticket #999",
      chip: "for your reading",
      prompt: "art/opening-prompt.txt",
      alt: "A placeholder picture standing in for the drawn opening.",
    },
    {
      id: "ticket",
      kind: "doc",
      from: "issue",
      number: 999,
      label: "Ticket #999",
      chip: "what you sign",
    },
    {
      id: "d",
      kind: "diagram",
      label: "The question",
      chip: "diagram",
      svg: "diagrams/d.svg",
      states: ["all"],
      caption: "One coachman alone, or lanes judged into one.",
    },
  ],
  steps: [
    {
      id: "title",
      section: "open",
      scene: "hero",
      kind: "title",
      title: "No address on the page",
      text: "Before any text is shown, the builder removes email addresses. This story proves it with one address that must go and one that must stay.",
    },
    {
      id: "hello",
      section: "open",
      scene: "d",
      state: "all",
      title: "Removed, line numbers kept",
      text: "An address outside the example domains becomes removed, with the lines where they were. The samples address stays as it is.",
    },
    {
      id: "c1",
      section: "c1",
      scene: "ticket",
      excerpt: true,
      find: ["The page shows no address"],
      kind: "criterion",
      title: "No address shown",
      text: "The criterion, and the problem line above it with both addresses, show the rule in both directions.",
    },
    {
      id: "c1d",
      section: "c1",
      scene: "d",
      state: "all",
      title: "Both directions",
      text: "The page holds the removed marker where the company address was, and the example address untouched.",
    },
  ],
};

// ---------- staging: story dirs, ticket files, the stub (edges) ----------

export interface Staged {
  dir: string;
  ticket352: string;
  ticket271: string;
  adapter: string;
  image: string;
}

export function stageBase(): Staged {
  const dir = mkdtempSync(join(tmpdir(), "story-352-"));
  const ticket352 = join(dir, "ticket-352.json");
  const ticket271 = join(dir, "ticket-271.json");
  writeFileSync(ticket352, JSON.stringify(TICKET_352));
  writeFileSync(ticket271, JSON.stringify(TICKET_271));
  const adapter = join(dir, "stub-adapter.sh");
  writeFileSync(adapter, STUB_ADAPTER_SH);
  chmodSync(adapter, 0o755);
  const image = join(dir, "known.png");
  writeFileSync(image, Buffer.from(KNOWN_PNG_B64, "base64"));
  return { dir, ticket352, ticket271, adapter, image };
}

/** The trial's #352 story, copied, its hero converted from a file to a prompt. */
export function stage352(dir: string): string {
  const storyDir = join(dir, "story352");
  cpSync(TRIAL_352, storyDir, { recursive: true });
  const file = join(storyDir, "story.json");
  const text = readFileSync(file, "utf8");
  const from = '"src": "art/opening.jpg"';
  if (text.split(from).length - 1 !== 1) throw new Error("trial story has no single hero src");
  writeFileSync(file, text.replace(from, '"prompt": "art/opening-prompt.txt"'));
  return storyDir;
}

export function stage271(dir: string): string {
  const storyDir = join(dir, "story271");
  mkdirSync(join(storyDir, "diagrams"), { recursive: true });
  mkdirSync(join(storyDir, "art"), { recursive: true });
  writeFileSync(join(storyDir, "story.json"), `${JSON.stringify(STORY_271, null, 2)}\n`);
  writeFileSync(join(storyDir, "diagrams", "d.svg"), DRAWING_SVG);
  writeFileSync(join(storyDir, "art", "opening-prompt.txt"), PROMPT_271);
  return storyDir;
}

export function stageScrub(dir: string): string {
  const storyDir = join(dir, "scrub");
  mkdirSync(join(storyDir, "diagrams"), { recursive: true });
  mkdirSync(join(storyDir, "art"), { recursive: true });
  writeFileSync(join(storyDir, "story.json"), `${JSON.stringify(SCRUB_STORY, null, 2)}\n`);
  writeFileSync(join(storyDir, "diagrams", "d.svg"), DRAWING_SVG);
  writeFileSync(join(storyDir, "art", "opening-prompt.txt"), PROMPT_271);
  return storyDir;
}

export interface StoryShape {
  sections: { id: string; label: string; title: string }[];
  scenes: { id: string; kind: string }[];
  steps: { id: string; section: string; scene: string; state?: string }[];
}

export function readStory(storyDir: string): StoryShape {
  return JSON.parse(readFileSync(join(storyDir, "story.json"), "utf8")) as StoryShape;
}

export function writeStory(storyDir: string, story: StoryShape): void {
  writeFileSync(join(storyDir, "story.json"), `${JSON.stringify(story, null, 2)}\n`);
}

export function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

// ---------- running the builder (edges) ----------

export interface Build {
  code: number;
  out: string;
  err: string;
  storyDir: string;
  outDir: string;
  log: string;
  html: string | null;
  sheet: string | null;
}

export function runBuild(
  storyDir: string,
  ticketFile: string,
  adapter: string,
  image: string,
  name: string,
): Build {
  const outDir = join(dirname(storyDir), `${name}-out`);
  const log = join(dirname(storyDir), `${name}-adapter.log`);
  const r = run(
    RUN,
    [
      "story-page",
      "build",
      REPO,
      storyDir,
      outDir,
      "--ticket-body",
      ticketFile,
      "--picture-adapter",
      adapter,
    ],
    { env: { STUB_ADAPTER_LOG: log, STUB_ADAPTER_IMAGE: image }, timeout: 120_000 },
  );
  const page = join(outDir, "index.html");
  const sheet = join(outDir, "sheet.html");
  return {
    code: r.code,
    out: r.out,
    err: r.err,
    storyDir,
    outDir,
    log,
    html: existsSync(page) ? readFileSync(page, "utf8") : null,
    sheet: existsSync(sheet) ? readFileSync(sheet, "utf8") : null,
  };
}

export function runPick(
  viewport: string,
  boxes: [number, number][],
): { code: number; out: string; err: string } {
  const r = run(
    RUN,
    ["story-page", "pick-step", "--viewport", viewport, "--boxes", JSON.stringify(boxes)],
    { timeout: 30_000 },
  );
  return { code: r.code, out: r.out, err: r.err };
}

/** The stub adapter's log lines for a build, or nothing when it never ran. */
export function adapterLog(b: Build): string[] {
  if (!existsSync(b.log)) return [];
  return readFileSync(b.log, "utf8")
    .split("\n")
    .filter((l) => l.length > 0);
}

// ---------- reading the ticket and the page (pure core) ----------

export interface Cited {
  lines: Set<string>;
  whole: string[];
}

const LINK =
  // ASCII: blob URLs and line numbers are ASCII by GitHub's form.
  /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/blob\/([0-9a-f]{7,40})\/([^)\s#]+)(?:#L(\d+)(?:-L(\d+))?)?/gu;

/** Every line the ticket cites as path@line, and every whole file it names. */
export function cited(body: string): Cited {
  const lines = new Set<string>();
  const whole: string[] = [];
  for (const m of body.matchAll(LINK)) {
    const path = m[2] ?? "";
    const from = m[3];
    if (from === undefined) {
      if (!whole.includes(path)) whole.push(path);
      continue;
    }
    const to = m[4] ?? from;
    for (let n = Number(from); n <= Number(to); n++) lines.add(`${path}@${n}`);
  }
  return { lines, whole };
}

const LINK_ONE =
  // ASCII: blob URLs and line numbers are ASCII by GitHub's form.
  /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/blob\/([0-9a-f]{7,40})\/([^)\s#]+)(?:#L(\d+)(?:-L(\d+))?)?/u;

/** The first blob link in the ticket, for the wrong-commit control. */
export function firstLink(body: string): { url: string; path: string; sha: string } {
  const m = LINK_ONE.exec(body);
  if (!m) throw new Error("ticket names no blob link");
  return { url: m[0] ?? "", path: m[2] ?? "", sha: m[1] ?? "" };
}

export interface StepDatum {
  i: number;
  id: string;
  scene: string;
  section: string;
  kind: string;
  lit: number[];
  marks: { row: number; text: string[] }[];
  excerpt: boolean;
  state?: string;
  label: string;
  chip: string;
  lines: string;
}

export interface SceneDatum {
  id: string;
  kind: string;
  states?: string[];
}

export interface StoryData {
  n: number;
  steps: StepDatum[];
  scenes: SceneDatum[];
}

/** The page's embedded story data: every step, its scene, and what it lights. */
export function storyData(html: string): StoryData {
  const m = /<script type="application\/json" id="story-data">(.*?)<\/script>/su.exec(html);
  if (!m) throw new Error("no story-data in page");
  return JSON.parse(m[1] ?? "") as StoryData;
}

export interface SceneDiv {
  cls: string;
  id: string;
}

/** Every scene the page renders, in page order. */
export function sceneDivs(html: string): SceneDiv[] {
  const out: SceneDiv[] = [];
  for (const m of html.matchAll(/<div class="scene ([^"]*)" data-id="([^"]+)"/gu)) {
    out.push({ cls: m[1] ?? "", id: m[2] ?? "" });
  }
  return out;
}

/** The section nav's labels, in page order. */
export function navLabels(html: string): string[] {
  const nav = /<nav class="secs"[^>]*>(.*?)<\/nav>/su.exec(html);
  if (!nav) throw new Error("no sections nav in page");
  const out: string[] = [];
  for (const m of (nav[1] ?? "").matchAll(/<a [^>]*>([^<]*)<\/a>/gu)) out.push(m[1] ?? "");
  return out;
}

export interface Article {
  cls: string;
  id: string;
  num: number;
  inner: string;
}

/** Every step article, in page order (articles never nest). */
export function articles(html: string): Article[] {
  const out: Article[] = [];
  for (const m of html.matchAll(
    // ASCII: step ids and indices are ASCII digits, which \d matches exactly.
    /<article class="step([^"]*)" id="(s\d+)" data-i="(\d+)">(.*?)<\/article>/gsu,
  )) {
    out.push({ cls: m[1] ?? "", id: m[2] ?? "", num: Number(m[3]), inner: m[4] ?? "" });
  }
  return out;
}

export interface CodeRow {
  type: string;
  key: string;
  scene: string;
  num: string;
  text: string;
}

/** Every code row in the page: steps and the closing list alike. */
export function codeRows(html: string): CodeRow[] {
  const out: CodeRow[] = [];
  const re =
    /<div class="r ([a-z]+)" data-k="([^"]+)" data-scene="([^"]+)"><span class="n">([^<]*)<\/span><span class="sg">[^<]*<\/span><span class="c">(.*?)<\/span><\/div>/gu;
  for (const m of html.matchAll(re)) {
    out.push({
      type: m[1] ?? "",
      key: m[2] ?? "",
      scene: m[3] ?? "",
      num: m[4] ?? "",
      text: m[5] ?? "",
    });
  }
  return out;
}

export interface Block {
  tag: string;
  b: number;
  scene: string;
  src: string | null;
  inner: string;
}

/** Every ticket and Markdown block in the page, with its source lines. */
export function blocks(html: string): Block[] {
  const out: Block[] = [];
  const re =
    // ASCII: block indices are ASCII digits, which \d matches exactly.
    /<(p|li|h2|h3|h4|pre) class="b[^"]*" data-b="(\d+)" data-scene="([^"]+)"( data-src="([^"]+)")?>(.*?)<\/\1>/gsu;
  for (const m of html.matchAll(re)) {
    out.push({
      tag: m[1] ?? "",
      b: Number(m[2]),
      scene: m[3] ?? "",
      src: m[5] ?? null,
      inner: m[6] ?? "",
    });
  }
  return out;
}

/** Tag-free text, whitespace collapsed, entities unescaped. */
export function plain(html: string): string {
  return html
    .replace(/<[^>]*>/gu, "")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, "&")
    .replace(/\s+/gu, " ") // ASCII: runs collapse for comparison on both sides alike.
    .trim();
}

/** The lit blocks' text for one step, in lit order. */
export function litText(html: string, scene: string, lit: number[]): string {
  const byB = blocks(html)
    .filter((b) => b.scene === scene)
    .sort((a, b) => a.b - b.b);
  return lit.map((j) => plain(byB[j]?.inner ?? "")).join("\n");
}

/** Every embedded picture in the page. */
export function imgSrcs(html: string): { mime: string; b64: string }[] {
  const out: { mime: string; b64: string }[] = [];
  for (const m of html.matchAll(/<img src="data:([^;]+);base64,([^"]+)"/gu)) {
    out.push({ mime: m[1] ?? "", b64: m[2] ?? "" });
  }
  return out;
}

/** Cited lines on no step and not in the closing list, from the page's rows. */
export function coverageMissing(body: string, html: string): string[] {
  const { lines } = cited(body);
  const keys = new Set(codeRows(html).map((r) => r.key));
  const ranges = new Map<string, { from: number; to: number }[]>();
  for (const b of blocks(html)) {
    if (!b.src) continue;
    // ASCII: source lines are ASCII digits, which \d matches exactly.
    const m = /^(.+)@(\d+)(?:-(\d+))?$/u.exec(b.src);
    if (!m) throw new Error(`bad data-src: ${b.src}`);
    const list = ranges.get(m[1] ?? "") ?? [];
    list.push({ from: Number(m[2]), to: Number(m[3] ?? m[2]) });
    ranges.set(m[1] ?? "", list);
  }
  const missing: string[] = [];
  for (const line of [...lines].sort()) {
    if (keys.has(line)) continue;
    const at = line.lastIndexOf("@");
    const list = ranges.get(line.slice(0, at)) ?? [];
    const n = Number(line.slice(at + 1));
    if (!list.some((r) => n >= r.from && n <= r.to)) missing.push(line);
  }
  return missing;
}

/** Each drawing's aria-label in page order, null where it has none. */
export function svgAria(html: string): (string | null)[] {
  const out: (string | null)[] = [];
  // ASCII: tag and class names are ASCII.
  for (const m of html.matchAll(/<svg\b[^>]*>/gu)) {
    const tag = m[0] ?? "";
    // ASCII: tag and class names are ASCII.
    if (!/\bdg\b/u.test(tag)) continue;
    const a = /aria-label="([^"]*)"/u.exec(tag);
    out.push(a ? (a[1] ?? "") : null);
  }
  return out;
}

/** Each drawing's caption in page order. */
export function figcaptions(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<figcaption>(.*?)<\/figcaption>/gsu)) {
    out.push((m[1] ?? "").trim());
  }
  return out;
}

/** Whether the page's script switches a drawing's state per step. */
export function scriptSwitches(html: string): boolean {
  return html.includes('setAttribute("data-state"');
}

// ---------- the oracle's builds (edges) ----------

export interface AllBuilds {
  dir: string;
  image: string;
  b352: Build;
  b271: Build;
  nodraw: Build;
  onedraw: Build;
  dropscrub: Build;
  badlink: Build;
  noadapter: Build;
  badstate: Build;
  scrub: Build;
}

/** Every page the checks read: two whole stories and each control's variant. */
export function buildAll(): AllBuilds {
  const s = stageBase();
  const s352 = stage352(s.dir);
  const s271 = stage271(s.dir);
  const sscrub = stageScrub(s.dir);

  const diagramIds = readStory(s352)
    .scenes.filter((x) => x.kind === "diagram")
    .map((x) => x.id);
  const copy = (from: string, name: string): string => {
    const to = join(s.dir, name);
    cpSync(from, to, { recursive: true });
    return to;
  };
  const sNodraw = copy(s352, "story352-nodraw");
  const nodraw = readStory(sNodraw);
  nodraw.steps = nodraw.steps.filter((x) => !(x.section === "c1" && diagramIds.includes(x.scene)));
  writeStory(sNodraw, nodraw);
  const sOnedraw = copy(s352, "story352-onedraw");
  const onedraw = readStory(sOnedraw);
  onedraw.steps = onedraw.steps.filter((x) => x.id !== "layout");
  writeStory(sOnedraw, onedraw);
  const sDropscrub = copy(s352, "story352-dropscrub");
  const dropscrub = readStory(sDropscrub);
  dropscrub.steps = dropscrub.steps.filter((x) => x.id !== "scrub");
  writeStory(sDropscrub, dropscrub);
  const badTicket = join(s.dir, "ticket-352-bad.json");
  writeFileSync(
    badTicket,
    JSON.stringify({
      title: TICKET_352.title,
      body: TICKET_352.body.replace("blob/14bd42d/", "blob/deadbee/"),
    }),
  );
  const scrubTicket = join(s.dir, "ticket-scrub.json");
  writeFileSync(scrubTicket, JSON.stringify(SCRUB_TICKET));
  const sBadstate = copy(s271, "story271-badstate");
  const badstate = readStory(sBadstate);
  const victim = badstate.steps.find((x) => x.id === "c1d");
  if (!victim) throw new Error("271 story has no c1d step");
  victim.state = "bogus";
  writeStory(sBadstate, badstate);

  return {
    dir: s.dir,
    image: s.image,
    b352: runBuild(s352, s.ticket352, s.adapter, s.image, "b352"),
    b271: runBuild(s271, s.ticket271, s.adapter, s.image, "b271"),
    nodraw: runBuild(sNodraw, s.ticket352, s.adapter, s.image, "nodraw"),
    onedraw: runBuild(sOnedraw, s.ticket352, s.adapter, s.image, "onedraw"),
    dropscrub: runBuild(sDropscrub, s.ticket352, s.adapter, s.image, "dropscrub"),
    badlink: runBuild(s352, badTicket, s.adapter, s.image, "badlink"),
    noadapter: runBuild(s271, s.ticket271, join(s.dir, "no-such-adapter"), s.image, "noadapter"),
    badstate: runBuild(sBadstate, s.ticket271, s.adapter, s.image, "badstate"),
    scrub: runBuild(sscrub, scrubTicket, s.adapter, s.image, "scrubbuild"),
  };
}
