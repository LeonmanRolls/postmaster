## Code review: `49731104…HEAD`

Two new files: `src/count.js` and `src/page.js`. Both wrap the in-memory `store` API.

### Bug — off-by-one in `page` (high)

`src/page.js:8` returns one record too many:

```js
return all().slice(start, start + size + 1);
```

`Array.slice(start, end)` excludes `end`, so `start + size` already yields exactly `size` items. The extra `+ 1` makes every full page hold `size + 1` records, against the comment on line 3 (“with `size` records to a page”) and against `pageCount`, which assumes pages of `size`.

Concrete case — 10 records, `size = 5` (`pageCount` = 2):

| call | returned | records |
|---|---|---|
| `page(1, 5)` | 6 items | indices 0–5 |
| `page(2, 5)` | 5 items | indices 5–9 |

Consecutive pages **overlap on one record** (index 5 here). Walk every page and record 5 is returned twice; any consumer that treats a page as a disjoint window will mis-handle it. This fires on every call with valid inputs, not only edge cases.

Fix:

```js
return all().slice(start, start + size);
```

That also makes `page` consistent with `pageCount` in `src/count.js`.

### Not issues

- Validation in both modules matches and is fine.
- `pageCount` (`Math.ceil(all().length / size)`) is correct, including 0 records → 0 pages.
- Calling `all()` (which already copies) then slicing again is slightly wasteful but not wrong, and not worth changing at this size.
- Out-of-range `number` returns a short or empty array via `slice` — reasonable, and not contradicted by the comments.

### Note

No tests accompany these two modules. A couple of cases around page size and the page-1/page-2 boundary would have caught this.