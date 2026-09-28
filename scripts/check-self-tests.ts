import { command, writeError, writeOut } from "./lib/core.ts";

// This is the fixed inventory from the BASE gate. Wrappers intentionally contain no test flags.
const selfTests = [
  "cut-scratch",
  "fixture",
  "front-door-acceptance",
  "front-door",
  "github",
  "host",
  "launch",
  "link-skills",
  "local",
  "log-action",
  "plane",
  "review-round",
  "reviewers",
  "run-log",
  "run-meta",
  "run-times",
  "runs-status",
  "setup",
  "skill-refs",
  "stage",
  "style-findings",
  "ticket-check",
  "tool-faults",
  "turnpikes",
  "verify",
  "verify-examples",
  "verify-journey",
  "verify-library",
  "view-stream",
  "wait-for-markers",
  "wiki-lint",
];

for (const name of selfTests) {
  writeOut(`check self-test: scripts/${name}.sh --self-test`);
  const result = command(`scripts/${name}.sh`, ["--self-test"], { inherit: true });
  if (result.code !== 0) {
    writeError(`check: scripts/${name}.sh --self-test exited ${result.code}`);
    process.exit(1);
  }
}
