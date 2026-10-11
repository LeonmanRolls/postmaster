// The edge of the apparatus: list the modules of a tree, run the mutation rule over them with
// Oxlint, and parse what it reports. Everything that touches a file or starts a process is here.
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuleOutput } from "./mutation-tally.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PLUGIN = join(HERE, "mutation-rule.ts");

/**
 * The modules in scope (decision D1 of the ticket): every TypeScript file under scripts/ that is not
 * a test, a type declaration or under scripts/fixtures/. Paths are relative to the tree, sorted.
 */
export const listModules = (tree: string): string[] => {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== "fixtures" && name !== "node_modules") walk(path);
      } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
        found.push(relative(tree, path).split(sep).join("/"));
      }
    }
  };
  const scripts = join(tree, "scripts");
  if (existsSync(scripts) && statSync(scripts).isDirectory()) walk(scripts);
  return found;
};

type Diagnostic = Readonly<{ code: string; message: string; filename: string }>;

/** Run the rule over the listed modules of a tree; the result is keyed by the module's path. */
export const runRule = (
  tree: string,
  files: readonly string[],
  oxlint: string,
  work: string,
): Map<string, RuleOutput> => {
  mkdirSync(work, { recursive: true });
  const config = join(work, "mutation.oxlintrc.json");
  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [PLUGIN],
      categories: { correctness: "off" },
      rules: { "mutation/count": "error" },
    }),
  );
  const result = Bun.spawnSync(
    [oxlint, `--config=${config}`, "--no-ignore", "--format=json", ...files],
    { cwd: resolve(tree), stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } },
  );
  const stdout = new TextDecoder().decode(result.stdout);
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(
      `oxlint exited ${result.exitCode}: ${new TextDecoder().decode(result.stderr) || stdout}`,
    );
  }
  const report = JSON.parse(stdout) as { diagnostics: Diagnostic[] };
  const out = new Map<string, RuleOutput>();
  for (const d of report.diagnostics) {
    if (d.code !== "mutation(count)") continue;
    out.set(d.filename, JSON.parse(d.message) as RuleOutput);
  }
  const missing = files.filter((f) => !out.has(f));
  if (missing.length > 0) throw new Error(`the rule reported nothing for: ${missing.join(", ")}`);
  return out;
};

/** Export a commit's scripts/ folder into a new folder, with no repository around it. */
export const exportScripts = (repo: string, commit: string, into: string): void => {
  mkdirSync(into, { recursive: true });
  const archive = Bun.spawnSync(["git", "-C", repo, "archive", "--format=tar", commit, "scripts"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (archive.exitCode !== 0) {
    throw new Error(`git archive ${commit} failed: ${new TextDecoder().decode(archive.stderr)}`);
  }
  const extract = Bun.spawnSync(["tar", "-x", "-C", into], {
    stdin: archive.stdout,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (extract.exitCode !== 0) {
    throw new Error(`tar failed: ${new TextDecoder().decode(extract.stderr)}`);
  }
};

export const tsv = (rows: readonly (readonly (string | number | boolean)[])[]): string =>
  `${rows.map((r) => r.map((c) => String(c).replace(/[\t\r\n]+/gu, " ")).join("\t")).join("\n")}\n`;
