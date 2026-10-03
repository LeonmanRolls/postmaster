---
kind: trial
subject: Jev 1.13 as a linter for personal data, with atomic questions and exclusions in code
date: 2026-10-02
---

# Method

**Question.** Issue #208. The user narrowed the check on 2026-10-02 to personal data and secrets:
private context such as paths, hosts, ids and attribution is allowed. The first AI trial
(`../ai-privacy-check/`) asked Jev ten questions per line, each carrying its own exclusions in
words, and at a threshold of 0.5 it raised many lines written to look private. TypeSafe's own
notes say Jev reads a question literally, that each question should be atomic, and that exact
work belongs in code. Asked that way, does Jev find personal data in prose without raising
look-alikes, quickly enough to run as a linter on every change, and how many lines would it
raise on this repository's real history?

**The checker**, `apparatus/pii_jev.py`, in five versions, each made after reading what the one
before it flagged. Each line is one request to OpenRouter's System One endpoint for
`typesafe/jev-1.13`, the line as its state.

- **v2** asks six yes/no questions: does the line name a person; is everyone it names a
  well-known public figure; is everyone it names a placeholder or textbook name; does it hold a
  phone number; a street address; other personal details (a date of birth, an identity, bank
  or card number, a health detail). An email address is found by a pattern, dropped in code
  when it is a public no-reply address or on a reserved domain, and only then put to Jev, in the
  same request: does it belong to an individual person. In code: a person counts when the line
  names one and every exclusion question is below 0.5; a phone number counts only on a line
  with seven or more digits; each kind counts at or above the threshold.
- **v3** adds two exclusions, each its own question: is everyone named an author of a
  published work, and is every name that of a tool, model, agent role or product.
- **v4** widens the author question to preprints and citations, and masks in code, before
  any question, the project's own names that are not people: its roles, lanes, harnesses,
  hosts and account, all already public in the repository.
- **v5** masks "lane" as well, and drops the line-only author question. In its place, a line
  that would otherwise be flagged as naming a person gets a second request holding the line and
  up to three lines on each side: is everyone it names an author of a work that the line or
  the lines around it cite by its title, venue or link.
- **v6** widens that question to a work cited by its authors and year as well.

**The corpus**, built at run time from fragments, every value made up, each line labelled
before any call. v2's 60 lines: 30 holding personal data (ten names in prose, code, JSON and a
sign-off; four personal email addresses; five phone numbers in fictional ranges; four street
addresses; seven other details: a date of birth, an identity number in an unissued range, a
payment provider's test card, a textbook IBAN, a passport number, a diagnosis, a salary) and 30
hard negatives (public figures, placeholder names, products, a company and a no-reply address,
numbers that are not phones, dates that are not birthdays, a fictional detective's famous
address, a business's support line, this project's public account name, and plain lines). v3
adds four negatives (a role, two lane names, a cited author, a host and a harness) and a person
named with their job; v4 adds a citation line from the wiki, a list of lane names, and a person whose
first name is a lane's; v5 adds a made-up citation's author field, and a made-up name in a
package manifest's author field and in a licence's copyright line, and gives five lines the
lines around them. Three calls over the corpus, then one over ten plain lines as a control. A
linter makes one call per line, so the scores give the fewest and most lines any one call
found beside the majority.

**The history**: every unique added line of `origin/main`'s history at 8fcb8b7, outside
`raw/runs` and JSONL files, with a letter or at least seven digits: 91,662 lines, each judged
once, sixteen requests in flight. For each line Jev flags, `history.json` records the commit
that added it, its path, its index in that list and the kinds, never its text. v2 judged every
line. v3 to v6 were first measured by re-asking only the lines v2 flagged at 0.5, and from v4
every line the mask changes: an exclusion only removes findings, so a line v2 cleared stays
cleared, within the noise of Jev's answers. v6 then judged every line in a full pass, by which
time main had moved on to 873cf2d: 92,252 lines, all of v2's and 590 more. Every line the full v6
pass flagged was then read
and sorted by hand into personal data, a value made up to look like personal data, a cited
author, the project's own public identity, and a misreading, recorded without its text in
`results/v6-full/read.txt`.

**Noise**, `apparatus/noise.py`: the answers of two calls about the same line to the same
question, compared over the corpus calls. Within one version that measures identical requests;
v2 against v3 measures whether asking more questions in one request moves the other answers.

**Versions**, `results/versions.txt`: `typesafe/jev-1.13`, served as
`typesafe/jev-1.13-20260917`; Python 3.12.3. The key is the user's OpenRouter key, read from a
local file and never printed.

**Running it.** From the repository root, with `OPENROUTER_API_KEY` set or `--key-file`:
`raw/trials/jev-pii/apparatus/pii_jev.py corpus --out raw/trials/jev-pii/results/v6 --version v6`,
then `pii_jev.py history --out raw/trials/jev-pii/results/v6-full --version v6`; `rejudge` and
`score` are in the script's usage, and `noise.py raw/trials/jev-pii/results` compares calls.

# Results

**Corpus**, lines found and hard negatives raised, by the majority of three calls, with the
range one call gave where it differs (`results/<version>/scores.txt`):

| version | personal / negative lines | found at 0.8 | raised at 0.8 | found at 0.9 | raised at 0.9 |
|---|---|---|---|---|---|
| v2 | 30 / 30 | 29 | 2 | 27 (26 to 27) | 2 |
| v3 | 31 / 34 | 29 | 2 | 27 (26 to 27) | 2 |
| v4 | 32 / 36 | 30 | 2 | 28 (27 to 28) | 2 |
| v5 | 34 / 37 | 33 | 3 | 30 (30 to 31) | 3 |
| v6 | 34 / 37 | 33 | 2 | 31 (30 to 31) | 2 |

At 0.5 and 0.7, v6 gives the same counts as at 0.8. The two negatives v6 raises at every
threshold are the fictional detective's address and the business's support line. Its one miss
at 0.8 is the salary, which its question for other details does not name. At 0.9 it also
misses the passport number, and the email question falls below the threshold on all four email
lines, which the pattern finds whatever Jev says; three of them still count for the name in
them. v4 missed the made-up name in a manifest's author field at every threshold: its line-only
author question read the field as authorship. v5 and v6, asking with the lines
around it, found it, and the name in the licence's copyright line too. The control raised
nothing in any version.

**History**, lines flagged at 0.5 / 0.7 / 0.8 / 0.9, of the 91,662 lines at 8fcb8b7 unless the
row says otherwise (`results/<version>/history.json`):

| version | lines asked | flagged | seconds | cost |
|---|---|---|---|---|
| v2 | all | 872 / 318 / 204 / 97 | 1,204 | $1.62 |
| v3 | 872 re-asked | 555 / 189 / 98 / 32 | 12 | $0.02 |
| v4 | 11,402 re-asked | 104 / 38 / 18 / 10 | 164 | $0.24 |
| v5 | 13,284 re-asked, 192 twice | 73 / 29 / 20 / 15 | 179 | $0.26 |
| v6 | 13,284 re-asked, 194 twice | 59 / 23 / 14 / 10 | 176 | $0.26 |
| v6 | all 92,252 at 873cf2d | 64 / 25 / 15 / 11 | 1,279 | $1.79 |

At 0.9, v2's flags were mostly cited authors (the authors' fields of `raw/papers` and the
citations in `wiki/sources` and `wiki/concepts`) and the project's own lane and role names,
which Jev took for people; the masking in v4 removed nearly all of the second kind. One of v2's
requests failed after six attempts: the line of 1.1 MB described below.

Every line the full v6 pass flagged was read (`results/v6-full/read.txt`), and none holds
personal data. At 0.8 it flagged 15: 12 values made up to look like personal data, which the
check's allow markers exist for (a first name in a script's usage examples, a home path with a
made-up user name in a settings test, and a made-up email address and a made-up street and
number in the tool-faults tests); 1 cited author whose citation the question missed; and 2
misreadings, "too sick" in a comment and a lane's name the mask missed, because a control
character written out as `\x1f` put a letter in front of it. At 0.9 only 10 of the made-up values
and the cited author remain. At 0.5 the misreadings grow to 43, mostly variable and field names
read as names, such as `actor`, `grace`, `diagnosis`, `alpha` and `beta`, and numbers read as
phone numbers. All 64 flags fall on lines v2 also saw; the 590 lines added since raised none. On
the lines both saw, the full pass and the re-asking shortcut flagged 13 of the same lines at 0.8,
with one more only in the shortcut and two only in the full pass, which is the noise below.

21 of the full pass's requests failed after six attempts, against one in v2's. One is a line of
1.1 MB, a JSON fixture in `scripts/fixtures/text-goldens.json`, far past Jev's context of 32,000
tokens; it failed in both passes. The pass kept no record of which the other 20 were, or why.

**Noise** (`results/noise.txt`): between two identical calls, 36 to 46 in every hundred answers
differ, by up to 0.20; asking two more questions in the same request moved the other answers no
more than that. The movement is mostly away from the middle: of 1,095 answer pairs among v2's
three calls, 4 fell on opposite sides of 0.5.

**Speed and cost**: the full v2 pass judged 76 lines a second with sixteen requests in flight,
at $1.77 per 100,000 lines, and the full v6 pass, with its second requests, 72 a second at $1.94;
the corpus's 71 lines took about three seconds a call with eight.

# What it settles

Facts about Jev 1.13 at one version, on one corpus of made-up lines and one repository's
history:

- **Asked this way, it works as a linter for personal data in prose.** v6 at 0.8 finds 33 of 34
  made-up lines holding personal data, each with its kind, raises 2 of 37 hard negatives, and
  over this repository's whole history flags 15 lines, none of them personal data, 12 of them
  made-up values a check should ask to be marked anyway. That supports 0.8: 0.9 also misses the
  passport number, and 0.7 adds ten misreadings over the history.
- **Exclusions belong in code, and some need the lines around them.** Masking the project's own
  names did more than any question. An exclusion asked of the line alone can clear the very
  thing the check exists for: v4 cleared a name in a manifest's author field. Asked with the
  lines around it, and only for a line otherwise flagged, it did not.
- **Questions are read literally.** The citation question found citations by authors and year
  only once it named them.
- **A gate needs a cache, a way to judge long lines, and retries.** Identical calls differ by up
  to 0.2, so the same line can get a different verdict on another day unless the first is kept.
  A line past the model's context cannot be judged at all, so a check has to judge it in pieces
  or fail. And requests fail: 21 of 92,252 after six attempts, which a gate that fails closed
  turns into failed checks unless it asks again.
- **Speed and cost suit a linter**: about 70 lines a second with sixteen requests in flight, and
  under $2 per 100,000 lines.

It does not settle recall on real personal data: the history holds none, and the corpus is one
writer's invention. Nor false alarms on another repository, text written to steer the model,
or a version of Jev other than 1.13.
