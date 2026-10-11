The focused tests pass, but the scanner can miss supported suppressions and the settings check omits a supported gate definition. Duplicate directives can also share an approval, allowing entries to clear without separate approval.

Full review comments:

- [P1] Include Makefile-backed gate definitions — /home/user/postmaster/.worktrees/268-rev-bug-luna/scripts/lib/switch-offs.ts:674-675
  When target discovery selects `make check`, a run can remove a lint or type-check command from the Makefile recipe, but this settings scan does not inspect that file. `landing switch-offs` then reports clear and Stage F can land the weakened gate without approval; include files that define supported gate commands in the comparison.

- [P1] Keep JSX text out of the comment scanner — /home/user/postmaster/.worktrees/268-rev-bug-luna/scripts/lib/switch-offs.ts:169-174
  In a `.tsx` file, JSX text such as `https://docs.example` is not a comment, but this scanner treats its `//` as one and consumes the rest of the line. A real trailing `// eslint-disable-line ...` after the JSX element is then missed, so the check can report clear and allow the suppression without approval. Track JSX text before recognizing comment openers.

- [P1] Recognize triple-slash TypeScript suppressions — /home/user/postmaster/.worktrees/268-rev-bug-luna/scripts/lib/switch-offs.ts:311-312
  TypeScript accepts `/// @ts-ignore`, but slicing only two slashes leaves `/ @ts-ignore` in the body, which does not match `TS_RE`. A run can therefore add this suppression and still have the check report clear; strip the optional third slash before parsing the directive.

- [P2] Distinguish duplicate suppression occurrences — /home/user/postmaster/.worktrees/268-rev-bug-luna/scripts/lib/switch-offs.ts:574-574
  Two identical directives in the same file over identical code produce the same ID because the hash inputs omit the occurrence. Since approvals are looked up by ID, one approval marks both entries approved and clears the check, even though the user was asked to approve each switch-off. Give duplicate occurrences distinct approval identities.