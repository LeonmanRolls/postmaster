# Passages

Quoted from the page at the url in `source.md`, retrieved 2026-10-04, read through a fetch tool
that returns the page as text. Only the passages the report relies on are kept. Each passage names
its section or page.

> The C Bounded Model Checker (CBMC) demonstrates the violation of assertions in C programs, or proves safety of the assertions under a given bound.

Abstract and introduction; checked (abstract page and HTML page, separate fetches).

> To avoid this source of unsoundness, --unwinding-assertions can be specified such that instead of assumptions assertions are inserted. The assertion checks that the loop exit condition is indeed always fulfilled, i.e., the number of unwinding steps was sufficient.

Section 5.3 in one read and 3.1 in the other, so the section is not checked; the words are checked (two fetches, word for word).

> no assertion can be violated with the given unwinding bounds

Section 5.4 in both reads; the fragment is checked (the sentence begins "Conversely, if the formula is unsatisfiable," in one read and "If the formula is unsatisfiable," in the other).
