# Record 03: Formal limits on what can be decided, and the practical answers

The search record of one group of reading, written by the helper that did it on 2026-10-04: the queries in order with how many results were looked at, the rule for choosing, and then what was not read. Nothing here is evidence about the question; it says how the sources in the wiki page were found and what was missed.


Web searches allowed: 40. Fetches allowed: 70. Captured sources: at most 16. Noted-only: at most 8.
All searches are standard mode. Dates: retrieved 2026-10-04.

### Rule used to choose what to read

1. For each topic in the brief, read the primary source or the closest page to it that the fetch tool
   can read (a standard, official documentation, the author's own page, a textbook, an arXiv paper).
2. Prefer adoption: standards, official documentation, textbooks, widely cited papers. A blog post is
   read only where the brief names it or where no other page states the point.
3. Always read both sides: at least one page that supports a bounded form and one that could
   contradict it or say it is incomplete.
4. For the dry-run question, read at least four tools' own documentation (the brief asks for four).
5. A page known only from a search result is not read; it goes in not-read.md.

### Searches (in order)

1. `Møller Schwartzbach Static Program Analysis Rice's theorem undecidability of program correctness chapter 1`. 10 results looked at. Chosen: the book's own PDFs (cs.au.dk/~amoeller/spa/, tried; PDF, not readable by the fetch tool), Wikipedia (as second reader).
2. `Rice's theorem lecture notes statement non-trivial semantic property decidable proof computability course`. 10 results looked at: Wikipedia, six university lecture PDFs (LUMS, Georgia Tech, Illinois x3, Washington), a blog post. Chosen: Wikipedia only; every lecture-notes result is a PDF.
3. `Dijkstra "program testing can be used to show the presence of bugs, but never to show their absence" EWD249 Notes on Structured Programming`. 10 results looked at: Wikiquote, a slide, a principles blog, forum-like pages. Chosen: none; went to the author's archive (EWD249 address guessed, 404; EWD340 read).
4. `runtime verification monitorability finite trace safety property can be refuted liveness cannot be monitored Leucker Schallhart brief account`. 10 results looked at: arXiv runtime-enforcement paper, a Waterloo PDF of the survey, the Lübeck listing of Bauer, Leucker, Schallhart 2011, an ANU listing, a Springer chapter, others. Chosen: the Lübeck listing (abstract, readable); the survey itself is a PDF.
5. `Lessons from building static analysis tools at Google Communications of the ACM 2018 Sadowski`. 10 results looked at: Google Research page, CACM page (two addresses), an MIT PDF copy, a blog review. Chosen: the CACM full text (HTML); both addresses returned 403.
6. `CBMC unwinding assertions loop unwinding bound check cprover manual`. 9 results looked at: arXiv 2302.02384, a Clarke and Kroening PDF, slides, a Debian man page, a mirror of the cprover manual. Chosen: arXiv 2302.02384 (abstract page and HTML), by the tool authors and readable.
7. `Evaluating the small scope hypothesis Andoni Daniliuc Khurshid Marinov`. 9 results looked at, none relevant (the search matched "hypothesis" in other fields). Chosen: none.
8. `"small scope hypothesis" Alloy most bugs found in small instances empirical evidence`. 10 results looked at: Wikipedia on Alloy, Alloy slides and a Jackson talk outline. Chosen: none yet (they restate the hypothesis, they do not measure it).
9. `The Oracle Problem in Software Testing: A Survey Barr Harman McMinn Shahbaz Yoo IEEE Transactions on Software Engineering 2015`. 10 results looked at: UCL Discovery (two addresses), a KAIST record, three PDF copies, an aggregator. Chosen: the UCL page (abstract); it returned 403, so the abstract was read through the Semantic Scholar record instead.
10. `LangSec "halting problems of network stack insecurity" parser equivalence undecidable input handling recognizer`. 9 results looked at: a Dartmouth PDF of the paper, an academia.edu copy, a MITRE page, a thesis, slides, a blog. Chosen: the Dartmouth personal LangSec page (found by guess, HTML); every paper copy found is a PDF or blocked.
11. `bounded exhaustive testing small scope hypothesis empirical evaluation mutation faults found data structures Marinov Khurshid`. 9 results looked at: a Columbia PDF of MIT TR-921 (Andoni and others, "An evaluation of exhaustive testing for data structures"), an Illinois thesis, a FASE 2009 abstract page, a colloquium announcement, others. Chosen: none readable (the report is a PDF); its abstract is known only from a search summary, so it is not used.
12. `arXiv empirical study small scope hypothesis counterexamples scope size model finder specifications evaluation`. 10 results looked at: arXiv papers on Alloy-based work, a KR 2012 PDF on the small scope hypothesis for answer-set programs, a forum thread. Chosen: none (PDFs or off topic).
13. `Beyer Lemberger "Software Verification: Testing vs. Model Checking" comparative evaluation of the state of the art HVC 2017`. 9 results looked at: the sosy-lab bibliography page for 2017, dblp records, a talks page, a proceedings listing, a call for papers. Chosen: the sosy-lab bibliography page (it prints abstracts); the publication page I guessed from memory returned 404.
14. `Rice's theorem implications for writing software requirements specification verifiable "Rice's theorem" requirements engineering`. 9 results looked at: Wikipedia, arXiv 1912.02951, arXiv 2006.10387 "A Theory of Black-Box Tests", two lecture PDFs, two chapters of Elaine Rich's HTML textbook on computability (chapter 21 and a link version), an Arbital page. Chosen: arXiv 2006.10387 (abstract page, one read); the textbook chapter was not fetched because the fetch budget was used up (see not-read.md).
15. `static analysis three-valued result "maybe" unknown sound over-approximation fail closed default deny closed world assumption unknown treated as violation`. 9 results looked at: lecture PDFs, an arXiv paper on static analysis under non-deterministic assumptions, the soundiness manifesto PDF, a vendor blog, a Wisconsin page on three-valued logic analysis. Chosen: none (fetch budget). No page found that names the "unknown and fail safe" move by one name.
16. `liveness property cannot be refuted by finite trace bounded liveness deadline runtime verification testing "eventually" requirement`. 9 results looked at: arXiv papers on run-time monitoring, patents, a Southampton paper, a Luebeck RV paper. Chosen: none (fetch budget). The summary says only bounded liveness can be checked at run time; that is a snippet and is not used.
17. `differential testing McKeeman 1998 Digital Technical Journal compare implementations same input disagreement`. 9 results looked at: Wikipedia "Differential testing", arXiv papers that use it, mailing list posts. Chosen: none (fetch budget).
18. `probabilistic requirement cannot be verified by finite number of tests statistical confidence flaky tests acceptance criterion "finite" runs cannot prove`. 9 results looked at: arXiv 1807.10255, arXiv 2101.09077, a Meta engineering post, vendor blogs, two patents. Chosen: none (fetch budget).

Searches used: 18 of 40.

### Fetch log

1. cs.au.dk SPA chapter 1 PDF: unreadable (PDF). 2. EWD249 guessed address: 404. 3. EWD340 (first read). 4. Wikipedia Rice (first read). 5. EWD340 (second read). 6. Wikipedia Rice (second read).
7. Lübeck listing of Bauer et al. (first read). 8. CACM full text, old address: 403. 9. Cousot (first read). 10. Lübeck (second read). 11. Cousot (second read). 12. CACM new address: 403. 13. arXiv abs CBMC.
14. arXiv HTML CBMC (first). 15. Saltzer Basic.html (first). 16. OWASP (first). 17. arXiv HTML CBMC (second). 18. Saltzer (second). 19. OWASP (second).
20. Ansible check mode (first). 21. Terraform plan (first). 22. Kubernetes API concepts (first). 23. Helm lookup (first).
24. Ansible (second). 25. Terraform plan (second). 26. Terraform apply. 27. Helm (second). 28. Kubernetes API concepts (second). 29. Kubernetes admission webhooks (first).
30. Kubernetes API concepts (third, neutral prompt). 31. Kubernetes admission webhooks (second; section not visible, content cut). 32. RFC 9413 (first). 33. langsec.org: certificate error.
34. RFC 9413 (second). 35. arXiv abs Greenberg and Blatt (first). 36. ShellCheck SC1090 (first). 37. UCL Discovery, Barr: 403. 38. academia.edu, LangSec paper: 403.
39. ShellCheck SC1090 (second). 40. arXiv abs Greenberg and Blatt (second). 41. KAIST record, Barr: host not found. 42. Dartmouth LangSec address: redirect. 43. GNU make 9.3: 429.
44. man7 rsync man page (first). 45. "Parse, don't validate" (first). 46. Dartmouth LangSec at the redirect address (first). 47. UCL staging record, Barr: 403. 48. GNU make 9.3 (first read after the 429).
49. Dartmouth LangSec (second). 50. GNU make 9.3 (second). 51. Semantic Scholar record of Barr and others (first).
52. Semantic Scholar record of Barr and others (second). 53. Wikipedia Rice (third). 54. Saltzer (third). 55. Semantic Scholar search, hyperproperties: 429. 56. Semantic Scholar search, Schneider: no abstract. 57. Semantic Scholar search, translation validation: 429.
58. Semantic Scholar search, hyperproperties, retry: 429. 59. Kubernetes ValidatingWebhookConfiguration API reference: cut off before sideEffects. 60. Wikipedia safety and liveness (first).
61. Semantic Scholar search, small scope: 429. 62. arXiv abs 1401.4492, hyperproperties (first). 63. Springer, translation validation: redirect to a login endpoint, not followed. 64. Amazon Science page: 404.
65. arXiv abs 1401.4492 (second). 66. Wikipedia safety and liveness (second). 67. sosy-lab publication page guessed address: 404. 68. sosy-lab bibliography 2017, Beyer and Lemberger (first). 69. Wikipedia certifying algorithm (first). 70. arXiv abs 2006.10387, Torabi Dashti and Basin (first).

Fetches used: 70 of 70 (the count includes every call that failed, redirected or was rate limited).

### Counts

- Searches: 18 of 40.
- Fetches: 70 of 70.
- Sources read: 23 (16 captured, 7 noted only). Captured: 10 articles and 6 papers.
- Not read: see not-read.md (22 bullets in three groups).
- Quoted passages in the passages files: 50. Of these 49 are checked (two reads agree word for word; in 5 of them the section heading is not checked, only the words) and 1 is not checked. The passages files also carry 7 notes marked paraphrase or not checked.
- Noted-only entries: 3 checked quotations (2 from the hyperproperties abstract, 1 from the safety and liveness page) and 3 quotations marked not checked (one read each: "Parse, don't validate", the certifying algorithm page, the black-box tests abstract).

## What was not read


Pages that could not be read, or that are known only from a search result, or whose reads
contradicted each other. Nothing here is used as evidence. Where a search summary said something, it
is named as a snippet and kept out of shapes.md.

### Blocked, empty, PDF, or wrong address

- Moller and Schwartzbach, "Static Program Analysis", chapter 1 (https://cs.au.dk/~amoeller/spa/1%20-%20TIP.pdf and https://cs.au.dk/~amoeller/spa/spa.pdf). PDF; the fetch tool returned no text. A search summary says chapter 1 has a section on the undecidability of program correctness; I do not use its wording. The "yes, no, maybe" framing is therefore not checked from the book.
- Lecture notes on Rice's theorem found by search 2: LUMS (https://web.lums.edu.pk/~imdad/pdfs/CS315_Slides/CS315-Slides-07-10_Rice_Theorem.pdf), Georgia Tech (https://faculty.cc.gatech.edu/~ladha/toc/L16.pdf), Illinois cs373 lecture notes, University of Washington CSE 431 (https://courses.cs.washington.edu/courses/cse431/19au/Rice.pdf). All PDFs. Not fetched.
- Elaine Rich, "Automata, Computability and Complexity", chapter 21, an HTML textbook chapter (https://www.cs.utexas.edu/~ear/cs341/automatabook/chapter21.html). It appeared in search 14 after the fetch budget was nearly spent and was not fetched. It is the HTML textbook page the brief asked for on Rice's theorem; the next reader should fetch it first.
- Dijkstra, EWD249, "Notes on Structured Programming" (1970), the usual source of "never to show their absence". The address I guessed (https://www.cs.utexas.edu/~EWD/transcriptions/EWD02xx/EWD249.html) returned 404. A search result said the sentence is in section 3; that is a snippet. The 1972 lecture EWD340 was read instead, and it has a slightly different wording.
- Sadowski and others, "Lessons from building static analysis tools at Google" (CACM 2018). The full text returned 403 at two addresses (https://cacm.acm.org/magazines/2018/4/226371-lessons-from-building-static-analysis-tools-at-google/fulltext and https://cacm.acm.org/research/lessons-from-building-static-analysis-tools-at-google/). A Google Research abstract page and an MIT PDF copy exist and were not fetched. So what that team measured about acceptable false-positive rates is not available to this report.
- Leucker and Schallhart, "A brief account of runtime verification": a PDF copy at https://cs.uwaterloo.ca/~bbonakda/teaching/CS745/papers/RV.pdf was in the results of search 4. PDF, not fetched. Pnueli and Zaks 2006: not fetched.
- LangSec: the project site https://langsec.org/ failed with "unable to verify the first certificate"; an academia.edu copy of "The Halting Problems of Network Stack Insecurity" (Sassaman, Patterson, Bratus, Shubina) returned 403; the Dartmouth PDF of that paper (https://www.cs.dartmouth.edu/~sergey/langsec/papers/Sassaman.pdf) is a PDF. A search summary attributes to the paper the statement that checking the equivalence of parsers for ambiguous context-free and stronger languages is undecidable; this is a snippet, and it is not used.
- Barr and others, "The oracle problem in software testing: a survey": the UCL Discovery pages (https://discovery.ucl.ac.uk/1471263/ and https://discovery-pp.ucl.ac.uk/id/eprint/1471263) returned 403 and the KAIST record (https://dspace.kaist.ac.kr/handle/10203/204028) was not reachable (host not found). The abstract was read through a Semantic Scholar record instead; the full text was not read.
- Translation validation (Pnueli, Siegel, Singerman, 1998): the Springer page (https://link.springer.com/chapter/10.1007/BFb0054170) redirected to a login endpoint, which I did not follow. Semantic Scholar searches for it returned 429.
- Schneider, "Enforceable security policies" (2000): the Semantic Scholar record has no abstract; the paper itself was not fetched. Alpern and Schneider, "Defining liveness" (1985): not fetched.
- Amazon Science page on "Code-level model checking in the software development workflow" (https://www.amazon.science/publications/code-level-model-checking-in-the-software-development-workflow): 404 on the guessed address.
- Beyer and Lemberger, publication page at sosy-lab.org: 404 on the guessed address (https://www.sosy-lab.org/research/pub/2017-HVC.Software_Verification_Testing_vs._Model_Checking.html). The group's bibliography page was read instead.
- Semantic Scholar searches for hyperproperties (twice), translation validation and the small scope evaluation returned 429 (rate limit).

### Pages whose reads contradicted each other, or were cut off

- Kubernetes API concepts, "Dry-run" section (https://kubernetes.io/docs/reference/using-api/api-concepts/). Three reads gave three different texts for the section: one said a dry-run request does not persist data or trigger side effects; one gave a paragraph saying the response is as close as possible to a real request and that dry-run "does not guarantee that the request will succeed"; one gave a section on the dryRun query parameter. I cannot tell which is the page, so nothing from it is quoted or relied on. The page may also be cut off by the fetch tool.
- Kubernetes admission webhooks page (https://kubernetes.io/docs/reference/access-authn-authz/extensible-admission-controllers/) and the ValidatingWebhookConfiguration API reference (https://kubernetes.io/docs/reference/kubernetes-api/extend-resources/validating-webhook-configuration-v1/): the fetch tool's text was cut off ("Content truncated due to length") before the sideEffects text. One read printed a list of sideEffects values (None, NoneOnDryRun, Some, Unknown, with Unknown meaning "treat as if Some"); the next said "not visible". I recall from outside this session that Kubernetes refuses a dry-run request that would call a webhook with undeclared side effects, which would be a good example of "unknown fails safe"; I could not confirm it, and it is not used.

### Known only from a search result (snippets, not read)

- Measured studies of the small scope hypothesis and of bounded exhaustive testing: Andoni, Daniliuc, Khurshid, Marinov, Rinard (MIT-LCS-TR-921, "An evaluation of exhaustive testing for data structures"; PDF at https://www.cs.columbia.edu/~andoni/papers/TR921.pdf); Oetsch and others on the small-scope hypothesis for answer-set programs (KR 2012; PDF at https://haendel.kr.tuwien.ac.at/projects/mmdasp/kr2012.pdf); Sullivan and others, "Software assurance by bounded exhaustive testing". Search summaries say these use mutation analysis and report that small scopes find almost all injected faults. I could not read any of them, so the report has no measured evidence of that kind. Not found (readable).
- Statistical criteria (finite runs and probabilistic requirements): arXiv 1807.10255 "Assurances in Software Testing: A Roadmap", arXiv 2101.09077 "An Empirical Study of Flaky Tests in Python", and the Meta engineering post "Probabilistic Flakiness" (https://engineering.fb.com/2020/12/10/developer-tools/probabilistic-flakiness/) appeared in search 18. Not fetched: fetch budget used up.
- Soundiness manifesto (Livshits and others, CACM 2015; a PDF copy at https://www.doc.ic.ac.uk/~livshits/papers/pdf/cacm15.pdf appeared in search 15): not fetched. It would say how real analysers treat features they cannot model (reflection, eval), which bears on the shell.
- McKeeman, "Differential testing for software" (Digital Technical Journal, 1998) and the Wikipedia page "Differential testing" (search 17); Segura and others on metamorphic testing (2016); Claessen and Hughes, QuickCheck (2000); Biere and others on bounded model checking (1999); McConnell and others, "Certifying algorithms" (2011; the Wikipedia page was read, the paper was not): not searched for separately or not fetched. The brief lists them as starting points; the fetch budget did not stretch to them.
- The full text of Torabi Dashti and Basin (https://arxiv.org/html/2006.10387): not fetched; the abstract was read once.
- Terraform: a stated rule that applying a saved plan refuses when the state has changed since the plan: not found on the two Terraform pages read (plan, apply). A different Terraform page may say it.
- rsync: the long description of --dry-run was not visible in the one read (see notes.md).
