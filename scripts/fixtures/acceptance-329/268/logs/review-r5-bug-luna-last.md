The detector misses changes that weaken supported Makefile-based gates, and valid Flow source changes fail parsing. The legacy landing instructions also mishandle reasonless suppressions, while the detector is omitted from the fixture contract list.

Full review comments:

- [P1] Include discovered gate inputs in the settings comparison — /home/brindlewick/postmaster/.worktrees/268-rev-bug-luna/scripts/lib/switch-offs.ts:666-668
  When a target uses the supported `make check` fallback ([`discover-project.ts`](https://github.com/brindlewick/postmaster/blob/53ab3a46b210d97bcb6b196e43832560ef2c1bf1/scripts/discover-project.ts#L69-L71)), a change to its `Makefile` can remove lint or tests, but `settingsKind` ignores that file and reports the branch as clear. Include the discovered gate's definition and inputs in the comparison so Stage F cannot land a weakened gate.

- [P2] Enable Flow parsing for changed JavaScript files — /home/brindlewick/postmaster/.worktrees/268-rev-bug-luna/scripts/lib/switch-offs.ts:113-114
  When a target changes a `.js` or `.jsx` file containing Flow annotations, this selects `JS_PLUGINS` without Babel's `flow` plugin, so `parseSource` throws and the switch-off check exits with an input error even when the change contains no directives. Enable Flow parsing for these extensions so valid Flow projects can land changes.

- [P2] Route reasonless legacy switch-offs back before asking — /home/brindlewick/postmaster/.worktrees/268-rev-bug-luna/skills/postmaster/postmaster.md:704-705
  In the legacy Stage F path, `otherwise` also handles exit 3 (`no reason`), so the postmaster asks the user to approve a reasonless suppression instead of sending it back to the coachman to add a reason or remove it. This conflicts with [C8](https://github.com/brindlewick/postmaster/blob/53ab3a46b210d97bcb6b196e43832560ef2c1bf1/WORKHORSE-SPEC.md#L69); handle exit 3 separately, as the current Stage F path does.

- [P2] Register the detector in the coachman contract list — /home/brindlewick/postmaster/.worktrees/268-rev-bug-luna/scripts/lib/switch-offs.ts:484-486
  The new detector lives in [scripts/lib/switch-offs.ts](https://github.com/brindlewick/postmaster/blob/53ab3a46b210d97bcb6b196e43832560ef2c1bf1/scripts/lib/switch-offs.ts#L484-L486), but the [contract file list](https://github.com/brindlewick/postmaster/blob/53ab3a46b210d97bcb6b196e43832560ef2c1bf1/docs/coachman-contract.toml#L51-L53) has no entry for it. The [repository rule](https://github.com/brindlewick/postmaster/blob/53ab3a46b210d97bcb6b196e43832560ef2c1bf1/AGENTS.md#L35-L39) uses that list to determine when a fixture score is required, so a follow-up change limited to this detector would bypass that check; add it to the list.