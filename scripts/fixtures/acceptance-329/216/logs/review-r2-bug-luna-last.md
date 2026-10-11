The new privacy workflow does not run its scanner for typical external-project checks, and the range scanner misses findings in committed UTF-16 files. Both leave gaps in the protections this patch adds.

Full review comments:

- [P1] Invoke the private-data scanner for dispatched checks — /home/brindlewick/postmaster/.worktrees/216-rev-bug-luna/scripts/verify.ts:790-792
  For runs against ordinary external projects, this only passes a detections-log path to the project’s declared checks; `runChecks` never invokes the pinned `scrub-check.sh` or `tree-check.sh`. Unless the target’s own gate independently calls these scripts, no findings are recorded and private data can pass through the new TELL and ship-card flow. Run the pinned scanner as a mandatory check on the target worktree.

- [P2] Decode UTF-16 before scanning Git child output — /home/brindlewick/postmaster/.worktrees/216-rev-bug-luna/scripts/scrub-core.ts:1514-1517
  When a changed committed file is UTF-16LE or UTF-16BE, Git’s diff output contains NUL-interleaved bytes, but `childLines` decodes them only as UTF-8. The range scan therefore misses text that the `--files` mode correctly detects from a BOM-marked file, allowing such findings to pass the gate; the raw-blob scan has the same issue. Detect the encoding or scan the blob through the BOM-aware reader before feeding lines to the scanner.