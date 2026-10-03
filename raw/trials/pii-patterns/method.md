---
kind: trial
subject: Patterns for personal data, beside Jev 1.13 on the same lines
date: 2026-10-03
---

# Method

**Question.** Issue #208. Jev 1.13 found personal data in prose with few false alarms, but on
this repository's real history it flagged nothing real (`../jev-pii/`). The user asked whether
the check's patterns could be made to cover what Jev catches, and do it better. Can patterns
alone, with no model and no network, find the personal data Jev finds? How do the two compare
on the same made-up lines, on lines neither was tuned to, and on the repository's history?

**The patterns**, `apparatus/patterns.ts`, TypeScript run by Bun, with no dependency. A rule finds
a value by its shape, by a checksum where the value carries one, by a word beside it that says
what it is, or by the slot it sits in.

- **Names**: two or more capitalised words in a slot. The slots are a sign-off or co-author line,
  an author, maintainer or contact field, a copyright line, a git identity, a name before an
  email address in angle brackets, a credit such as "thanks to" or "assigned to", "my name is",
  and a title such as Mr or Dr, after which one word is enough. A placeholder name, or a name
  holding a product's, a vendor's or this project's word, is left alone, and so is an author
  field in a citation's front matter: a title beside a link within three lines.
- **Email addresses**: the address shape, Unicode included, less public no-reply addresses,
  reserved domains, and role mailboxes such as support or security.
- **Phone numbers**: 8 to 15 digits, either international, with a leading +, or grouped on a line
  that says it holds a phone number; never a date, a time, an IP address or a toll-free line.
- **Other details**: card numbers, by the Luhn check and the issuer's prefix; IBANs, by mod-97;
  US social security numbers; ID numbers after a word that names them, such as passport or
  licence; a date after "born" or "date of birth"; and phrases: a diagnosis with a person as its
  subject, income, the writer's own family, and where the writer lives or works.
- **Street addresses**: a house number before capitalised words and a street type; a European
  street name before its number; a UK postcode after a town; a US city, state and ZIP; a PO box.

**v1** was written before any run over the history, and is kept as it ran in
`apparatus/patterns-v1.ts`; `run.ts` uses it with `--patterns v1`. **v2**,
after the first held-out set, adds: a nickname in quotes inside a name; a prefix on a person
field's name, as in `lead-maintainer`, and a plain `contact` field; "thanks", "kudos" and
"cheers" as credits; a named relative, a family word before a full name; a diagnosis of a listed
condition without a subject; a field named for salary or income with a number in it; decimals
no longer read as phone numbers; "contact number" and its like as a phone word; streets in
Romance languages with the number first, and Iberian ones with the number after a comma;
Japanese addresses in Latin letters; fields named for an address; and no address that holds a
placeholder word such as Fake, Example or Sample.

**The lines.**

- The Jev trial's 71 made-up lines, ported to `apparatus/corpus.ts` from the same fragments. The
  patterns were written with these lines in view, so their score here is a fit, not a test.
- Two held-out sets, written by models that took no other part. Gemini 3.8 Flash wrote set 1,
  which showed v1's gaps and so is no test of v2. Qwen 3.8 Max wrote set 2 after v2 was fixed,
  and is v2's test. Both came from one prompt in `apparatus/heldout.ts`, sent through OpenRouter,
  asking for 60 lines from a repository's code, configuration, documentation, commit messages
  and chat transcripts: half with personal data of the five kinds in several countries'
  formats, half look-alikes. The models' labels are kept as given. Each line is stored in
  three-character pieces (`results/heldout*/lines.json`), so no committed file holds a whole
  value. GPT-6 Astra through codex was tried first, and refused: its usage limit, which the lanes
  share, was spent.
- The history: the same 92,252 unique added lines at 873cf2d that Jev's full pass judged.
  `results/identity-bun.txt` and `results/identity-python.txt` show that Bun and Python read the
  same corpus, labels, contexts and history lines.

**Jev** is the Jev trial's last version, v6, at 0.8, the threshold that trial chose. On the
held-out sets it ran through the same apparatus with `--lines`, three calls each, by majority.

**Versions.** Bun 1.4.2; `typesafe/jev-1.13` as served on 2026-10-03; `google/gemini-3.8-flash`
and `qwen/qwen3.8-max-0902` as `results/heldout*/generated.txt` record.

**Running it.** From the repository root, `bun raw/trials/pii-patterns/apparatus/run.ts corpus
--out <dir>`, `history --out <dir> --rev 873cf2d`, `identity --out <dir> --rev 873cf2d` and
`heldout --out <dir> --in raw/trials/pii-patterns/results/heldout2/lines.json`, each with
`--patterns v1` for the first version.

# Results

**Corpus**, a fit: v1 and v2 each found 32 of 34 and raised 1 of 37, the fictional detective's
address; both missed the two names in prose that sit in no slot (`results/v*/corpus-scores.txt`).
Jev at 0.8 found 33 and raised 2.

**Held-out sets**, lines found of those holding personal data and look-alikes raised:

| set | written by | patterns v1 | patterns v2 | Jev at 0.8 |
|---|---|---|---|---|
| 1: 33 personal, 27 look-alikes | Gemini 3.8 Flash | 23 found, 4 raised | 33 found, 3 raised, tuned on it | 32 found, 5 raised |
| 2: 37 personal, 23 look-alikes | Qwen 3.8 Max | 23 found, 4 raised | 25 found, 4 raised | 33 found, 4 raised |

Three of set 2's personal lines are what the prompt itself named as look-alikes: Jane Doe's and
Bob's addresses on example.com, and a street called Example Street. Counted as look-alikes,
patterns v2 found 25 of 34 and raised 4 of 26, and Jev found 32 of 34 and raised 5 of 26.

On set 2, v2 missed 12 lines. Three are the disputed look-alikes. Four are names in prose, most
of them a first name alone: a thank-you to a first name, a first name at the end of a sentence,
children's first names in a list, and a handle. Three are fields whose names use underscores (a
date of birth, a driving licence, a passport number), one a tenant's "lives in" and "works at"
fields, and one a line that names a date-of-birth field with no value in it. Jev found 9 of the
12, all but the field with no value and the two addresses on example.com; it missed a salary
field that v2 found. Both raised two well-known test card numbers and a company's public
headquarters; the patterns also raised a public figure in a contributor field, and Jev a first
name in a notification template. (`results/heldout2/`, `results/heldout/`, `results/v*/`)

**History**: v1 and v2 each flagged 9 of the 92,252 lines, in about five seconds, and all nine
are email addresses made up for the tool-faults tests' own handling of email. Nothing else was
flagged: no name, phone number, address or other detail (`results/v*/history-summary.txt`). Jev
at 0.8 flagged 15 in 21 minutes for $1.79: 3 of the same made-up addresses, 9 other made-up or
allowed values, a cited author and 2 misreadings (`../jev-pii/results/v6-full/read.txt`).

Outside the history, v1 read a cost in dollars as a phone number on a line that held the word
"phone", in this trial's own `results/heldout/generated.txt`; v2's decimal rule fixed it. Read
over this branch's own commits, v2 then read "written by Pure JavaScript", in a quoted passage,
as a person named Pure Java, because a name could end inside a longer word. Fixing that, after
the measurements above, changed none of them. The patterns also found, as they should, the
made-up lines of the three trials' corpora: `corpus.ts`, `../jev-pii/apparatus/pii_jev.py` and
`../ai-privacy-check/apparatus/ai_check.py`. Those lines are now built from pieces split inside
each value's signal, such as "D" + "r." and "my na" + "me is", and hash the same as before; the
patterns find nothing in the three files.

# What it settles

On two held-out sets and one repository's history:

- **Patterns match Jev on personal data with a shape or a label**: email addresses, phone
  numbers, card and bank numbers, ID numbers, dates of birth, street addresses, and names in the
  places a name is written down. Checksums and context words do the work of the model.
- **They do not match it on names in prose**, a first name alone above all: 4 of the 9 lines v2
  missed and Jev found on set 2. A list of first names would raise many false alarms in code; a
  model reads them.
- **On the real history, patterns raised nothing but made-up test addresses**, in seconds, with
  no network, key or cost, and the same answer every time. Jev raised more, and slower.
- **Field names with underscores**, such as `date_of_birth`, and fields such as `lives_in`, 4 more
  of those 9 lines, are the next easy fix. It has not been tested on fresh lines.

It does not settle recall on real leaks, since the history holds none; how far the address and
phone formats reach beyond the handful of countries written in; or how either does on lines
from another prompt.
