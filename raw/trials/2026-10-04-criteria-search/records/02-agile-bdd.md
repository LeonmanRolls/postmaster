# Record 02: Agile acceptance criteria and behaviour-driven specifications

The search record of one group of reading, written by the helper that did it on 2026-10-04: the queries in order with how many results were looked at, the rule for choosing, and then what was not read. Nothing here is evidence about the question; it says how the sources in the wiki page were found and what was missed.


Budgets: searches 35 (used 21), fetches 70 (used 70), captured 16 (16), noted-only 8 (8).
All searches were in standard mode. Retrieval date for every source: 2026-10-04.

### Rule used to choose what to read

1. First, the official or founding source for each named practice (Cucumber documentation, the
   Example Mapping post, North, Fowler, Wake, Jeffries, the Scrum Guide, Cohn, Adzic). Those are
   the most used and they are the starting list. I fetched them by their known address, which
   spends fetches and no searches.
2. Then every study that measured or surveyed something about user stories, acceptance criteria,
   test artifacts or BDD scenarios (Lucassen, Binamungu, Oliveira and Marczak, Fischbach, a
   literature survey). A measurement outranks an argument. I used a search to find where each
   one can be read, and took the abstract page where the full text was a PDF.
3. Then the most-read practitioner guides to acceptance criteria, labelled argued.
4. A source with "all", "always", "never", negative scenarios, key examples, "enough examples" or
   "too big, split it" in it ranks above one without, because those bear on the four shapes.
5. When a page held nothing on the shapes I did not enter it as a source (see not-read.md).

"Most used" = adoption: a standard, official documentation, a founding text. I took no citation
counts, so "most used" is a judgement from standing, not a count.
"Most serious" = strongest evidence, or the entry that most directly contradicts or qualifies the rules.

### Searches

1. `Binamungu Embury Konstantinou behaviour driven development specifications quality maintaining challenges` (9 results looked at). Chose the open-access full text of the XP 2020 paper on PubMed Central. The SANER 2018 maintenance paper did not come back as a result of its own. Chose the Eindhoven result (Wautelet and others) as a second study of scenario quality.
2. `Lucassen Quality User Story framework AQUSA tool improving agile requirements` (10 results). Wanted the Requirements Engineering journal paper. The Springer page redirects to a login endpoint, the Utrecht copies are PDFs, and the scinapse page is a reCAPTCHA page. None readable (see not-read.md).
3. `Oliveira Marczak evaluating quality of BDD scenarios Gherkin` (9 results). Chose the SBES 2019 abstract page.
4. `Adzic Specification by Example key examples how many examples enough refining the specification` (10 results). Only book-store pages and slide decks came back. None read. Needed a different route (search 9).
5. `Gherkin smells empirical study feature files open source BDD scenarios anti-patterns` (9 results). Chose the Bern study of Gherkin features in 23 open-source projects (blocked, see not-read.md). The testquality.com pages are vendor blog posts and were not chosen.
6. `behaviour driven development systematic mapping study acceptance test driven development literature review benefits challenges` (9 results). Chose the arXiv abstract page of the mapping study (166 papers).
7. `Mike Cohn conditions of satisfaction acceptance tests user story Mountain Goat Software` (9 results). Chose the Mountain Goat post on the Definition of Done and conditions of satisfaction.
8. `Lucassen Dalpiaz Brinkkemper "The use and effectiveness of user stories in practice" survey practitioners` (10 results). Chose the Springer Professional abstract page.
9. `Gojko Adzic key examples specification by example "key examples" complete precise not too many examples` (9 results). Chose the gojko.net list page for Specification by Example, which gave the two Adzic posts. The book-store pages and the Blinkist summary were not chosen (no author's text).
10. `"Maintaining behaviour driven development specifications" challenges and opportunities SANER 2018 Binamungu` (9 results). The paper itself did not come back. The Manchester group page did; I read it (one sentence on the paper, no findings). The academia.edu copies were not tried.
11. `acceptance criteria quality empirical study user stories vague untestable defects open source Jira` (10 results). Chose the arXiv paper by Fischbach and others (2020) and the SciTePress paper by Souza and Conte (2025). Not chosen: a Jira-ecosystem paper, two Chinese-journal tool papers (snippets only).
12. `writing acceptance criteria avoid words always never all untestable ambiguous testable measurable guide` (9 results). Chose Premier Agile (names "all", "never", "always"), Atlassian (the most read; its page came back as navigation only) and StoryPointLab (2026). Not chosen: BA Times, Visual Paradigm, Jama (PDF), a Waterloo cheat sheet (PDF), tessl.io and skills.cat listings.
13. `Agile Alliance glossary acceptance criteria acceptance tests definition of done` (9 results). Nothing chosen directly; showed that the Agile Alliance glossary exists but no entry for acceptance criteria came up.
14. `acceptance criteria definition` with allowed domain agilealliance.org (10 results). Chose agilealliance.org/glossary/acceptance-testing/.
15. `how to write acceptance criteria user story testable` with allowed domain scrum.org (10 results). All community forum threads and short blog posts; none chosen. The Scrum Guide itself was fetched by its address.
16. `large language models generate acceptance criteria Gherkin scenarios quality evaluation study user stories coding agents specification` (9 results). Chose arXiv 2504.07244 (an industrial case study). Not read: arXiv 2607.01980, 2510.18861, 2512.01232, 2508.20744, a SciTePress PDF, an SBES download.
17. `acceptance criteria cannot be automated usability look and feel non-functional requirements limits of executable specifications BDD exploratory testing` (9 results). Hits: BDD in Action chapter 9, the ISTQB acceptance testing syllabus (PDF), a BrowserStack guide, a Medium post. None read (the fetch budget ran out first); in not-read.md.
18. `acceptance test scenarios unsupported input format reject unknown input explicit "unsupported" example BDD specification list supported formats` (9 results). Nothing relevant: tessl.io skill listings, a Semaphore blog. None read. This was the one search made for shape 4.
19. `Specification by Example criticism limitations examples cannot specify general rules properties instead of examples BDD critique` (9 results). Hits: an SFU course page, Marcano's 2011 post on scenario-oriented against rules-oriented acceptance criteria, Adzic's 2011 post on the specification/script problem, an SD Times piece, a Manning preview chapter. None read (the fetch budget ran out first); in not-read.md.

20. `Gojko Adzic Specification by Example survey of teams results how teams use examples interviews 50 projects` (10 results). Hits: Adzic's "SBE 10 years" post (2020, a survey of 514 responses according to the search description), a Google group, the Scrum.org book page, SD Times. None read (the fetch budget was spent first); in not-read.md. This is the search for "any survey of teams that he ran".
21. `acceptance test-driven development systematic literature review ATDD effectiveness empirical evidence` (10 results). Hits: a University of Calgary review of story-test-driven development, an arXiv paper on why TDD research is inconclusive, academia.edu listings. None read (the fetch budget was spent first); in not-read.md. This is the search for a literature survey of ATDD.

### Fetches (a retry, a redirect and a refusal count)

1. cucumber.io/docs/gherkin/reference/ (fetch 1 of 3)
2. cucumber.io/docs/bdd/better-gherkin/ (fetch 1 of 2)
3. cucumber.io/blog/bdd/example-mapping-introduction/ (fetch 1 of 3)
4. cucumber.io/docs/bdd/ (fetch 1 of 2)
5. cucumber.io/docs/gherkin/reference/ (fetch 2)
6. cucumber.io/docs/bdd/better-gherkin/ (fetch 2)
7. cucumber.io/blog/bdd/example-mapping-introduction/ (fetch 2)
8. cucumber.io/docs/bdd/ (fetch 2)
9. cucumber.io/docs/gherkin/reference/ (fetch 3, to confirm the observable-output sentence)
10. cucumber.io/blog/bdd/example-mapping-introduction/ (fetch 3, to confirm two sentences)
11. dannorth.net/introducing-bdd/ (no content returned)
12. martinfowler.com/bliki/GivenWhenThen.html (fetch 1 of 2)
13. martinfowler.com/bliki/SpecificationByExample.html (fetch 1 of 6)
14. xp123.com/invest-in-good-stories-and-smart-tasks/ (fetch 1 of 6)
15. ronjeffries.com/xprog/articles/expcardconversationconfirmation/ (fetch 1 of 2)
16. dannorth.net/blog/introducing-bdd/ (fetch 1 of 2, success)
17. martinfowler.com/bliki/SpecificationByExample.html (fetch 2)
18. xp123.com Wake (fetch 2)
19. martinfowler.com GivenWhenThen (fetch 2)
20. ronjeffries.com (fetch 2)
21. dannorth.net/blog/introducing-bdd/ (fetch 2)
22. martinfowler.com SpecificationByExample (fetch 3, context sentences)
23. xp123.com Wake (fetch 3, section text)
24. martinfowler.com SpecificationByExample (fetch 4, asked for the whole page; the tool refused and gave a summary)
25. xp123.com Wake (fetch 4, to confirm six sentences)
26. martinfowler.com SpecificationByExample (fetch 5, to confirm two sentences)
27. pmc.ncbi.nlm.nih.gov/pmc/articles/PMC7251619/ (301 redirect, not followed automatically)
28. link.springer.com/article/10.1007/s00766-016-0250-x (redirect to a login endpoint, not followed)
29. sol.sbc.org.br/index.php/sbes/article/view/9371 (fetch 1 of 2)
30. research.tue.nl, Wautelet and others 2023 (fetch 1 of 1)
31. pmc.ncbi.nlm.nih.gov/articles/PMC7251619/ (fetch 1 of 2)
32. sol.sbc.org.br SBES 9371 (fetch 2)
33. pmc.ncbi.nlm.nih.gov PMC7251619 (fetch 2)
34. arxiv.org/abs/2305.05567 (fetch 1 of 2)
35. boris.unibe.ch/171927 (308 redirect)
36. mountaingoatsoftware.com Cohn post (fetch 1 of 2)
37. springerprofessional.de Lucassen 2016 abstract (fetch 1 of 2)
38. scinapse.io/papers/2334498876 (reCAPTCHA page; nothing read)
39. boris-portal.unibe.ch/items/... (Access Denied page; nothing read)
40. arxiv.org/abs/2305.05567 (fetch 2)
41. mountaingoatsoftware.com Cohn post (fetch 2)
42. springerprofessional.de Lucassen 2016 abstract (fetch 2)
43. scrumguides.org/scrum-guide.html (fetch 1 of 2)
44. gojko.net/lists/specification-by-example.html (list page, to find the two Adzic posts)
45. agile.cs.manchester.ac.uk/?p=28 (read; one sentence on the SANER 2018 paper; not entered)
46. atlassian.com acceptance-criteria guide (navigation only, content truncated; nothing read)
47. premieragile.com acceptance-criteria (fetch 1 of 4)
48. arxiv.org/abs/2009.01722 Fischbach and others (fetch 1 of 2)
49. xp123.com Wake (fetch 5, Independent and Estimable sections)
50. gojko.net sufficient-set post (fetch 1 of 2)
51. gojko.net key-examples post (fetch 1 of 3)
52. scrumguides.org (fetch 2)
53. premieragile.com (fetch 2)
54. arxiv.org/abs/2009.01722 (fetch 2)
55. xp123.com Wake (fetch 6, to confirm five sentences)
56. gojko.net sufficient-set post (fetch 2)
57. gojko.net key-examples post (fetch 2)
58. agilealliance.org/glossary/acceptance-testing/ (fetch 1 of 3)
59. oreilly.com Specification by Example book page (HTTP 403)
60. cucumber.io/docs/guides/anti-patterns/ (read; two anti-patterns only; not entered)
61. agilealliance.org acceptance-testing (fetch 2)
62. gojko.net key-examples post (fetch 3)
63. scitepress.org/PublishedPapers/2025/133635 (fetch 1 of 2)
64. scitepress.org (fetch 2)
65. arxiv.org/abs/2504.07244 Ferreira and others (fetch 1 of 1)
66. martinfowler.com SpecificationByExample (fetch 6, to confirm three sentences)
67. agilealliance.org acceptance-testing (fetch 3)
68. storypointlab.com testable acceptance criteria (fetch 1 of 1)
69. premieragile.com (fetch 3, headings and the Not/No tip)
70. premieragile.com (fetch 4, the Not/No tip)

Fetches used: 70 of 70. Of these, 8 returned nothing readable (11, 27, 28, 35, 38, 39, 46, 59: an empty result, redirects, blocks, a truncated page or a 403). Fetch 24 was a refusal that still gave one quote. Three fetches (44, 45, 60) read pages that held nothing on the shapes or only pointers (a list page, a group page, a two-item anti-pattern page); they are not entered as sources.

## What was not read


Each entry: what it is, why it matters here, why it was not read. None of these is inferred from
a title or snippet. Where a search result described a page, I say so only to name what to look for.

### Tried and not readable

- Atlassian, "Acceptance criteria" guide (https://www.atlassian.com/work-management/project-management/acceptance-criteria). The most read practitioner guide on the subject. The fetch returned navigation and "[Content truncated due to length...]" and no article text (fetch 46). Not read.
- Gojko Adzic, "Specification by Example" (Manning 2011), publisher page on O'Reilly (https://oreilly.com/library/view/specification-by-example/9781617290084). It would give the table of contents and the book's own words on refining a specification. HTTP 403 (fetch 59). The book itself was not read; what I have from Adzic is two of Adzic's blog posts (adzic-sufficient-set-of-scenarios, adzic-focus-on-key-examples).
- Lucassen, Dalpiaz, van der Werf and Brinkkemper, "Improving agile requirements: the Quality User Story framework and tool", Requirements Engineering 2016. The QUS framework (13 criteria) and the AQUSA tool, evaluated on user stories from several organisations; it would give the measured share of defective stories. The Springer page redirects to a login endpoint (not followed), the Utrecht copy is a PDF, and the scinapse page returned a reCAPTCHA page. Only a search summary exists, which does not count as reading.
- Chandorkar, Patkar, Sorbo and Nierstrasz, "An Exploratory Study on the Usage of Gherkin Features in Open-Source Projects", VST 2022 (Bern). It would show how often Scenario Outlines and data tables are used in real feature files. The Bern repository page answered 308 and then "Access Denied" from an Anubis check. I did not work around it. The PDF at scg.unibe.ch is a PDF.
- Binamungu, Embury and Konstantinou, "Maintaining behaviour driven development specifications: challenges and opportunities", SANER 2018. It would give the challenges BDD practitioners report in keeping specifications up to date. It did not come back as a readable page. The Manchester group page (fetch 45) lists the citation and says only that the group surveyed the BDD community; it gives no numbers or findings and is not entered.

### Read, held nothing on the shapes, not entered as a source

- Cucumber "Anti-patterns" page (https://cucumber.io/docs/guides/anti-patterns/, fetch 60). The fetch showed two anti-patterns, feature-coupled step definitions and conjunction steps. Nothing on negative cases, lists of examples or universal words.
- Manchester group page (https://agile.cs.manchester.ac.uk/?p=28, fetch 45). One sentence that the group surveyed the BDD community; see above.
- Gojko Adzic's list page for Specification by Example (https://gojko.net/lists/specification-by-example.html, fetch 44). Used only to find the addresses of two posts.

### Seen in search results only, not fetched (the fetch budget was spent first)

These are worth reading by anyone who continues this. I know them only from a search result's description, so I make no claim about their content.

- Antony Marcano, "Scenario-oriented vs rules-oriented acceptance criteria" (2011), https://antonymarcano.com/blog/2011/10/scenario-oriented-vs-rules-oriented-acceptance-criteria/. Look for: whether a rule should be stated beside its examples, which bears directly on the bounded form of shape 1.
- Gojko Adzic, "A fresh perspective on the specification/script problem" (2011), https://gojko.net/2011/05/10/a-fresh-perspective-on-the-specificationscript-problem/. Look for: examples used as scripts rather than specification.
- SFU course page "Specification by Example" (https://coursys.sfu.ca/2023sp-cmpt-276-d2/pages/SpecByExample). Look for: any statement that examples define only a small subset of input-output mappings.
- SD Times, "Specification by example: looking back and ahead". Look for: Adzic's later view of what examples did not cover.
- BDD in Action, chapter 9, "Automating acceptance criteria for non-UI requirements" (Manning livebook). Look for: which criteria the author says cannot be automated.
- ISTQB Certified Tester Acceptance Testing syllabus 2019 (PDF). Look for: what it says about subjective criteria such as usability, and about acceptance criteria quality.
- arXiv 2607.01980, "Epic-Organized vs. Requirement-Aligned Gherkin: An Empirical Evaluation of LLM-Based Acceptance Criteria Generation" (2026); arXiv 2510.18861; arXiv 2512.01232; arXiv 2508.20744. Look for: measured quality of generated acceptance criteria and any result on negative-path scenarios.
- Gojko Adzic, "SBE 10 years" (2020), https://gojko.net/2020/03/17/sbe-10-years.html. The search description called it a survey of 514 responses, 339 of which used examples as acceptance criteria, and said teams using acceptance criteria were about three times as likely to report great quality. If that is right it is the only measured comparison I came across in this group. I did not read the page, so I make no claim about it. It is the first thing to fetch if the work continues. Look for: the sampling (the description said the sample was biased towards teams using the technique), how "quality" was asked, and whether the comparison controlled for anything.
- University of Calgary, "An Extended Review on Story Test Driven Development" (a systematic review related to ATDD; https://prism.ucalgary.ca/handle/1880/47762). Look for: what evidence the ATDD literature holds, and whether it is anecdotal. Also arXiv 2007.09863, "Why Research on Test-Driven Development is Inconclusive?" (about TDD, not ATDD).
- Binamungu and others on detecting duplicate examples in BDD specifications (academia.edu copy). Look for: how often scenarios are duplicates, and what it costs to maintain them.
- Lucassen, Dalpiaz, van der Werf and Brinkkemper, "Forging High-Quality User Stories: Towards a Discipline for Agile Requirements" (RE 2015, Utrecht research portal). Look for: the QUS criteria list and whether "testable" is one.
- Scrum.org forum threads on how many acceptance criteria a story should have. Community answers, not a guide; look only for the common figure.
- BA Times, Visual Paradigm, Jama (PDF) and a Waterloo cheat sheet (PDF) on writing acceptance criteria and requirements. Look for: a second source for the "avoid all, always, never" rule.
