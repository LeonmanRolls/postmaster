import { closeSync, writeFileSync } from "node:fs";
writeFileSync("/home/brindlewick/postmaster/.worktrees/109-mimo/.port-scratch/fl/stage", "got lock\n");
closeSync(9);
writeFileSync("/home/brindlewick/postmaster/.worktrees/109-mimo/.port-scratch/fl/stage", "released\n");
