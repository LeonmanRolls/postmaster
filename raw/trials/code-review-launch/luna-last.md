The new pagination function returns one more record than its documented page size, causing pages to overlap when callers advance by the requested size.

Review comment:

- [P1] Limit each page to the requested size — <tmpdir>/target/.worktrees/T-1-rev-bug-luna/src/page.js:8-8
  When a page has at least `size + 1` records remaining, this returns `size + 1` records despite the function's documented page size. Callers advancing by `size` will get overlapping pages; use an exclusive end of `start + size`.