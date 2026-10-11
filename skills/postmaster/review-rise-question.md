# Why this review loop is not converging

A review loop stopped because one round found more serious defects than the
round before. Your question is why: read the materials and answer the four
parts below, each under its own heading, carrying the name it is given here.
Answer from the materials alone, in the form your skill sets; where the
materials do not settle a part, say so instead of filling the gap.

## Your materials

The ticket under review, every round's reviewers' reports, and one rounds
file: its `survey-snapshot` is the stop round's snapshot, its `counts` line
the serious count per round as the loop's decision counts it, written as
`r<round>=<count>` pairs, its `round-snapshots` line each round's snapshot,
and below them the
finding, review-launch and degrade lines to the stop, verbatim, in record
order. The code is the checkout you were given, cut at the stop round's
snapshot with its history: read an earlier round's code with
`git show <its snapshot>` from the rounds file. A round whose snapshot reads
`not-recorded` has no recorded snapshot; say so if it matters.

## What the findings share

What the rounds' findings have in common: the sites, the shape, the pattern.

## Where the cause lies

Whether the cause is in the change, in the ticket, in the reviewers, or in
something from outside the review such as a merge from the main branch.

## What is still open

What the findings leave undecided.

## Whether another round is likely to help

Whether fixing and reviewing again would converge, and why.

Your skill asks for closing plain sentences after your last part; they are
quoted to the user with the question, before the options, so write them for
a reader who reads nothing else. End your answer with those sentences as
their own final paragraph, after `## What I could not tell`.
