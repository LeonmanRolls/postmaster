// The project notes: what a person and the postmaster have written down about one project, put
// into the part of the flow each note is for. The file is <repo>/.postmaster/notes.md; its form
// and the parts of the flow are in scripts/lib/notes.ts, the written rules it can name in
// scripts/lib/rule-sources.ts, and the wikis and standards folders it can name in
// scripts/lib/sources.ts (registered once by name in the machine config).
//
//   run project-notes check <repo>
//       the file's problems, and what each part of the flow would receive, in words; exit 1 on a
//       problem. A project with no notes file is fine and prints nothing.
//   run project-notes preview <repo> [--area <glob>]...
//       the same, with every part's text printed: a dry run for the user to read before accepting
//   run project-notes clerk <repo> [--area <glob>]...
//       the clerk's part, with the files as they are on this machine
//   run project-notes sources <repo>
//       the registered sources and whether each is proposed for this repo
//   run project-notes bundle <repo> <dispatch> [--area <glob>]...
//       copy what the notes name into the run: <dispatch>/notes/<part>.md, a snapshot of each
//       file under <dispatch>/sources/ with its commit and hash in <dispatch>/sources.json, and
//       the rules in <dispatch>/rules/rules.json. Nothing is written when anything is wrong.
//   run project-notes show <dispatch> <part|waybill-section>
//       print a part as bundled; nothing when the part has none
//   run project-notes rules <dispatch> [<rule id>]
//       the bundled rules, or one, with its label and whether it gates
//   run project-notes verify-waybill <dispatch>
//       exit 1 unless <dispatch>/brief.md carries the bundled waybill section word for word
//   run project-notes verify-brief <dispatch> <lens>
//       exit 1 unless <dispatch>/review-<lens>-brief.md carries the lens's bundled part
//
// An area is a glob for where the ticket's work is, such as apps/shop/**. A note, rule source or
// file whose scope cannot reach any area given is left out; with no area, everything is in.
//
//   exit 0  done; checked clean
//   exit 1  a problem in the notes, a sources file or a bundle
//   exit 2  usage
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import {
  effectiveConfigForProject,
  expandUser,
  isDie,
  isFile,
  projectRoot,
  strictRead,
} from "./lib/effective-config.ts";
import {
  PARTS,
  type Part,
  type Parsed,
  type ReadsDecl,
  type RulesDecl,
  overBudget,
  parseNotes,
  parseRef,
  renderPart,
  routedFor,
} from "./lib/notes.ts";
import { run } from "./lib/proc.ts";
import { type Rule, readRules, scopeApplies } from "./lib/rule-sources.ts";
import { type Source, appliesTo, readSources, sourceFile } from "./lib/sources.ts";

const USAGE =
  "usage: run project-notes check|preview|clerk|sources <repo> [--area <glob>]... | bundle <repo> <dispatch> [--area <glob>]... | show <dispatch> <part> | rules <dispatch> [<id>] | verify-waybill <dispatch> | verify-brief <dispatch> <lens>";

const SECTION = "waybill-section";
const LENSES: readonly Part[] = ["style", "security", "design", "landing"];

const isPart = (s: string): s is Part => (PARTS as readonly string[]).includes(s);
const words = (s: string): number => s.split(/[ \t\n]+/u).filter((w) => w !== "").length;
const sha256 = (buf: Buffer): string => createHash("sha256").update(buf).digest("hex");

interface Ctx {
  readonly root: string;
  readonly notes: string;
  readonly sources: ReadonlyMap<string, Source>;
  readonly sourceProblems: readonly string[];
  readonly areas: readonly string[];
}

interface Located {
  readonly ref: string;
  /** Where the file is on this machine; null with a problem when the reference cannot be resolved. */
  readonly abs: string | null;
  /** Where its snapshot goes under <dispatch>/sources/. */
  readonly snapshot: string;
  readonly problem: string | null;
}

function context(repo: string, areas: readonly string[]): Ctx {
  const root = projectRoot(repo);
  const resolved = effectiveConfigForProject(repo);
  const table = resolved.config?.sources;
  const read = readSources(table, expandUser);
  return {
    root,
    notes: join(root, ".postmaster", "notes.md"),
    sources: new Map(read.sources.map((s) => [s.name, s])),
    sourceProblems: resolved.error === null ? read.problems : [resolved.error, ...read.problems],
    areas,
  };
}

function locate(ref: string, ctx: Ctx): Located {
  const parsed = parseRef(ref);
  if (parsed.kind === "source") {
    const source = ctx.sources.get(parsed.name);
    if (!source) {
      return {
        ref,
        abs: null,
        snapshot: "",
        problem: `${ref}: no source named "${parsed.name}" is registered in the machine config`,
      };
    }
    const abs = sourceFile(source, parsed.path);
    if (abs === null) {
      return {
        ref,
        abs: null,
        snapshot: "",
        problem: `${ref}: the path leaves the source's folder`,
      };
    }
    return {
      ref,
      abs,
      snapshot: posix.join(parsed.name, posix.normalize(parsed.path)),
      problem: null,
    };
  }
  const clean = posix.normalize(parsed.path);
  if (clean.startsWith("../") || clean === ".." || posix.isAbsolute(clean)) {
    return { ref, abs: null, snapshot: "", problem: `${ref}: the path leaves the project` };
  }
  return { ref, abs: join(ctx.root, clean), snapshot: posix.join("repo", clean), problem: null };
}

const reaches = (ctx: Ctx) => (scope: readonly string[]) => scopeApplies(scope, ctx.areas);

interface Gathered {
  readonly parsed: Parsed;
  readonly rules: readonly { rule: Rule; decl: RulesDecl["decl"]; parts: readonly Part[] }[];
  readonly files: readonly Located[];
  readonly problems: readonly string[];
}

/** Read the notes, the rule files they declare and the files they name. Problems are collected. */
function gather(ctx: Ctx): Gathered {
  if (!isFile(ctx.notes)) {
    return {
      parsed: { blocks: [], background: [], problems: [] },
      rules: [],
      files: [],
      problems: [],
    };
  }
  const parsed = parseNotes(strictRead(ctx.notes));
  const problems: string[] = [...parsed.problems];
  const reach = reaches(ctx);
  const blocks = parsed.blocks.filter((b): b is RulesDecl | ReadsDecl => b.kind !== "route");
  const files: Located[] = [];
  const rules: Array<{ rule: Rule; decl: RulesDecl["decl"]; parts: readonly Part[] }> = [];
  const note = (loc: Located): boolean => {
    if (loc.problem !== null) {
      problems.push(loc.problem);
      return false;
    }
    if (loc.abs === null || !isFile(loc.abs)) {
      problems.push(`${loc.ref}: no such file`);
      return false;
    }
    if (!files.some((f) => f.ref === loc.ref)) files.push(loc);
    return true;
  };
  for (const b of blocks) {
    if (!reach(b.scope)) continue;
    if (b.kind === "reads") {
      for (const ref of b.refs) note(locate(ref, ctx));
      continue;
    }
    const loc = locate(b.decl.ref, ctx);
    if (!note(loc) || loc.abs === null) continue;
    const read = readRules(strictRead(loc.abs), b.decl);
    for (const p of read.problems) problems.push(p);
    for (const r of read.rules) {
      if (reach(r.scope)) rules.push({ rule: r, decl: b.decl, parts: b.parts });
    }
  }
  // A source the notes name but the machine does not register is a problem once, however often named.
  for (const p of ctx.sourceProblems) problems.push(p);
  return { parsed, rules, files, problems: [...new Set(problems)] };
}

function partInput(
  g: Gathered,
  part: Part,
  ctx: Ctx,
  pathOf: (loc: Located) => string,
  where: string,
) {
  const reach = reaches(ctx);
  const blocks = routedFor(g.parsed, part, reach);
  const rules = g.rules.filter((r) => r.parts.includes(part));
  const reads = g.parsed.blocks
    .filter((b): b is ReadsDecl => b.kind === "reads" && b.parts.includes(part) && reach(b.scope))
    .flatMap((b) => b.refs)
    .map((ref) => g.files.find((f) => f.ref === ref))
    .filter((f): f is Located => f !== undefined)
    .map((f) => ({ ref: f.ref, path: pathOf(f) }));
  return { part, blocks, rules: rules.map((r) => ({ rule: r.rule, decl: r.decl })), reads, where };
}

function render(
  g: Gathered,
  ctx: Ctx,
  pathOf: (loc: Located) => string,
  where: string,
): Record<Part, string> {
  const out = {} as Record<Part, string>;
  for (const part of PARTS) out[part] = renderPart(partInput(g, part, ctx, pathOf, where));
  return out;
}

/** The waybill's section: the waybill's own notes, then what the lane that writes the code reads.
 * A note routed to both is printed once, in the first. */
function waybillSection(
  g: Gathered,
  ctx: Ctx,
  pathOf: (loc: Located) => string,
  where: string,
): string {
  const way = partInput(g, "waybill", ctx, pathOf, where);
  const impl = partInput(g, "implement", ctx, pathOf, where);
  const seen = new Set(way.blocks.map((b) => b.line));
  const implOnly = { ...impl, blocks: impl.blocks.filter((b) => !seen.has(b.line)) };
  const first = renderPart(way);
  const second = renderPart(implOnly);
  if (first === "" && second === "") return "";
  const lines = ["## Project notes", ""];
  if (first !== "") lines.push(first, "");
  if (second !== "") lines.push("### For the lane that writes the code", "", second);
  return `${lines.join("\n").trim()}\n`;
}

function parseAreas(argv: readonly string[]): { rest: string[]; areas: string[] } | null {
  const rest: string[] = [];
  const areas: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--area") {
      const g = argv[i + 1];
      if (g === undefined || g.startsWith("--")) return null;
      areas.push(g);
      i += 1;
    } else if (argv[i]?.startsWith("--")) {
      return null;
    } else {
      rest.push(argv[i] as string);
    }
  }
  return { rest, areas };
}

function summary(g: Gathered, texts: Record<Part, string>): string[] {
  const lines: string[] = [];
  for (const part of PARTS) {
    const n = words(texts[part]);
    if (n > 0) {
      const rules = g.rules.filter((r) => r.parts.includes(part)).length;
      lines.push(`${part}: ${n} words${rules > 0 ? `, ${rules} rules` : ""}`);
    }
  }
  const gating = g.rules.filter((r) => r.rule.gate).length;
  if (g.rules.length > 0) lines.push(`rules: ${g.rules.length}, ${gating} gate`);
  for (const b of g.parsed.background) {
    const first = b.text.split("\n").find((l) => l.trim() !== "") ?? "";
    lines.push(`background (line ${b.line}, copied nowhere): ${first.trim().slice(0, 70)}`);
  }
  return lines;
}

function problemsOf(g: Gathered): string[] {
  const over = overBudget(g.parsed).map(
    (o) =>
      `${o.part}: ${o.words} words routed, over its budget of ${o.budget}: move the long material into a file and route a pointer`,
  );
  return [...g.problems, ...over];
}

function check(repo: string, areas: string[], full: boolean): number {
  const ctx = context(repo, areas);
  const g = gather(ctx);
  const texts = render(g, ctx, (f) => f.abs ?? f.ref, "on this machine");
  const problems = problemsOf(g);
  for (const p of problems) console.log(`problem: ${p}`);
  for (const l of summary(g, texts)) console.log(l);
  if (full) {
    for (const part of PARTS) {
      if (texts[part] !== "") console.log(`\n=== ${part} ===\n${texts[part]}`);
    }
  }
  return problems.length > 0 ? 1 : 0;
}

function clerk(repo: string, areas: string[]): number {
  const ctx = context(repo, areas);
  const g = gather(ctx);
  const problems = problemsOf(g);
  if (problems.length > 0) {
    for (const p of problems) console.error(`project-notes: ${p}`);
    return 1;
  }
  const text = renderPart(partInput(g, "clerk", ctx, (f) => f.abs ?? f.ref, "on this machine"));
  if (text !== "") console.log(text);
  return 0;
}

function sources(repo: string): number {
  const ctx = context(repo, []);
  const glob = (pattern: string, path: string): boolean => new Bun.Glob(pattern).match(path);
  for (const s of ctx.sources.values()) {
    const here =
      appliesTo(s, ctx.root, expandUser, glob) || appliesTo(s, resolve(repo), expandUser, glob);
    const mark = here ? "applies" : "-";
    console.log(`${s.name}\t${mark}\t${s.path}\t${s.about}`);
  }
  for (const p of ctx.sourceProblems) console.error(`project-notes: ${p}`);
  return ctx.sourceProblems.length > 0 ? 1 : 0;
}

function commit(dir: string): string {
  const r = run("git", ["-C", dir, "rev-parse", "HEAD"]);
  return r.code === 0 ? r.out.trim() : "";
}

function bundle(repo: string, dispatch: string, areas: string[]): number {
  const ctx = context(repo, areas);
  const g = gather(ctx);
  const problems = problemsOf(g);
  if (problems.length > 0) {
    for (const p of problems) console.error(`project-notes: ${p}`);
    console.error("project-notes: nothing bundled");
    return 1;
  }
  const sourceDir = join(dispatch, "sources");
  const where = "copies in this run's sources folder";
  const pathOf = (f: Located): string => join(sourceDir, f.snapshot);
  const texts = render(g, ctx, pathOf, where);
  const record: Array<Record<string, string | number>> = [];
  for (const f of g.files) {
    const dest = pathOf(f);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(f.abs as string, dest);
    const parsed = parseRef(f.ref);
    const home =
      parsed.kind === "source" ? (ctx.sources.get(parsed.name)?.path ?? ctx.root) : ctx.root;
    const bytes = readFileSync(dest);
    record.push({
      ref: f.ref,
      snapshot: dest,
      sha256: sha256(bytes),
      bytes: bytes.length,
      commit: commit(home),
    });
  }
  writeFileSync(
    join(dispatch, "sources.json"),
    `${JSON.stringify({ area: ctx.areas, files: record }, null, 2)}\n`,
  );
  mkdirSync(join(dispatch, "rules"), { recursive: true });
  writeFileSync(
    join(dispatch, "rules", "rules.json"),
    `${JSON.stringify(
      g.rules.map((r) => ({ ...r.rule, parts: r.parts })),
      null,
      2,
    )}\n`,
  );
  const notesDir = join(dispatch, "notes");
  mkdirSync(notesDir, { recursive: true });
  for (const name of [...PARTS, SECTION]) {
    const file = join(notesDir, `${name}.md`);
    if (existsSync(file)) unlinkSync(file);
  }
  for (const part of PARTS) {
    if (texts[part] !== "") writeFileSync(join(notesDir, `${part}.md`), `${texts[part]}\n`);
  }
  const section = waybillSection(g, ctx, pathOf, where);
  if (section !== "") writeFileSync(join(notesDir, `${SECTION}.md`), section);
  for (const l of summary(g, texts)) console.log(l);
  console.log(`bundled: ${record.length} files, ${g.rules.length} rules`);
  return 0;
}

function show(dispatch: string, name: string): number {
  if (name !== SECTION && !isPart(name)) {
    console.error(
      `project-notes: "${name}" is not a part of the flow (${PARTS.join(", ")}, ${SECTION})`,
    );
    return 2;
  }
  const file = join(dispatch, "notes", `${name}.md`);
  if (isFile(file)) process.stdout.write(readFileSync(file, "utf8"));
  return 0;
}

function showRules(dispatch: string, id: string | undefined): number {
  const file = join(dispatch, "rules", "rules.json");
  if (!isFile(file)) {
    if (id === undefined) return 0;
    console.error(`project-notes: no rules bundled in ${dispatch}`);
    return 1;
  }
  const rules = JSON.parse(readFileSync(file, "utf8")) as Array<Rule & { parts: string[] }>;
  const line = (r: Rule): string =>
    `${r.id}${r.label === "" ? "" : ` (${r.label})`} [${r.gate ? "gates" : "advisory"}]: ${r.text} (${r.at})`;
  if (id === undefined) {
    for (const r of rules) console.log(`- ${line(r)}`);
    return 0;
  }
  const found = rules.filter((r) => r.id === id);
  if (found.length === 0) {
    console.error(`project-notes: no rule "${id}" in ${dispatch}`);
    return 1;
  }
  for (const r of found) console.log(line(r));
  return 0;
}

const norm = (s: string): string => s.replace(/\r\n/gu, "\n").trim();

function verify(dispatch: string, notesName: string, target: string, label: string): number {
  const notes = join(dispatch, "notes", `${notesName}.md`);
  if (!isFile(notes)) return 0;
  if (!isFile(target)) {
    console.error(`project-notes: ${label} is missing: ${target}`);
    return 1;
  }
  if (!norm(readFileSync(target, "utf8")).includes(norm(readFileSync(notes, "utf8")))) {
    console.error(`project-notes: ${label} does not carry ${notes} word for word`);
    return 1;
  }
  console.log(`${label} carries the project notes`);
  return 0;
}

export function main(argv: string[]): number {
  const [cmd, ...tail] = argv;
  const usage = (): number => {
    console.error(USAGE);
    return 2;
  };
  if (cmd === "show") {
    return tail.length === 2 ? show(tail[0] as string, tail[1] as string) : usage();
  }
  if (cmd === "rules") {
    return tail.length === 1 || tail.length === 2 ? showRules(tail[0] as string, tail[1]) : usage();
  }
  if (cmd === "verify-waybill") {
    return tail.length === 1
      ? verify(tail[0] as string, SECTION, join(tail[0] as string, "brief.md"), "the waybill")
      : usage();
  }
  if (cmd === "verify-brief") {
    if (tail.length !== 2) return usage();
    const lens = tail[1] as string;
    if (!(LENSES as readonly string[]).includes(lens)) {
      console.error(`project-notes: a brief is written for a lens: ${LENSES.join(", ")}`);
      return 2;
    }
    return verify(
      tail[0] as string,
      lens,
      join(tail[0] as string, `review-${lens}-brief.md`),
      `the ${lens} brief`,
    );
  }
  const args = parseAreas(tail);
  if (args === null) return usage();
  const [repo, dispatch] = args.rest;
  if (repo === undefined) return usage();
  try {
    switch (cmd) {
      case "check":
        return args.rest.length === 1 ? check(repo, args.areas, false) : usage();
      case "preview":
        return args.rest.length === 1 ? check(repo, args.areas, true) : usage();
      case "clerk":
        return args.rest.length === 1 ? clerk(repo, args.areas) : usage();
      case "sources":
        return args.rest.length === 1 && args.areas.length === 0 ? sources(repo) : usage();
      case "bundle":
        return args.rest.length === 2 && dispatch !== undefined
          ? bundle(repo, dispatch, args.areas)
          : usage();
      default:
        return usage();
    }
  } catch (e) {
    console.error(
      `project-notes: ${isDie(e) ? e.message : e instanceof Error ? e.message : String(e)}`,
    );
    return 1;
  }
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
