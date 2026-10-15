// Finding, by convention, where a project keeps its written rules: a styleguide, a review bot's
// config, a linter's, an agent-instruction file in the repo or in a folder above it. Discovery
// only proposes: nothing found here enters a run until the notes name it. The conventions are
// data, so a new one is a line in a list. The functions take the file system as arguments and
// return values.
import { dirname, join } from "node:path";

export type RuleSourceKind = "styleguide" | "review-bot" | "linter" | "agent-instructions";

export interface Found {
  readonly kind: RuleSourceKind;
  readonly path: string;
}

/** Files at fixed paths in the repo, by what they usually are. */
export const FIXED: readonly { kind: RuleSourceKind; paths: readonly string[] }[] = [
  {
    kind: "styleguide",
    paths: [
      "STYLEGUIDE.md",
      "STYLE.md",
      "CODING_STANDARDS.md",
      "CODING-STANDARDS.md",
      "docs/STYLEGUIDE.md",
      "docs/style-guide.md",
      "docs/style.md",
      "docs/standards.md",
    ],
  },
  {
    kind: "review-bot",
    paths: [
      "REVIEW.md",
      ".greptile/config.json",
      ".greptile/rules.md",
      ".coderabbit.yaml",
      ".coderabbit.yml",
      ".github/copilot-instructions.md",
    ],
  },
  {
    kind: "linter",
    paths: [
      "biome.json",
      "biome.jsonc",
      ".oxlintrc.json",
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.ts",
      ".eslintrc",
      ".eslintrc.json",
      ".eslintrc.js",
      "ruff.toml",
      ".golangci.yml",
      "rustfmt.toml",
      "clippy.toml",
    ],
  },
  { kind: "agent-instructions", paths: [".cursorrules", ".cursor/rules"] },
];

/** Workflow files whose name says they review a change. */
const REVIEW_WORKFLOW_RE = /review/iu;

/** The rule sources a repo has, in the order of FIXED, then review workflows. `exists` says whether
 * a repo-relative path is there; `workflows` lists the names in .github/workflows. */
export function findRuleSources(
  exists: (relative: string) => boolean,
  workflows: readonly string[],
): Found[] {
  const fixed = FIXED.flatMap((g) =>
    g.paths.filter((p) => exists(p)).map((path): Found => ({ kind: g.kind, path })),
  );
  const flows = workflows
    .filter((w) => REVIEW_WORKFLOW_RE.test(w))
    .map((w): Found => ({ kind: "review-bot", path: `.github/workflows/${w}` }));
  return [...fixed, ...flows];
}

/** The agent-instruction files in the folders above a project, nearest first, stopping before
 * `stop` (the home folder) and after `levels` folders. A file one folder above a family of repos is
 * how a company's own guidance reaches each of them. */
export function instructionFilesAbove(
  project: string,
  stop: string,
  has: (path: string) => boolean,
  levels = 4,
  names: readonly string[] = ["AGENTS.md", "CLAUDE.md"],
): string[] {
  const found: string[] = [];
  let dir = dirname(project);
  for (let i = 0; i < levels && dir !== stop && dir !== dirname(dir); i++) {
    for (const name of names) {
      const file = join(dir, name);
      if (has(file)) found.push(file);
    }
    dir = dirname(dir);
  }
  return found;
}

/** The discovery lines for a project: `rule_sources=` as kind:path words. */
export function ruleSourceLine(found: readonly Found[]): string {
  return `rule_sources=${found.map((f) => `${f.kind}:${f.path}`).join(" ")}`;
}
