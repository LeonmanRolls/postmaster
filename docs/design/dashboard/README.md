# The dashboard's look

This folder holds the look chosen for the dashboard in the ticket "Design: clickable
prototypes of the dashboard from every model, before it is built".
The dashboard is built to it, in
[#32, A read-only web dashboard of every run, on the tailnet, for phone, iPad and desktop](https://github.com/LeonmanRolls/postmaster/issues/32)
and the tickets after it. What the dashboard shows, and what it must never do, is in
[the dashboard concept](../../../wiki/concepts/dashboard.md). This folder covers how it looks.

| file | what it is |
|---|---|
| `prototype.html` | the chosen prototype, byte for byte |
| `shots/` | twelve pictures of it: three pages, two widths, two themes |
| `README.md` | its values and parts, what it does, and what not to copy from it |

When this page and the prototype disagree, the prototype is right, except where
[What not to copy](#what-not-to-copy) says otherwise.

## Where it came from

The user chose it on 2026-10-05, from 44 prototypes built on made-up data, because "it felt the
easiest to read". GPT-6 Astra built it
(`gpt-6-astra` on codex CLI 0.157.1, reasoning effort max) from a seed the user picked: a landing
page in engraved navy and coral, [Dribbble shot 11124390](https://dribbble.com/shots/11124390). It
takes the seed's palette and manner, not its pictures. The record of the choice, in the user's
words, is under "How it looks" in [the dashboard concept](../../../wiki/concepts/dashboard.md).

## The prototype file

The first nine lines and the last three are the frame it was shown in: a doctype, a charset, a
viewport and a small reset. Everything between the two marker comments is the prototype as
written. This prints its hash, which must be
`649fa05538b626f0cbe42429dbd5c6f7f3564d432243ef4793f116e3f87ebe65`:

```sh
sed '1,/^<!-- The prototype as written starts/d; /^<!-- The prototype as written ends/,$d' prototype.html | sha256sum
```

Open it in a browser with a network connection, so it loads its fonts. The file has four parts:

| lines | what |
|---|---|
| 11 to 490 | the CSS, the reference for every value this page leaves out |
| 491 to 516 | the masthead, the freshness line and an empty `main` |
| 517 to 7445 | made-up sample data: a project called marigold, its runs and their changes |
| 7446 to 7848 | the script that draws the three pages from the data |

The prototype has three pages: the home page, a run's page (tap a run card) and a run's change
(Read the change, on a run's page). The address ends in `#home`, `#run` or `#change`.

## The pictures

`shots/<page>-<width>-<theme>.png`, the whole page from top to bottom:

- page: `home`; `run`, the page of run #63; `change`, the change of run #44, with Summary beside
  Diff on the iPad, and the Diff tab on the phone.
- width: `phone`, 390 CSS pixels at device pixel ratio 2, so 780 pixels wide; `ipad`, 1180 CSS
  pixels at ratio 1, an iPad held landscape.
- theme: `light` or `dark`, set by the browser's colour scheme, which is all the page reads.

Firefox 156 drew them headless, with the page's web fonts loaded. They are reduced to 256 colours
to keep them small. Their commonest colours match the tokens exactly, but anti-aliased edges and
the load lines may band. The sample was read at 14:20:00 UTC on 3 October 2026, so every page
says "just now".

## Colour

Every colour is a token on `:root`, redefined for dark mode, and no rule names a colour directly.
The prototype redefines them twice, under `prefers-color-scheme: dark` and under
`[data-theme="dark"]`, because the page it was shown in could set a theme. The dashboard needs
only the first, unless it gets a theme switch of its own.

| token | light | dark | for |
|---|---|---|---|
| `--paper` | `#fcfaee` | `#192630` | the page; the gap a label cuts in a rule; the dialog; text on the notice bar |
| `--surface` | `#fffdf5` | `#20303b` | cards, panels, folds, the document pane, the file box |
| `--wash` | `#f1f0e4` | `#283844` | a held run, the open run in the rail, code, table heads, the copy hint, empty bars |
| `--ink` | `#304862` | `#e9e5d3` | text; the notice bar; active time and round progress |
| `--soft-ink` | `#526473` | `#c1c8c6` | second-level text: introductions, questions, eyebrows, breadcrumbs, run facts |
| `--muted` | `#65716e` | `#a8b8b9` | meta lines, captions, line numbers, empty states |
| `--rule` | `#c0c5b9` | `#495a61` | hairlines within and between parts; run cards' borders; an empty stage's dash |
| `--strong-rule` | `#304862` | `#9aafba` | the masthead's rule, section tops, folio cards, panels, tabs, buttons |
| `--coral` | `#f67355` | `#f68d73` | the accent: heading underlines, active tabs, the brand mark, stalled runs, the notice button, the memory line |
| `--coral-ink` | `#a7402c` | `#ffaf95` | coral as text: stalled, failing and stale values, list markers; the focus ring |
| `--coral-wash` | `#fce8dc` | `#43332f` | the postmaster's question, a stalled run, a wait panel, the past-cap badge, deleted lines |
| `--good` | `#466248` | `#afc69b` | the fresh dot, passing gate results, added lines' edge and count |
| `--good-wash` | `#eaf0e2` | `#2c3b33` | added lines |
| `--terminal` | `#273b4e` | `#14212c` | launch output and the toast; text on coral |
| `--terminal-ink` | `#f2eedc` | `#f2eedc` | text in launch output and the toast |
| `--terminal-muted` | `#b0c0c6` | `#b0c0c6` | second-level text in launch output |
| `--terminal-rule` | `#53697a` | `#53697a` | rules and the scrollbar in launch output |
| `--selection` | `#f9d8bc` | `#654a38` | selected text, selected code lines, the tap highlight |
| `--keyword` | `#855075` | `#d9acd1` | code: keywords |
| `--string` | `#55723e` | `#bdd498` | code: strings |
| `--number` | `#ac4d36` | `#ffac91` | code: numbers |
| `--comment` | `#667774` | `#a1b5b1` | code: comments, in italic |
| `--code-tag` | `#365c86` | `#a9c9ee` | code: tags |
| `--scrim` | `#172734a8` | `#101b24bd` | behind the copy dialog |
| `--shadow` | `#30486216` | `#101b2438` | the toast's shadow |
| `--transparent` | `transparent` | `transparent` | so that no rule names a colour |

The notice bar is ink with paper text, so it is navy in light mode and cream in dark mode.

## Type

Three faces, from one Google Fonts request at the top of the CSS:

```text
https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=IBM+Plex+Mono:wght@400;500&family=Source+Serif+4:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap
```

| token | stack | for |
|---|---|---|
| `--display` | `'DM Serif Display',Georgia,'Times New Roman',serif` | headings, card titles, the brand, the large counts and figures; weight 400 only |
| `--serif` | `'Source Serif 4',Georgia,'Times New Roman',serif` | reading text: the body at 16px/1.55, prose at 15px/1.7 |
| `--mono` | `'IBM Plex Mono',Consolas,'Liberation Mono',monospace` | labels, meta lines, times, small figures and code, at 8px to 12px |
| `--sans` | `Arial,Helvetica,sans-serif` | buttons and the masthead's nav, at 11px to 13px |

Labels in capitals are mono at 8px to 10px, most of them letter-spaced, up to .13em. The largest
display headings are set tight, at -0.6px to -1.8px, and display line heights run from 1 to 1.25.
All three faces are under the SIL Open Font License 1.1, which allows serving the same files with
the dashboard. Without them the page falls back to Georgia and Consolas, and no longer looks like
this.

Sizes of the main parts. An empty cell is the size to its left.

| part | below 700px | from 700px | from 1180px | from 1550px |
|---|---|---|---|---|
| brand | 29px | 32px | | |
| home heading | 45px | `clamp(40px,4.7vw,70px)` | | |
| section heading | 27px | 25px | | |
| count in the index | 31px | 36px | | |
| machine figure | 39px | 43px | | |
| question card title | 25px | 22px | 21px | |
| run card title | 24px | 21px | 18px | 22px |
| run page heading | 36px | `clamp(31px,3.25vw,47px)` | | |
| change page heading | 38px | `clamp(33px,4vw,51px)` | | |
| code line | 11px/1.8 | | | |

## Layout

The page is one column up to 2000px wide, with 18px of side padding below 700px, 28px from 700px
and 42px from 1550px.

- **Below 700px.** One column, except the machine's two figures, side by side, and the four
  counts, two by two. The notice bar drops its explanation and the masthead drops its nav.
  A run's page puts the list of runs in a fold at the top. A change shows one tab at a time:
  Ticket, Spec, Summary, Diff or Files.
- **From 700px.** The home page has two equal columns: what waits on the user and on the
  postmaster on the left, what is running and closed on the right. A run's page gets a rail of
  every run, 205px wide. A change shows its document (36%) beside its code (64%), the document
  staying in view as the code scrolls. Records sit two across.
- **From 1180px.** The home page puts what waits on the user in a side column 258px wide. Beside
  it, the postmaster's queue and the running runs are boards, one column per stage that any open
  run is in, each headed by the stage and its count, with a dash where it is empty. Closed runs
  sit three across. A run's page widens its rail to 224px and splits its overview in two, and
  launch outputs sit side by side, at least 400px each.
- **From 1550px.** The side column is 310px wide, and card text is a little larger.

Below 1180px there are no boards: each section lists its runs in one column, and a card names
its stage.

## Parts

**Every page**

- Masthead: the brand mark, a diamond drawn as SVG (line 495), the wordmark, the nav, and the
  project's name after a small diamond, over a strong rule.
- Freshness line: mono, a green dot and "Read 14:20:00 UTC · just now" on the left, the date on
  the right. Stale, it turns coral and the dot becomes a coral diamond.
- Foot: the wordmark, and "Read the dashboard. Answer in your chat with the postmaster."
- Section heads: a strong rule above, a display heading underlined 3px in coral, the count in a
  ruled box, a small label on the right.
- Folio cards and panels: a box in strong rule, its label set into the top rule on the page
  colour, like a form.

**Home**

- Heading: an eyebrow (project / Dashboard), "Every run, at a glance." with the second line
  underlined by a thick coral band, and the project's one-line description.
- The machine: CPU and memory as large figures, each with a line for the last hour (memory's in
  coral), and a fold of details.
- Four counts between strong rules: waiting on you, waiting on the postmaster, running, and
  closed in the last 24 hours. Each jumps to its section.
- Notice bar: how many runs are stalled, the rule that makes one stalled, and a coral button to
  the postmaster's queue.
- The postmaster's own question: a folio card in coral, labelled "◇ POSTMASTER", with "Answer in
  chat" in its foot.
- A question for the user: a folio card labelled with the ticket and "USER", the title with ↗,
  the question, its stage and round, and a foot with the time waited and "Open run →".
- Run card: the ticket number and ↗, the title, stage and leg, idle time, review round, the next
  step's code and how long it has waited, CPU and memory. Stalled: a 2px coral border, a coral
  wash, and a coral band reading "STALLED · 34m" across the top. Held: a wash, and a ruled
  "Ⅱ HELD" label in place of the ↗. Past the round cap: a coral badge, "Round 4 · past cap".
- Closed card: as a run card, with the time it closed and how it ended.

**A run's page**

- A breadcrumb with coral slashes. The rail of every run, in groups, the open one washed with a
  coral edge.
- An eyebrow and the heading, beside a ruled "Ticket #n ↗", with a coral "Read the change →"
  before it when the run has a change. Under them a line of facts, the usage, and links to
  Overview, Review rounds, Gate, Launches and Records.
- What it waits on, in a panel labelled "Next ·" and the step's code, which turns coral when the
  run waits on the user or is stalled. Escalations, review rounds, cards and records are folds
  that open with + and close with −.
- Timings: totals, then a bar for each stage, active time in ink, waiting in coral hatching.
- Review rounds: a progress bar, coral past the cap, a row for each reviewer with a status
  badge, and findings with their severity in coral.
- Gate: a table, passes in green, failures in coral.
- Team: a ruled box each for the coachman, its fallback, the workhorses and the reviewers, with
  model, harness and effort.
- Launches: each launch's output as a dark terminal panel, 380px of events that scroll, newest
  last. Shell commands start with a coral `$`, and errors are coral. Ended launches fold into
  light boxes.

**A run's change**

- The heading, the branch with its base and head commits, and a ruled "Pull request #n ↗".
- Tabs: Ticket, Spec and Summary over the document, Diff and Files over the code. The open tab is
  bold, with a 4px coral bar.
- Code: a file picker with ← and →, the file count and the lines added and removed, a hint on how
  to copy, then the file in a box: its path and counts, a legend, hunk headers, and numbered
  lines. Added lines are on a green wash with a green edge, deleted ones on a coral wash with a
  coral edge, and a selected line takes the selection colour with a coral-ink edge.
- A toast at the bottom right, dark with a coral border, and a dialog over the scrim.

## What it does

- **It only reads.** No control on any page changes anything. Where an answer is needed, the
  page says to answer in the chat with the postmaster.
- **Clocks run.** Every duration of an open run counts on each second from when the data was
  read. With no new data for 60 seconds, the freshness line says "Stale · no new data for" and
  how long.
- **Who a run waits on.** On the user: its next step is `USER`, plus the postmaster's own
  question when there is one. On the postmaster: its next step is one of `RULE`, `READ`, `GATE`,
  `SPEC`, `DISPATCH`, `ASK`, `TAKEOVER`, `RESUME` or `INSPECT`. Running: every other open run.
  Closed: closed in the last 24 hours, newest first.
- **Stalled.** A run waiting on the postmaster is stalled once it has waited more than twice the
  postmaster's polling interval, unless it is held. A held run is never stalled. Cards, panels
  and counts change as a run crosses the line, without a reload.
- **The Summary tab** leaves out the summary's "**Checks.**" paragraph.
- **Copying a line.** A tap copies `path:line` and the line's text. A second tap in the same
  file, side and view makes it a range, `path:a-b`, with every line's text. A deleted line's
  reference ends in "(base)". The clipboard is called inside the tap. If it refuses, a dialog
  shows the reference, selected. A toast confirms a copy.
- **Reach.** Every button, fold and select is at least 44px tall. Focus shows a 2px coral-ink
  outline, 4px out. A skip link leads to the content, the tabs follow the arrow keys, Home and
  End, and colours change with a transition only when reduced motion is not asked for.

## What not to copy

Reading the prototype found these places where it does not follow its data:

1. The project's name in the masthead is typed in, `<span>marigold</span>` on line 499. The
   eyebrows already read it from the data.
2. From 1180px the boards always have six columns, `.lane-grid` on line 377, the number of
   stages the sample fills. With more stages in use they wrap to a second row; with fewer,
   columns stand empty. The column count must follow the stages in use.
3. The cap on review rounds is typed in, "Cap: 3 rounds" on line 7637. The sample has no cap,
   only whether a round is past it.
4. A count of one still takes a plural: "1 RUNS" (line 7581), "1 RUNS IN FLIGHT" (7583), "1 runs
   stalled" (7586), "1 events" (7660), "1 changed files" (7730).
5. The project's description drops a sentence starting "Made up" (line 7578), which only the
   sample has.

Nor are the frame lines, the sample data, or the `[data-theme]` rules part of the design.
