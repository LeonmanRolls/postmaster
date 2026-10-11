---
kind: trial
subject: what has been published on writing tickets and acceptance criteria that can be finished, and how coding-agent benchmarks treat under-specified issues, from public pages and papers
date: 2026-10-04
---

# Method

**Question.** [Issue #293](https://github.com/brindlewick/postmaster/issues/293), criterion 1: map what exists on writing acceptance criteria and tickets in four groups, and for each of four shapes the template says cannot be finished (a "every", "all" or "never" about an input with no end; predicting another program's behaviour; exact agreement between two implementations of one decision; a reader that must handle any format) find what the sources recommend, in both directions: what supports the bounded form, what contradicts it, and whether a fifth shape appears. The wiki page that answers it is [ticket-and-criteria-design](../../../wiki/concepts/ticket-and-criteria-design.md).

**What was done.** On 2026-10-04, four groups of reading by web search and page fetch, each by one helper with its own list of starting points and its own search budget, then a second reading by the session of the pages the answer turns on. The groups are requirements engineering ([record 01](records/01-requirements.md)), agile acceptance criteria and behaviour-driven specifications ([record 02](records/02-agile-bdd.md)), formal limits on what can be decided and the practical answers ([record 03](records/03-formal-limits.md)), and specifications for coding agents ([record 04](records/04-agents.md)). [Record 05](records/05-session.md) is what the session itself searched, read and could not read. Each record holds the queries in order with how many results were looked at, the rule for choosing, and what was not read.

**Tools.** The web search tool in standard mode only, and the page fetch tool, which returns a page as text processed by a small model. No shell network command was used. No third-party code was installed, cloned, built or run, and nothing was posted, starred, forked or filed anywhere.

**How entries were chosen.** In each group the helper took the sources the ticket names first, then, for "most used", the standards, official documentation, founding texts and widely used tools; and for "most serious", the sources with a measurement, and the sources that most directly contradict or qualify the template's rules. Adoption was not counted: no citation counts or star counts were taken, so "most used" is a judgement from standing, and each record says what it chose and why. A source whose page held nothing on the shapes was not entered.

**What a read is.** A source counts as read only if its text was fetched and the reported parts were read. A search snippet is not a read, and a claim known only from a snippet is listed as not read and is not used. PDFs cannot be fetched as text, so a paper was read as its arXiv HTML page or its abstract page; where only the abstract was read the capture says so. Each passage kept in a capture is marked `checked` when two reads, in separate fetches, gave it word for word, and `not checked` otherwise. The fetch tool paraphrases and sometimes contradicts itself between reads, so no paraphrase is in quotation marks.

**Counts.** 93 web searches by the helpers (26, 21, 18 and 28) and 6 by the session, of the 200 the session allowed in all. 70 fetches by each helper and about 30 by the session. 100 sources read by the helpers, of which 64 were captured and 36 only noted or found to hold nothing usable; the session captured 5 more, so 69 captures stand under `raw/papers/` and `raw/articles/`. A source that was read and only noted has no passage kept, so the page makes no claim from it.

**Controls.** Positive and negative controls, run at the end through the same tool: [controls.md](controls.md). They show that the tool returns a named paper and a named method when asked and nothing for a nonsense query. They do not show that the search was complete.

**Limits.**

- The sources are mostly argued, and each capture says so in its strength label: controlled study, one report or one team's experience, argued and not measured, standard or documentation. A standard or a tool's documentation is a rule or a description, and not evidence that the rule works.
- Several of the sources the question names could not be read: IEEE 830 and ISO/IEC/IEEE 29148 (paywalled or PDF), the INCOSE guide (403, PDF), Rice's 1953 paper, textbook statements of Rice's theorem (PDF), OpenAI's two pages on SWE-bench Verified (403), and the Communications of the ACM paper on static analysis at Google (403). [Record 05](records/05-session.md) and the records list each.
- The helpers' working notes and their summaries of what each source implies are not kept here, since an argument belongs in the wiki and not in `raw/`. The page rests on the captures.
- A search is not proof that something does not exist. Where the page says a source was not found, it names the query.

**To repeat.** Run the queries in the records. A repeat will differ, since pages change and the anchor is the day each source was read, which is in its capture.
