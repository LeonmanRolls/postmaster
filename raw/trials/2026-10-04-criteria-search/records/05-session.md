# Record 05: reads and searches made by the session itself

Made on 2026-10-04 after the four groups reported, to read the sources the answer turns on a second time, to try the ones the helpers could not read, and to run the controls. Fetches are counted by attempt.

## Searches (6 of the shared budget)

1. `Rice's theorem statement non-trivial semantic property of programs undecidable lecture notes "extensional"`. Wanted a textbook or lecture statement. Results: Wikipedia, a course page, lecture slides as a PDF, a question-and-answer page and blog posts. Only Wikipedia was fetched; the others were not tried.
2. `"finite cost-effective process with which a person or machine can check that the software product meets the requirement"`. Wanted the sentence in IEEE 830. Results: a W3C mailing-list message of 2002 that gives an adaptation without naming the standard, Wikipedia pages, a PDF of the standard (not readable). The message is captured as `w3c-qa-skall-testability`.
3. to 6. The controls, in [../controls.md](../controls.md).

## Fetches that gave text

- Wikipedia, Rice's theorem: five reads, for the lead sentence, the definitions of semantic and non-trivial, the sentence on overestimating or underestimating tools, and the introduction. Captured as `wikipedia-rice-theorem`.
- Saltzer and Schroeder, 1975: one read, the four passages on negative requirements and fail-safe defaults; they matched the helper's checked passages word for word.
- Adzic, "Specification by Example, 10 years later" (2020): three reads. Captured as `adzic-sbe-10-years`.
- The SWE-bench project's page on SWE-bench Verified: two reads. Captured as `swebench-verified-page`.
- A W3C mailing-list message (Skall, 2002): two reads. Captured as `w3c-qa-skall-testability`.
- METR's note on passing patches that would not be merged (2026): two reads. Captured as `metr-swebench-passing-prs-not-merged`.
- arXiv abstract pages of SWE-bench+, UTBoost and Ambig-SWE, one read each, and the HTML pages of ImpossibleBench (two reads) and SWE-bench Pro (one read): the numbers matched the helper's captures. One thing the helper's note left out: ImpossibleBench says the flag option "is much less pronounced for Claude Opus 4.1".
- The Ansible check-mode page: one read; matched.

## Tried and not read

- Elaine Rich's chapter 21, https://www.cs.utexas.edu/~ear/cs341/automatabook/chapter21.html (two reads): a table of contents with no theorem text.
- The Stanford Encyclopedia of Philosophy entry on computability: one read; it does not mention Rice's theorem.
- OpenAI's "Introducing SWE-bench Verified": HTTP 403. The fetch tool refused the Internet Archive host, so no archived copy was tried. The figures that search summaries give for it (93 annotators, each sample labelled three times, 68.3% of samples filtered out, 500 kept; 38.3% and 61.1% in other summaries) are not read and are not used.
- The Communications of the ACM page of Sadowski and others, "Lessons from building static analysis tools at Google": HTTP 403.
- The GNU make manual page on dry runs: HTTP 429 twice, so the helper's two reads stand without a third.
- Wikipedia, Software quality control: read once; it does not contain the "finite cost-effective process" sentence the search tool matched it to.
