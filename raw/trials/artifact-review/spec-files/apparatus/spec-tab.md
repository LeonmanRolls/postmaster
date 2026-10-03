# Spec files trial

<date chip: 2026-10-02> · <mention chip: the user>

A trial for #214: three ways to open the files a spec links to, to compare on a phone and an iPad.

## Example spec

Made up for this trial, in the shape of the workhorse spec template. It describes #179, "A workhorse shows every acceptance criterion working, and keeps at it until it can", which merged as pull request 213. It is not that run's real spec.

**Summary.** Each acceptance criterion gets a check in the spec. The workhorse builds, runs each check, fixes what fails and repeats until every check shows its criterion working. Its summary cites evidence for each criterion, and a new script, `scripts/summary-evidence.ts`, holds the summary to that shape.

**Decisions.**

1. The criterion count comes from `ticket-check.sh`, never from the summary.
2. Evidence sits under `.postmaster/verify/` in the worktree; a path outside it is refused.
3. A criterion that cannot be shown says `not shown: <reason>`.

## Files this spec links to

Each file opens three ways: on GitHub at the run's base commit, as a tab in this doc, and in a separate viewer page. The two scripts stand in for files that exist only in the run's worktree, so GitHub has nothing at the base commit.

<!-- As published on 2026-10-02. <viewer page> stands for the viewer page's own link, which is
     not recorded here; <tab chip: name> is a mention chip that opens that tab. After version 2
     of the viewer, the first two rows' viewer cells read "use its tab". -->

| File | On GitHub | Tab here | Viewer page |
| --- | --- | --- | --- |
| Runbook, the workhorse spec bullet: `coachman.md` lines 253–259 (on main) | [lines 253–259](https://github.com/brindlewick/postmaster/blob/faf18732c1281208d31ea8ee502f8287d75af3a0/skills/postmaster/coachman.md?plain=1#L253-L259) | <tab chip: coachman.md> | [lines 253–259](<viewer page>#f1-L253-L259) |
| Spec template: `workhorse-spec-template.md` lines 10–55 (on main) | [lines 10–55](https://github.com/brindlewick/postmaster/blob/faf18732c1281208d31ea8ee502f8287d75af3a0/skills/postmaster/workhorse-spec-template.md?plain=1#L10-L55) | <tab chip: workhorse-spec-template.md> | [lines 10–55](<viewer page>#f2-L10-L55) |
| Contract file list: `coachman-contract.toml` lines 1–5 (on main) | [lines 1–5](https://github.com/brindlewick/postmaster/blob/faf18732c1281208d31ea8ee502f8287d75af3a0/docs/coachman-contract.toml#L1-L5) | no tab made | [lines 1–5](<viewer page>#f3-L1-L5) |
| New evidence checker: `summary-evidence.ts` lines 304–324 (worktree only) | [not there](https://github.com/brindlewick/postmaster/blob/faf18732c1281208d31ea8ee502f8287d75af3a0/scripts/summary-evidence.ts#L304-L324) | <tab chip: summary-evidence.ts> | [lines 304–324](<viewer page>#f4-L304-L324) |
| Its tests: `summary-evidence.test.ts` (worktree only) | [not there](https://github.com/brindlewick/postmaster/blob/faf18732c1281208d31ea8ee502f8287d75af3a0/scripts/summary-evidence.test.ts) | no tab made | [whole file](<viewer page>#f5) |

Control for the GitHub column: the same runbook link without `?plain=1` opens the rendered file, where the line range has nowhere to land: [rendered, lines 253–259](https://github.com/brindlewick/postmaster/blob/faf18732c1281208d31ea8ee502f8287d75af3a0/skills/postmaster/coachman.md#L253-L259).
