# WORKHORSE-BLOCKED

**Check:** C17 requires a fixture run dispatched from this branch and scored by `fixture.sh`.

**What it shows:** `fixture.sh new` created a clean fixture repository with ready ticket #1. Dispatching it through the documented flow calls `run-meta.sh`, which creates a detached tool pin with `git worktree add`. The workhorse instructions prohibit writing any worktree outside this worktree, so I stopped before dispatching the fixture.

**Ruling needed:** May I create one disposable tool pin under this session's scratchpad by setting `POSTMASTER_TOOL_PINS` there, solely to dispatch and score C17?

**Branch state:** clean at `929bfb5` (`Harden ready-ticket dispatch checks`). The fixture repository exists in the session scratchpad; no run was dispatched and no worktree was created.

**Verification context:** The last full `bun run check` exited 1 with 2,677 passing and three failing tests. I fixed the two failures caused by this change and their targeted reruns pass. The remaining `probe-confine` test expects `/bin/sh` to be root-owned; this rootless container reports UID 65534. The final `verify.sh run .` was not run because C17 is waiting on the ruling above.
