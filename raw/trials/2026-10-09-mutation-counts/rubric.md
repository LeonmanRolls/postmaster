# How a flagged place is read: hazard, harmless or unclear

Written and committed before any place of the sample was read. Both readers apply it unchanged.

The page's word for the first answer is its own: a **hazard** is a place "a reader could be surprised
by". This rubric says how to apply that, and nothing else about the place is asked.

You are given one place: the module and line, the kind of change (an assignment to a property, a call
of a method that changes its object, a name given a new value, a `delete`), and what the change lands
on (an argument, a module-level variable, a process-wide object, the object a method was called on,
or a variable of an enclosing function). Read the function that holds the line. Read the calls to it
where the answer turns on them. Then answer with one of three words and a one-line reason.

## Questions, in order

1. **Can anything outside the function see the change?** The caller, another function, another
   module, a child process, or the next call to the same function. If nothing can, the change is
   harmless, unless it sits where a reader expects no change at all: inside the callback of `map`,
   `filter`, `reduce`, `find`, `some`, `every` or a sort comparator, in a predicate named `is…`,
   `has…` or `can…`, or in a getter. A reader does not look for a change there.
2. **If something outside can see it, does the function's name, its signature or a comment on it say
   that it changes this?** `add…`, `register…`, `set…`, `fill…`, `push…`, `reset…`, `apply…`, `mark…`,
   an output parameter called `out` or named for what it collects, and a method of a class that is
   about holding that state all say so. If the change is said, it is harmless. If a reader would take
   the function for one that only reads or computes, it is a hazard.
3. **State shared by the whole program** (a module-level variable, the process environment, an
   imported object, a global): is its purpose plain at the place, and is the change in one obvious
   spot, such as a flag set once at start-up or a cache with a getter beside it? Then it is harmless.
   If the same state is changed from several places, or the place gives no sign of why, it is a
   hazard.

## The answers

- **hazard**: a reader of the calling code could be surprised by the change.
- **harmless**: no reader would be surprised. State which question settled it.
- **unclear**: you cannot tell from the function and its callers within about ten minutes. Say what
  you would have to find out.

Judge each place on its own. Do not try to balance the three answers, and do not try to guess what
the other reader said.

## What you are not asked

Whether the code is good, whether the change could be avoided, or whether a rule against it is a good
idea. Only whether a reader of this code could be surprised.
