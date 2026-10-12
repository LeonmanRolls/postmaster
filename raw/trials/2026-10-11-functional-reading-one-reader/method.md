---
kind: trial
subject: which of two versions of one function a person finds easier to follow, the original or the one with no mutation
date: 2026-10-11
---

# Method

**Question.** Whether the user, the person this project's code is read by when it is read by a person,
finds the functional version of a function easier to follow than the original. It follows
[the reading trial of the same day](../2026-10-11-functional-reading/method.md), which used a model as
the reader and left open whether a person finds either easier.

**What was shown.** `textWrap` of `view-stream.ts` in two versions with the same behaviour, on a page
made for a phone ([page.html](page.html)), with the two small helpers and the one constant they both
use. The versions are the original and the functional arrangement of
[the earlier record](../2026-10-11-functional-reading/arrangements/view-stream/): the original is 30
lines and keeps the text as a reversed list of chunks, taking from the end of it and changing a
counter; the functional one is 45 lines, a record of the line being filled and two small functions.
They were labelled A and B, with no word about style and no word about which was which.

**Which was which was fixed before the page was built,** by a seeded coin: `random.Random(20261011).random()`
reads 0.4919, below 0.5, so A is the original and B the functional version.

**What was asked.** Three questions, answered in the chat: which is easier to follow; which they would
rather change, say to let a word longer than a line run past the width instead of breaking it; which
they are more sure is correct, reading it without running it.

**The answer,** in their words: "I think B is much better". It was one answer to the page, not one for
each question, so it is recorded as that and not as three.

## What it shows, and what it does not

It is one person's preference for one function of 30 lines against 45, given after the page was
built to be read as one reads code before changing it. It was not blind to the question: the user had
asked for the trial and had said they expected functional code to show its benefits at larger scales. It is a datum, not a
test; it has no control for the length or for the layout, and no second reader.

It differs from the model readers of the earlier record, which found no difference in the questions
they were asked about this module. That fits what the earlier record says it cannot show: a model
answering what a function returns for an input is one kind of following, and a person choosing which
version they would rather read is another.
