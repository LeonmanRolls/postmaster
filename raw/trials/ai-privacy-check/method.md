---
kind: trial
subject: an AI privacy check beside #135's mechanical scanner, on the same made-up lines
date: 2026-10-02
---

# Method

**Question.** Issue #208. #135's scanner checks shapes: paths, addresses, tokens, keys,
trailers. Some private data has no fixed shape: a person's name or street address in prose,
attribution in a new wording, an identifier in a field nobody anticipated. Does a model, given
the same lines a change would publish, find what the shapes miss, and at what cost in false
alarms, consistency and time? The user asked for the trial on 2026-10-02.

**The corpus**, built by `apparatus/ai_check.py` at run time and never written down, every value
made up and assembled from fragments, then shuffled with a fixed seed:

- #135's own self-test fixtures, every line of every `pos` and `neg` call, read from the branch
  by `../scanner-rule-format/apparatus/load.py`. A `pos` line is labelled positive, a `neg` line
  negative, as #135's self-test labels them.
- The eight probes of the scanner-rule-format trial (`../scanner-rule-format/apparatus/probes.py`):
  six positives (four attribution lines, a home path at JSON depth 1 and 2) and two encrypted
  blocks, which are reported but not scored, since no check can read them.
- 36 open-ended lines written for this trial and labelled before any model saw them: 18
  positives (names, a health detail, street addresses, phone numbers in three formats, a
  password stated in prose, a `.home.arpa` host, a device name, four attribution wordings, a name
  inside a branch name, a customer number, and four the shapes also find as controls: a private
  address, a home path, an email address) and 18 negatives that look private and are not (a public
  figure, placeholder names, a field name, a public address and host, a documentation address,
  a bare `~/` path, a placeholder home, a tool credit, mentions of an assistant or a vendor that
  credit nobody).

**The mechanical level.** #135's whole line pipeline (`LineScanner`: escape-code stripping,
JSON-string decoding, markers, rules) on each line, through `load.py scan`.

**The AI levels.** Four models this machine runs as lanes or as the postmaster, each through its
own harness, at low effort, with no tools: Claude Haiku 4.5 and Claude Opus 5.5 through Claude
Code (`--tools ""`, a JSON schema for the answer); GPT-6 Sol through codex (`-s read-only`, an
output schema); MiMo V2.6 Pro through MiMo Code (bash, edit, web fetch and outside directories
denied). A fifth, `opf`, is OpenAI's Privacy Filter (Apache-2.0, 1.5 billion parameters, 50
million active), run on this machine's CPU by `apparatus/opf.ts` through Transformers.js, from
its 4-bit ONNX weights, each line on its own; its eight labels map onto the trial's kinds
(`private_person` to person, `private_url` and `private_date` to other-personal, and so on), at a
score of 0.5 or more. Hugging Face was added to this machine's egress list for the download, at
the user's word. A sixth, `jev`, is TypeSafe's Jev 1.13, a model that answers typed questions
with calibrated probabilities and writes no text, called through OpenRouter's System One
endpoint with a key the user keeps on this machine. TypeSafe's guidance is to ask it atomic
questions and keep exact work in code, so each line is one request, the line as its state, with
one yes/no question per kind carrying that kind's definition (`JEV_QUESTIONS`), eight requests
at a time; a kind counts at a probability of 0.5 or more, and the probabilities are kept, so
`scores.txt` also gives other thresholds.

The four general models each ran in an empty temporary folder, with this session's identity taken
out of its environment (issue #102), and read only its harness's user-level instructions. Each got
the same instruction (in `apparatus/ai_check.py`): ten kinds, each defined; report made-up values
too, since made-up data is marked separately; never repeat a value; answer with line numbers and
kinds as JSON. Every level answered the whole corpus three times, then once a control of ten plain
lines with no private data.

**What is recorded**, in `results/`: `corpus.txt` (each line's number, group, label, expected
kind and name, never its text), `mechanical.txt`, one `<level>-<n>.json` per call (the parsed
findings, the exit status, the seconds taken) and `scores.txt`: lines found by group and label
for each call, each level's majority over its three calls, and that majority joined with the
mechanical findings, which is the design under test, where the model may add findings and never
clear one; how often a level's three calls agree; whether a majority named the expected kind on
the open-ended positives; what each level did with the encrypted blocks; and the control.

**Versions.** `results/versions.txt`.

**Running it.** From the repository root:
`raw/trials/ai-privacy-check/apparatus/ai_check.py git:b6b070d:scripts/scrub-check.sh --out raw/trials/ai-privacy-check/results --levels haiku,opus,sol,mimo`,
then the same with `--levels opf --opf <folder>`, a folder holding `@huggingface/transformers`
and the model, then `--score-only` to score every level together, and
`apparatus/breakdown.py raw/trials/ai-privacy-check/results` to name each level's misses and
false alarms (`results/breakdown.txt`).

# Results

From `results/scores.txt`, each AI level as the majority of its three calls. "With the scanner"
is that majority joined with the mechanical findings: the design under test, where a model may
add findings and never clear one.

| level | #135 positives (67) | #135 negatives raised (79) | probes (6) | open positives (18) | open negatives raised (18) | seconds a call | calls agreeing, lines (188) |
|---|---|---|---|---|---|---|---|
| mechanical | 67 | 0 | 3 | 4 | 2 | | |
| Claude Haiku 4.5 | 48 | 12 | 4 | 18 | 0 | 112 to 184 | 173 |
| Claude Opus 5.5 | 61 | 7 | 6 | 18 | 0 | 14 to 25 | 182 |
| GPT-6 Sol | 63 | 16 | 6 | 18 | 0 | 26 to 52 | 176 |
| MiMo V2.6 Pro | 61 | 14 | 6 | 18 | 0 | 333 to 705 | 174 |
| Privacy Filter, local | 49 | 24 | 1 | 12 | 0 | 46 to 58 | 188 |
| Jev 1.13, at 0.5 | 65 | 44 | 6 | 18 | 2 | 5.2 to 5.4 | see `scores.txt` |
| Jev 1.13, at 0.9 | 45 | 9 | 4 | 16 | 0 | | |
| each general model with the scanner | 67 | its own count | 6 | 18 | 2 | | |
| Privacy Filter with the scanner | 67 | 24 | 3 | 13 | 2 | | |
| Jev at 0.9 with the scanner | 67 | 9 | 6 | 17 | 2 | | |

- **What the shapes miss, the general models find.** All four found every open-ended positive
  and named its kind on every one: names, a health detail, street addresses, phone numbers, a
  password in prose, a `.home.arpa` host, a device name, a name in a branch name, a customer
  number, and four wordings of attribution. The mechanical check found the four controls only.
  Opus, Sol and MiMo also found Claude Code's pull-request lines and the path at JSON depth 2.
- **No model replaces the shapes.** Every general model missed some of #135's positives: all four
  missed a compound field name and a bare id; some missed key headers, an access key or a literal
  `.env` value; Haiku missed most of the made-up home paths, which it seems to take for test data
  despite the instruction (`results/breakdown.txt`).
- **The cost is false alarms on look-alikes.** Joined with the scanner, every positive in every
  group was found, and the models' false alarms fell on #135's negative fixtures, which are written
  to look private: composed `.env` values, short or digitless ids, a bare UUID, a public `100.x`
  address. Opus raised the fewest, 7 of 79. No general model raised an open-ended negative; the
  mechanical check raised two, a documentation address (192.0.2.x, which Python counts as private)
  and a placeholder home path before a full stop.
- **The Privacy Filter is narrow.** It has no label for attribution, hosts, addresses on a
  network or file paths, so it found none of those. Its 24 false alarms include six public
  no-reply or reserved-domain email addresses, which the scanner's own list would drop, composed
  `.env` values it takes for secrets, and placeholder user names. It gave the same answer on every
  call.
- **Jev trades recall for false alarms through its threshold.** At 0.5 it found more of #135's
  positives than any other level, 65 of 67, and raised the most negatives, 44 of 79, among them
  placeholder users, loopback and reserved-domain addresses its questions excluded in words: the
  literal reading TypeSafe's own notes warn of. At 0.9, with the scanner, it found 17 of the 18
  open-ended positives and raised 9 of #135's negatives, near Opus, in about five seconds and half
  a cent a pass (`results/jev-*.json` keep the cost). An exclusion the scanner already makes in
  code, such as the no-reply list, belongs in code rather than in a question.
- **Encrypted blocks.** Haiku, Opus and the Privacy Filter reported both on every call, Sol on
  two of three, MiMo on none. Reporting them is the safe outcome; dropping them unread, as
  #208's page proposes, does not depend on it.
- **Controls.** No level reported anything on the ten plain lines (`results/*-control.json`).

# What it settles

Facts about these models at these versions, on one corpus of made-up lines, at low effort and
one instruction (and, for Jev, one set of questions): a general model reading the same lines as #135's scanner finds the private data
the shapes cannot see, and with the scanner beside it nothing labelled private was missed, at
the price of some false alarms on lines written to look private. The local Privacy Filter covers
people, addresses, phones and some secrets only. It does not settle how a model does on real
changes and real transcripts, how many false alarms a real change would raise, whether the
answers hold against text written to steer the model, or how the levels compare at higher
effort, none of which was tried.
