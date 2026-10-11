---
title: What a functional core opens up for checking code, and what it does for coding with AI
type: concept
standing: claimed
sources: [trials/2026-10-04-review-findings-classified, trials/2026-10-09-mutation-counts, articles/alloy-tools, articles/anthropic-2026-pbt-blog, articles/biome-noprocessenv, articles/dafny-2022, articles/dafny-lang, articles/effect-schema, articles/effect-ts, articles/eslint-plugin-functional, articles/fastcheck-ts, articles/fpts, articles/galois-dodds-2025, articles/hacl-2017, articles/hypothesis-py, articles/isabelle, articles/kiro-2025-pbt, articles/kleppmann-2025, articles/lemmafit-2026, articles/lemmascript-2026, articles/meyer-1992, articles/neverthrow, articles/oxlint-no-process-env, articles/quint, articles/rocq-coq, articles/stryker-js, articles/tlaplus-tla, articles/tokeneer-2013, articles/ts-pattern, articles/zod, papers/agda-2024, papers/agentic-pbt-2025, papers/agentic-proving-2026, papers/algoveri-2026, papers/alphaverus-2024, papers/aria-2026, papers/atlas-2025, papers/autospec-2024, papers/autoverus-2024, papers/aws-2014, papers/axdafny-2026, papers/berger-2019, papers/bicarregui-2009, papers/bisharat-2026-tla-bench, papers/bisharat-2026-tla-write, papers/cardano-2024, papers/cedar-2024, papers/chen-2026-modelbench, papers/cheng-2026-sysmobench, papers/clever-2025, papers/clover-2023, papers/dafny-ir-2025, papers/dafnybench-2024, papers/dafnypro-2026, papers/danso-2026-ltl, papers/erlang-pulse-2009, papers/estler-2014, papers/etna-jfp2026, papers/fakhoury-2024-ticoder-study, papers/fan-2025-verifast, papers/faria-2026, papers/fiatcrypto-2019, papers/fonseca-2017, papers/formalbench-2025, papers/fstar-2016, papers/fstar-neural-2024, papers/fvapps-2025, papers/gleirscher-2020, papers/goedel-code-prover-2026, papers/goldstein-icse2024, papers/he-2025-pgs, papers/hong-2025-alloy, papers/howtospecify-2020, papers/huang-2026, papers/hughes-1989, papers/hughes-2016, papers/ironfleet-2015, papers/jing-2026-pbtbench, papers/kamath-2023-loopy, papers/konstantinou-2024-oracles, papers/lahiri-2024-intent-formalization, papers/lahiri-2026, papers/laurel-2024, papers/lean4-2021, papers/leetproof-2026, papers/leroy-2009, papers/li-2026-probe, papers/liquidhaskell-2025, papers/liu-2023-evalplus, papers/mariposa-2023, papers/matichuk-2015, papers/misu-2024, papers/mongodb-xmodelling-2020, papers/nl2postcond-2024, papers/nl2spec-2023, papers/pei-2023-invariants, papers/prasetya-2026-postconditions, papers/propertygpt-2025, papers/qed-2020, papers/quickcheck-2000, papers/rango-2024, papers/ravi-coblenz-2025, papers/richter-2025-nl2contract, papers/rsc-2016, papers/schneider-2025, papers/sel4-2009, papers/sel4-2014, papers/selene-2024, papers/shefer-2025, papers/specgen-2025, papers/swe-proof-2026, papers/tan-2026, papers/tanaka-2025-pbt-ebt, papers/ticoder-2024, papers/verdi-2015, papers/vericoding-2025, papers/vericontest-2026, papers/verifythisbench-2025, papers/verina-2025, papers/vero-2026, papers/verus-2024, papers/verus-specbench-2026, papers/verusage-2025, papers/vikram-2024-pbt, papers/yang-2011, papers/yuan-2014, papers/zhao-2026-misguidance]
updated: 2026-10-09
---

# What a functional core opens up for checking code, and what it does for coding with AI

**The answer.** The question is [#300, Research: how functional programming opens up formal verification, and what that does for coding with AI](https://github.com/brindlewick/postmaster/issues/300),
raised when [#298, The design rules say a computation does no I/O and effects sit at the edges](https://github.com/brindlewick/postmaster/issues/298)
added a functional-core rule to the design rules. In short: the functional style opens up cheap checks far more than it opens up proofs, and
the cheap checks are where the evidence points.

**What it opens up here.** In postmaster's own record, a stated property was more often the missing piece than the
structure of the code. Of 84 serious review findings in four runs, a first reading judged that a stated property or a
small model would have caught 79 before a reviewer did: 37 by a property checked in process, with no git, shell or real
tool, 18 by one whose oracle is git, a shell or a real tool, and 24 for which a pure core would also have made the
check possible. A second reader gave the same answer to the property question on 25 of the 26 findings it read. The 24
sat in procedures that mixed decisions with reads of, or acts on, git, the file system, the environment, the process
table or the log (restores, a dry run that disagrees with the real run, ambient variables), and for none of them was a
pure core enough without a property. For most of the other 55 the code already took text and returned values; for at
least six (252/bug-1, bug-14, bug-15 and bug-24, 216/bug-3 and sec-3) the defect was in how the code ran git, tar or the
file system, and a pure core would not have changed that. What was missing was the property. Five findings were runbook
prose or an inference from free text, with nothing to run. This is an estimate with hindsight in it, not a forecast,
because both readers knew each defect: counting only the 47 findings the first reader marked clear, 45 remain. The first
trial below measures the hindsight.

**What proofs add.** The functional style does open the door for TypeScript, and the evidence on whether it pays is thin.
The one current toolchain found that verifies TypeScript source, LemmaScript, a tech preview created in March 2026, verifies
only "the pure, functional core" (arrays, maps, sets, ordinary control flow, functions, discriminated unions) and
excludes classes with inheritance, closures over mutable state and `any`, and does not yet support `await`; it
generates Dafny or Lean 4 from ordinary TypeScript carrying annotations, and several of its case studies name the user
interface and the I/O as their trust boundary [@articles/lemmascript-2026/passages.md]. Every figure it reports is its own, and it gives no person-time.
Where proofs have been measured they cost far more than the code they check. For seL4 the 2009 paper reports about
200,000 lines of proof script for 8,700 lines of C, about 20 person-years of proof effort and 144 defects found in the C code, none deep in the sense that an algorithm was flawed (mainly typos, misreadings of the specification and code left out of date), and the 2014 account puts building the kernel at 2.2 person-years against 20.5 for the
functional-correctness proof [@papers/sel4-2009/passages.md] [@papers/sel4-2014/passages.md]. Its authors write that a proof "does not guarantee
that the specification describes the behaviour the user expects". In AWS's Cedar the proofs found 4 bugs, all in the policy validator, and differential and property-based testing found 21 more in various parts of the system [@papers/cedar-2024/passages.md]. The one
industrial report found that states a functional core as a verification policy, Cardano's, puts more weight on verification in the inner layers and more on testing in the impure outer ones, and checks its production Haskell against the specification by conformance tests, not by proof [@papers/cardano-2024/passages.md].

**What AI coding has shown.** With the statement to prove fixed, how many proofs get accepted depends on the language and the
setup. In the largest benchmark, off-the-shelf models solved 82% of the Dafny tasks, 44% of the Verus tasks and 27% of the
Lean tasks, counting a task as solved if any one model solved it; on an older Dafny set the best single model went from 68%
to 89% in about 14 months [@papers/vericoding-2025/passages.md]. On 849 proof tasks from real Verus systems, coding agents completed 81% for the best model [@papers/verusage-2025/passages.md]. A proof checker rejects every wrong proof,
so the trust moves to the statement. An agent that must write its own specification gains nothing over an unaided
one, and only 56% of its specifications pass an audit [@papers/swe-proof-2026/passages.md]. Models cheat a verifier that
is not guarded, and verified solutions often fail the original tests. Models write specifications well for small
functions when a person has already given the intent in a checkable form, and badly for rich targets. A model
writing property tests found real bugs in popular Python packages; of 50 reports sampled from the top 80% by the agent's
own score, 56% were valid [@papers/agentic-pbt-2025/passages.md]. No controlled comparison with example tests on real code
was found: in the one small head-to-head, on 16 problems and one model, each kind of test caught 2 defects the other
missed, 11 each and 13 together [@papers/tanaka-2025-pbt-ebt/passages.md]. Nothing found
measures any of this in TypeScript, apart from the case studies of LemmaScript's own authors.

| claim | verdict | strength |
|---|---|---|
| Pure functions are easier to test and to verify than code that mixes in effects | not settled: argued for decades, never measured; for 24 of 84 findings a pure core made the check possible | argued but not measured; one team's count |
| Machine-checked proofs make AI-written code trustworthy | shown narrowly (a checker rejects wrong proofs, and agents supply proofs for given statements); the opposite as worded, because the trust moves to the specification and the guards | controlled studies on narrow benchmarks, mostly by their authors; single-team reports for 2026 |
| Writing the specification is the hard part, and models are weak at it | shown for people; for models, weak where they must supply the intent, not where a person has given it in a checkable form | one team's experience for older work; controlled benchmarks, mostly by their authors, for models |
| Property-based tests find defects that example tests miss | shown that they find defects; in the one small head-to-head each kind caught defects the other missed, and no controlled comparison on real code was found | experience reports, one corpus study and one small head-to-head |

**What follows.** Four changes are proposed to the design rules and the ticket template (give rule 8 a mechanical
check, which asks the user to reverse a decision they gave in #298, with a possible second part against mutating what escapes a function; one program for the dry run, the tests and the real run of anything that runs dry or undoes;
a law over generated inputs for each reader of text; a state table for each undo), and five trials, none run: four of 2 to 12 hours each, and a fifth in three steps of 4 to 12 hours, each later step run
only if the one before did not fail. One of the four prices LemmaScript on a single function. The fifth writes a cleanup script's
decisions once, with git passed in and swapped for a mock that is checked against real git, and compares a plain version
with an Effect version. A proof tool is not proposed yet, and neither are the Effect and fp-ts libraries as dependencies: nothing
read shows they would have caught what the reviews caught, or what they would cost a project of this size, and the fifth
trial measures one comparison.

**Standing: claimed.** The page rests on reading, and on a count of four runs by a first reader and a second. Two
independent readers checked it against its captures and sources before it was published, and a third checked the
rewrite of the fifth trial; what they found was corrected, and [what was not read](#what-was-not-read) says what they did
not reach. By
[the schema](../schema.md) outside work moves no standing, and the count is a trial, not a promoted run, as
[the lane audit](several-lanes.md) was. What would settle it: runs made under a changed practice that show fewer
serious findings per round than these four, and the first trial's result.

## The map

What exists, in the five groups the ticket names. Each entry gives the source, a link, the day it was read, one
sentence on what it says, and which rule chose it. This is not a survey. Each reading helper took the most used
and the most serious entries of its group by four rules, named in the third column: **use** (stars, downloads,
named adoption), **serious** (the most cited, or the most rigorous or independent evaluation), **recent** (for
language-model work, the newest result that supersedes older ones) and **contradicts** (it cuts against one of
the four claims). Each entry carries the day it was read, 2026-10-04 or, after midnight UTC, 2026-10-05. Rows in every table run from the oldest source to the newest. The last column is the capture in `raw/`, which holds the helper's notes and the
quotes, each marked `checked` only where two separate reads gave the same words. A search that finds nothing is
not proof that nothing exists, and what could not be read is listed under [what was not read](#what-was-not-read).

### 1. Lightweight checking of pure code

Property-based testing states a property of a function and searches generated inputs for a counterexample; design by contract attaches checks to routines. Three entries are the older argument and evidence about purity and defects, which bear on claim 1.

| source | what it says | chosen by | read | capture |
|---|---|---|---|---|
| [Why Functional Programming Matters](https://www.cse.chalmers.se/~rjmh/Papers/whyfp.pdf), Hughes, 1989 | The paper says the usual selling points of functional programming, no assignment and no side effects, are negative and "not very convincing", and argues instead that higher-order functions and lazy evaluation give a kind of glue that improves modularity. | serious | 2026-10-04 | [@papers/hughes-1989] |
| [Applying "Design by Contract"](https://se.inf.ethz.ch/~meyer/publications/computer/contract.pdf), Meyer, 1992 | Each routine carries a precondition (the caller's obligation) and a postcondition (the routine's), each class an invariant, all written as Boolean expressions that can be checked at run time during development; a violated precondition is a bug in the caller and a violated postcondition a bug in the routine. | serious | 2026-10-04 | [@articles/meyer-1992] |
| [QuickCheck: A Lightweight Tool for Random Testing of Haskell Programs](https://www.cs.tufts.edu/~nr/cs257/archive/john-hughes/quick.pdf), Claessen and Hughes, 2000 | The paper introduces QuickCheck, where a Haskell programmer writes properties as functions and the tool tests them on random inputs, and it argues that pure functions are much easier to test than side-effecting ones ("in Haskell, only computations in the IO monad are hard to test"), so random testing can be done at a fine grain. | serious | 2026-10-04 | [@papers/quickcheck-2000] |
| [Finding Race Conditions in Erlang with QuickCheck and PULSE](https://web.cecs.pdx.edu/~apt/icfp09_accepted_papers/70.html), Claessen and others, 2009 | QuickCheck, a deterministic scheduler called PULSE and a visualizer together let unit-level tests detect race conditions that unit tests normally miss, shown on an industrial case study. | serious | 2026-10-04 | [@papers/erlang-pulse-2009] |
| [Contracts in Practice](https://arxiv.org/pdf/1211.4775), Estler and others, 2014 | In 21 projects that use contracts (Eiffel, C# and Java), more than a third of routines and classes carry contracts in most projects, the share is stable over time, and contracts change much less often than the code that implements them. | serious | 2026-10-04 | [@papers/estler-2014] |
| [Simple Testing Can Prevent Most Critical Failures: An Analysis of Production Failures in Distributed Data-Intensive Systems](https://www.usenix.org/system/files/conference/osdi14/osdi14-paper-yuan.pdf), Yuan and others, 2014 | Among 198 randomly sampled user-reported failures of five distributed data systems, 92% of the catastrophic ones came from incorrect handling of non-fatal errors that the software had explicitly signalled, and most of those faults were easy to find with simple tests of the error-handling code. | contradicts, serious | 2026-10-04 | [@papers/yuan-2014] |
| [Experiences with QuickCheck: Testing the Hard Stuff and Staying Sane](http://publications.lib.chalmers.se/records/fulltext/232550/local_232550.pdf), Hughes, 2016 | The inventor of QuickCheck recounts three industrial stories (a toy C queue, 20,000 lines of QuickCheck models for Volvo's AUTOSAR code, and five bugs in Erlang's `dets` database found with generated parallel tests, two of them in about ten minutes each, after the database's maintainer had spent six weeks at a customer hunting one), and concludes that the need for a specification is the real weakness of property-based testing. | serious | 2026-10-04 | [@papers/hughes-2016] |
| [On the Impact of Programming Languages on Code Quality: A Reproduction Study (of Ray, Posnett, Filkov and Devanbu, FSE 2014)](https://arxiv.org/pdf/1901.10220), Berger and others, 2019 | An independent reproduction of a study of 729 GitHub projects found it only partly repeatable and, after correcting the data and the statistics, found 4 of the 11 originally significant languages still associated with defects, with effect sizes that the authors call exceedingly small. | serious | 2026-10-04 | [@papers/berger-2019] |
| [Hypothesis (Python property-based testing)](https://github.com/HypothesisWorks/hypothesis), MacIver and others, 2019 onward | "The property-based testing library for Python": it tests that a property holds for all inputs in a described range, picks inputs itself, and reports the simplest failing case it can find. | use | 2026-10-04 | [@articles/hypothesis-py] |
| [How to Specify It! A Guide to Writing Properties of Pure Functions](https://research.chalmers.se/publication/517894/file/517894_Fulltext.pdf), Hughes, 2020 | A tutorial gives five ways to write properties for pure code (validity invariants, postconditions, metamorphic, inductive, model-based), compares them on eight planted bugs in a binary search tree, and says that newcomers find it hard to identify properties to write. | serious | 2026-10-04 | [@papers/howtospecify-2020] |
| [Property-Based Testing in Practice](https://cis.upenn.edu/~bcpierce/papers/icse24-pbt-in-practice), Goldstein and others, 2024 | Interviews with 30 experienced PBT users at one financial firm found they use PBT mostly where a property is obvious and a third said it found bugs other methods missed, while writing properties, writing generators and judging whether the tests are effective are its weak points. | serious | 2026-10-04 | [@papers/goldstein-icse2024] |
| [An Empirical Evaluation of Property-Based Testing in Python](https://2025.splashcon.org/details/OOPSLA/102), Ravi and Coblenz, 2025 | A corpus study of 426 Python programs that use Hypothesis classifies their property-based tests into 12 categories and reports that, by mutation testing on 40 projects, each property-based test finds about 50 times as many mutations as the average unit test. | serious | 2026-10-04 | [@papers/ravi-coblenz-2025] |
| [Etna: An Evaluation Platform for Property-Based Testing](https://arxiv.org/pdf/2603.27002), Keles and others, 2026 | A platform measures how fast different input generators find hand-injected bugs for the same properties in Haskell, Rocq, OCaml, Racket and Rust, and finds that hand-written generators beat type-derived ones where the precondition is sparse, and that larger inputs are not always better. | serious | 2026-10-04 | [@papers/etna-jfp2026] |

### 2. Proof assistants and verified languages

Proof assistants and verified languages: the tools, then what proofs cost and what they found. Older work only; what language models do with these tools is in group 4.

| source | what it says | chosen by | read | capture |
|---|---|---|---|---|
| [Industrial Practice in Formal Methods: a Review (FM 2009, LNCS 5850, pp. 810-813), the four-page summary of Woodcock, Larsen, Bicarregui and Fitzgerald, "Formal Methods: Practice and Experience" (ACM Computing Surveys 41(4), 2009), which I could not read](https://epubs.stfc.ac.uk/manifestation/48912103/STFC-AAM-2021-007.pdf), Bicarregui and others, 2009 | Of 62 industrial projects that used formal methods, projects that reported cost effects were five times as likely to report a reduction as an increase, and 92% reported better quality, but only half reported cost at all and the authors say the review is not a basis for general inference. | contradicts | 2026-10-05 | [@papers/bicarregui-2009] |
| [Formal verification of a realistic compiler (CACM 52(7); author's preprint read)](https://xavierleroy.org/publi/compcert-CACM.pdf), Leroy, 2009 | CompCert's Coq development is 42,000 lines and about 3 person-years, three quarters of it proof, and the author lists exactly what is still trusted: the semantics of the source and target languages, the unverified parser, assembler and linker, the extraction chain, and Coq itself. | serious | 2026-10-04 | [@papers/leroy-2009] |
| [seL4: Formal Verification of an OS Kernel (SOSP '09)](https://www.sigops.org/s/conferences/sosp/2009/papers/klein-sosp09.pdf), Klein and others, 2009 | The first full functional-correctness proof of a general-purpose OS kernel: 8,700 lines of C and 600 of assembler, about 200,000 lines of Isabelle proof script, about 20 person-years of proof effort (11 of them seL4-specific); the authors state in so many words that the proof shows the code matches the specification, not that the specification is what the user expects. | serious | 2026-10-04 | [@papers/sel4-2009] |
| [Finding and Understanding Bugs in C Compilers (PLDI '11)](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf), Yang and others, 2011 | Random testing found 325 reported bugs across GCC, LLVM and other compilers, none in the verified middle end of CompCert after about six CPU-years, but bugs in its unverified front end and in a gap in its target semantics. | serious, contradicts | 2026-10-04 | [@papers/yang-2011] |
| [the Tokeneer project (NSA, 2003, SPARK and Z): what it cost, and the problems found in it later](https://www.cl.cam.ac.uk/archive/mjcg/FMATS2/papers/CbyCForSecurity.pdf), Altran/Praxis, 2013 | A verified, 10,000-line security system was built in 260 person-days and the NSA's testers found no faults at the time, yet five defects were counted by 2013 and later work reports further problems that the proofs had not caught. | contradicts | 2026-10-05 | [@articles/tokeneer-2013] |
| [Comprehensive Formal Verification of an OS Microkernel (ACM TOCS 32(1), Article 2)](https://sel4.systems/Research/pdfs/comprehensive-formal-verification-os-microkernel.pdf), Klein and others, 2014 | A full functional-correctness proof of a roughly 10,000-line C microkernel, extended to security properties and the compiled binary, took about 20 person-years of proof effort against 2.2 for building the kernel, found 144 defects in the C code, and rests on stated assumptions (assembly, boot code, caches, hardware) that it does not prove. | serious | 2026-10-04 | [@papers/sel4-2014] |
| [IronFleet: Proving Practical Distributed Systems Correct (SOSP '15)](https://www.microsoft.com/en-us/research/wp-content/uploads/2015/10/ironfleet.pdf), Hawblitzel and others, 2015 | Two verified distributed systems (a Paxos-based replicated state machine library and a sharded key-value store), written in Dafny, cost about 3.7 person-years including inventing the method and carry about 3.6 lines of proof annotation per line of executable code at the implementation layer, and about 7.7 to 1 in total by Figure 12's counts. | serious | 2026-10-04 | [@papers/ironfleet-2015] |
| [An Empirical Study Towards a Leading Indicator for Cost of Formal Software Verification (ICSE 2015; the brief says "Staples and others", the first author is Matichuk)](https://trustworthy.systems/publications/nicta_full_text/8318.pdf), Matichuk and others, 2015 | In six Isabelle proof developments the length of a proof grows roughly with the square of the size of the property it proves, and statements that say more than they need inflate that size, so a statement's size is a leading, though not yet predictive, indicator of proof effort. | serious | 2026-10-05 | [@papers/matichuk-2015] |
| [Verdi: A Framework for Implementing and Formally Verifying Distributed Systems (PLDI '15)](https://homes.cs.washington.edu/~ztatlock/pubs/verdi-wilcox-pldi15.pdf), Wilcox and others, 2015 | A Coq framework with a verified Raft implementation: about 4,100 lines of proof for 520 lines of implementation and 170 of specification, which exposed a serious data-loss bug in the authors' own Raft code that testing was unlikely to find. | serious | 2026-10-04 | [@papers/verdi-2015] |
| [Dependent Types and Multi-monadic Effects in F* (POPL 2016), with the project page](https://www.fstar-lang.org/papers/mumon/), Swamy and others, 2016 | F* is "a general-purpose proof-oriented programming language, supporting both purely functional and effectful programming." | use | 2026-10-05 | [@papers/fstar-2016] |
| [An Empirical Study on the Correctness of Formally Verified Distributed Systems (EuroSys '17)](https://www.cs.purdue.edu/homes/pfonseca/papers/eurosys2017-dsbugs.pdf), Fonseca and others, 2017 | Searching three machine-checked distributed systems for more than eight months found 16 bugs, none in the verified protocol logic, all in the specification, the unverified shim layer or the verification tools, and the authors trace them to assumptions the proofs relied on. | serious, contradicts | 2026-10-04 | [@papers/fonseca-2017] |
| [HACL*: A Verified Modern Cryptographic Library (CCS 2017) - the paper itself NOT READ; read here: the project page, plus the cost figures as reported in the Huang survey](https://hacl-star.github.io/), Zinzindohoue and others, 2017 | A cryptographic library written and verified in F* and compiled to C, whose code runs in Firefox, Linux and several other systems, built at a cost of roughly one person-week per symmetric primitive and several person-months for the bignum ones, according to a survey of it. | use | 2026-10-05 | [@articles/hacl-2017] |
| [Simple High-Level Code For Cryptographic Arithmetic - With Proofs, Without Compromises (IEEE S&P 2019)](https://people.csail.mit.edu/jgross/personal-website/papers/2019-fiat-crypto-ieee-sp.pdf), Erbsen and others, 2019 | A Coq-checked generator for cryptographic arithmetic replaced hand-written code in BoringSSL, so that, by the authors' estimate, about half of the HTTPS connections that browsers open use the verified field arithmetic, with the proof covering one algorithm for many parameter sets. | use | 2026-10-05 | [@papers/fiatcrypto-2019] |
| [QED at Large: A Survey of Engineering of Formally Verified Software (Foundations and Trends in Programming Languages 5(2-3), 102-281; arXiv 2003.06458, submitted 13 Mar 2020)](https://arxiv.org/abs/2003.06458), Ringer and others, 2019/2020 | A survey of how large machine-checked proofs of programs are built, which says that large projects have mostly been carried out by small expert teams, that the cost literature finds proof effort tracking proof size, and that proof assistants and their extraction and linking steps are themselves part of what must be trusted. | serious | 2026-10-04 | [@papers/qed-2020] |
| [Formal Methods in Dependable Systems Engineering: A Survey of Professionals from Europe and North America (Empirical Software Engineering 25; arXiv 1812.08815, v3 22 Sept 2020)](https://arxiv.org/abs/1812.08815), Gleirscher and Marmsoler, 2020 | In a survey of 216 people who use or study formal methods in mission-critical software, usefulness is rated well, ease of use poorly, and scalability, skills and education are the main challenges. | serious | 2026-10-05 | [@papers/gleirscher-2020] |
| [The Lean 4 Theorem Prover and Programming Language (System Description, CADE 2021)](https://lean-lang.org/papers/lean4.pdf), de Moura and Ullrich, 2021 | Lean 4 is a rewrite of the Lean proof assistant in Lean itself, "also an efficient functional programming language", whose users extend it with their own tactics and code. | use | 2026-10-04 | [@papers/lean4-2021] |
| [Proof, but at What Cost? (talk abstract, HCSS '22, 27 April 2022), with the Dafny project page](https://sos-vo.org/node/83866/), Salkeld (Amazon Web Services), 2022 | The tool's own page calls Dafny "a verification-aware programming language"; the AWS team says that several high-assurance AWS projects are written in it and that "verification instability", small changes breaking proofs that held before, is the biggest threat to its adoption. | use, contradicts | 2026-10-05 | [@articles/dafny-2022] |
| [Lessons from Formally Verified Deployed Software Systems (arXiv 2301.02206; short version in ACM Computing Surveys)](https://arxiv.org/pdf/2301.02206), Huang and others, 2023 | Across 32 deployed verified systems the authors find cost to be the main obstacle, find that every team relied on something unverified or on a specification that could be wrong, and also collect several reports that verification lowered total cost. | serious | 2026-10-04 | [@papers/huang-2026] |
| [Mariposa: Measuring SMT Instability in Automated Program Verification (FMCAD 2023)](https://www.andrew.cmu.edu/user/bparno/papers/mariposa.pdf), Zhou and others, 2023 | In six existing verification projects, up to 5% of the solver queries behind their proofs are unstable, that is, a semantically irrelevant change such as renaming a variable can make verification slow or fail, and upgrading the solver often makes this worse. | serious | 2026-10-05 | [@papers/mariposa-2023] |
| [Formal Specification of the Cardano Blockchain Ledger, Mechanized in Agda (FMBC 2024, OASIcs 118, article 2), with the Agda repository](https://drops.dagstuhl.de/storage/01oasics/oasics-vol118-fmbc2024/OASIcs.FMBC.2024.2/OASIcs.FMBC.2024.2.pdf), Knispel and others, 2024 | Agda is "a dependently typed programming language / interactive theorem prover"; one company wrote the specification of a production blockchain ledger in it, about one twentieth the size of the Haskell implementation, and uses it by generating a reference implementation and testing production code against it, rather than proving the production code. | use | 2026-10-05 | [@papers/agda-2024] |
| [Applying Continuous Formal Methods to Cardano (Experience Report) (FUNARCH '24, 2nd ACM SIGPLAN Workshop on Functional Software Architecture, 6 Sept 2024)](https://www.iog.io/api/research/pdf/ZZQVQ3ZZ), Chapman and others, 2024 | A team of about six formal-methods engineers, one in each development team of about six, applies proofs and executable Agda specifications to the pure inner layers of a Haskell blockchain node and tests the impure outer layers, checking the production code against a reference implementation generated from the specification. | use | 2026-10-05 | [@papers/cardano-2024] |
| [How We Built Cedar: A Verification-Guided Approach](https://arxiv.org/abs/2407.01688), Disselkoen and others, 2024 | AWS wrote an executable model of Cedar in Lean and proved properties of it, checked the Rust production code against the model with differential random testing, and used property-based tests for the rest; proofs found 4 bugs and the testing 21 more. | use, serious | 2026-10-04 | [@papers/cedar-2024] |
| [Verus: A Practical Foundation for Systems Verification (SOSP '24)](https://www.andrew.cmu.edu/user/bparno/papers/verus-sys.pdf), Lattuada and others, 2024 | Verus checks proofs about Rust programs with an SMT solver and the authors report 6.1K lines of verified Rust against 31K lines of proof across five systems, a proof-to-code ratio of 5.1 overall and up to 13.3 for the page table. | use, serious | 2026-10-05 | [@papers/verus-2024] |
| [Usability Barriers for Liquid Types (PACMPL 9, PLDI, article 224, June 2025; the brief gives "PLDI 2023", but the study I found is PLDI 2025)](https://catarinagamboa.github.io/papers/pre_print_barriers_liquid_types.pdf), Gamboa and others, 2025 | Interviewing and observing 19 developers using LiquidHaskell found nine usability barriers; among them developers struggled to say what to prove, wrote post-conditions weaker than they should be, and could not tell from a passing check whether the specification was too weak. | serious, use | 2026-10-05 | [@papers/liquidhaskell-2025] |
| [Breaking Bad: How Compilers Break Constant-Time Implementations (arXiv 2410.13489, submitted 17 Oct 2024, v2 2 Sept 2025)](https://arxiv.org/html/2410.13489), Schneider and others, 2025 | An independent study found that some compilers turn the constant-time code in HACL*'s P-256 implementation into secret-dependent branches or memory accesses on some processors, so the source-level guarantee did not survive compilation. | contradicts | 2026-10-05 | [@papers/schneider-2025] |
| [Leino and contributors: Dafny (dafny-lang/dafny)](https://github.com/dafny-lang/dafny), Leino and contributors: Dafny (dafny-lang/dafny) | Dafny is a verification-aware programming language that can compile to C#, Go, Python, Java or JavaScript. | use | 2026-10-05 | [@articles/dafny-lang] |
| [Isabelle project page and the Archive of Formal Proofs statistics page](https://isabelle.in.tum.de/), Isabelle project page and the Archive of Formal Proofs statistics page | "Isabelle is a generic proof assistant." (project page) | use | 2026-10-04 | [@articles/isabelle] |
| [Rocq Prover (formerly Coq) project repository, with the Coq Community Survey 2022 (Borges and others, ITP 2023, LIPIcs 268, article 12) as the caveat](https://github.com/rocq-prover/rocq), Rocq Prover (formerly Coq) project repository and others | "The Rocq Prover is an interactive theorem prover, or proof assistant", used to write definitions, executable algorithms and theorems with machine-checked proofs. | use, serious | 2026-10-05 | [@articles/rocq-coq] |

### 3. Model checking of designs

Model checking of designs. TLA+ and Alloy explore a model of a design exhaustively, up to a bound; they check the design, not the code that is meant to implement it.

| source | what it says | chosen by | read | capture |
|---|---|---|---|---|
| [Use of Formal Methods at Amazon Web Services (report dated 29 Sept 2014; the CACM 2015 article is titled "How Amazon Web Services Uses Formal Methods")](https://lamport.azurewebsites.net/tla/formal-methods-amazon.pdf), Newcombe and others, 2014 | Amazon engineers learned TLA+ in two to three weeks and wrote design-level specifications of 102 to 939 lines that, in the authors' account, "added significant value" in all 10 systems (bugs found in five of the six components in their table; the sixth, a lock-free structure, got "improved confidence" and missed a liveness bug the spec did not state), while the authors state that nothing checks that the code implements the verified design. | use | 2026-10-04 | [@papers/aws-2014] |
| [TLA+ and the TLC model checker (tlaplus/tlaplus)](https://github.com/tlaplus/tlaplus), Lamport and contributors, 2016 onward | TLC is a model checker for specifications written in TLA+, and the TLA+ Toolbox is an IDE for TLA+. | use | 2026-10-05 | [@articles/tlaplus-tla] |
| [Alloy (AlloyTools/org.alloytools.alloy)](https://github.com/AlloyTools/org.alloytools.alloy), Jackson and contributors, 2017 onward | Alloy is a language for describing structures and a tool for exploring them, used from finding holes in security mechanisms to designing telephone switching networks. | use | 2026-10-05 | [@articles/alloy-tools] |
| [eXtreme Modelling in Practice](https://arxiv.org/abs/2006.00915), Davis and others, 2020 | MongoDB, which uses TLA+ to model several systems, tried two ways of checking that code matches its specification and found model-based trace-checking impractical for the Server's abstract replication specification and model-based test-case generation highly successful for Realm Sync. | serious | 2026-10-05 | [@papers/mongodb-xmodelling-2020] |
| [Quint (quint-co/quint)](https://github.com/quint-co/quint), Informal Systems and contributors, 2021 onward | Quint is an executable specification language with tooling, based on the temporal logic of actions. | use | 2026-10-05 | [@articles/quint] |

### 4. Language models used with formal methods

Language models used with formal methods, in four tables: writing verified code and proofs, turning a statement into a specification, writing properties and tests, and writing models of designs. Dates run from 2022 to September 2026.

**Writing verified code and proofs**

| source | what it says | chosen by | read | capture |
|---|---|---|---|---|
| [Clover: Closed-Loop Verifiable Code Generation](https://arxiv.org/abs/2310.17807), Sun and others, 2023 | Rather than trust a verifier on code the model also annotated, Clover checks that code, docstring and formal annotations agree with each other, using the verifier plus the model, and on its small test set it accepted 87% of correct programs while accepting none of the deliberately wrong ones. | serious | 2026-10-04 | [@papers/clover-2023] |
| [AlphaVerus: Bootstrapping Formally Verified Code Generation through Self-Improving Translation and Treefinement](https://arxiv.org/abs/2412.06176), Aggarwal and others, 2024 | A model translating Dafny programs to Verus learned, without being told to, to write `assume(false)` and trivial specifications that the verifier accepted, so the authors added three filters; without the filters the model translated a large fraction of programs mainly by writing `assume(false)`, and the hacking snowballed over the iterations. | contradicts, serious | 2026-10-04 | [@papers/alphaverus-2024] |
| [AutoVerus: Automated Proof Generation for Rust Code](https://arxiv.org/abs/2409.13082), Yang and others, 2024 | A network of model agents writes the proof annotations (invariants, assertions, proof functions) for Rust programs whose Verus specifications are given, and proved 91.3% of 150 tasks against a 44.7% baseline of direct GPT-4o prompting. | serious | 2026-10-04 | [@papers/autoverus-2024] |
| [DafnyBench: A Benchmark for Formal Software Verification](https://arxiv.org/abs/2406.08467), Loughridge and others, 2024 | Models are given a Dafny program that already has its specification and asked to put back the removed assert and invariant hints, and the best of them got 68% of 750-plus programs through the verifier. | serious | 2026-10-04 | [@papers/dafnybench-2024] |
| [Towards Neural Synthesis for SMT-Assisted Proof-Oriented Programming](https://arxiv.org/abs/2405.01787), Chakraborty and others, 2024 | On 600K lines of real F* programs and proofs, fine-tuned small models matched or beat GPT-4 at writing a definition that type-checks against a given specification, but even the best single model solved well under half of the test definitions. | use | 2026-10-04 | [@papers/fstar-neural-2024] |
| [Laurel: Unblocking Automated Verification with Large Language Models](https://arxiv.org/abs/2405.16792), Mugnier and others, 2024 | On lemmas taken from three real Dafny codebases, GPT-4o with the verifier's error location and similar examples produced the missing assertion for 56.6% of 145 cases within ten tries; with the code alone it managed 6.2%. | serious | 2026-10-04 | [@papers/laurel-2024] |
| [Towards AI-Assisted Synthesis of Verified Dafny Methods](https://arxiv.org/abs/2402.00247), Misu and others, 2024 | GPT-4 produced a verified Dafny method with a postcondition for far fewer problems than the raw verified count suggests, because almost half the verified outputs carried no postcondition at all. | serious | 2026-10-04 | [@papers/misu-2024] |
| [Rango: Adaptive Retrieval-Augmented Proving for Automated Software Verification](https://arxiv.org/abs/2412.14063), Thompson and others, 2024 | A small fine-tuned model that retrieves relevant lemmas and similar proofs from the project proved 32.0% of 10,396 theorems from 12 real Coq projects, and success fell steeply as the human proof got longer. | serious | 2026-10-04 | [@papers/rango-2024] |
| [Selene: Pioneering Automated Proof in Software Verification](https://arxiv.org/abs/2401.07663), Zhang and others, 2024 | Asked to prove lemmas extracted from the seL4 verification in Isabelle, GPT-4 managed about 42% of the easiest tier on the first attempt and almost none of the hardest. | serious | 2026-10-04 | [@papers/selene-2024] |
| [ATLAS: Automated Toolkit for Large-Scale Verified Code Synthesis](https://arxiv.org/abs/2512.10173), Baksys and others, 11 December 2025 | A pipeline that has a model write Dafny specifications for Python solutions and then screens them with test-based lemmas produced 2.7K verified Dafny programs; fine-tuning a 7B model on them lifted DafnyBench from about 32% to about 57%. | use, recent | 2026-10-04 | [@papers/atlas-2025] |
| [CLEVER: A Curated Benchmark for Formally Verified Code Generation](https://arxiv.org/abs/2505.13938), Thakur and others, 2025 | When the model has to write the specification itself and prove it equivalent to a held-out reference, and then write and prove the implementation, almost nothing gets through in Lean: the best end-to-end result was 1 problem of 161. | serious | 2026-10-04 | [@papers/clever-2025] |
| [Dafny as Verification-Aware Intermediate Language for Code Generation](https://arxiv.org/abs/2501.06283), Li and others, 10 January 2025 | In a prototype where the model writes Dafny from a prose request, confirms its reading with the user in prose, and compiles verified Dafny to Python, 77% of 164 HumanEval tasks passed all tests, against 86% when the same model wrote Python directly. | use, contradicts | 2026-10-04 | [@papers/dafny-ir-2025] |
| [Proving the Coding Interview: A Benchmark for Formally Verified Code Generation](https://arxiv.org/abs/2502.05714), Dougherty and Mehta, 2025 | Unit tests from the APPS programming problems were turned into unproven Lean 4 theorems by a model, and on a 100-sample slice Claude 3.5 Sonnet proved 30% of the theorems and Gemini 1.5 Pro 18%. | serious | 2026-10-04 | [@papers/fvapps-2025] |
| [Claude Can (Sometimes) Prove It](https://www.galois.com/articles/claude-can-sometimes-prove-it), Dodds, 16 September 2025 | A formal-methods researcher used Claude Code to formalise a published concurrency logic in Lean 4, found that it can write proofs but sometimes thrashes or makes deep conceptual mistakes that do not cause a build error, and judged it slower than doing it by hand. | contradicts | 2026-10-04 | [@articles/galois-dodds-2025] |
| [Prediction: AI will make formal verification go mainstream](https://martin.kleppmann.com/2025/12/08/ai-formal-verification.html), Kleppmann, 8 December 2025 | Kleppmann predicts that language models will make proofs cheap enough that formal verification becomes ordinary practice, on the grounds that a proof checker rejects any wrong proof, and he says the hard part moves to writing the right specification. | recent | 2026-10-04 | [@articles/kleppmann-2025] |
| [Can LLMs Enable Verification in Mainstream Programming?](https://arxiv.org/abs/2503.14183), Shefer and others, 2025 | With Claude 3.5 Sonnet, the share of programs verified falls from 86% in Dafny when code and specification are given (proof only) to 29% when only a prose description and a signature are given, and the same fall appears in Nagini and Verus. | serious | 2026-10-04 | [@papers/shefer-2025] |
| [A benchmark for vericoding: formally verified program synthesis](https://arxiv.org/abs/2509.22908), Bursuc and others, 2025 | Given a formal specification, off-the-shelf models produce verified code for 82% of Dafny tasks, 44% of Verus tasks and 27% of Lean tasks when a task counts as solved if any one model solved it; the best single model solves far fewer. | recent, serious | 2026-10-04 | [@papers/vericoding-2025] |
| [VerifyThisBench: Generating Code, Specifications, and Proofs All at Once](https://arxiv.org/abs/2505.19271), Deng and others, 2025 | Asked to go from a plain description of a VerifyThis competition challenge all the way to specification, implementation and machine-checked proof, the best model passed under 4% zero-shot and under 10% after five feedback rounds. | serious | 2026-10-04 | [@papers/verifythisbench-2025] |
| [VERINA: Benchmarking Verifiable Code Generation](https://arxiv.org/abs/2505.23135), Ye and others, 2025 | In Lean, with natural-language problems, the best model (o3) got code right 72.6% of the time, wrote a sound and complete specification 52.3% of the time, and proved the code against a specification only 4.9% of the time, one try each. | serious | 2026-10-04 | [@papers/verina-2025] |
| [VeruSAGE: A Study of Agent-Based Verification for Rust Systems](https://arxiv.org/abs/2512.18436), Yang and others, 2025 | Coding agents completed 81% of 849 proof tasks taken from real Verus-verified systems (best model, Sonnet 4.5), up from 41% for the weakest model in the same study, and one model cheated in 14% of tasks until it was given a cheat checker. | serious, recent | 2026-10-04 | [@papers/verusage-2025] |
| [Agentic Proving for Program Verification](https://arxiv.org/abs/2605.23772), Sosso and others, 22 May 2026 | Run through a compiler-in-the-loop coding-agent harness, Claude Opus 4.6 reached 98.1% end-to-end on CLEVER's Lean problems (154 of 157 entries, after setting aside 4 whose premises the benchmark broke, counting any success over two runs) where the benchmark paper's own end-to-end result had been 1 of 161, and in doing so it flagged bugs in about half of the benchmark's reference specifications. | recent, contradicts | 2026-10-04 | [@papers/agentic-proving-2026] |
| [AlgoVeri: An Aligned Benchmark for Verified Code Generation on Classical Algorithms](https://arxiv.org/html/2602.09464v1), Zhao and others, 10 February 2026 | On 77 classical algorithms with the same specification written in all three languages, the best of the tested models verified 40.3% in Dafny, 24.7% in Verus and 7.8% in Lean, so the language matters as much as the model. | recent | 2026-10-04 | [@papers/algoveri-2026] |
| [Harnessing Code Agents for Automatic Software Verification (system name Aria)](https://arxiv.org/abs/2607.06341), Kan and others, 7 July 2026 | A general coding agent wrapped in a verification harness re-proved every lemma it was given in the Iris separation-logic library (4,257 lemmas), 217 lemmas in Rust's standard libraries built on it, and 318 in a regular-language library, with no Coq expert intervention, using Claude Opus 4.7; the lemma statements come from public libraries and no held-out set was used. | recent, serious | 2026-10-04 | [@papers/aria-2026] |
| [AxDafny: Agentic Verified Code Generation in Dafny](https://arxiv.org/abs/2606.32007), Breen and others, 30 June 2026 | With a verifier-guided repair loop, models verified 56.4% of 250 competition-style Dafny problems (against 11.6% for one shot of GPT-5.5) and 92.7% of DafnyBench, but most verified solutions then failed the original executable tests, mainly by running out of time. | recent, contradicts | 2026-10-04 | [@papers/axdafny-2026] |
| [DafnyPro: LLM-Assisted Automated Verification for Dafny Programs](https://arxiv.org/abs/2601.05385), Banerjee and others, 8 January 2026 | A wrapper that stops the model from touching the program's logic, prunes needless invariants and adds fixed proof strategies lifted Claude 3.5 Sonnet from about 70% to 86% on DafnyBench, and tuned 7B and 14B open models reached 68% and 70%. | recent | 2026-10-04 | [@papers/dafnypro-2026] |
| [Goedel-Code-Prover: Hierarchical Proof Search for Open State-of-the-Art Code Verification](https://arxiv.org/abs/2603.19329), Li and others, 18 March 2026 | On 427 Lean code-verification tasks with program and specification given, a specialised 8B proving model succeeded on 62.0%, against 23.8% for the best other model in the comparison, and general frontier models scored below about 24% on the same tasks; the baselines ran at pass@128 and the new system used up to 128 decomposition iterations, so the budgets differ. | recent | 2026-10-04 | [@papers/goedel-code-prover-2026] |
| [Certified Program Synthesis with a Multi-Modal Verifier (LeetProof)](https://arxiv.org/abs/2604.16584), Feng and others, 17 April 2026 | A pipeline in Lean that tests each model-written specification with randomised property-based tests before any code is written certified 28 of 50 LeetCode-style problems against 17 for a single-mode Lean baseline at a $5 budget per problem; the same tests found 13 defective reference specifications in Verina and 18 in CLEVER, and an AI prover's equivalence check brought the Verina total to 16. | recent, contradicts | 2026-10-04 | [@papers/leetproof-2026] |
| [lemmafit, "Make agents prove that their code is correct" (midspiral/lemmafit)](https://github.com/midspiral/lemmafit), Midspiral, 2026 | The repository's description is "Make agents prove that their code is correct." | recent, use | 2026-10-05 | [@articles/lemmafit-2026] |
| [SWE-Proof: Can Language Models Resolve Real-World Issues with Machine-Checked Proofs?](https://arxiv.org/abs/2609.21190), Ma and others, 18 September 2026 | On 500 real issues from SWE-bench Verified, an adversarial audit that wrote new tests overturned 26.8 points of the 85.0% of patches that pass the benchmark's tests, a correct formal specification handed to the agent raised resolution to about 95%, but an agent that had to write its own specification did no better than an unaided agent. | recent, serious | 2026-10-04 | [@papers/swe-proof-2026] |
| [Automating Formal Verification with Reinforcement Learning and Recursive Inference (thesis)](https://arxiv.org/abs/2605.30914), Tan, 29 May 2026 | When open models were trained with reinforcement learning to be rewarded by the Dafny verifier, the verified reward rose from 2.2% to 58.1%, but the models were exploiting weak specifications; after weak tasks were filtered out, the honest pass rate rose from 9.7% to 31.1%. | contradicts, recent | 2026-10-04 | [@papers/tan-2026] |
| [VeriContest: A Competitive-Programming Benchmark for Verifiable Code Generation](https://arxiv.org/abs/2605.08553), Xie and others, 8 May 2026 | On 946 competitive-programming problems in Verus, the best of ten May 2026 models wrote correct code from prose 92.18% of the time, but a correct specification 48.31%, a proof 13.95% and a full verified program from prose 5.29%. | recent | 2026-10-04 | [@papers/vericontest-2026] |
| [Vero: Can AI Agents Build Formally Verified Software Repositories?](https://arxiv.org/abs/2608.13522), Ye and others, 13 August 2026 | On 43 repositories (793 to 56,887 lines of source), the strongest coding-agent configuration fully solved 27, and no configuration closed any specification on the hardest repositories; the grader also rejected a share of the strongest agent's attempts as cheating. | recent, serious | 2026-10-04 | [@papers/vero-2026] |
| [Verus-SpecGym: An Agentic Environment for Evaluating Specification Autoformalization](https://arxiv.org/abs/2605.26457), Agarwal and others, 26 May 2026 | Frontier models wrote a Verus specification that survived official and adversarial tests for 51% to 78% of 581 competition problems, and a model acting as judge missed about a quarter of the wrong specifications that the tests caught. | recent, serious | 2026-10-04 | [@papers/verus-specbench-2026] |

**Specifications from a statement, and invariants**

| source | what it says | chosen by | read | capture |
|---|---|---|---|---|
| [Interactive Code Generation via Test-Driven User-Intent Formalization](https://arxiv.org/abs/2208.05950), Lahiri and others, 2022 | The model proposes input-output tests, a person answers yes or no to each, and the answers prune and rank code candidates, lifting Codex's pass@1 by 22-38 points on MBPP and 25-54 points on HumanEval within one to five questions, which in the paper's evaluation were answered by simulated users. | serious | 2026-10-04 | [@papers/ticoder-2024] |
| [Finding Inductive Loop Invariants using Large Language Models](https://arxiv.org/abs/2311.07948), Kamath and others, 2023 | GPT-4 finds the invariant for about half of 555 single-loop C programs on its own and for about seven in ten when its guesses are filtered by a Houdini-style algorithm and repaired, which is still below the symbolic tool Ultimate Automizer. | serious | 2026-10-04 | [@papers/kamath-2023-loopy] |
| [nl2spec: Interactively Translating Unstructured Natural Language to Temporal Logics with Large Language Models](https://arxiv.org/abs/2303.04864), Cosler and others, 2023 | On 36 hard sentences chosen by five temporal-logic experts, Codex translated 44.4% correctly at first, 58.3% with examples drawn from the same data, and 86.1% when a person could correct sub-translations for up to three rounds. | serious | 2026-10-04 | [@papers/nl2spec-2023] |
| [Can Large Language Models Reason about Program Invariants?](https://proceedings.mlr.press/v202/pei23a.html), Pei and others, 2023 | Code models fine-tuned for invariant generation can predict program invariants statically, with the best result from a scratchpad approach that predicts invariants step by step through the program, at a quality the abstract calls comparable to a dynamic analysis tool given five traces. | serious | 2026-10-04 | [@papers/pei-2023-invariants] |
| [Enchanting Program Specification Synthesis by Large Language Models using Static Analysis and Program Verification](https://arxiv.org/abs/2404.00762), Wen and others, 2024 | A model driven by static analysis and Frama-C feedback wrote ACSL annotations (loop invariants, pre- and postconditions) that let Frama-C prove the benchmark's own assertion for 199 of 251 C programs. | serious | 2026-10-04 | [@papers/autospec-2024] |
| [LLM-Based Test-Driven Interactive Code Generation: User Study and Empirical Evaluation](https://arxiv.org/abs/2404.10100), Fakhoury and others, 2024 | In a within-subjects study of 15 programmers, those who confirmed model-proposed tests judged generated code correctly 84% of the time against 40% for those given plain suggestions, with lower workload. | serious | 2026-10-04 | [@papers/fakhoury-2024-ticoder-study] |
| [Do LLMs generate test oracles that capture the actual or the expected program behaviour?](https://arxiv.org/abs/2410.21136), Konstantinou and others, 2024 | A model asked to classify or write test assertions for Java code tends to accept or produce assertions that match what the code actually does, including buggy code, rather than what it should do. | contradicts | 2026-10-04 | [@papers/konstantinou-2024-oracles] |
| [Evaluating LLM-driven User-Intent Formalization for Verification-Aware Languages](https://arxiv.org/abs/2406.09757), Lahiri, 2024 | No algorithm can show that a specification matches the user's intent, so the paper tests specifications symbolically against input-output examples and shows the metric mostly agrees with human labels while exposing mislabelled specifications. | serious | 2026-10-04 | [@papers/lahiri-2024-intent-formalization] |
| [Can Large Language Models Transform Natural Language Intent into Formal Method Postconditions?](https://arxiv.org/abs/2310.01831), Endres and others, 2024 | GPT-4 usually writes postconditions that pass the tests (77% on the first try with the simple prompt), but the prompt that gives stronger postconditions is correct less often, many correct ones are weak type checks, and on 525 real Defects4J bugs the postconditions discriminated 64. | serious | 2026-10-04 | [@papers/nl2postcond-2024] |
| [Evaluating the Ability of GPT-4o to Generate Verifiable Specifications in VeriFast](https://arxiv.org/abs/2411.02318), Fan and others, 2025 | GPT-4o kept the intended functional behaviour in most outputs (106 of 126 specification files) but only 9 of 126 output files verified. | serious | 2026-10-04 | [@papers/fan-2025-verifast] |
| [Can LLMs Reason About Program Semantics? A Comprehensive Evaluation of LLMs on Formal Specification Inference](https://arxiv.org/abs/2503.04779), Le-Cong and others, 2025 | Models write formal specifications well for simple control flow and badly for loops, and are not robust when the program is rewritten without changing its meaning. | serious | 2026-10-04 | [@papers/formalbench-2025] |
| [Beyond Postconditions: Can Large Language Models infer Formal Contracts for Automatic Software Verification?](https://arxiv.org/abs/2510.12702), Richter, Wehrheim, 2025 | Postconditions that pass the tests are mostly unsound once a verifier checks them, because the model leaves out the preconditions; asking for a full contract (NL2Contract) lifts soundness from 13.0% to 81.1% for GPT-5 on HumanEval+. | serious | 2026-10-04 | [@papers/richter-2025-nl2contract] |
| [SpecGen: Automated Generation of Formal Program Specifications via Large Language Models](https://arxiv.org/abs/2401.08807), Ma and others, 2025 | With a conversational prompt plus mutation of its own output, a model produced JML specifications that OpenJML accepts for 279 of 385 Java programs, well ahead of plain few-shot prompting, Houdini and Daikon, but the task is "specify code that already exists" and it needed that scaffolding. | serious | 2026-10-04 | [@papers/specgen-2025] |
| [Syntax Is Easy, Semantics Is Hard: Evaluating LLMs for LTL Translation](https://arxiv.org/abs/2604.07321), Danso and others, 2026 | Models translate English into well-formed LTL much more often than into LTL with the right meaning, and rewriting the task as Python code completion lifts the semantic score a lot. | recent | 2026-10-04 | [@papers/danso-2026-ltl] |
| [Automatic Generation of Formal Specification and Verification Annotations Using LLMs and Test Oracles](https://arxiv.org/abs/2601.12845), Faria and others, 19 January 2026 | Given Dafny code with prose comments and tests, a two-model combination wrote preconditions, postconditions, invariants and helpers that verified for 108 of 110 programs within 8 repair rounds, and 96.4% of the generated specifications were logically equivalent to the expert ones. | recent, serious | 2026-10-04 | [@papers/faria-2026] |
| [Intent Formalization: A Grand Challenge for Reliable Coding in the Age of AI Agents](https://arxiv.org/abs/2603.17150), Lahiri, 17 March 2026 | The author argues that the key unsolved problem for AI-written code is validating that a formal specification says what the user meant, because "there is no oracle for specification correctness other than the user", and surveys early results. | recent | 2026-10-04 | [@papers/lahiri-2026] |
| [Talk is Cheap, Logic is Hard: Benchmarking LLMs on Post-Condition Formalization](https://arxiv.org/abs/2603.17193), Prasetya and others, 2026 | Models can usually write valid pre- and postconditions from a description, better for preconditions than postconditions, but none got every task right, and extra machine-generated tests showed that about one in ten of the best model's accepted solutions was wrong. | recent | 2026-10-04 | [@papers/prasetya-2026-postconditions] |

**Properties and tests written by models**

| source | what it says | chosen by | read | capture |
|---|---|---|---|---|
| [Is Your Code Generated by ChatGPT Really Correct? Rigorous Evaluation of Large Language Models for Code Generation](https://arxiv.org/abs/2305.01210), Liu and others, 2023 | Adding about 80 times as many generated test inputs to HumanEval exposed wrong code from 26 models that the original ten or so tests had accepted, lowered pass@k by up to 19.3-28.9%, and changed the ranking of models. | use | 2026-10-04 | [@papers/liu-2023-evalplus] |
| [Can Large Language Models Write Good Property-Based Tests?](https://arxiv.org/abs/2307.04346), Vikram and others, 2023 | Given only API documentation, the best model needed about 2.4 samples to get a Hypothesis test that runs and passes, but its tests covered only about a fifth of the properties a model had extracted from the documentation. | serious | 2026-10-04 | [@papers/vikram-2024-pbt] |
| [Agentic Property-Based Testing: Finding Bugs Across the Python Ecosystem](https://arxiv.org/abs/2510.09907), Maaz and others, 2025 | A coding agent that reads a Python module, infers properties from code, docstrings and usage, writes Hypothesis tests and triages the failures produced 984 bug reports over 100 packages, and of 50 reports two authors scored, 56% were valid and 32% worth reporting. | recent | 2026-10-04 | [@papers/agentic-pbt-2025] |
| [Use Property-Based Testing to Bridge LLM Code Generation and Validation](https://arxiv.org/abs/2506.18315), He and others, 2025 | A two-agent loop in which a tester model writes properties from the problem statement and feeds back the smallest failing input improved pass@1 over test-driven repair methods on HumanEval, MBPP and LiveCodeBench. | serious | 2026-10-04 | [@papers/he-2025-pgs] |
| [Does your code match your spec?   [with the Kiro documentation page on correctness]](https://kiro.dev/blog/property-based-testing/), Eline (AWS Kiro), 2025 | Kiro's agent turns requirements written in EARS form into "for any ..." properties and then into Hypothesis tests, surfaces a failure to the developer, and the developer decides whether to change the code, the test or the requirement. | use | 2026-10-04 | [@articles/kiro-2025-pbt] |
| [PropertyGPT: LLM-driven Formal Verification of Smart Contracts through Retrieval-Augmented Property Generation](https://arxiv.org/abs/2405.02580), Liu and others, 2025 | A retrieval-augmented GPT-4 wrote Solidity invariants and pre/postconditions that matched human auditors' properties with 80% recall and 64% precision and, checked by a prover, found known and unknown vulnerabilities. | serious | 2026-10-04 | [@papers/propertygpt-2025] |
| [Understanding the Characteristics of LLM-Generated Property-Based Tests in Exploring Edge Cases](https://arxiv.org/abs/2510.25297), Tanaka and others, 2025 | On 16 HumanEval problems whose solutions fail the extended tests, model-written property tests and model-written example tests each exposed the bug in 11 cases, and together in 13. | serious | 2026-10-04 | [@papers/tanaka-2025-pbt-ebt] |
| [Finding bugs across the Python ecosystem with Claude and property-based testing](https://www.anthropic.com/research/property-based-testing), Maaz and others, 2026 | The blog repeats the paper's counts (984 reports, 56% valid, 32% reportable) and adds that when code carries an implicit assumption only the maintainers can decide the right property. | recent | 2026-10-04 | [@articles/anthropic-2026-pbt-blog] |
| [PBT-Bench: Benchmarking AI Agents on Property-Based Testing](https://arxiv.org/abs/2605.15229), Jing and others, 2026 | Agents given only a library's documentation found 31% to 77% of injected semantic bugs with an open-ended prompt and 42% to 83% when told to write Hypothesis property tests, and the gain from the property prompt was largest for weaker models. | recent | 2026-10-04 | [@papers/jing-2026-pbtbench] |
| [Beyond Superficial Tests: Adversarial Refinement for Reliable Property-Based Testing](https://aclanthology.org/2026.findings-acl.683/), Li and others, 2026 | The authors state that models write syntactically correct property-based tests but weak properties that give "a false sense of security", and they add an agent that writes wrong implementations satisfying the property to expose its gaps. | recent | 2026-10-04 | [@papers/li-2026-probe] |
| [Evaluating and Mitigating the Misguidance Effect of Buggy Code in LLM-Generated Unit Tests](https://arxiv.org/abs/2607.22883), Zhao and others, 2026 | When models are shown buggy code, they write about eight times as many tests that assert the bug's behaviour (3.84% of tests against 0.46% with the fixed code) and about a third as many tests that expose it, and replacing the code in the prompt with a model-written specification docstring reduces this. | recent | 2026-10-04 | [@papers/zhao-2026-misguidance] |

**Models of designs written by models (TLA+, Alloy)**

| source | what it says | chosen by | read | capture |
|---|---|---|---|---|
| [On the Effectiveness of Large Language Models in Writing Alloy Formulas](https://arxiv.org/abs/2502.15441), Hong and others, 2025 | Two reasoning models wrote correct Alloy formulas for the classic graph and relation properties from English descriptions, and could list many distinct correct formulas, so on small, well-known specifications they do well. | contradicts | 2026-10-04 | [@papers/hong-2025-alloy] |
| [TLA+-Bench: An Execution-Grounded Benchmark and Dataset for Natural-Language to TLA+ Specification Generation](https://arxiv.org/abs/2607.23425), Bisharat and others, 2026 | Every model wrote parseable TLA+ far more often than correct TLA+ (the best was correct 16% of the time by default), and the same outputs score from 10.0% to 1.7% depending on how strictly "correct" is screened, or 18.7% when the model is also told the configuration's names. | recent | 2026-10-04 | [@papers/bisharat-2026-tla-bench] |
| [Can LLMs Write Correct TLA+ Specifications? Evaluating Natural-Language-to-TLA+ Generation](https://arxiv.org/abs/2606.05792), Bisharat and others, 2026 | Models usually fail to turn a natural-language description into a TLA+ specification that the model checker accepts: the best pooled open-weight result was 26.6% parseable and 8.6% passing TLC, and GPT-5 passed TLC on 7 of 26. | recent | 2026-10-04 | [@papers/bisharat-2026-tla-write] |
| [Can Large Language Models Model Programs Formally?](https://arxiv.org/abs/2604.01851), Chen and others, 2026 | Open-weight models turn Python programs into TLA+ models that run in about half of the cases on the first try and in two thirds in three tries at best, and reproduce about half of the program's states. | recent | 2026-10-04 | [@papers/chen-2026-modelbench] |
| [SysMoBench: Evaluating AI on Formally Modeling Complex Real-World Systems](https://arxiv.org/abs/2509.23130), Cheng and others, 2026 | Models can model a small piece of code, such as a spinlock, in TLA+ well, but on a large system such as an etcd Raft implementation the generated models mostly fail the runtime and conformance checks. | serious | 2026-10-04 | [@papers/cheng-2026-sysmobench] |

### 5. Functional-style tooling for TypeScript

Functional-style tooling for TypeScript, what else a TypeScript project uses to check pure code, and the tools found that verify TypeScript source. Star counts and weekly downloads are not in the table: where the page gives them, in the section on what it costs a TypeScript project and in each capture, they are from the GitHub API and the npm API, for the week to 2026-10-03, as read on the day each entry is dated.

| source | what it says | chosen by | read | capture |
|---|---|---|---|---|
| [Refinement Types for TypeScript (PLDI 2016)](https://arxiv.org/abs/1604.02480), Vekris and others, 2016 | Refined TypeScript is a lightweight refinement type system for TypeScript that enables static verification of higher-order, imperative programs, evaluated on parts of the Octane benchmarks, D3, Transducers and the TypeScript compiler. | serious | 2026-10-05 | [@papers/rsc-2016] |
| [StrykerJS (mutation testing for JavaScript and TypeScript)](https://github.com/stryker-mutator/stryker-js), Stryker contributors, 2016 onward | It inserts small bugs ("mutants") into production code, runs the tests for each, and reports the mutants that no test caught. | use | 2026-10-04 | [@articles/stryker-js] |
| [fast-check (property-based testing for JavaScript and TypeScript)](https://github.com/dubzzz/fast-check), dubzzz and contributors, 2017 onward | A QuickCheck-style framework in TypeScript that generates inputs, runs a predicate on hundreds of them, shrinks a failing input to a small counterexample, and plugs into Jest, Vitest and other runners. | use | 2026-10-04 | [@articles/fastcheck-ts] |
| [fp-ts](https://github.com/gcanti/fp-ts), Canti and contributors, 2017 onward | A library of typed functional-programming data types and type classes for TypeScript (Option, Either, IO, Task, Functor, Monad), using an encoding of higher-kinded types, whose README says the project is merging into Effect, "the successor to fp-ts v2". | use | 2026-10-04 | [@articles/fpts] |
| [Effect (the `effect` package and its monorepo)](https://github.com/Effect-TS/effect), Effect-TS contributors, 2019 onward | A TypeScript library in which failure, required services, concurrency and scheduling are values described by the type `Effect<Success, Error, Requirements>`, which a runtime executes later. | use | 2026-10-04 | [@articles/effect-ts] |
| [eslint-plugin-functional](https://github.com/eslint-functional/eslint-plugin-functional), eslint-functional contributors, 2019 onward | ESLint rules that forbid mutation, loops, throwing, classes and similar, grouped as no-mutations, no-statements, no-exceptions, currying, no-other-paradigms and stylistic. | use | 2026-10-04 | [@articles/eslint-plugin-functional] |
| [neverthrow](https://github.com/supermacro/neverthrow), neverthrow contributors, 2019 onward | `Result` and `ResultAsync` types put failure in the return type so that a caller can see it, in place of thrown exceptions. | use | 2026-10-04 | [@articles/neverthrow] |
| [ts-pattern](https://github.com/gvergnaud/ts-pattern), Gabriel Vergnaud and contributors, 2020 onward | Pattern matching for TypeScript whose `.exhaustive()` makes the compiler fail when a case of a union is not handled. | use | 2026-10-04 | [@articles/ts-pattern] |
| [Zod](https://github.com/colinhacks/zod), Colin McDonnell and contributors, 2020 onward | One schema both validates untrusted data at runtime and gives the static TypeScript type of what passes. | use | 2026-10-04 | [@articles/zod] |
| [the noProcessEnv lint rule](https://biomejs.dev/linter/rules/no-process-env/), Biome project, 2026 | Biome's noProcessEnv rule disallows the use of process.env; it is in the style group, available since v1.9.1, and not recommended by default. | use | 2026-10-05 | [@articles/biome-noprocessenv] |
| [LemmaScript, a verification toolchain for TypeScript (midspiral/LemmaScript)](https://github.com/midspiral/LemmaScript), Midspiral and contributors, 2026 | A tech-preview toolchain verifies the pure, functional core of ordinary TypeScript carrying `//@ ` specification annotations by generating Dafny or Lean 4 code from it, and its own case studies verify parts of real packages in place. | use, recent, contradicts | 2026-10-05 | [@articles/lemmascript-2026] |
| [the node/no-process-env lint rule](https://oxc.rs/docs/guide/usage/linter/rules/node/no-process-env.html), Oxlint project, 2026 | Oxlint's node/no-process-env rule disallows use of process.env and is not enabled by default. | use | 2026-10-05 | [@articles/oxlint-no-process-env] |
| [Effect-TS contributors: Schema module of Effect](https://effect.website/docs/schema/introduction/), Effect-TS contributors: Schema module of Effect | One schema definition decodes, encodes and asserts data, and also generates a fast-check arbitrary, a JSON Schema, an equivalence and a pretty printer. | use | 2026-10-04 | [@articles/effect-schema] |

## The four claims

Each claim is looked at in both directions. Older work, from before language models wrote code, and
language-model work are kept apart, because the second is easy to over-read: a benchmark says what its task
was, how big its programs were and who wrote its specification, and those decide what a number means. The
strength words are the ticket's: shown by a controlled study, shown by one report or one team's experience,
argued but not measured, or not found. A search that finds nothing is "not found in N searches" and not proof
that nothing exists.

### C1. Pure functions are easier to test and to verify than code that mixes in effects

**Verdict: not settled. A 1984 paper already reports as common the view that side-effect-free programs have fewer bugs, the testing form of it is stated in 2000 with no citation, and none of it has been measured; postmaster's own record bears on it only for a minority of findings.** Strength: argued but not measured; one team's count.

- **Where it is argued.** The QuickCheck paper states it as common belief and cites nothing: "It is generally
  accepted that pure functions are much easier to test than side-effecting ones, because one need not be
  concerned with a state before and after execution." [@papers/quickcheck-2000/passages.md] Hughes's 2020
guide to writing properties says its ideas "are applicable to testing any pure code, but code with
side-effects demands a somewhat different approach", and that "the same ideas can be adapted to this setting"
[@papers/howtospecify-2020/passages.md]. Meyer's design by contract says a function called inside an assertion must not change state [@articles/meyer-1992/passages.md]. The founding paper on functional programming,
which dates from 1984, reports it as the usual summary that having no side effects "eliminates a major source of bugs",
calls such a catalogue of advantages "not very convincing", and argues for modularity
instead [@papers/hughes-1989/passages.md].
- **What was measured.** The one large measurement is about whole languages, not about a pure core inside one. A study of GitHub projects claimed an association between eleven languages and defects, and a reproduction reanalysed it: "only four languages are found to have a statistically significant association with defects, and even for those the effect size is exceedingly small" [@papers/berger-2019/passages.md]. The reanalysis covers only the first research question, on languages ("Our second objective is to carry
  out a reanalysis of RQ1 of the FSE paper"); the second, on classes of language such as functional, was repeated and
  not reanalysed, and in the repetition a functional class still had a negative coefficient. The original authors
  dispute the reproduction.
- **Where it is built in.** The one current TypeScript verification toolchain found verifies only "the pure, functional core",
  and excludes `this` and method dispatch, classes with inheritance, closures over mutable state and `any`; `await` is
  not yet supported [@articles/lemmascript-2026/passages.md]. Cardano's team applies "heavier techniques with a greater
  emphasis on verification to the more tractable inner components" and a greater emphasis on testing to the impure outer ones
  [@papers/cardano-2024/passages.md]. Both are choices by the people who build the tools, and they show that tooling for
  effectful code is harder to build, not that it is harder to use. Neither measures it.
- **Against.** Severe failures sit at the edges. Among 198 sampled failures of five distributed data systems,
  92% of the 48 catastrophic ones came from incorrect handling of non-fatal errors the software had signalled,
  and most of those faults were easy to find with simple tests of the error-handling code [@papers/yuan-2014/passages.md]; that is the part a functional core leaves to the edge. Hughes's later
  account of QuickCheck in industry is of stateful, concurrent and C code, so effects did not stop property-based testing
  [@papers/hughes-2016/passages.md].
- **In postmaster's record.** A pure core would have made the check possible for 24 of 84 serious findings,
  and it was not the missing piece for the other 60 (see the record below).
- **What it does not cover.** Nothing found compares the cost of testing the same logic written pure and
  written entangled. No study found concerns TypeScript.

### C2. Machine-checked proofs make AI-written code trustworthy

**Verdict: shown only narrowly, and shown the opposite as worded.** When the statement to prove is fixed and
given, a proof checker rejects every wrong proof and, on the benchmarks read, the best coding agents now get most such proofs accepted. That is not the
same as trustworthy code, because the trust moves to the statement, the definitions and the scripts that stop a
model cheating. Strength: controlled studies on narrow benchmarks, mostly run by the authors who made them;
single-team reports for the 2026 agent results; one team's account for each older cost figure.

*Language-model work, 2024 to 2026.*

- **What it shows.** On the original 782-task Dafny benchmark the best single model went from 68% in June 2024 to 89%, and the union of
  models to 96%, in about 14 months [@papers/vericoding-2025/passages.md], and an agent loop reached 92.7% in June 2026 [@papers/axdafny-2026/passages.md].
  Over 849 proof tasks from real Verus systems the best model completed 81% and the weakest 41%
  [@papers/verusage-2025/passages.md]. On the Lean benchmark CLEVER, where the authors' methods "all struggle to
  achieve full verification" [@papers/clever-2025/passages.md], a second team's agent reached 98.1% end to end on
  the 157 entries with self-consistent premises, counting an entry if any attempt over two runs worked
  [@papers/agentic-proving-2026/passages.md]. A benchmark of
  real issues reports that "a quarter of test-passing patches admit counterexamples", found by an adversarial auditor
  writing new tests, not by a proof checker, with one model [@papers/swe-proof-2026/passages.md].
- **Verified is not the same as correct for the need.** With a plain prompt GPT-4 verified 104 of 178 Dafny
  problems, but 56 of those methods had any postcondition and 34 a strong one [@papers/misu-2024/passages.md]. In
  the largest benchmark, in a manual inspection of 5 randomly chosen successes for each language and data source, about 9% of
  the specifications were too weak and another 15% badly translated [@papers/vericoding-2025/passages.md]. Of 75 verified
  solutions to easy competition problems, 32 passed the original executable tests, 39 ran out of time and 4 out of memory,
  and part of the time-outs is Dafny's slower Python runtime [@papers/axdafny-2026/passages.md].
- **Models cheat the verifier, so a number needs its guard.** One model cheated in 14% of Verus tasks until it was
  given a cheat checker, and under 1.5% after [@papers/verusage-2025/passages.md]. Reinforcement learning against
  a Dafny verifier raised the verified reward from 2.2% to 58.1%, and the thesis reports that the models were
  exploiting weak specifications [@papers/tan-2026/passages.md]. The largest benchmark screens for such bypasses with a
  validation script [@papers/vericoding-2025/passages.md].
- **Without the statement the numbers fall.** In Dafny one model went from 86% with code and specification given to
  29% from prose alone [@papers/shefer-2025/passages.md]. On the best of ten May 2026 models, with one attempt and a plain prompt, a benchmark that
  separates the tasks reads 92.18% for code, 48.31% for specification, 13.95% for proof with the specification and code
  given, and 5.29% end to end [@papers/vericontest-2026/passages.md]. An agent that must write its own specification "gains nothing over an
  unaided baseline", and "only 56% of those specifications pass our audit" [@papers/swe-proof-2026/passages.md].
- **Real code is harder.** The strongest agent fully solved 27 of 43 repository-scale instances and closed no
  specification on the hardest [@papers/vero-2026/passages.md].

*Older work, kept apart.*

- **The checker is not the weak part.** CompCert's verified middle end gave random testing no wrong-code bug in about
  six CPU-years, while the unverified front end and a gap in the target semantics did
  [@papers/yang-2011/passages.md]. Three verified distributed systems, searched for more than eight months by a group that included a co-author of one of
  them (Verdi), had 16 bugs, none in the verified protocol logic: 11 in the unverified shim, 2 in the specification (the
  developers disputed one) and 3 in the tools [@papers/fonseca-2017/passages.md]. seL4's proof found 144 defects in the C
  code after 16 had turned up in student projects and a port, none of them deep in the sense that an algorithm was flawed,
  and its authors write that "the proof does not guarantee that the specification describes the behaviour the user
  expects" [@papers/sel4-2009/passages.md].
- **The cost is of another order.** seL4: 8,700 lines of C, about 200,000 lines of Isabelle proof script, about 20
  person-years of proof effort, 11 of them seL4-specific, against 2.2 person-years to design, code and test the kernel [@papers/sel4-2009/passages.md] [@papers/sel4-2014/passages.md]. Cedar, built by AWS, has
  5,714 lines of Lean proof for a 1,673-line Lean model of a 15,693-line Rust system, and the paper gives no
  person-time [@papers/cedar-2024/passages.md]. In Cedar the proofs found 4 bugs, all in the policy validator, and differential random testing
  and property-based testing 21 more in various parts of the system [@papers/cedar-2024/passages.md], so in this report,
  which counts both, the cheap checks found more bugs than the proofs, over a wider part of the system; the paper also
  lists 10 bugs that testing missed and gives no person-time to set against the counts.
- **What it does not cover.** The one current TypeScript verification tool found, LemmaScript, reports its own case studies, with counts of
  lemmas and verification conditions and no person-time, and no independent evaluation of it was found
  [@articles/lemmascript-2026/passages.md]; none of the language-model studies of verified code read uses TypeScript
  (not found in one search). No controlled comparison of proof-checked, reviewed and property-tested AI-written code
  was found. Whether a model-written proof helps a person trust code was not measured, and the human time to review
  specifications is not found.

### C3. Writing the specification is the hard part, and models are weak at it

**Verdict: shown for people; mixed for models.** For people the hard part is writing and trusting the
specification, in most older accounts found and in the newest benchmarks. For models the weakness is real where
the model must supply the intent, and not where a person has already given it in a checkable form. Strength: one
report or team's experience for each older source; controlled benchmark studies, mostly by their authors, for
models.

- **People.** QuickCheck's unifier case study found no error in the code and errors in the specification, which was
  "a lot of work, perhaps more than writing the implementation" [@papers/quickcheck-2000/passages.md]. Hughes's
  later account concludes that the need for a specification is the weakness of property-based testing
  [@papers/hughes-2016/passages.md], and 16 of 30 experienced users said writing specifications slowed them
  [@papers/goldstein-icse2024/passages.md]. Amazon's engineers learned TLA+ in two to three weeks and wrote
  specifications of 102 to 939 lines [@papers/aws-2014/passages.md]. A published human-verified set had 6 of 50
  programs with wrong or too-weak specifications [@papers/clover-2023/passages.md]; 80 of CLEVER's 161
  expert-written reference specifications were flagged as having bugs in agent runs
  [@papers/agentic-proving-2026/passages.md].
- **Models, where they are weak.** Codex translated 44.4% of 36 hard temporal-logic sentences correctly with a
  minimal prompt, and 31 of 36 (86.1%) after the interactive correction of sub-translations the paper proposes
  [@papers/nl2spec-2023/passages.md]. On 26 test specifications in TLA+, the best pooled open-weight result passed the model checker in 8.6% of runs, under
  the one prompting strategy that passed any, and GPT-5 passed 7 of 26 [@papers/bisharat-2026-tla-write/passages.md]; on
  1,300 specifications the best model was correct 16% of the time by default
  [@papers/bisharat-2026-tla-bench/passages.md]. None of 24 models got all 40 pre- and postcondition tasks right
  [@papers/prasetya-2026-postconditions/passages.md]. Verina's best model scored 72.6% on code, 52.3% on
  specification and 4.9% on proof [@papers/verina-2025/passages.md].
- **Models, where they are not.** With a simple prompt and no reference solution, 77% of GPT-4's postconditions
  for short Python functions were correct on the test set [@papers/nl2postcond-2024/passages.md], and, given the code, prose comments and tests, 96.4% of generated pre- and
  postconditions equalled the experts' on 110 small Dafny programs [@papers/faria-2026/passages.md].
- **The pattern.** High numbers appear when a person has already given the intent in a checkable form (an
  assertion, tests, a docstring with examples); low ones when the model must supply it (a hard sentence, a
  system's design). The same model scores 77.8% on one specification benchmark, which is agentic, and 19.03% on another, which is one-shot
  with a different judge, so the two numbers cannot be compared [@papers/vericontest-2026/passages.md]
  [@papers/verus-specbench-2026/passages.md]. Most studies read judge a specification by tests, a model-checker run or a
  verifier, a few by people, so they measure agreement with something, and a 2026 position paper argues that the user is the only oracle for intent [@papers/lahiri-2026/passages.md].
- **What it does not cover.** CLEVER's specification task was repeated with a newer model and an agent: 159 of 161 specifications judged arguably
  valid by the authors, against 3 of 161 before, though about half of the benchmark's reference specifications had bugs, so
  neither number is a clean yardstick [@papers/agentic-proving-2026/passages.md]. No repeat of nl2spec's or Clover's tests
  with newer models was found. No study found measures how long a person takes to review a
  model-written specification.

### C4. Property-based tests find defects that example tests miss

**Verdict: shown that they find defects; not shown, on real code, that they find ones example tests miss.** Experience
reports and one corpus study say property-based tests find bugs, and one interview study has a third of its
users saying they found bugs other methods missed. No controlled comparison of property-based and example-based
tests on real code was found; the one small head-to-head, on 16 problems with one model, found the two complementary,
each catching 2 defects the other missed.
Strength: one report or one team's experience.

*Older work.*

- **For.** Hughes's Volvo report found more than 200 problems in code from six suppliers, well over 100 of them
  ambiguities in the standard itself, and five bugs in an Erlang database found with generated parallel tests, two of them in about ten minutes each, after its maintainer had spent six weeks at a customer hunting one [@papers/hughes-2016/passages.md]. Of 30 experienced users, 10 said
  their property-based tests found bugs they had not found by other methods [@papers/goldstein-icse2024/passages.md].
  A corpus study of 426 Python programs reports that each property-based test found about 50 times as many
  injected mutations as the average unit test, from its abstract [@papers/ravi-coblenz-2025/passages.md]. seL4's
  authors, whose proof found simple typos in a well-tested executable specification, suggest that ordinary testing may
  miss "a larger number of simple, obvious faults than one may expect"; that is a result for proof, not for property tests
  [@papers/sel4-2009/passages.md].
- **Against, and the cost.** The authors of the Volvo work sell the tool, their one comparison with example-based suites is a sentence on size (the
  property-based code was an order of magnitude smaller, in TTCN3) with no defect counts for the example tests, and 16 of 30
  interviewed users said writing specifications slowed them
  [@papers/hughes-2016/passages.md] [@papers/goldstein-icse2024/passages.md]. A controlled comparison of generator
  strategies found hand-written generators beat derived ones on injected bugs, which is the effort the
  interviewees complained of [@papers/etna-jfp2026/passages.md]. The mutation figure is per test, not per project,
  and a mutation is an injected change, not a real defect [@papers/ravi-coblenz-2025/passages.md].

*Language-model work.*

- **For.** An agent that wrote Hypothesis tests for 100 Python packages produced 984 bug reports; of 50 sampled from the top 80% by the agent's own score and scored by
  two authors, 56% were valid and 32% worth reporting, and 5 were reported, 4 with patches, 3 merged, including to
  NumPy [@papers/agentic-pbt-2025/passages.md]. Property feedback repaired 75.9% of the failed LiveCodeBench instances that perfect hidden-test feedback could fix,
  against 46.6% for public-test feedback [@papers/he-2025-pgs/passages.md].
- **Against.** That study has no baseline arm, so it shows property tests found bugs, not bugs example tests missed
  [@papers/agentic-pbt-2025/passages.md]. Head to head on 16 HumanEval problems with one model, model-written property tests and
  model-written example tests each exposed the bug in 11 and together in 13, 9 by both and 2 only by each
  [@papers/tanaka-2025-pbt-ebt/passages.md].
  The best model wrote correct property tests for 21% of the properties that could be extracted from API
  documentation [@papers/vikram-2024-pbt/passages.md];
  about 44% of the 50 scored reports were not valid bugs and the two scorers' first-pass agreement was kappa 0.31
  [@papers/agentic-pbt-2025/passages.md]; tests written from buggy code assert the bug in 3.84% of tests, against
  0.46% from fixed code [@papers/zhao-2026-misguidance/passages.md].
- **What it does not cover.** Nothing found measures a model writing fast-check or any TypeScript property test (not
  found in one search), and nothing found compares human-written properties with human-written examples. The
  language-model studies are Python, Solidity and Java, on short functions.

## What it costs a TypeScript project like this one

The constraints are in [`AGENTS.md`](https://github.com/brindlewick/postmaster/blob/b6283aa/AGENTS.md) at `b6283aa`:
scripts run on Bun 1.4.2 or newer, runtime imports are Bun's built-ins and Node's standard modules only, the
development dependencies are `typescript`, `@biomejs/biome` and `oxlint`, and `bun run check` is the type check,
Oxlint, the Biome format check, the tests, the runbook reference check and the wiki lint. Against that:

- **Properties over generated inputs fit, by hand or with a library.** The repository already has one seeded
  random differential test of about 50 lines, with no library and no shrinking (see the record below). fast-check is the
  library: a QuickCheck-style framework in TypeScript with shrinking and model-based tests, MIT-licensed, 5,177 GitHub
  stars and 59.7 million npm downloads in the week to 2026-10-03, its latest release 4.10.2 of 2026-09-19
  [@articles/fastcheck-ts/passages.md]. It would be a development dependency, which changes the list above, and
  whether it runs under `bun test` was not checked. It proves nothing: a pass means no counterexample turned up in
  the cases tried, and finding the property is still the author's job.
- **A purity check is a rule away.** Biome's `noProcessEnv` rule (style group, since v1.9.1, off by default) and Oxlint's
  `node/no-process-env` (off by default) each disallow `process.env`
  [@articles/biome-noprocessenv/passages.md] [@articles/oxlint-no-process-env/passages.md]. The gate runs Oxlint, with one
  custom rule switched on, and runs Biome only as a formatter, so Biome's rule would need `biome lint` or `biome check`
  added to `bun run check`. Whether either rule can be switched on for one folder, and whether either restricts imports of
  `node:fs` or `node:child_process` or reads of the clock, was not checked; trial 4 settles it.
- **Contracts are assertions at a function's edge.** The evidence is descriptive: in most of 21 projects that use
  contracts, more than a third of routines and classes carry them, and the study looks at no defects
  [@papers/estler-2014/passages.md]. Nothing read shows that contracts reduce defects.
- **Mutation testing checks the example tests.** StrykerJS inserts small bugs and reports the ones no test caught
  [@articles/stryker-js/passages.md]. It measures how sensitive a suite is, not whether the code is right, and
  whether it runs under Bun was not checked.
- **A model of a design is outside the language.** TLA+, Alloy and Quint check a model of a design, not the code
  [@articles/tlaplus-tla/passages.md] [@articles/alloy-tools/passages.md] [@articles/quint/passages.md]. Amazon's
  engineers report learning TLA+ in two to three weeks [@papers/aws-2014/passages.md]. MongoDB tried two ways of
  tying a TLA+ model to production code and found one impractical and one highly successful
  [@papers/mongodb-xmodelling-2020/passages.md].
- **A tool that verifies TypeScript exists, as a tech preview.** LemmaScript generates Dafny, its primary backend, or
  Lean 4 from ordinary TypeScript carrying `//@ ` annotations; its design note says "The TypeScript source *is* the
  production code" and that fidelity of the generated code is "validated by inspection of the code generator"
  [@articles/lemmascript-2026/passages.md]. It was created on 2026-03-30, has 112 GitHub stars, and its README lists
  more than twenty case studies, among them node-casbin ("5 functions verified, 217 existing tests pass") and the security
  middleware of hono ("Four CVEs covered"). It verifies a subset that excludes classes with inheritance, closures over
  mutable state and `any`, and does not yet support `await`, so code that does I/O is outside it. It gives no person-time,
  and no independent evaluation of it was found. A 2016 research system, Refined TypeScript, adds refinement types to
  TypeScript, and only its abstract was read [@papers/rsc-2016/passages.md]. A second tool from the same team,
  lemmafit, describes itself as making "agents prove that their code is correct", and only that description was read
  [@articles/lemmafit-2026/passages.md].
- **The other proof tools check a copy.** Lean, Rocq, Isabelle, Agda, F*, Dafny, Liquid Haskell and Verus check programs
  written in their own languages or in Rust, so a proof there covers a copy of the function, and what ties the copy to
  the shipped code is a check of another kind. Dafny lists JavaScript among its compile targets
  [@articles/dafny-lang/passages.md]. Cedar's team ties the Lean model to the Rust code by differential random testing
  [@papers/cedar-2024/passages.md], and Cardano's team checks Haskell against a reference generated from an Agda
  specification by running both on the same generated inputs [@papers/cardano-2024/passages.md]; both bridges are
  the checks of the first bullet.
- **Effect, fp-ts, Zod, neverthrow and ts-pattern shape code and prove nothing about its logic.** Effect makes failure, required
  services and scheduling values of the type `Effect<Success, Error, Requirements>`, with 16,963 stars, and fp-ts,
  whose README says it is merging into Effect, has had no release since December 2024
  [@articles/effect-ts/passages.md] [@articles/fpts/passages.md]. neverthrow puts failure in the return type,
  ts-pattern makes the compiler reject an unhandled case of a union, and Zod validates untrusted data at runtime
  [@articles/neverthrow/passages.md] [@articles/ts-pattern/passages.md] [@articles/zod/passages.md]. Each is a
  runtime dependency, against the rule that runtime imports are built-ins. A plain function that returns a union
  of a value and an error, and that receives the calls it makes as arguments, gives the same shape with no dependency;
  that is argued here, not measured, and no study found measures what adopting any of them costs a small tool. A lint
  rule might back either style: the gate already loads one custom Oxlint rule, whether its linters can scope a rule to a
  folder or restrict imports was not checked, and trial 4 prices an environment, clock and import check, not a ban on
  `any` and casts. TypeScript tracks Effect's types, so `any` and casts can bypass them, as they can the parameter types
  of plain functions [@articles/effect-ts/passages.md] (the reading helper's note; the docs pages read do not say), and a
  rule would have to ban those in either style. What the capture credits Effect with is a type that carries a function's
  needs and expected errors. Whether that adds anything over the plain style is what the third step of trial 5
  compares.

## Postmaster's own record

The question here is the one the sources cannot answer: of the serious findings postmaster's own
reviews made, how many would a stated property, a small model or a pure core have caught first?

**What was counted.** The serious findings of four runs: [#202, After the workhorses and after each
review round, check for a lane's reach outside its own worktree](https://github.com/brindlewick/postmaster/issues/202)
(nine review rounds), [#216, The private-data check is TypeScript run by Bun, and flags little of the
project's own code](https://github.com/brindlewick/postmaster/issues/216) (four rounds),
[#252, Cleaning up after a run is one script, with a dry run and clear errors](https://github.com/brindlewick/postmaster/issues/252)
and [#268, A run cannot add a comment that switches off a check without the user's word](https://github.com/brindlewick/postmaster/issues/268)
(three rounds each when the count was taken, and a fourth since logged for each). A serious finding is a
`finding` line of class gating and severity P1 or P2 that the coachman verified and did not dismiss. There
are 84: 34, 17, 14 and 19. Runs #252 and #268 were still in review when they were read, on 2026-10-04 at 23:04
UTC, and their round-4 findings are not counted. Run #202's rounds 8 and 9 logged no `finding` lines, so
their three serious findings come from its escalation lines and its checkpoint card. The count of `finding`
lines has its own controls: run #202 reads 31 serious lines, and run #265, which has 11 finding lines that
are all style, reads 0 through the same command
[@trials/2026-10-04-review-findings-classified/method.md].

| run | round 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | serious |
|---|---|---|---|---|---|---|---|---|---|---|
| #202 | 12 | 4 | 3 | 2 | 4 | 1 | 5 | 1 | 2 | 34 |
| #216 | 5 | 1 | 4 | 7 | | | | | | 17 |
| #252 | 5 | 5 | 4 | | | | | | | 14 |
| #268 | 4 | 11 | 4 | | | | | | | 19 |

Among the findings counted, no round was free of serious ones. Two fourth rounds were logged after the
count was taken. Run #252's, at 23:13 UTC, found nine findings and none of them serious
[@trials/2026-10-04-review-findings-classified/data/finding-lines-252-round4.jsonl]. Run #268's, at 00:30 UTC
on 2026-10-05, found seven, four of them serious (two P1 and two P2); the first reader, alone, labelled all
four `prop`, three cheap and one heavy
[@trials/2026-10-04-review-findings-classified/held-out.tsv]. In #202 each round from the fourth on ran under
a fresh ruling after an escalation, and the loop ended by hand after round 9
[@trials/2026-10-04-review-findings-classified/data/cards/202-checkpoint-review.md].

**How each finding was read.** Two questions, against a rubric whose two questions and six anchors were
committed before any other finding was classified
[@trials/2026-10-04-review-findings-classified/rubric.md]. Would a stated property or a small
model have caught it, meaning a one-sentence statement that does not mention the defect, inputs that
a tool could generate, and an oracle that is not the code under test? And would a pure core have made
the case checkable, meaning the decision that went wrong sat in code that also read or acted on the
world, the same decision as a function of data would be reached by a test that supplies the data, and
that test would fail on the defect? The answers give four labels: `prop`, `core`, `both` and `neither`.
A `prop` label also says `cheap` when the check runs in process on data, and `heavy` when its oracle
or inputs need git, a shell or a real tool. That cost field was added after the first reading showed that
the property question alone said nothing about cost, and before the second reader began.

**Controls.** Six findings were chosen and labelled before the rest were read, two obviously `prop`,
two obviously `both` and two obviously `neither`, and committed first
[@trials/2026-10-04-review-findings-classified/anchors.tsv]. The first reading gave the expected label
on all six. A second reader, a language model that had not seen the first reading, then read 20 findings
drawn at random with a fixed seed and the six anchors, unmarked, against the same rubric. It gave the
expected label on five of the six anchors. It gave the same four-way label as the first reading on 21
of the 26 (kappa 0.61), and on 16 of the 20 drawn at random (kappa 0.50). On the property question the two
agreed on 25 of 26 findings, on 19 of the 20 drawn at random (95% interval 76% to 99%). On the pure-core
question they agreed on 22 of 26. The agreement statistic was itself run on a labelling against itself,
which reads 100%, and against a shuffled copy, which reads 40 of 84 and kappa -0.08
[@trials/2026-10-04-review-findings-classified/results/numbers.md]. The second reader reported opening code
at a later snapshot than the item's own for three items; no answer is known to have changed
[@trials/2026-10-04-review-findings-classified/method.md].

**The result.** Of 84 serious findings, the first reading puts 79 (94%) as ones a stated property or a
small model would have caught: 37 by a property checked in process, with no git, shell or real tool, 18 by
a property whose oracle is git, a shell or a real tool, and 24 for which a pure core would also have made
the check possible, heavy to check before the separation and cheap after it. None needed a pure core
without a property. Five could not be caught by either.

| run | serious | prop, cheap | prop, heavy | both | neither |
|---|---|---|---|---|---|
| #202 | 34 | 16 | 5 | 10 | 3 |
| #216 | 17 | 9 | 3 | 5 | 0 |
| #252 | 14 | 1 | 4 | 9 | 0 |
| #268 | 19 | 11 | 6 | 0 | 2 |
| all | 84 | 37 | 18 | 24 | 5 |

Read the label for what it is. It says a check could have caught the finding, not that anyone would
have written it. Both readers know every defect, so hindsight is in the count, and a strict reading of
"an oracle that is not the code under test" could deflate it as easily. The count is an estimate of what a
property or a pure core could have done for these runs, and the proposed trials measure how far below it a
blind attempt lands.

**What kind of defect it was.** Grouping the findings by the shape of the missing check shows where the
pure core mattered and where it did not
[@trials/2026-10-04-review-findings-classified/results/kinds.md].

| kind of check | findings | prop, cheap | prop, heavy | both | neither |
|---|---|---|---|---|---|
| A. A reader of text must obey a law (it splits, quotes, renders, parses or validates text) | 31 | 31 | 0 | 0 | 0 |
| B. A reader must agree with a real tool, a format or git | 21 | 5 | 15 | 1 | 0 |
| C. A procedure over states and steps has a case missing (restore, attribution, process ids, exit status, reruns) | 12 | 0 | 2 | 10 | 0 |
| D. Two paths that must agree do not (dry run and real run, promote and check, range and files) | 7 | 1 | 1 | 5 | 0 |
| E. The environment or an effect leaks into a decision (ambient variables, a failed read read as a value, a forgotten log) | 8 | 0 | 0 | 8 | 0 |
| F. Runbook prose, or a decision inferred from free text: nothing to run | 5 | 0 | 0 | 0 | 5 |

- **A and B, 52 findings: for most, structure was not the missing piece.** These sat in functions that already
  took text and returned values: a shell-command classifier, a scanner for suppression comments, renderers of the
  ship card, integrity checks on bundles. Five sat elsewhere: 202/bug-33, where the classifier probed the file
  system to decide whether a bare word was a path, and four in code that ran git, tar or the file system
  (252/bug-1 and bug-24, 216/bug-3 and sec-3), where the defect was in how the code ran them. A law over
  generated text, such as "the writes found in two commands joined by a newline are the union of the writes found
  in each" (#202, the first round), or "scanning the same text twice gives the same findings" (#216, a shared
  `/g/` regular expression that keeps state), would have found the first kind. The classifier (18 findings, in
  three families) and the scanner (16 findings, all in one library file) alone hold 34 of the 84. Both predict
  what another program will do from its text, which is the shape
  [#291, A ticket's acceptance criteria ask only for what a run can finish](https://github.com/brindlewick/postmaster/issues/291)
  names as one that cannot be finished. In #202 the rounds went on until a ruling removed the classifier and had
  the check observe what changed instead; rounds 8 and 9 then found three serious findings, about the card, the
  restore guard and ties between reviewers, none about what a command writes
  [@trials/2026-10-04-review-findings-classified/data/cards/202-checkpoint-review.md].
- **C, D and E, 27 findings: for 23, a pure core made the check possible.** These sat in procedures whose
  decisions were interleaved with reads of, or acts on, git, the file system, the environment, the process table
  or the log. In every one of the 23 a one-line law existed too: a restore changes only what the round
  changed (five findings in #202, in rounds 1, 1, 3, 7 and 9), a process group is signalled only when the launch
  record matches (#252), a git call's result does not depend on the ambient `GIT_*` variables (#202 round 2, #252
  round 3), an ambient `SCRUB_CHECK_DISABLE` must not reach the scan (#216, rounds 1 and 3), a read error is not
  an empty answer (#202, #252). The other four needed no separation: one is a pair of functions of text that must agree
  (268/bug-10), and three are properties that need real repositories (216/bug-7, 252/bug-14 and bug-15).
- **Four classes came back in later rounds or in other runs.** The ambient environment (4 findings in 3
  runs), restore (5 findings in rounds 1, 3, 7 and 9 of one run), the dry run against the real run (3 findings
  in 2 rounds, which the run's own escalation names as a design signal, since the dry run re-implements every
  real-run decision inline [@trials/2026-10-04-review-findings-classified/data/cards/252-ESCALATION.md]), and
  the identity of a suppression (#268, 4 findings in 3 rounds, which its escalation proposes to end with a
  conservative window, an approximation that errs toward asking
  [@trials/2026-10-04-review-findings-classified/data/cards/268-ESCALATION.md]).
- **F, 5 findings: nothing to run.** Three are runbook prose (a step omitted, a paragraph that misdescribes a
  state), one infers from the free text of a tool's output whether a call was refused (202/bug-1), and one is a
  tension in the classifier between failing closed and precision that no law states (202/bug-39).

**The tests that existed.** Every one of the four tools shipped example tests, and three of the four tickets
asked for them: #202's criterion 15 asks for "one test that must find it and one that must find nothing" for each
kind of thing the check looks for, #216's criterion 23 for tests that show each rule finding what it should and
passing what it should not, and #252's direction for tests with a positive and a negative control for each count.
The test files the four branches added hold 52 (#202), 52 (#216), 30 (#252) and 54 (#268) cases, and none runs a
generator over many cases in one test. A search for `Math.random`, `seeded`, `fast-check`, `forAll` and `fuzz`
finds only three `Math.random` calls in #202's tests, which make unique names; #252's tests build one random
1 KB file for a round trip and #216's build nested inputs at fixed depths
[@trials/2026-10-04-review-findings-classified/method.md]. The repository does have one seeded random
differential test, from
[#109, Rewrite the scripts in TypeScript, run by Bun](https://github.com/brindlewick/postmaster/issues/109):
"the decoder matches iconv -c on 300 seeded cases" in `scripts/log-action.test.ts`, about 50 lines with its
oracle, a small pseudo-random generator, a list of boundary bytes and a real tool as the oracle, and no library.
That is the pattern the A and B findings called for.

**One style finding sat on the root of a class.** In #216 round 1 the style lens reported, at the lowest
severity, "env reads + IO in core module against functional-core paradigm" at `scripts/scrub-core.ts:438`
[@trials/2026-10-04-review-findings-classified/data/finding-lines-216.jsonl]. That line reads
`SCRUB_CHECK_DISABLE` from the environment, and the finding does not name the variable. Two serious findings,
one in round 1 and one in round 3, are entries through which that variable reached the scans, which the run's
own card calls "the same DISABLE class in different entries, found one round apart", and the style finding
went to the ship card as a note
[@trials/2026-10-04-review-findings-classified/data/cards/216-checkpoint-review.md].

**How sure.** Firm: what the findings were, which code each sat in, and that two readers working apart agree on
whether a stated property could have caught a finding. Soft: the split between cheap and heavy (the readers
agreed on 8 of 15), the `clear` and `arguable` marks (14 of 26), and the by-construction field (16 of 26),
so the page gives the cheap and heavy counts as one reader's and rests nothing on the by-construction field. Of
the 84 findings the first reading marked 47 `clear` and 37 `arguable`. An independent fact-checker read eight
findings drawn at random and found six labels reasonable, one with an over-confident mark (202/bug-14) and one
whose cost label the code does not bear (216/sec-4, and its twin 216/bug-4, which has the same reason)
[@trials/2026-10-04-review-findings-classified/method.md]. Not measured: whether an author working from the
ticket and not from the review would have written the property and its generator. The data is four runs, two
of them in review when counted, and 34 of the 84 sit in two families.

## Trials postmaster could run

Five trials, only the second part of the fourth run here; the fifth is in three steps, and a later step runs only if the one before did not fail. Each gives its cost in hours, what it would show and what would show it
failed. The costs are estimates, not measurements. The first measures what the count above cannot: how much of
it is hindsight.

**1. Properties written blind for a text classifier.** Take #202's shell-command classifier at its round-1
snapshot, before any review finding was fixed. A model that has not seen the findings gets the ticket and
the function signatures and writes at most ten laws with generators (separators and quoting leave the answer
unchanged, a substitution does not hide a write, an unresolved target is never read as clean), using the
seeded-generator pattern the repository already has or fast-check. They run against the snapshot. The control for the newline law is the fixed code with newline splitting
taken out again, which the law must fail (positive), and the code after the round-1 fix, which it must pass
(negative).
*Cost:* about 6 hours of the postmaster's time and a million tokens: two to write the laws, two for the
generators and a throwaway-directory oracle for the heavy ones, two to read the results against the
findings. *It would show* the share of the classifier family's round-1 findings (8 of the 18) that
blind-written laws find, which is the figure for how much of the cheap label is hindsight, on the five cheap
findings among them.
*It failed if* the laws find fewer than a third of those eight, if they fail on code the review later found
clean, or if the generators take more than a day.

**2. A small model of #202's restore.** Write about 100 lines in TLA+ or Alloy: refs that a round may move,
a synthesis worktree that may be attached, detached, a link or missing, files that may be dirty, and the
steps reset, update-ref, delete and save. State the law "a restore changes only what the round changed and
nothing outside the worktree", and check it exhaustively for three refs and two lanes, without reading the
five restore findings first.
*Cost:* 8 to 12 hours for a first model by someone new to the tool. Amazon's engineers report learning TLA+ in
two to three weeks, and the authors say the specifications added significant value in all ten systems
[@papers/aws-2014/passages.md]. *It would show* whether the model finds
the five restore findings of #202 (202/sec-1, sec-4, bug-22, bug-51, bug-57) in seconds, and how large a model
that took. *It failed if* it finds none, finds them only after the findings are written into it, or takes more than
two days.

**3. A proof spike with LemmaScript on one pure function, with a model writing the annotations.** Take the
10-line `ticketHasComment` of #252, the function that matched a longer comment by substring, which is a pure function
of two strings. First check whether it lies inside the subset LemmaScript verifies (strings, loops, comparisons; the
design note lists no regular expressions). The function calls `pyWords`, which splits on regular expressions built from
a Unicode class, so that check starts there. Then state the exact-match law as annotations, have a model write them and
the Dafny proof, run the tool's check, and have a person judge the specification the model wrote. Time each step.
*Cost:* 6 to 12 hours and one to two million tokens, most of it installing the toolchain, which needs Dafny, and
writing the specification; if the function falls outside the subset the trial ends in an hour with that result.
*It would show* whether a pure function of this project's own fits the verifiable subset, what one proof costs for
the simplest finding, whether the specification a model writes for itself would have rejected the substring version,
and how much of the generated Dafny a person must read to trust the translation, which the design note says is
checked by inspection. *It failed if* the function is outside the subset and a rewrite into it changes what it does,
if the work takes more than two days, if the specification the model wrote admits the buggy version, or if the proof
cannot be trusted without reading the generated Dafny line by line.

**4. A purity and mutation check in the gate.** Write a script, or switch on a rule, that flags `process.env`,
`Date.now` and imports of `node:fs`, `node:child_process` and `node:os` inside modules named `*-core.ts` or under
`scripts/lib/`. Biome's `noProcessEnv` and Oxlint's `node/no-process-env` each disallow `process.env` and are off by
default [@articles/biome-noprocessenv/passages.md] [@articles/oxlint-no-process-env/passages.md]. Oxlint runs in the
gate, and Biome runs there only as a formatter, so its rule would need `biome lint` or `biome check` added to
`bun run check`. Whether either can be scoped to one folder, or restricts imports and the clock, was not checked. Run the
check on `main` and at the review snapshots of the four runs; no module on `main` is named `*-core.ts` today, so on
`main` it covers `scripts/lib/`.
The same script also counts two kinds of mutation, so that a rule on mutation would rest on numbers. *Escaping
mutation* is a change to something the function did not create: assigning to an argument or to a property of one,
calling `push`, `set`, `delete` or `splice` on one, or changing a module-level variable or an imported object. *Every
mutation* adds reassigning a local variable and changing a local collection. In the first count, locals built inside the
function and modules at the edge (the code that calls git, the file system and the clock) are exempt. In the second,
nothing is exempt, and the number is a contrast, not a pass mark. Controls: a function that pushes onto its argument
must be flagged in both counts (positive), and one that builds a local array and returns it must not be flagged in the
first (negative). For the second count, a function that reassigns a local `let` must be flagged, and one that uses only
`const`, `map` and `filter` must not. Run both counts on `main` and at the review snapshots, and read a random sample of
30 flagged places, marking each a hazard (a reader could be surprised by it), harmless or unclear, with a second reader on
10 of them.
*Cost:* 4 to 6 hours, 2 to 3 for the first part and 2 to 3 for the mutation counts. *It would show* whether the first
part flags the environment reads in #216's `scrub-core.ts` (three at the round-1 snapshot, one of them the variable behind
two of the eight E-kind findings), how many of the eight it reaches, and how many places on `main` it flags that no one
would call a defect. Several of the eight, such as a git call that inherits `GIT_DIR`, sit at the edge, where a check on
core modules does not look, and the trial counts them. It would show how many of the 84 serious findings sit in the same
function as a place the first mutation count flags at that round's snapshot (81 of the 84 cite a file and a line), which
is the test of whether a rule on mutation connects to what the reviewers found, and how many flagged places on `main` are
hazards.
*It failed if* the first part flags none of the eight, or flags more than about twenty places on `main` that are not
defects. The mutation counts failed if the first count flags more than about twenty places on `main` that are not
hazards, or flags none of the 84 findings' functions.

*Result of the mutation counts.* Run on 2026-10-09, on `main` at `67d4ae2` and at the 19 review snapshots, by one reader,
with a second on 10 of the 30 places read [@trials/2026-10-09-mutation-counts]. The first count took every kind of change to
something the function did not create, as the user chose: an argument, a module-level variable, an imported binding, a
process-wide object such as `process.env`, the object a method was called on, and a variable of an enclosing function changed
from a nested one. Nothing was exempt as being at the edge.

- **The counts.** On `main` (79 scripts, 52,522 lines) the first count flags 360 places and the second 3,511. The 360 are 81
  on arguments, 44 on module-level variables, none on imports, 37 on process-wide objects (29 of them `process.env`, 5 `process.exitCode`, 3 `globalThis`), 32 on
  the object a method was called on and 166 on a variable of an enclosing function. At the 19 snapshots the first count reads
  323 to 422 and the second 3,112 to 3,949. Of the 360, 115 lie in a function that reads the environment or the clock,
  touches files, starts processes or uses the operating system, and 355 in a module that does, so the exemption for edge code would leave 245 places
  by function and 5 by module [@trials/2026-10-09-mutation-counts/results/counts-by-commit.tsv]
  [@trials/2026-10-09-mutation-counts/results/edge-tags-main.txt].
- **Hazards.** Of 30 places drawn at random, the first reader marked 4 hazards and 26 harmless, none unclear. That puts about
  312 of the 360 places (95% interval 253 to 341) outside the hazards, against the line of about twenty. The second reader
  gave the same mark on all 10 it read and read both of two made-up places right
  [@trials/2026-10-09-mutation-counts/results/marks-tally.txt]. The hazards are a delay kept in a module-level variable
  and set at 16 places in one test, a regex's `lastIndex` reset inside a predicate named `isDigitChar`, a flag kept on
  `globalThis`, and a `replace` callback that also collects into an outer array. Three of the four are changes to module-level
  state or a process-wide object (3 of the 7 drawn on those, against 1 of the other 23); none of the 9 drawn on arguments or the
  3 on a method's receiver was one. That split was made after the fact on small numbers.
- **The findings.** Of the 78 findings that cite a TypeScript line, 8 sit in a function that holds a place of the first count
  (1 of 30 in #202, 3 of 17 in #216, 0 of 14 in #252, 4 of 17 in #268) and 21 in such a function or around one; 3 cite a runbook
  line and 3 no line. If each finding fell on a random line of its own file, 5.9 would sit in a flagged function and 27.1 in or
  around one, so the count reaches the findings' functions about as often as chance would. In 1 of the 8 the flagged place bears on
  the defect (216/bug-14, whose cause is the `lastIndex` of global regexes kept in module state), in 1 partly, in 1 it sits beside
  the defect, and in 5 it has nothing to do with it. The second count reaches 57 of the 78, where 49.2 are expected
  [@trials/2026-10-09-mutation-counts/results/findings-summary.txt]
  [@trials/2026-10-09-mutation-counts/results/findings-reading.md].
- **How sure.** The counts are firm: 105 controls, including the page's four, read as expected, and a spot check of 32 places
  found none wrong. The share of hazards rests on 30 places, one reader's rubric and a second reader of the same kind with
  10 places, so its interval is wide; the first failure test holds across it, and on the reading that exempts edge functions
  (about 206 of the 245 left are not hazards). The reading of the 8 findings is one reader's. Not run: a rule on mutation in the
  gate, whether it would have found a defect a reviewer found, and whether code without these changes is easier to follow.

*Failure test 1, the first count flags more than about twenty places on `main` that are not hazards: met, about 312. Failure
test 2, it flags none of the 84 findings' functions: not met, it flags the function of 8 of the 78 that cite a line.*

**5. One program with its git swapped, for the cleanup script's dry run.** Take #252's cleanup at its round-1
snapshot (`a793251` in the trial's data): 1,624 lines that run ten different git commands (`status`, `diff`,
`diff-tree`, `ls-files`, `rev-list`, `rev-parse`, `format-patch`, `hash-object`, `log` and `worktree`). Three steps. Step 2
runs only if step 1 did not fail, and step 3 only if step 2 did not fail.

1. *One program, three gits.* First put a seam at the git call, change nothing else, and run the law below against the
   snapshot as it is. Count how many of the two dry-run findings that turn on git (252/bug-16 and bug-23) it reaches.
   Then, on a scratch copy, write the cleanup's decisions once, in code that receives the git calls it makes as an
   argument. The real run passes real git. The dry run passes a git that records each write and does not do it. The test
   passes a mock. Run the law again. A model that has not seen the findings writes, from the ticket and git's manual, the
   list of folder states to generate (the ticket names a locked folder and a running preview server; clean and dirty are
   the obvious others). The law is given: the writes the dry run records equal the writes the real run makes when nothing
   changes in between. The seam leaves out what is not git: the process table and the launch registry behind 252/bug-18
   (a live preview), the `tar` call and the calls to other scripts. A read that follows one of the dry run's own writes can
   also differ, because the dry run does not do the write; in the snapshot, the dry run's pin check skips the run's own
   folder to stand in for the done mark it did not set. The trial counts these places.
2. *Keep the mock honest.* Run the same generated operations through the mock and through real git on a scratch
   repository, and compare what each returns. Where they differ, find out why. If real git is doing what git does, change
   the mock. If the cause is how our code calls git, such as an inherited environment variable, fix the code. Either way
   keep the sequence as a fixed case. Cedar's team checks its Lean model of Cedar against its Rust code this way, and
   Cardano's team checks the Haskell generated from its Agda specification against its hand-written Haskell
   [@papers/cedar-2024/passages.md] [@papers/cardano-2024/passages.md]. Both compare a model of their own system with
   that system, not a mock of an outside tool with the tool, and Cedar's testing missed 10 bugs, for reasons such as an
   input too hard to generate. Count the changes the mock needs.
3. *The same in Effect.* Write the same decisions as an Effect program that needs git as a service, with the same three
   gits and the same laws. Compare it with step 1 on size, on hours taken and on what the compiler tracks for you, with
   the same lint rule on both (trial 4 prices an environment, clock and import check).

*Cost:* 10 to 12 hours for step 1, 4 to 6 for step 2 and about 8 for step 3, which includes reading Effect's
documentation: 22 to 26 if all three run. *It would show* whether generated states reach the two dry-run findings that
turn on git before a reviewer does, and whether writing the decisions once makes the law hold by construction. It would
show how many of the states that the findings of #252 name beyond the obvious ones (a dirty submodule, an unbranched
merge, a locked pin) the blind list contains, counting an entry only if it names the same kind of folder or pin. It would
show whether comparing the mock with real git reaches the four findings of #252 that the first reader marked as needing
real repositories or tools (252/bug-1, bug-14, bug-15, bug-24; the second reader judged a pure parser given recorded git
output enough for bug-24), and how many changes the mock needs to get there, which is the price of keeping it honest. And
it would show whether step 3 gives anything that step 1 with a lint rule does not.
*Step 1 failed if* the generator cannot reach the locked state without hand-built cases, if the law has to be told the
findings to define its states, or if the dry run still needs its own copy of a refusal that turns on git. *Step 2 failed
if* it reaches none of the four findings (either the mock only repeats what its author already knew, or the findings do
not lie in what git returns), or if the mock needs more than about 400 lines (a guess: a quarter of the cleanup) to agree
with real git on those commands. *Step 3 failed if* it shows nothing that step 1 with a lint rule does not.

What the trials would settle: the page stays **claimed** until runs made under a changed practice show fewer
serious findings per round than these four. The measure is close to the one
[when a review loop should stop](review-convergence.md) uses: serious findings reaching zero outside escalated
mechanisms within the cap, across at least three runs.

## Changes proposed to the design rules and the ticket template

Nothing here is made. Each follows from a finding above, and the first two wait for the trials named. The text
the proposals would change is that of `origin/main`: `AGENTS.md` and the ticket template read the same at `cd441e6` as at `b6283aa`.

**1. Give design rule 8 a narrow check.** Rule 8 reads "A computation takes its inputs as arguments and returns its
result. Reading files, the clock, the environment and processes happens at the edge of a script, not inside the
computation." Nothing enforces it, and that was chosen: decision D2 of
[#298](https://github.com/brindlewick/postmaster/issues/298), given by the user, says the rule is "a design rule in
the written rules, and no check enforces it", because no tool in the gate can decide whether a function is pure and a
lint rule "would flag good code and miss bad code". The check proposed here does not decide purity. It flags one narrow
thing, reads of the environment and the clock and imports of file, process and operating-system modules, inside
modules named `*-core.ts` or under `scripts/lib/`, and trial 4 counts the good code it would flag. It still asks the
user to reverse the "no check" half of D2. No module on `main` is named `*-core.ts` today, so as scoped it covers
`scripts/lib/`, whose helpers do I/O on purpose, and trial 4 counts what it flags there. A second part would add a rule against mutating anything that escapes a
function (arguments, module state, imported objects), with locals built inside the function and edge modules exempt. A
ban on every mutation is the stricter version, and trial 4 counts both before either is switched on. The argument for it
is that a name that never changes is easier to follow, for a reader and for a model, and that a check gives an agent
something to iterate against. Neither is measured here: no study found compares a reader's or a model's grasp of mutable
and immutable versions of the same code, and the 84 findings were not classified by mutation. The second part is not tied
to a finding; trial 4 tests whether it connects to any. It has tested it: the first count flags 360 places on `main`, an
estimated 312 of them not hazards, and 8 of the 78 findings that cite a TypeScript line sit in a function it flags, about as many as
random placement would give [@trials/2026-10-09-mutation-counts/results/marks-tally.txt]
[@trials/2026-10-09-mutation-counts/results/findings-summary.txt].
*Tied to (the first part):* the 8 findings of kind E, 4 of them the ambient environment in 3 runs, and to #216's round-1 style
finding that named the environment read in a core module at the lowest severity while two serious findings
traced to it.

**2. Add a design rule for tools that run dry or undo: decide once, with git, files and processes passed in.**
Proposed text: "A tool that can run dry or undo makes each decision once, in code that the dry run, the tests and the
real run all use, and receives the calls it makes outside itself (to git, the file system, the process table and other
programs) as arguments. The three differ only in what they pass in, so they cannot disagree about a decision made from
the same reads. A read that follows a write can still differ, because the dry run does not do the write." *Tied to:*
#252's three dry-run findings (252/bug-16, bug-18, bug-23), whose own escalation names re-implementing every real-run
decision inline as the design signal
[@trials/2026-10-04-review-findings-classified/data/cards/252-ESCALATION.md], and #202's five restore findings
(sec-1, sec-4, bug-22, bug-51, bug-57), where the restore decided between git calls. Of the three dry-run findings,
bug-16 and bug-23 turn on git worktree locks, and bug-18 on the process table and the launch registry, which trial 5 does
not pass in. Trial 5 checks the rule on the cleanup's decisions, with git swapped for a mock that is itself checked
against real git.

**3. In the template's Checks, give each reader a law.** The template asks for one check per criterion, and #202's
criterion 15 asked for one test that must find a thing and one that must find nothing. For a criterion about
something that reads text (it splits, scans, renders, parses or validates), propose that the check also name one
law over generated inputs and its oracle: a law (a round trip, the answer for joined parts is the union of the
answers for each, a check is never clean when it cannot tell), a reference the project already runs (the
compiler, the formatter, git), or the closed list of inputs the criterion covers. *Tied to:* kinds A and B, 52
of the 84 findings, which sat between the examples the tests held. The cost is about 50 lines for a seeded
generator, which the repository already has once, or a development dependency, which would change the list
that `AGENTS.md` gives as `typescript`, `@biomejs/biome` and `oxlint`. That choice is the user's.

**4. In the template's Checks, give an undo or a cleanup its state table.** For a criterion that restores,
undoes or removes, propose that the checks list the states it must handle and the expected result for each:
for a restore, a ref present, absent or moved, a worktree attached, detached, linked or missing, clean or
dirty. *Tied to:* kind C, 12 findings, among them #202's five restore findings across rounds 1, 3, 7 and 9
and #252's two missed kinds of unsaved state (a dirty submodule and an unbranched merge), each a case missing
from a list that no one had written.

**What does not follow.**

- **The four unfinishable shapes in the template already cover the largest families.** The classifier of #202
  and the scanner of #268 hold 34 of the 84 findings, and both forecast what another program will do from its
  text, which [#291](https://github.com/brindlewick/postmaster/issues/291) names. The records bear that rule out and call for no change to it.
- **A proof tool is not proposed yet.** After the cheap checks, 47 findings remain: 18 that need git or a real tool, 24
  that need a pure core as well, and the 5 of kind F, which have nothing to run. Nothing read shows a proof would help
  with any of them. The one current TypeScript tool found, LemmaScript, is a tech preview whose
  evidence is its own case studies [@articles/lemmascript-2026/passages.md]; the cost figures for proofs elsewhere are of
  another order; and in Cedar, the report found that counts both, differential and property-based testing found more
  bugs than the proofs did [@papers/cedar-2024/passages.md]. Trial 3 prices LemmaScript on the simplest finding, and an
  independent evaluation of it, or a measured result with models on TypeScript, would change this.
- **Effect and fp-ts are not proposed as dependencies.** They shape code and prove nothing about its logic
  [@articles/effect-ts/passages.md] [@articles/fpts/passages.md]. Each is a runtime dependency, against the rule that
  runtime imports are Bun's built-ins and Node's standard modules, and no study found measures what adopting either
  costs a small tool. What the capture credits Effect with is a type that carries a function's needs and expected errors. Whether
  that adds anything over plain functions that receive their git as an argument is what step 3 of trial 5 compares.
  What Effect offers for processes, locks, time-outs and cleanup was not read.

## What was not read

A search that finds nothing is not proof that nothing exists. What follows could not be read, or was read only in
part, and nothing is inferred from its title or an abstract snippet.

**How the sources were read.** The page-to-text tool paraphrases a page with a small model and gives no text for
some PDFs. Where it saved a PDF, its pages were read as images, and a quote is marked `checked` in the capture only
where two separate reads gave the same words. A figure that exists only in a plot cannot be read this way, so none is
used. Every other number was read from a table or from the text beside it.

**Language models writing verified code and proofs.**

- The VeriBench paper (listings and a PDF only); the workshop listings of two papers whose arXiv versions were read.
- Search hits not opened: a paper on the costs of proof synthesis for Rust systems (arXiv 2602.04910); a podcast with
  the Lean author; job postings and news about Google DeepMind's "Verified Code Generation"; three blog posts. A
  published anecdote of a specification with a transposed field that survived 49,280 discharged proof obligations could
  not be traced to a primary source and is not used.
- The benchmark repositories' data files and the vericoding results file (55,397 experiments).
- Baldur, miniCodeProps, SAFE, Anthropic's account of formalising Fermat's Last Theorem and Mistral's Lean model
  were cut to one-line pointers in the notes to stay within the cap.
- Not found: any measured result by Google DeepMind or the Lean FRO on a model writing verified code; any
  independent replication of the headline results of vericoding, Verina or VerifyThisBench under their own
  protocols (only CLEVER was re-run by a second team); the human time to review model-written specifications; any
  target in TypeScript or JavaScript (one search).

**Specifications, properties and tests written by models.**

- Bodies of FormalBench, PROBE and the loop-invariant paper of Pei and others (abstract pages only); Verina, CLEVER
  and VerifyThisBench were read from their abstracts for this group.
- Seen only in search results: Quokka, LiveFMBench, ClassInvGen, VeriStruct, REQ2LTL, VLTL-Bench, NeuroNL2LTL, a
  paper on repairing Alloy models with models, AugmenTest, SpecEval and Lemur. A VerifyThisBench "coherence 43%"
  figure appeared in one search summary and not on the abstract page, and is not used.
- Not found: a measured study of a model writing fast-check or any TypeScript property test; a controlled study
  comparing human-written properties with human-written examples; a study repeating nl2spec's or Clover's tests with
  newer models; a measurement of how often properties derived from requirements by Kiro are wrong.

**Proof assistants, verified languages and the cost of proofs.**

- Founding papers of Dafny, Agda, Liquid Haskell and Isabelle/HOL, the full POPL 2016 F* paper and the OOPSLA 2023
  Verus paper: not opened, for lack of budget, not because they were blocked.
- The original HACL* paper (blocked), so its cost figures are a survey's; the CACM version of Amazon's paper (blocked;
  the 2014 report was read); the 36-page Woodcock survey of 62 projects (only its four-page summary was read);
  Staples and others on proof productivity; the primary Tokeneer later-defect paper (second-hand only); the
  CPP 2016 paper on the Raft proof in Verdi (no effort figure for it); the Springer version of the Coq user survey;
  Amazon's SampCert and s2n papers.
- Not found: a user study of Lean, F*, Dafny or Verus; a controlled comparison of proving against testing on the same
  ordinary code; a cost figure for proofs on a small non-research program; independent measurement of effort for the
  2025 to 2026 industrial Lean and Verus projects; maintenance cost over time.

**Lightweight checking, model checking and TypeScript tooling.**

- The helper that read this group stopped before it could write its own list of what it left unread, and some of its
  early entries were drafted before it could see the pages they cite. Its notes say an entry is verified only if its url
  line says it was checked against the page images, and each capture in this group says whether its entry is. The two
  AUTOSAR papers were read in part and not verified, and are left out of the map.
- Not read: the original authors' rebuttal of the reproduction of the study of languages and defects; the rest of Hughes's
  1989 paper after its first three pages; the appendix of per-project data in the study of contracts; the Hypothesis
  journal paper (its page returned only a title).
- Model checking: the TLA+ manual, the primary Alloy papers and the Quint documentation were not read. Only the
  repositories' descriptions and the MongoDB abstract were, so the group rests on those and on Amazon's account.
- Tools that verify TypeScript: the case-study repositories of LemmaScript and the README of lemmafit were not read, the
  paper behind Refined TypeScript was read from its abstract only, and JaVerT and Gillian-JS, tools for verifying
  JavaScript, were seen in search results only.
- Not checked: whether Oxlint or Biome can restrict imports or the clock for one folder, whether fast-check or StrykerJS
  runs under `bun test` and Bun, and whether postmaster's own scripts lie inside the subset LemmaScript verifies. Not found: any measurement of what adopting Effect or fp-ts costs a small tool. Not read: what Effect offers for
  processes, locks, time-outs and cleanup, how well models write it, and whether it runs under Bun's test runner.

**Postmaster's own record.** Runs #252 and #268 were still in review: their round-4 findings, logged after the count,
are in the trial's data and are not among the 84. The first reading's labels rest on the descriptions on the runs'
review cards, the structure of the modules and the code at the round's snapshot; the trial does not record for which
findings the code was opened. A second reader read 26 of the 84, and an independent fact-checker re-read eight.

**How the page itself was checked.** Two independent readers checked the built page before it was published, one the
literature and one the record and the count. They compared it with the captures and, for about 140 of the literature's
figures and quotes, with the sources themselves, and compared the record's counts with the run branches and the trial's
data. What they found wrong, overstated, unsupported or missing a limit was corrected. Figures that only a reading
helper's notes support and the independent readers did not reach include PropertyGPT's precision and its per-project
recall range, the per-model numbers of Verus-SpecGym, and the rows for SysMoBench, Hong's Alloy study and Danso's
temporal-logic study; each capture says which of its quotes were read twice. Trial 5, proposal 2 and the sentences about
Effect were rewritten on 2026-10-09 and checked by a third reader against the captures, the trial's data and the code at
the snapshot; what it found was corrected. The mutation counts added to trial 4, and the possible second part of
proposal 1, were added later on 2026-10-09 and were read by the research session only.

## Every serious finding, and what would have caught it

The 84 serious findings of the four runs, in the order of [the table of findings](../../raw/trials/2026-10-04-review-findings-classified/data/findings.tsv),
each with the first reader's label. `prop, cheap` and `prop, heavy` are a property that runs in process or
needs git, a shell or a real tool; `both` is a property and a pure core; `neither` is nothing to run. A
finding is `arguable` where a reasonable reader could have answered the other way. The keys are the ids the
runs' own review cards use. The last column is the first reader's suggestion, written before the proposals, and not
the proposal itself.

| finding | round | what it was | label | what would have caught it, or why nothing |
|---|---|---|---|---|
| #202 bug-1 | 1 | refusal attribution hides a successful write beside a denial | neither (arguable) | Whether a call was refused is read from the call's free-text output as a whole; the only oracle is what changed on disk, which the run later observed instead. |
| #202 bug-2 | 1 | a write after a newline reads as a read | prop, cheap | The writes found in two commands joined by a newline are the union of the writes found in each. |
| #202 sec-1 | 1 | restore resets unmoved branches and wipes uncommitted work | both | Restoring a round changes only the refs and files the round changed. Extract: planRestore(snapshot refs, current refs, worktree state) returning the actions to take. |
| #202 bug-3 | 1 | bare cd and cd under an environment variable ignored | prop, cheap | cd D then c reports what c reports with relative paths taken from D; when D cannot be resolved, later relative paths are reported as unresolved, never as inside. |
| #202 bug-4 | 1 | the git block misses escapes (branch and tag names, dropped operands, redirects off git) | prop, heavy (arguable) | For each git subcommand in the closed list, the reported writes equal the refs and files that changed when it ran in a temporary repository. |
| #202 bug-5 | 1 | the shell-group rewrite flips inside reads to notes | prop, cheap (arguable) | A path inside the lane's own folder is reported as expected, however the command is grouped (braces, subshell). |
| #202 bug-6 | 1 | reads outside the home directory and the project not exempt, and tool-checkout and brief reads unreachable | prop, cheap | A read of any path in the ticket's normal-read categories (outside HOME and the repository, the tool checkout, the brief) is not reported. |
| #202 bug-11 | 1 | hostile filenames break the card block | prop, cheap | For any path string the rendered card block keeps its own structure and parses back to the same findings. |
| #202 sec-2 | 1 | git configuration values never skipped | prop, heavy (arguable) | git -c key=value and git config operands are never counted as paths written. |
| #202 sec-3 | 1 | refs named by git reads counted as writes | prop, cheap | A read-only git subcommand never reports a write, whatever refs it names. |
| #202 sec-4 | 1 | reset climbs when the synthesis metadata is missing | both (arguable) | A restore from a snapshot that lacks its metadata changes nothing. Extract: planRestore returns a refusal when the snapshot is incomplete. |
| #202 style-1 | 1 | quoted shell text misread as a redirect (a gating defect reported under the style lens) | prop, cheap | Quoting text never changes the reported writes: for any text t, echo 't' reports no write. |
| #202 bug-14 | 2 | git subprocesses honor inherited directory overrides | both | A git call's result does not depend on the ambient GIT_* variables. Extract: gitEnv(base environment) returning the environment git runs with. |
| #202 bug-15 | 2 | substitutions inside double quotes skipped | prop, cheap | Wrapping a command in a double-quoted substitution does not change its reported writes. |
| #202 bug-16 | 2 | a rider claims file changes its move did not produce | both (arguable) | A change is attributed to a lane only if its record names the path or the ref (#202's D2), and a file rides a move only if the move changed it. Extract: attribute(changes, lane records, moved files). |
| #202 bug-17 | 2 | the card reason is not escaped | prop, cheap | For any reason string the rendered card block keeps its own structure. |
| #202 bug-21 | 3 | descriptor-duplication redirects invent a path write | prop, cheap | Appending 2>&1 to a command does not change its reported writes. |
| #202 bug-22 | 3 | restore faults instead of reattaching a detached synthesis worktree | both | For every state of the synthesis worktree (attached, detached) a restore returns to the snapshot. Extract: planRestore over a worktree state value. |
| #202 bug-23 | 3 | an unreadable task transcript still counts as checked | both | An unreadable record is never reported as checked (#202's D13). Extract: laneStatus(read result), where the result can be an error. |
| #202 bug-26 | 4 | a write redirect onto a substitution target reads as a read | prop, cheap (arguable) | A write whose target cannot be resolved is reported as an unresolved write, never as a read. |
| #202 bug-27 | 4 | a write or delete under a glob or an unset variable reads clean | prop, cheap (arguable) | A write or delete under a glob or an unset variable is never reported clean. |
| #202 bug-30 | 5 | file tools drop a path holding a variable or a glob | prop, cheap (arguable) | A file tool's path holding a variable or a glob is reported as unresolved, never dropped. |
| #202 bug-33 | 5 | a bare write operand is dropped | both | An operand a command writes is reported whatever its spelling. Extract: classify(command, role table) deciding paths by operand role, not by probing the filesystem. |
| #202 bug-35 | 5 | the card prints a not-checked reason as the lane wrote it | prop, cheap | For any not-checked reason the card prints it in a form that cannot break the block. |
| #202 bug-36 | 5 | the round reach step restores after a faulted check | neither (arguable) | A step order in runbook prose (restore after a faulted check); a model of a design that has the rule does not flag prose that forgot it. |
| #202 bug-39 | 6 | ordinary commands with patterns read not checked | neither (arguable) | A tension between failing closed and precision, settled by each tool's argument roles; no law states it, and the ticket's notes did not. |
| #202 bug-46 | 7 | a substitution split hides writes | prop, cheap | A substitution inside a write command does not hide the outer write. |
| #202 bug-47 | 7 | cp roles confused under substitution | prop, heavy (arguable) | For cp, the destination is reported as written whatever substitutions the operands hold. |
| #202 bug-49 | 7 | the sed long in-place form missed | prop, heavy (arguable) | Every spelling of sed's in-place option is reported as a write. |
| #202 bug-50 | 7 | a repository path with a space faults every check | prop, heavy | A check's result does not depend on where the repository is (spaces, quotes, non-ASCII in the path). |
| #202 bug-51 | 7 | restore faults on a deleted run branch | both | A restore returns to the snapshot whether or not a run branch still exists. Extract: planRestore over a ref map in which refs can be absent. |
| #202 bug-53 | 8 | the card prints unresolved non-absolute paths verbatim (found under the security lens, below that lane's own reporting threshold, verified by the coachman) | prop, cheap | No path outside the project appears on the card (#202's D18). |
| #202 bug-57 | 9 | the synthesis guard passes a symlinked worktree and restore then resets the main checkout | both (arguable) | A restore changes nothing outside the synthesis worktree it was given, whatever that path is (directory, symlink, file, missing). Extract: guard(stat of the path, repository root). |
| #202 bug-58 | 9 | only the first tied reviewer is voided | both | When several lanes' records explain one change, every one of them is named. Extract: attribute(changes, lane records) returning all owners. |
| #216 bug-1 | 1 | PATTERN_CODE skips whole line, const-EMAIL-plus-address passes gate | prop, cheap | A private value placed anywhere in a line is flagged, whatever else the line holds. |
| #216 bug-2 | 1 | card scan inherits SCRUB_CHECK_DISABLE via run env merge; same hole in scrub-rewrite.ts parseFindings | both | The scan's result does not depend on the ambient SCRUB_CHECK_DISABLE. Extract: scan(text, explicit config) with the environment read only at the edge. |
| #216 bug-3 | 1 | symlinked dest ancestor escapes repo on mkdir+rename | prop, cheap | A promote writes nothing outside the repository, whatever symlinks the destination path holds. |
| #216 bug-4 | 1 | --check passes edited bundle body on matching header hash | prop, cheap | Any single-byte change to a bundle fails --check. |
| #216 bug-5 | 1 | privateDataBlock freezes heldout scores + D1/D8/D9/D19 into every future card, check requires verbatim match | prop, cheap (arguable) | The block depends only on the run's own inputs: two runs with different inputs give blocks that differ exactly there. |
| #216 bug-7 | 2 | range scan misses UTF-16 content that --files finds | prop, heavy | Scanning a commit range and scanning the same content as files give the same findings, for any text encoding. |
| #216 bug-9 | 3 | block generator dies over 50 census suspects, accepted 236-line census unrepresentable, card step blocked | prop, cheap | For any number of suspects the block renders and parses back. |
| #216 bug-10 | 3 | ambient DISABLE turns promote scrub into straight copy; same hole in tree-check entry, gate chain, runbook scan commands | both | The result does not depend on the ambient DISABLE variable, in promote, tree-check and the gate chain. Extract: one config value built at the edge and passed down. |
| #216 bug-11 | 3 | hasReasoning depth-64 fail-open, 66-deep encrypted_content passes tree gate | prop, cheap | A record nested to any depth is judged, and a depth limit fails closed. |
| #216 bug-12 | 3 | marker strip eats closing JSON syntax, malformed record promoted exit 0 | prop, cheap | Stripping markers from a valid record yields a valid record or a refusal. |
| #216 bug-14 | 4 | MAIL.test on /g/ regex without reset, successive bare key fields miss key intermittently | prop, cheap | Scanning the same text twice gives the same findings. |
| #216 bug-15 | 4 | placeholder keeps encrypted_content field, tree-check flags presence, success promotion fails gate | both (arguable) | Everything promote writes passes tree-check. Extract: scrubRecord(record) and treeCheckRecord(record) as functions of one record. |
| #216 bug-16 | 4 | reasoning findings never call logFinding in tree-check or promote, TELL and card blind to the class | both (arguable) | A failing check logs at least one finding. Extract: check(tree) returning findings, with logging done once at the edge. |
| #216 bug-17 | 4 | pr-description/card scans log draft rows, TELL fires, block dies without resolution, landing stuck | both (arguable) | A draft scan leaves the detections log unchanged. Extract: scanDraft(text) returning findings and logging nothing. |
| #216 sec-2 | 4 | raw path in manual-reword refusal prints finding value, violates rule 10 and C10 | prop, heavy | No message the tool prints contains a value the scanner would flag: scan the tool's own output. |
| #216 sec-3 | 4 | show %B appends newline, every recreated commit gets a new id, pushed untouched commits rewritten, C18 broken | prop, heavy | Recreating a commit whose message needs no change gives the same commit id. |
| #216 sec-4 | 4 | header line 2 and unanchored pattern outside body digest, injected code passes --check and runs | prop, cheap | Any single-byte change to a bundle fails --check, including the header lines. |
| #252 bug-1 | 1 | tar and git byte outputs decoded as UTF-8 corrupt saves of non-UTF8 files, then the folder is removed | prop, heavy | Saving then restoring any file's bytes returns the same bytes. |
| #252 bug-2 | 1 | a reused pid with an overwritten registry record passes the start check, signalling another launch's group | both | A process group is signalled only when the launch record names this run's folder and the recorded start time matches. Extract: decideStop(record, process table, run folder, boot id). |
| #252 bug-3 | 1 | preview left with synthesis already gone still closes the run and exits 0 | both | The exit status is zero only when every step finished. Extract: exitFor(steps). |
| #252 bug-4 | 1 | .worktrees read errors treated as empty, silently omitting unscanned folders | both | A read error is not an empty answer. Extract: candidates(read result, ticket), where the read result can be an error. |
| #252 bug-5 | 1 | substring run-log check skips the closing line and faults a wordless rerun of a closed run | both (arguable) | A closing line counts as written only if an entry equals it, and running the command twice gives what running it once does. |
| #252 bug-14 | 2 | dirty submodule contents invisible to the save and deleted with the worktree | prop, heavy (arguable) | After saving and removing a folder, every path that differed from what git holds is in the save. |
| #252 bug-15 | 2 | format-patch omits unbranched merges, losing their resolutions on removal | prop, heavy (arguable) | After saving and removing a folder, every commit and resolution that was only in the folder is in the save. |
| #252 bug-16 | 2 | dry run promises removal of a locked worktree the real run must leave | both | The dry run's plan equals what the real run does when nothing changes in between. Extract: plan(state) consumed by both the dry run and the real run. |
| #252 bug-17 | 2 | reconcile substring matches a longer comment and skips the post | prop, cheap | A comment counts as present only when an entry equals it, never when a longer entry contains it. |
| #252 bug-18 | 2 | dry run exits 3 on a live preview the real run stops and closes | both | The dry run exits as the real run would when nothing changes. Extract: plan(state) consumed by both. |
| #252 bug-22 | 3 | inherited GIT_DIR/GIT_WORK_TREE override git -C, scanning the wrong checkout before removal | both | A git call's result does not depend on the ambient GIT_* variables. Extract: gitEnv(base environment). |
| #252 bug-23 | 3 | dry run promises a pin release that a lock refuses in the real run | both | The dry run promises a pin release only if the real run will make it. Extract: plan(state) consumed by both. |
| #252 bug-24 | 3 | core.quotePath quoted paths fail hash-object, silently missing flags | prop, heavy | The paths parsed from git's output equal the names on disk, for any file name. |
| #252 bug-25 | 3 | plane.sh takes no repo arg, so every Plane run stops at ticket-state | both (arguable) | Every adapter call the tool builds is accepted by that adapter, for each tracker kind. Extract: adapterCall(kind, repo, ticket) returning the argument list. |
| #268 bug-1 | 1 | biome-ignore covers the next node but the identity hashes one line | prop, heavy (arguable) | When any line a directive really covers is edited, the approval identity changes. |
| #268 bug-2 | 1 | block closes pop whole stack but Oxlint matches by rule set and ignores bare enable | prop, heavy (arguable) | The lines the scanner says a directive covers include every line the real linter suppresses. |
| #268 bug-5 | 1 | switch-off ask never writes .waiting-on-user | neither | Anchor: a step the runbook prose left out; nothing to run, and a model cannot flag prose that forgot a step. |
| #268 bug-6 | 1 | exit-2 paragraph misdescribes held and its remedy cannot clear it | neither | Anchor: runbook prose that misdescribed a state and a remedy. |
| #268 bug-7 | 2 | triple-slash TS suppressions honored but not parsed | prop, cheap (arguable) | Every suppression form the TypeScript compiler honours is found by the scanner. |
| #268 security-4 | 2 | TS block directives read first line but tsc reads last | prop, cheap (arguable) | The lines the scanner says a TS block directive covers include every line tsc suppresses. |
| #268 security-5 | 2 | TS next-line identity misses tsc blank and comment skipping | prop, cheap (arguable) | The scanner's next-line identity changes whenever the line tsc suppresses is edited. |
| #268 bug-8 | 2 | linter block rules read first line only but Oxlint reads across lines | prop, heavy (arguable) | Block rules cover every line the real Oxlint suppresses. |
| #268 security-6 | 2 | Biome block directives read first line only but Biome reads any line | prop, heavy (arguable) | Block directives cover every line the real Biome suppresses. |
| #268 bug-9 | 2 | JSX-text double-slash swallows a trailing directive | prop, cheap (arguable) | A directive at the end of a line is found whatever the line's earlier text holds (strings, regexes, JSX text). |
| #268 security-7 | 2 | apostrophe in JSX text opens a fake string hiding directives | prop, cheap (arguable) | The same law as bug-9, with JSX text holding an apostrophe. |
| #268 security-8 | 2 | slash after a condition paren divide-read hides regex directives | prop, cheap (arguable) | The same law as bug-9, with a slash after a closing parenthesis (division against regex). |
| #268 security-9 | 2 | slash after plus-plus regex-read hides trailing directives | prop, cheap (arguable) | The same law as bug-9, with a slash after ++. |
| #268 security-10 | 2 | strings and regexes end at U+2028 which ES2019 allows inside | prop, cheap (arguable) | The same law as bug-9, with U+2028 inside strings and regexes. |
| #268 bug-10 | 2 | covered lines split Python-wide while the scanner counts tsc-narrow | prop, cheap | The function that splits covered lines and the scanner's own line counting agree on any text. |
| #268 bug-12 | 3 | unclosed quote in JSX text swallows a trailing directive the tool honors | prop, cheap (arguable) | The same law as bug-9, with an unclosed quote in JSX text. |
| #268 bug-13 | 3 | Biome identity stops before an implicit continuation | prop, heavy (arguable) | The Biome identity changes whenever any line Biome's node covers is edited, including an operator continuation. |
| #268 security-12 | 3 | block-comment next-line identity hashes a comment line not the covered code | prop, heavy (arguable) | A next-line identity hashes the code the directive covers, not a comment line before it. |
| #268 bug-14 | 3 | switch-off record accepted with no user words | prop, cheap | A switch-off record without the user's words is refused. |
