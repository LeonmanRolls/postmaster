# Controls for the search

Run on 2026-10-04 after the four groups had reported, through the same search tool in standard mode. Each positive control asks for something known to exist. The negative control asks for something that does not.

| # | Query | Expected | Result |
| --- | --- | --- | --- |
| P1 | `Rapid quality assurance with Requirements Smells Femmer Méndez Fernández Wagner Eder` | the paper on requirements smells | **Found.** The first result is its arXiv page (1611.08847); the summary gives its abstract, with the figures 59% and 82% that the capture holds |
| P2 | `Mavin EARS Easy Approach to Requirements Syntax templates` | the EARS method | **Found.** Wikipedia, a Manchester research record and several vendor pages came back; the author's own page, which the capture holds, was read by the helper |
| P3 | `SWE-bench Verified human annotators under-specified problem statements unfair unit tests` | the benchmark's screening | **Found as a result, not as a read.** OpenAI's announcement is listed and returns HTTP 403 to a fetch, so the figures in the summary are not used |
| N1 | `qzxv wibbleflop zibzab acceptance criteria halting quorblat` | nothing about the nonsense words | **Zero.** The tool reports that the nine results contain none of the nonsense words and that they appear to be made up. The results about the halting problem and acceptance criteria are what the two real words match |
| P4 | the session's first search, for Rice's theorem | a page that states it | **Found.** Wikipedia, a course page, lecture slides and blog posts; only Wikipedia was fetched |

Two things the controls cannot show. A search can find a page and the fetch can still fail to read it, as in P3. And a search can miss what exists under other words: an HTML chapter on Rice's theorem by a textbook author turned up only after a helper's fetch budget was spent, and it proved to be a table of contents.
