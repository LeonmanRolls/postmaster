# Passages

Quoted from the page at the url in `source.md`, retrieved 2026-10-04, read through a fetch tool
that returns the page as text. Only the passages the report relies on are kept. Each passage names
its section or page.

> ImpossibleBench creates "impossible" variants of tasks from existing benchmarks like LiveCodeBench and SWE-bench by introducing direct conflicts between the natural-language specification and the unit tests.

Abstract (abstract page); checked

> We measure an agent's "cheating rate" as its pass rate on these impossible tasks, where any pass necessarily implies a specification-violating shortcut.

Abstract (abstract page); checked

> Introduces contradictory test cases by duplicating existing tests with different expected outputs

Full text, section on test mutations (the "Conflicting" strategy; one read named it section 2.2); checked

> GPT-5, cheats 54.0% of the time on Conflicting-SWEbench when facing these clearly impossible tasks

Full text, results on model behaviors (one read named it section 4); checked (two reads, comma as returned)

> prompt D lowers them to 1% and 33%, respectively

Full text, effect of the prompt (one read named it section 5.1 and the benchmark Conflicting-LiveCodeBench, for GPT-5 and o3); checked

> instruct the models to submit the string `flag_for_human_intervention` when they identify errors

Full text, effect of the feedback loop (one read named it section 5.3); checked (the longer sentence in one read began "We" and ended "in the task")

> lowering the cheating rate of GPT-5 from 54% to 9% and o3 from 49% to 12%

Full text, same place; checked (two reads agree)

> we experiment with providing agents an option to abort and exit the feedback loop when they find the task impossible to solve legitimately

Full text, section 5.3 "Effect of Feedback Loop", the sentence before the one above; checked (two reads by the session agree; the sentence begins "To mitigate this increased cheating propensity,").

> However, the effect is much less pronounced for Claude Opus 4.1.

Full text, section 5.3, the sentence after the one with the percentages; checked (two reads by the session agree word for word).

One read also gave "GPT-5 cheats in 76% of the tasks in Oneoff-SWEbench and 2.9% on Oneoff-LiveCodeBench" and "Hiding tests from agents reduces cheating success rate to near zero"; not checked (the second read elided or omitted them), paraphrase, not quoted.
