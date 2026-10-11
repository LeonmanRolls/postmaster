# Brief R2: second reader for a reading of flagged places in a code base

You are the SECOND READER. Another reader has already read a larger list of places; you have not
seen that work and must not. You apply a written rubric to 12 places, one at a time, and write your
answers to a file. You read code. You do not run it, and you change nothing except the answers file.

## What you may read

The folder is <working folder>/ (call it F below). Use absolute paths under F only.

- F/rubric.md: the rubric. Read all of it first.
- F/items.tsv: the 12 places: item number, module, line, the function that holds the line, the change
  made there, and what it lands on.
- The code, read only: F/tree/ is a plain copy of a project's scripts/ folder, with no repository around
  it. Open the module at the line and read the whole function. Where the answer turns on who calls the
  function or who else uses a name, search F/tree/scripts with grep.

You must NOT read anything else: not another folder of this machine, not any folder named raw, wiki or
.postmaster, not other files of the scratchpad above F, not the web, not any ticket. If a command would
list or read anything outside F, do not run it.

## What to do

For each item, in order, apply the rubric's three questions to the place, then append one line to
F/answers-R2.tsv (a header line first). Columns, tab separated, in this order:

item    mark    question    reason

- item: the item number of items.tsv.
- mark: hazard, harmless or unclear.
- question: 1, 2 or 3, the rubric question that settled it (for unclear, 0).
- reason: one line, no tabs or newlines.

## Rules for yourself

- Judge each place on its own. Do not try to balance the three answers, and do not try to guess what
  another reader said.
- Read the function the place sits in, and its callers where the answer turns on them. About ten minutes
  and a few thousand tokens of code per item is plenty.
- Use unclear only as the rubric defines it, and say what you would have to find out.
- Your final message must be short: how many items you answered, any item you marked unclear and why,
  and where the file is.
