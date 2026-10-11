---
title: A ticket or a change reads better as a story that scrolls, drawn before it shows code
type: concept
standing: claimed
sources: [trials/2026-10-09-story-pages]
updated: 2026-10-10
---

# A ticket or a change reads better as a story that scrolls, drawn before it shows code

**Claim.** On a phone or an iPad, the user takes in a ticket or a change better as a story page than as a
long document or a page of tabs. The page opens on a picture and a plain welcome, gives each acceptance
criterion a section in which a drawing comes before the code, and keeps a panel beside the story that
shows what the step being read is about [@trials/2026-10-09-story-pages].

**Standing: claimed.** One user's judgment of one change and one ticket over two days. Nothing measured
how long a review took or what a reader caught.

## What was tried

Three pages, built from story files by a script and published as private artifacts
[@trials/2026-10-09-story-pages]:

- a merged change, pull request 336, told mostly in words and code;
- the same change told with ten drawings, each placed before the code it explains;
- a ticket, #352, told for review before it is built, opening on a picture drawn by Codex in the style of
  the project's poster.

## What the user chose

- One scroll from start to end, with a section for each acceptance criterion, and a clear box on the step
  being told.
- Drawings before code. The drawn form's greater length was no problem, because steps are easy to scroll.
- Tickets first. The user reviews tickets more often than changes, so a story tells a ticket too, with the
  code it will touch as that code stands today.
- A simple, inviting start: a picture in the poster's style and a plain welcome, not the ticket's text. The
  ticket's words appear a step at a time, and whole near the end.
- Markdown files shown formatted, code shown as code.

## How a page is made

A session writes a story file: the sections, the scenes the panel can show, and for each step a few
sentences and what it lights. A builder reads it with the code at a commit and the ticket's text, checks
that every line, sentence and drawing state it names exists, and writes one page. Every changed line of a
change, or every line a ticket cites, is on a step or in a closing list, so a story cannot hide part of
what it tells. The picture comes from Codex's image tool, with the poster as its style reference, in about
two minutes [@trials/2026-10-09-story-pages].

## Who makes one, and what comes next

#352 builds the story page for tickets. #434 has the booking clerk make one for every ticket it prepares,
by default, with a setting to turn it off. Until then a session makes one when asked. A step for each
decision, the refusal of a story that points at what is not there, and stories for merged changes are
drafted as follow-ups.

## Open

- Whether a story shortens a review, or helps the user catch more, is not measured.
- The words are an agent's. The coverage check shows every line it tells about, and the follow-up check
  would refuse a step that points at what is not there, but neither checks that the words are right.
- Each picture uses about two minutes of the Codex limit that the Codex lanes share.

**What would change it:** reviews measured to take longer, or to miss more, with stories than without; or
the user going back to the ticket's document once stories are made for every ticket.
