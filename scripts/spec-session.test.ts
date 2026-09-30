import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { run } from "./lib/proc.ts";

const ROOT = resolve(import.meta.dir, "..");
const SCRATCH = join(ROOT, ".postmaster", "verify");
const SCRIPT = join(import.meta.dir, "spec-session.sh");
const SPEC = "WORKHORSE-SPEC.md";

function withScratch<T>(body: (root: string) => T): T {
  mkdirSync(SCRATCH, { recursive: true });
  const root = mkdtempSync(join(SCRATCH, "spec-session-test-"));
  try {
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function command(cmd: string, args: string[], cwd?: string) {
  const result = run(cmd, args, cwd === undefined ? {} : { cwd });
  if (result.code !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${result.err}`);
  return result.out.trim();
}

function fileAtHead(worktree: string, path: string): string {
  const result = run("git", ["-C", worktree, "show", `HEAD:${path}`]);
  if (result.code !== 0) throw new Error(`git show HEAD:${path} failed: ${result.err}`);
  return result.out;
}

function initRepo(path: string): void {
  mkdirSync(path, { recursive: true });
  command("git", ["init", "-q", "-b", "main"], path);
  command("git", ["config", "user.name", "brindlewick"], path);
  command("git", ["config", "user.email", "332054101+brindlewick@users.noreply.github.com"], path);
}

function fixture(root: string, preferences?: string) {
  const repo = join(root, "project");
  const dispatch = join(repo, ".postmaster", "runs", "RUN-1");
  const synthesis = join(repo, ".worktrees", "RUN-1");
  const review = join(dispatch, "spec-review");
  const configDir = join(root, "machine");
  const config = join(configDir, "config.toml");
  mkdirSync(dispatch, { recursive: true });
  mkdirSync(review, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(dispatch, "run.json"), JSON.stringify({
    config: {
      planning: { review_link: "https://code.example/?folder={path}" },
      team: { postmaster: { harness: "codex", model: "gpt-6-astra", effort: "max" } },
    },
  }) + "\n");
  writeFileSync(join(dispatch, "manifest.json"), JSON.stringify({ lanes: { alpha: {}, beta: {} } }) + "\n");
  writeFileSync(join(dispatch, "brief.md"), [
    "# Waybill: RUN-1",
    "",
    "## Ticket",
    "# Example ticket",
    "",
    "## Problem / feature",
    "Build one thing.",
    "",
    "## Project profile",
    `repo: ${repo}`,
    "",
    "## Dispatch",
    "name: RUN-1, Example ticket",
    `dispatch: ${dispatch}`,
    `synthesis worktree: ${synthesis}`,
    `tool: ${ROOT}`,
    "",
  ].join("\n"));
  writeFileSync(join(review, SPEC), "# Shared spec\n\nBuild one thing.\n");
  writeFileSync(config, "# scratch config\n");
  if (preferences !== undefined) writeFileSync(join(configDir, "preferences.md"), preferences);
  return { repo, dispatch, synthesis, review, config };
}

function cli(config: string, ...args: string[]) {
  return run(SCRIPT, args, { env: { POSTMASTER_CONFIG: config } });
}

function initializeSynthesis(synthesis: string, text = "# Shared spec\n\nBuild one thing.\n"): string {
  initRepo(synthesis);
  writeFileSync(join(synthesis, SPEC), text);
  command("git", ["add", "--", SPEC], synthesis);
  command("git", ["commit", "-q", "-m", "Write shared spec"], synthesis);
  return command("git", ["rev-parse", "HEAD"], synthesis);
}

function prepareApproval(root: string, reviewedText?: string) {
  const dirs = fixture(root);
  const initial = initializeSynthesis(dirs.synthesis);
  if (reviewedText !== undefined) writeFileSync(join(dirs.review, SPEC), reviewedText);
  expect(command("bash", [join(import.meta.dir, "spec-decisions.sh"), dirs.dispatch, "fresh"])).toBe("");
  return { ...dirs, initial };
}

test("brief includes the waybill, editor link, no-draft state, preferences and runbook", () =>
  withScratch((root) => {
    const dirs = fixture(root, "Keep feedback direct.\nPrefer short examples.\n");
    const result = cli(dirs.config, "brief", dirs.dispatch);
    expect(result.code).toBe(0);
    const briefPath = result.out.trim();
    const text = readFileSync(briefPath, "utf8");
    expect(text).toContain("## Ticket\n# Example ticket\n\n## Problem / feature\nBuild one thing.");
    expect(text).toContain(`Editor link: https://code.example/?folder=${join(dirs.dispatch, "spec-review")}`);
    expect(text).toContain(`Copy to edit: ${join(dirs.review, SPEC)}`);
    expect(text).toContain("There are no lane drafts.");
    expect(text).toContain("Keep feedback direct.\nPrefer short examples.\n");
    expect(text).toContain(`Read the runbook at ${join(ROOT, "skills", "postmaster", "spec-session.md")}`);
  }));

test("brief says no preferences are set when the adjacent file is absent", () =>
  withScratch((root) => {
    const dirs = fixture(root);
    const result = cli(dirs.config, "brief", dirs.dispatch);
    expect(result.code).toBe(0);
    expect(readFileSync(result.out.trim(), "utf8")).toContain(
      "## User's standing preferences\nNone are set.",
    );
  }));

test("brief lists any committed lane drafts by commit and path", () =>
  withScratch((root) => {
    const dirs = fixture(root);
    const draftWorktree = join(dirs.repo, ".worktrees", "RUN-1-alpha");
    initRepo(draftWorktree);
    writeFileSync(join(draftWorktree, SPEC), "# Alpha draft\n");
    command("git", ["add", "--", SPEC], draftWorktree);
    command("git", ["commit", "-q", "-m", "Draft lane spec"], draftWorktree);
    const commit = command("git", ["rev-parse", "HEAD"], draftWorktree);
    const result = cli(dirs.config, "brief", dirs.dispatch);
    expect(result.code).toBe(0);
    const briefText = readFileSync(result.out.trim(), "utf8");
    expect(briefText).toContain(
      `- alpha: commit \`${commit}\`; file \`${join(draftWorktree, SPEC)}\``,
    );
    expect(briefText).toContain("Draft text:\n\n  # Alpha draft");
  }));

test("approval of unchanged text records the existing commit without creating another", () =>
  withScratch((root) => {
    const dirs = prepareApproval(root);
    const result = cli(dirs.config, "approve", dirs.dispatch);
    expect(result.code).toBe(0);
    expect(result.out.trim()).toBe(dirs.initial);
    expect(command("git", ["rev-parse", "HEAD"], dirs.synthesis)).toBe(dirs.initial);
    expect(readFileSync(join(dirs.dispatch, "spec-decisions.md"), "utf8")).toContain(
      `## spec\ndecision: approved\ncommit: ${dirs.initial}\nwords: `,
    );
  }));

test("approval of edited text commits exactly the reviewed copy", () =>
  withScratch((root) => {
    const reviewedText = "# Revised shared spec\n\nBuild the agreed thing.\n";
    const dirs = prepareApproval(root, reviewedText);
    const result = cli(dirs.config, "approve", dirs.dispatch);
    expect(result.code).toBe(0);
    expect(result.out.trim()).not.toBe(dirs.initial);
    expect(fileAtHead(dirs.synthesis, SPEC)).toBe(reviewedText);
    expect(command("git", ["show", "--format=", "--name-only", "HEAD"], dirs.synthesis)).toBe(SPEC);
    expect(readFileSync(join(dirs.dispatch, "spec-decisions.md"), "utf8")).toContain(
      `decision: approved\ncommit: ${result.out.trim()}`,
    );
  }));

test("approval refuses a stray synthesis change without recording or committing", () =>
  withScratch((root) => {
    const dirs = prepareApproval(root);
    writeFileSync(join(dirs.synthesis, "stray.txt"), "not part of the spec\n");
    const result = cli(dirs.config, "approve", dirs.dispatch);
    expect(result.code).toBe(1);
    expect(result.err).toContain("synthesis worktree has changes");
    expect(command("git", ["rev-parse", "HEAD"], dirs.synthesis)).toBe(dirs.initial);
    expect(readFileSync(join(dirs.dispatch, "spec-decisions.md"), "utf8")).toBe("");
  }));
