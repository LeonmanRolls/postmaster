# Brief for a reader of later review findings

You are one of two readers who each mark the same findings independently, with no contact. Read this
whole file, then the packet files you are given, and return your marks as text. Do not run any
command, do not open any file other than this brief and your packets, and do not look for how the
runs ended or what anyone else decided. Everything you need is in the packets.

## What a packet holds

One run per packet file: the ticket as it was dispatched (the plain part the user signed off, and
its checks), the run's own lines about rulings and escalations, and then the run's **later
findings**: serious review findings from round 2 on. Each has an id like `335.3.1`, its round,
severity, lens, lanes, target, the finding's text, the code at the cited lines, some facts about
where those lines came from, and earlier serious findings in the same file.

A run's review leg runs in rounds. Reviewers read the change, the coachman checks what they found
and fixes what is real, and another round follows while the last one found a serious problem. A
finding from round 2 on is one the earlier rounds did not leave closed.

## The three marks

Mark every finding that has text. Use only the packet's ticket, text and facts.

**ticket_open**, one of `yes`, `no`, `unclear`.
- `yes`: the finding is about behaviour the ticket's criteria, decisions, direction and checks
  neither state nor rule out, where more than one reasonable behaviour exists, so the fix chose one
  the ticket could have chosen: a case a criterion does not cover, a precedence, a failure mode, a
  "what happens when" the ticket never says.
- `no`: the ticket states the behaviour, so the code is wrong against it; or any reading of the
  ticket requires the fix (a crash, a wrong comparison, a missing guard, a stale sentence); or the
  finding is about something the ticket does not reach.
- `unclear`: the text is too short to tell.
- A small gap that has one sane answer is `no`. The ticket template leaves such gaps to the lanes,
  and a finding on one is the lanes' to find.

**disagrees**, `yes` or `no`: the finding asks for the reverse of a change an earlier round made,
objects to a decision an earlier ruling made, or is the opposite of what another reviewer of the
same round reported.

**kind**, one of seven; take the first in this order that fits:
`input` the code reads or classifies an input it could not list in advance and handles one shape
wrongly; `state` an ordering, a race, a crash or restart, a partial failure or a repeated call;
`contract` two places that must agree do not: a producer and its reader, a document and its code, a
test and what it tests, a preview and the real action; `site` the same defect, or the same missing
rule, at one more place a fix or the ticket's rule should have reached; `prose` a runbook or
document that is wrong, ambiguous or missing a step, where the defect is in the words; `test` a
check or test that is missing, vacuous or wrong; `other`.

## What to return

Only tab-separated lines, one per finding, in the packets' order, with no header and no other text:

`id<TAB>ticket_open<TAB>disagrees<TAB>kind<TAB>reason`

where `reason` is at most 20 words and says what in the packet decided `ticket_open`. Do not add a
summary, a table or a note after the lines. Mark every finding in every packet you are given.
