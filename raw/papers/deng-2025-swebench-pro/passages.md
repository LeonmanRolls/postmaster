# Passages

Quoted from the page at the url in `source.md`, retrieved 2026-10-04, read through a fetch tool
that returns the page as text. Only the passages the report relies on are kept. Each passage names
its section or page.

> All tasks are human-verified and augmented with sufficient context to ensure resolvability.

Abstract (abstract page, two reads agree); checked

> The goal of augmentation is to equip the SWE agent with sufficient context to resolve the issue without failing due to an underspecified task description

Section 4.2; checked (two reads; one ended the sentence with a full stop)

> the requirements specify the expected behavior but does not prescribe how the solution should be implemented

Section 4.2; checked (two reads)

> A common false negative in unit-test verifiers is when a model submits a valid solution with different interfaces than what the unit test is expecting.

Section 3.2 "Task Specification"; checked (two reads, one with a lower-case first letter)

> Here, we explicitly define the class and function names

Section 3.2 "Task Specification"; checked (two reads; the sentence continues "expected by the tests to avoid this failure mode when relevant", seen in one read)

> unit tests expect a narrow set of solutions, verifiers are prone to false negatives, resulting in lower pass rates

Section 6.2 "Ablation: Removing Human Augmentations" (the sentence starts "Since"); checked (three reads)

> Without the requirements and interface, both models tested (GPT-5 and Claude Opus 4.1) show significantly degraded performance.

Section 6.2; checked (two reads that returned the parenthesis; an earlier read gave the sentence without it)

> Table 3: Comparison of model performance with and without human augmentations.

Section 6.2, caption; the rows read "OpenAI GPT-5 (high): 25.9% | 8.40%" and "Claude Opus 4.1: 22.7% | 8.20%", with columns "Problem Statement, Requirements, Interface | Problem Statement Only"; checked (two reads agree)

> we drop tests that fall into either category: a) it is irrelevant to the task description, and b) it is too broad

Section 4.3 (one read called it "Creating Environments", an earlier read "Test Verification"); checked (two reads agree word for word)

> In the case that all tests are too broad or not relevant, we drop the problem

Section 4.3; checked (two reads, one with a full stop)

> we run the gold tests several times and ensure that they pass consistently

Section 4.3 (the sentence goes on to say this removes flaky tests); checked (three reads)

The paper also says that each test is checked by humans for relevance to the task description and for not being too broad (one read), that it requires edits to span multiple files with a substantial change (one read), and that 161 of the 500 SWE-bench Verified problems need only one- or two-line changes (one read); paraphrase, not quoted. An earlier read said trivial edits of 1 to 10 lines are excluded; a later read did not find that sentence, so it is not relied on.
