# Record 01: Requirements engineering

The search record of one group of reading, written by the helper that did it on 2026-10-04: the queries in order with how many results were looked at, the rule for choosing, and then what was not read. Nothing here is evidence about the question; it says how the sources in the wiki page were found and what was missed.


Rule used to choose what to read in this group: a source is read first if it is (1) the standard or
official text that defines the term the rules lean on (verifiable, complete, absolutes, universal
quantifiers), (2) a widely adopted guide or tool list (INCOSE, NASA, EARS, Volere, SWEBOK), or
(3) a study that measured something about requirement-writing rules, or (4) a message or article by
someone who writes standards, on negative requirements or testability, when a search surfaced one.
Among equals, the page that shows the original wording beats a page that retells it, and a page
that is HTML beats a PDF because the fetch tool cannot read PDFs. A source known only from a search
snippet is never counted as read. Choices were limited by the fetch budget, which was spent on
two reads of every page I quote (the brief's verification rule), so many sources found by search
were never fetched; they are listed in not-read.md.

Budget: 40 web searches, 70 fetches. Standard mode only.

Final count: searches 26 of 40 (a call that ran several searches inside is counted once per run, see entries 8 and 20), fetches 70 of 70. The fetch budget ran out first; the unused searches were not needed once no fetches were left.

### Searches

A search result is a list of titles and links with a short machine summary. The summary is never
used as a source; only pages I fetched count as read.

1. `IEEE 830-1998 "verifiable" "finite cost-effective process" "never enter an infinite loop" non-verifiable requirement`
   10 results looked at. Read: the course wiki page that reproduces Meyer's post (HTML, quotes the standard), Wikipedia "Requirement" (appeared in the results), and the arXiv paper 1209.1551 (paper citing the definition). Not read: three PDFs of the standard, a store page, a blog post, a quiz page, a defence conference PDF (PDF or no value).
2. `ISO/IEC/IEEE 29148 characteristics of a well-formed requirement necessary appropriate unambiguous complete singular feasible verifiable correct conforming definitions`
   9 results looked at. Read later (batch 3): the arXiv paper 2408.10886, whose Table I restates the characteristics (two reads). Not read: store pages (paywalled), a vendor page, a government template, a Spanish-language journal page. The summary at the top of the result is not used.
3. `INCOSE Guide to Writing Requirements rules avoid absolutes universal quantification "all" "every" "never" rule text`
   9 results looked at. Read: the Altium documentation page (a rule list that cites INCOSE; three reads in all) and, from the same results, the Spec Innovations help page (two reads). Not read: the INCOSE webinar PDF (PDF), a blog post and two more pages of the same kind.
4. `Femmer Vogelsang "Requirements Quality Is Quality in Use" IEEE Software 2019 arXiv`
   9 results looked at. Read: the TU Berlin repository pages (two) for the abstract. Not read: the thesis PDF, a CV PDF, a literature-review page.
5. `"all realizable classes of input data in all realizable classes of situations" IEEE 830 complete software requirements specification`
   10 results looked at. Read: Wikipedia "Software requirements specification" (two reads; the phrase is not on it). Not read: lecture PDFs, scribd pages, a Word file, a store page for the 1984 edition.
6. `"there exists some finite cost-effective process with which a person or machine can check that the software product meets the requirement"`
   9 results looked at. Read: two W3C QA list messages (2002, HTML) and Wikipedia "Software quality control". Not read: slide decks, a quiz page, scribd, an INCOSE 2013 conference PDF, Wikipedia "Software verification and validation".

7. `29148 requirement characteristics "needs no further amplification because it is measurable" verifiable "its realization can be proven"`
   9 results looked at. Nothing fetched from this one. Candidates for later: a Sparx tool page (blocked, HTTP 403 when tried in batch 2), an ArgonDigital post (read), an INCOSE 2018 conference PDF and a 2011 ANSI preview PDF (PDF, not read). The search summary's wording of the standard is not used.
8. `NASA Systems Engineering Handbook Appendix C how to write a good requirement verifiable avoid "always" "never" "all" absolutes`
   The tool ran this as two searches in one call (10 and 9 results); counted as two. Read: the NASA handbook page (https://www.nasa.gov/seh/appendix-c-how-to-write-a-good-requirement). Not read: lecture PDFs, a bookfusion page, practitioner blog posts (SEP, Modern Analyst, Quality Digest, Ragan, ArgonDigital; the SEP page answered 403, ArgonDigital's "Is the requirement verifiable" was read).
9. (second search run inside call 8, counted here)
10. `Guide to Writing Requirements rules "unachievable absolutes" universal quantification "each" rule R26 R32` limited to incose.org, reqexperts.com and the SEBoK wiki domains
   1 result: the INCOSE summary sheet PDF (HTTP 403 when fetched). Used only to learn that the rule ids exist; the rule text was then read on two vendor pages (Altium, Spec Innovations).
11. `EARS Easy Approach to Requirements Syntax empirical evaluation experiment does EARS improve requirement quality study`
   10 results looked at. Read: the Chalmers record of Horkoff's teaching report, the GI abstract of the template benchmark (found through the next search), arXiv 2005.01355. Not read: the Manchester and IEEE records of Mavin 2009, the academia.edu page of Mavin and others, a Fraunhofer record (blocked), the infona record (404), an IET forum page.
12. `Großer Jürjens "requirement template systems" EARS MASTER boilerplates controlled experiment quality characteristics Requirements Engineering journal 2024`
   10 results looked at. Read: a Cádiz repository record (a 2016 student thesis, not the paper; two reads). Not read: a second Fraunhofer record, GI pages.
13. `Benchmarking requirement template systems: comparing applicability, usability, and expressiveness` limited to springer.com and doi.org
   9 results looked at. The Springer article page redirected to a login handshake (not followed). Not read: the issue page and an unrelated editorial.
14. `controlled experiment requirements templates EARS boilerplate understandability ambiguity free-text versus template participants` limited to arxiv.org
   9 results looked at. Read: arXiv 2002.02672 (quantifiers, Winter and others) and arXiv 1702.07656 (does requirements quality matter, Mund and others), both chosen because they are controlled experiments on requirements wording or defects with a measured outcome. Not read: an ADR templates paper, a temporal logic understandability experiment (not about requirement wording rules).

15. `Volere requirements "fit criterion" definition measurable "fit criteria" Robertson requirement testable quantify`
   9 results looked at. Nothing read from this one directly: course PDFs and Word templates (not readable), a book review post, and an O'Reilly chapter page (HTTP 403 when tried).
16. `SWEBOK Guide software requirements "verifiable" OR "testable" requirement acceptance criteria requirements validation`
   9 results looked at. Nothing fetched (budget). Found: a wiki copy of the chapter, the version 4 topics page, a PDF copy of version 4 (not readable). See not-read.md.
17. `Volere fit criterion "a measurement of the requirement" such that it is possible to determine whether a given solution fits snow card template` limited to volere.org, systemsguild.com, atlsysguild.com and wikipedia.org
   10 results looked at. Read: the Volere template page on volere.org (three reads). Not read: the snow card, atomic requirement and getting started PDFs (PDF).
18. `"set of requirements" complete "contains everything pertinent to the definition of the system" TBD TBR requirements set characteristics 29148`
   10 results looked at. Nothing fetched: lecture PDFs and readthedocs pages that carry ISO/IEC/IEEE 29110 text, none shown to quote 29148's set-level definition of complete. So that definition is not read (see shapes.md).
19. `negative requirements "shall not" cannot be verified by testing absence of behaviour requirements engineering state positively verification closed set`
   10 results looked at. Read: the Penn State record of Voas and Laplante, the Systemthink post by Howell, a message on the IEEE 802.11 list and a message on the W3C QA list (the last two chosen because they come from people writing standards and discuss negatives and testability). Not read: an arXiv paper on negation in requirements (2503.13958), a Business Rules Community article, a defence conference PDF, university slides, an ArgonDigital post already read.
20. `Gilb Planguage requirement Scale Meter Must Plan Wish "Meter" test measurement quantified requirements free page`
   The tool ran this as three searches in one call (9 results each); counted as three (entries 20 to 22). Nothing fetched (budget). Found: Gilb's article in ACCU Overload 70, an article by Wiegers on Modern Analyst, and the same article on ArgonDigital. See not-read.md.
21. (second search run inside call 20)
22. (third search run inside call 20)
23. `Berry Kamsties Krieger "From Contract Drafting to Software Specification: Linguistic Sources of Ambiguity" handbook quantifier ambiguity`
   9 results looked at. Nothing fetched (budget). Found: the handbook PDF and its HTML landing page. See not-read.md.
24. `Wilson Rosenberg Hyatt ARM Automated Requirement Measurement weak phrases "options" "continuances" imperatives NASA QuARS Gnesi`
   10 results looked at. Nothing fetched (budget). See not-read.md.
25. `Montgomery Frattini "Empirical research on requirements quality: a systematic mapping study" Requirements Engineering 2022 abstract`
   9 results looked at. Nothing fetched (budget). Found the open full text on PubMed Central. See not-read.md.
26. `W3C QA Framework Specification Guidelines conformance classes profiles modules discretionary behaviour testable assertions unsupported error handling`
   9 results looked at. Nothing fetched (budget); only 2002 working drafts were listed. See not-read.md.

Not searched for lack of budget or because the topic is outside this group: a source saying "report anything outside the closed set as unknown and fail safe" (fail-safe defaults are a security design idea; no query of mine used those words), dry run versus real run agreement (shape 3), and readers of many file formats (shape 4). The searches closest to shapes 3 and 4 are entries 18 and 26.

### Fetches (batch 1, 22 in all)

York course page (2); Wikipedia Requirement (2); Altium (1); Meyer's post (2); arXiv abstract and ar5iv full text of 1611.08847 (1 + 3); arXiv abstract and ar5iv full text of 2309.10355 (1 + 2); TU Berlin repository (2); Wikipedia Software requirements specification (2); ar5iv 1209.1551 (1); W3C list messages 0031 and 0032 (2); Wikipedia Software quality control (1).

### Fetches (batch 2, 26 more, 48 in all)

NASA handbook page (2); SEP blog (403); Sparx page (403); ArgonDigital (1); INCOSE summary sheet PDF (403); Altium rule list (2 more, 3 in all); Spec Innovations help page (2); alistairmavin.com/ears (2); GI abstract page (1); Fraunhofer record (blocked); Cádiz thesis record (2); Springer article (redirect, not followed); infona record (404); Chalmers record (1); arXiv 2005.01355 (1); arXiv abstracts 2002.02672 and 1702.07656 (2); ar5iv full texts of the same two (2 + 2).

### Fetches (batch 3, 22 more, 70 in all)

arXiv abstract of 1611.10288 (1) and ar5iv full text (2); arXiv HTML of 2408.10886 (2); arXiv HTML of 2502.18617 (1); jot.fm Firesmith column (3); O'Reilly chapter page (403); Volere template page (3); Penn State record (2); Systemthink post (2); IEEE 802.11 list message (2); W3C QA list message of 2005 (3).

<!-- end -->

## What was not read


Pages that could not be read, or that are known only from a search snippet. Nothing here is
inferred from a title or a snippet.

- IEEE 830-1998 itself (the standard). Known only through PDF copies and secondary quotes. PDF links found, not read, because the fetch tool cannot read PDFs: https://people.eecs.ku.edu/~hossein/Teaching/Stds/0830.pdf, https://sphere10.com/files/1cc91fe5-4de1-47c5-af40-769fcd246688/830-1998.pdf, https://web.njit.edu/%7Ejoelsd/capstone/Standards%20for%20Writing%20Requirements.pdf. Also a Word file, https://mobileappdev.academic.csusb.edu/wp-content/uploads/2019/04/SRS.doc, not tried. Consequence: the sentence "there exists some finite cost-effective process with which a person or machine can check that the software product meets the requirement" was NOT seen word for word on any page I read. What I did read: sentences of the standard quoted by Meyer (see captures/articles/meyer-ieee830-naivete), a paraphrase of it in a paper (chopra-meaning-of-requirements) and an adaptation in a W3C list message. The standard's definition of "complete" ("all realizable classes of input data in all realizable classes of situations") is known only from a search result summary, so it is not read and not used.
- ISO/IEC/IEEE 29148:2018, store and catalogue pages: https://store.sfs.fi/en/ieee-29148-2018, https://connect.snv.ch/en/ieee-29148-2018-2. Not fetched: sales pages, the standard is paywalled.
- INCOSE webinar and conference papers: https://www.incose.org/wp-content/uploads/2026/01/webinar_144_the_incose_gfwr_raising_the_ante.pdf and https://www.incose.org/wp-content/uploads/legacy/presentation/IS2013-pdf/6-4-1.pdf. PDF, not read.
- Femmer thesis (2017): https://wwwbroy.in.tum.de/~femmer/works/femmer-thesis-2017.pdf. PDF, not read.
- Full text of "Requirements Quality Is Quality in Use": PDF behind the repository page, not read (abstract only, see captures).

- https://sep.com/blog/deconstructing-always-and-never/ ("Deconstructing always and never", a practitioner blog on "always" and "never" in requirements). Blocked: HTTP 403. Not worked around. Only its title is known from a search result, so nothing from it is used.
- https://sparxsystems.com/enterprise_architect_user_guide/13.5/model_domains/characteristics_of_good_requirements.html (a tool's page on characteristics of good requirements). Blocked: HTTP 403. Not worked around.
- https://www.incose.org/docs/default-source/working-groups/requirements-wg/rwg_products/incose_rwg_gtwr_summary_sheet_2022.pdf (INCOSE Guide to Writing Requirements, summary sheet). Blocked: HTTP 403 (and a PDF). The rule text for R26 and R32 was taken from two vendor pages instead (captures/articles/altium-valiassistant-incose-rules and the noted-only Spec Innovations entry).
- https://publica.fraunhofer.de/handle/publica/475513 (a Fraunhofer repository record that a search result tied to an EARS case study in aviation). Blocked: an "Access Denied" bot-protection page, no content. Not worked around. The aviation and nuclear case studies of EARS named in the search result summary are therefore not read and not used.
- https://link.springer.com/article/10.1007/s00766-024-00427-0 ("Benchmarking requirement template systems: comparing appropriateness, usability, and expressiveness", Requirements Engineering, 2024). The page redirected to an identity-provider authorisation address with encoded parameters. Not followed: the address carries encoded parameters, and it is a login handshake. Its findings appear only in search result summaries and are not used.
- https://www.infona.pl/resource/bwmeta1.element.ieee-art-000007765533 (a catalogue record that a search result tied to Mavin's "Listens Learned (8 Lessons Learned Applying EARS)", 2016). HTTP 404. The paper itself is not read: known only from a search result title.
- Mavin and others, "Easy Approach to Requirements Syntax (EARS)", RE 2009 (a Manchester research page and an IEEE record appeared in a search result). Not fetched, to keep within the source budget; known only from search result titles, so nothing from it is used. The author's own project page was read instead (captures/articles/alistairmavin-ears).
- https://gtu.academia.edu/SarahGregory (a search result for "Listens Learned (8 Lessons Learned Applying EARS)"). Not fetched: a login-gated profile page.
- https://rodin.uca.es/handle/10498/18769 was read (two reads) and is NOT the paper I was after: it is a 2016 student thesis on template systems (abstract only: "template-systems are a good improvement for requirements specification and MASTeR would be the more suitable one", one read), so it is not used.

- https://www.oreilly.com/library/view/mastering-the-requirements/9780132942850/ch12.xhtml ("Mastering the Requirements Process", a chapter of the Robertsons' book, which a search result tied to fit criteria). Blocked: HTTP 403. Not worked around. The Volere page was read instead.

### Not read because the 70-fetch budget was spent (found by search, never fetched)

These are known only from search result titles and summaries. Nothing from them is used as evidence.

- Berry, Kamsties and Krieger, "From Contract Drafting to Software Specification: Linguistic Sources of Ambiguity" (2003 handbook). A PDF, https://cs.uwaterloo.ca/~dberry/handbook/ambiguityHandbook.pdf (the fetch tool cannot read PDFs), and an HTML landing page, https://cs.uwaterloo.ca/~dberry/ambiguity.html, which I did not fetch. So the quantifier ambiguity section ("all", "each", "every", "any" used to define or refer to sets) is not read.
- ARM (Wilson, Rosenberg and Hyatt, NASA, 1997) and QuARS (Gnesi and others, 2005): a Penn State record "The NASA automated requirements measurement tool: a reconstruction" (https://pure.psu.edu/en/publications/the-nasa-automated-requirements-measurement-tool-a-reconstruction/) and an ISTI-CNR PDF (https://openportal.isti.cnr.it/data/2007/160845/2007_160845.pdf). The weak phrase lists are not read. NASA's handbook checklist and the INCOSE rule R7 gave similar word lists, so this gap matters less.
- Montgomery, Fucci, Bouraffa, Scholz and Maalej, "Empirical research on requirements quality: a systematic mapping study" (Requirements Engineering, 2022; open full text at https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9110500/). Not fetched. The evidence census I could read is the later paper by Frattini and others (captures/papers/frattini-2023-quality-theory).
- SWEBOK Guide on verifiable and testable requirements: a wiki copy of the chapter, https://swebokwiki.org/Chapter_1:_Software_Requirements, and the topics page of version 4, https://www.computer.org/education/bodies-of-knowledge/software-engineering/topics. Not fetched; the version 4 PDF is a PDF. SWEBOK is therefore not covered.
- Planguage (Gilb): Gilb's article "How to Quantify Quality: Finding Scales of Measure", https://accu.org/journals/overload/13/70/gilb_299, and Wiegers' "Specifying Quality Requirements With Planguage", https://modernanalyst.com/Resources/Articles/tabid/115/ID/2926/Specifying-Quality-Requirements-With-Planguage.aspx. Not fetched. A search summary describes a Meter keyword (how to measure) and a worked example with a stated sample of test reports and an operational profile, which would bear on shape 1 and shape 2; I could not check it.
- SMART criteria (Doran, 1981): not searched, not read.
- W3C "QA Framework: Specification Guidelines" (conformance classes, profiles, discretionary behaviour, testable assertions): the search results list only 2002 working drafts, for example https://www.w3.org/TR/2002/WD-qaframe-spec-20020826/. Not fetched. It could bear on shapes 3 and 4 (naming classes of product that must conform); my group found nothing else on those.
- Not searched at all, so not found and not read: Femmer, Kučera and Vetrò 2014 on passive voice requirements (a controlled experiment), Zowghi and Gervasi on completeness of requirements, Zave and Jackson on domain assumptions, Femmer and others 2014 "Which requirements artifact quality defects are automatically detectable?".

