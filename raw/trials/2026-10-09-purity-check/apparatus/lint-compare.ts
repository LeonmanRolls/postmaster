// Switches on the linters' own rules for scripts/lib/ and any *-core.ts module alone, through their
// per-file overrides, and sets what they report beside the places the purity check flags.
//
//   bun --no-env-file --config=/dev/null lint-compare.ts --root <tree> [--out <file>] [--unscoped]
//
// <tree> is a scratch folder holding a `scripts/` folder: the configurations in lint/ are written
// into it, so run it on a copy. Three configurations run: Oxlint's rules, Biome's rules, and
// Biome's rules with one GritQL plugin. The output is one line per place the check flags, with the
// rules of each configuration that report it on that declaration or line, then one line per report
// no flagged place accounts for. With --unscoped the rules are switched on for every file instead
// of through the override, to show what the override keeps out.
//
//   check <path> <line> <rule>   oxlint <rules|->   biome <rules|->   biome+plugin <rules|->
//   extra <tool> <path> <line> <rule>
import { spawnSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { modulesUnder, placesIn } from "./purity-check.ts";

const HERE = import.meta.dir;
const BIN = resolve(HERE, "../../../../node_modules/.bin");
const TEMPLATES = join(HERE, "lint");

type Report = Readonly<{ tool: string; path: string; line: number; rule: string }>;

/** Reports whose line is on a flagged place's declaration (its first to its last line). */
export function covering(
  place: Readonly<{ path: string; line: number; endLine: number }>,
  reports: readonly Report[],
): Report[] {
  return reports.filter(
    (r) => r.path === place.path && r.line >= place.line && r.line <= place.endLine,
  );
}

/** The parts of the two linters' configurations that the templates in lint/ use. */
type Override = {
  plugins?: string[];
  rules?: Record<string, unknown>;
  linter?: { rules?: Record<string, unknown> };
};
type OxlintConfig = {
  categories?: Record<string, string>;
  overrides: Override[];
  plugins?: string[];
  rules?: Record<string, unknown>;
};
type BiomeConfig = {
  linter: { enabled?: boolean; rules: Record<string, unknown> };
  overrides: Override[];
  plugins?: string[];
};

const template = <T>(name: string): T =>
  JSON.parse(readFileSync(join(TEMPLATES, name), "utf8")) as T;

/** The same configuration with the first override's settings made global. */
export function unscopedOxlint(cfg: OxlintConfig): Omit<OxlintConfig, "overrides"> {
  const [first] = cfg.overrides;
  return { categories: cfg.categories, plugins: first?.plugins, rules: first?.rules };
}

export function unscopedBiome(cfg: BiomeConfig): BiomeConfig {
  const [first] = cfg.overrides;
  const rules = { ...cfg.linter.rules, ...first?.linter?.rules };
  return { ...cfg, overrides: [], plugins: first?.plugins, linter: { ...cfg.linter, rules } };
}

function oxlintReports(root: string, unscoped: boolean): Report[] {
  const cfg = template<OxlintConfig>("oxlintrc.json");
  writeFileSync(join(root, ".oxlintrc.json"), JSON.stringify(unscoped ? unscopedOxlint(cfg) : cfg));
  const run = spawnSync(
    join(BIN, "oxlint"),
    ["-c", ".oxlintrc.json", "--disable-nested-config", "-f", "json", "scripts"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(run.stdout) as {
    diagnostics: { code: string; filename: string; labels: { span: { line: number } }[] }[];
  };
  return parsed.diagnostics.map((d) => ({
    tool: "oxlint",
    path: d.filename,
    line: d.labels[0]?.span.line ?? 0,
    rule: d.code,
  }));
}

function biomeReports(root: string, config: string, tool: string, unscoped: boolean): Report[] {
  const cfg = template<BiomeConfig>(config);
  writeFileSync(join(root, "biome.json"), JSON.stringify(unscoped ? unscopedBiome(cfg) : cfg));
  copyFileSync(join(TEMPLATES, "no-ambient.grit"), join(root, "no-ambient.grit"));
  const run = spawnSync(
    join(BIN, "biome"),
    ["lint", "--reporter=json", "--max-diagnostics=none", "--colors=off", "scripts"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(run.stdout) as {
    diagnostics: { category: string; location: { path: string; start: { line: number } } }[];
  };
  return parsed.diagnostics.map((d) => ({
    tool,
    path: d.location.path,
    line: d.location.start.line,
    rule: d.category,
  }));
}

function main(argv: readonly string[]): number {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = arg("--root");
  if (root === undefined) {
    console.error("usage: lint-compare.ts --root <tree> [--out <file>] [--unscoped]");
    return 2;
  }
  const places = modulesUnder(root, "core").flatMap((path) =>
    placesIn(path, readFileSync(join(root, path), "utf8")),
  );
  const unscoped = argv.includes("--unscoped");
  const oxlint = oxlintReports(root, unscoped);
  const biome = biomeReports(root, "biome.json", "biome", unscoped);
  const plugin = biomeReports(root, "biome-grit.json", "biome+plugin", unscoped);
  const names = (rs: readonly Report[]): string =>
    rs.length === 0 ? "-" : [...new Set(rs.map((r) => r.rule))].sort().join(",");
  const lines: string[] = [];
  for (const p of places) {
    const row = [
      "check",
      p.path,
      String(p.line),
      p.rule + (p.typeOnly ? " (type only)" : ""),
      `oxlint\t${names(covering(p, oxlint))}`,
      `biome\t${names(covering(p, biome))}`,
      `biome+plugin\t${names(covering(p, plugin))}`,
    ];
    lines.push(row.join("\t"));
  }
  for (const reports of [oxlint, biome, plugin]) {
    for (const r of reports) {
      const covered = places.some((p) => covering(p, [r]).length > 0);
      if (!covered) lines.push(["extra", r.tool, r.path, String(r.line), r.rule].join("\t"));
    }
  }
  const text = `${lines.join("\n")}\n`;
  const out = arg("--out");
  if (out === undefined) process.stdout.write(text);
  else writeFileSync(out, text);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
