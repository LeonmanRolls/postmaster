// Acceptance oracle for #233: the gate refuses the any type, and the tree carries no
// use of it apart from a few reasoned suppressions. Pure file reads plus the gate's own
// lint command, run as a user runs it; nothing here imports the change's own modules.
//
//   run no-explicit-any-acceptance [--base <commit>] [repo-root]
//           default root: the repo this script lives in
//
//   exit 0  the rule is on, no use remains, the gate and the count command flag a
//           planted probe, at most five reasoned suppressions stand, and with --base
//           every test file changed since the base is the same program with its
//           types stripped
//   exit 1  findings, one per line on stdout: <file>: <what fails>
//   exit 2  usage, an unreadable tree, a probe left behind, or a run that never started
//
// With --base, a test file added on the branch has nothing at the base to compare and
// is skipped; a deleted one fails, since dropping a test is not a type-only change.
//
// The beside-script test fails on a tree that still carries the old shape, at its
// live-tree step; that failure is the control proving the checks bite on the real
// files, not only fixtures.
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { toolRoot } from "./lib/paths.ts";

export interface AcceptResult {
  code: number;
  out: string;
  err: string;
}

export interface RunResult {
  code: number;
  out: string;
  err: string;
  ran: boolean;
}

export type Runner = (cmd: string[], cwd: string) => RunResult;

const RULE = "typescript/no-explicit-any";
// Findings render the rule with parens, so the probe match uses this form while the
// config checks use the key above.
const RULE_RENDERED = `${RULE.replace("/", "(")})`;
const PROBE_REL = "scripts/zz-probe.ts";
const PROBE_SRC = "export const z = (x: any): number => x;\n";
// The count invocation, shared by the clean count and its planted control so
// the two are provably the same command.
const COUNT_ARGS = ["bunx", "oxlint", "-A", "all", "-D", RULE, "-f", "unix"];
const MAX_SUPPRESS = 5;
// Generated bundles, byte-pinned by `bundle-scrub --check`, the same reason as vendored code.
const WANT_IGNORE =
  '["fixtures/**","scripts/scrub-check.ts","scripts/raw-promote.ts","scripts/lib/vendor/**"]';
// The matcher is built from the constant so this file holds no line the walk below
// would count: the literal rule name and the comment form never share one.
const SUPPRESS = new RegExp(`(oxlint|eslint)-disable.*${RULE}`, "u");

/** Spawn through node. `ran` is false when the command never started or never exited. */
export function spawnRunner(cmd: string[], cwd: string): RunResult {
  const name = cmd[0] ?? "(empty)";
  let r: SpawnSyncReturns<string>;
  try {
    r = spawnSync(cmd[0] ?? "", cmd.slice(1), {
      cwd,
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    return { code: 127, out: "", err: `${name}: did not start: ${String(e)}\n`, ran: false };
  }
  if (typeof r.status !== "number") {
    const how = r.signal === null ? "never exited" : `died on ${r.signal}`;
    return { code: 127, out: "", err: `${name}: ${how}\n`, ran: false };
  }
  return { code: r.status, out: r.stdout, err: r.stderr, ran: true };
}

function readJson(path: string): { ok: true; value: unknown } | { ok: false } {
  try {
    // JSON.parse returns any; the assertion keeps the value unknown-typed.
    return { ok: true, value: JSON.parse(readFileSync(path, "utf8")) as unknown };
  } catch {
    return { ok: false };
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The rule's setting and the config's shape, from the parsed .oxlintrc.json. */
function lintConfigFindings(value: unknown): string[] {
  if (!isRecord(value)) return [".oxlintrc.json: want an object at the top"];
  const out: string[] = [];
  const rules: unknown = value["rules"];
  if (!isRecord(rules)) {
    out.push(".oxlintrc.json: want a rules object");
  } else {
    const setting: unknown = rules[RULE];
    if (setting !== "error" && setting !== 2) {
      out.push(`.oxlintrc.json: ${RULE} is ${JSON.stringify(setting) ?? "missing"}, want "error"`);
    }
  }
  const raw: unknown = value["overrides"];
  if (raw !== undefined) {
    if (!Array.isArray(raw)) {
      out.push(".oxlintrc.json: overrides is not an array");
    } else {
      const entries: unknown[] = raw;
      for (let i = 0; i < entries.length; i++) {
        const entry: unknown = entries[i];
        if (!isRecord(entry)) {
          out.push(`.oxlintrc.json: overrides[${i}] is not an object`);
          continue;
        }
        const erules: unknown = entry["rules"];
        if (erules === undefined) continue;
        if (!isRecord(erules)) {
          out.push(`.oxlintrc.json: overrides[${i}].rules is not an object`);
          continue;
        }
        const setting: unknown = erules[RULE];
        // Anything but error neuters the gate for those files: it fails on no
        // warning. An entry that does not name the rule is left alone.
        if (setting !== undefined && setting !== "error" && setting !== 2) {
          out.push(
            `.oxlintrc.json: overrides[${i}] sets ${RULE} to ${JSON.stringify(setting) ?? "missing"}, want "error"`,
          );
        }
      }
    }
  }
  const ignore: unknown = value["ignorePatterns"];
  if (JSON.stringify(ignore) !== WANT_IGNORE) {
    out.push(
      `.oxlintrc.json: ignorePatterns is ${JSON.stringify(ignore) ?? "missing"}, want ${WANT_IGNORE}`,
    );
  }
  return out;
}

/** A blanket-fail mechanism in the check script other than --deny-warnings, or
 * null when the script carries none: --max-warnings with a zero threshold, or
 * denying the whole `all` category. */
function blanketFlag(check: string): string | null {
  // ASCII: a shell splits words on ASCII whitespace, as does JS \s.
  const capped = /--max-warnings(?:=|\s+)0+(?![0-9])/u.exec(check);
  if (capped !== null) return capped[0];
  // ASCII: a shell splits words on ASCII whitespace, as does JS \s.
  const denied = /(?:^|\s)(?:--deny|-D)(?:=|\s+)all(?:\s|$)/u.exec(check);
  if (denied !== null) return denied[0].trim();
  return null;
}

/** The gate runs the linter with the rule failing at error, and fails on every
 * warning only through --deny-warnings (#232): any other blanket mechanism is
 * refused, naming the flag. */
function gateFindings(value: unknown): string[] {
  if (!isRecord(value)) return ["package.json: want an object at the top"];
  const scripts: unknown = value["scripts"];
  if (!isRecord(scripts)) return ["package.json: want a scripts object"];
  const check: unknown = scripts["check"];
  if (typeof check !== "string") return ["package.json: no check script runs the linter"];
  if (!check.includes("oxlint")) return ["package.json: the check script does not run oxlint"];
  const blanket = blanketFlag(check);
  if (blanket !== null) {
    return [
      `package.json: the check script fails on every warning with ${blanket}, want --deny-warnings or none`,
    ];
  }
  return [];
}

interface Hit {
  loc: string;
  reasoned: boolean;
}

/** Every suppression of the rule under one directory, symlinks and unreadable files aside. */
function walk(dir: string, root: string, hits: Hit[]): void {
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    return;
  }
  for (const name of names) {
    const full = join(dir, name);
    try {
      const st = lstatSync(full);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        walk(full, root, hits);
        continue;
      }
      if (!st.isFile()) continue;
    } catch {
      continue;
    }
    let text: string;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    for (const [i, line] of text.split("\n").entries()) {
      if (!SUPPRESS.test(line)) continue;
      const tail = line.slice(line.indexOf(RULE) + RULE.length);
      hits.push({
        loc: `${relative(root, full)}:${i + 1}`,
        reasoned: / -- [^\p{White_Space}]/u.test(tail),
      });
    }
  }
}

function suppressionFindings(hits: Hit[]): string[] {
  const out = hits
    .filter((h) => !h.reasoned)
    .map((h) => `${h.loc}: suppression without ' -- <reason>'`);
  if (hits.length > MAX_SUPPRESS) {
    out.push(`${RULE}: ${hits.length} suppressions stand, at most ${MAX_SUPPRESS}`);
  }
  return out;
}

const stripper = new Bun.Transpiler({ loader: "ts" });

/** Both sources compile to the same JavaScript once their types are stripped. */
export function strippedEqual(a: string, b: string): boolean {
  return stripper.transformSync(a) === stripper.transformSync(b);
}

/** Every test file changed since the base is the same stripped program. `fatal` is set
 * when git itself cannot answer, as against a file that fails the comparison. */
function typesOnly(root: string, run: Runner, base: string): { findings: string[]; fatal: string } {
  const diff = run(
    [
      "git",
      "diff",
      "--name-only",
      `${base}...HEAD`,
      "--",
      "scripts/*.test.ts",
      "scripts/host-self-test.ts",
    ],
    root,
  );
  if (!diff.ran || diff.code !== 0) {
    return {
      findings: [],
      fatal: `cannot list test changes at ${base}: ${diff.err || `exit ${diff.code}`}`,
    };
  }
  const findings: string[] = [];
  for (const name of diff.out.split("\n").filter((l) => l !== "")) {
    let head: string;
    try {
      head = readFileSync(join(root, name), "utf8");
    } catch {
      findings.push(`${name}: deleted, want type-only changes`);
      continue;
    }
    const shown = run(["git", "show", `${base}:${name}`], root);
    if (!shown.ran) return { findings, fatal: `cannot read ${base}:${name}: ${shown.err}` };
    if (shown.code !== 0) continue;
    if (!strippedEqual(shown.out, head)) {
      findings.push(`${name}: stripped program differs from the base`);
    }
  }
  return { findings, fatal: "" };
}

export function accept(root: string, run: Runner = spawnRunner, base?: string): AcceptResult {
  const me = "no-explicit-any-acceptance";
  const findings: string[] = [];
  if (base !== undefined) {
    const t = typesOnly(root, run, base);
    if (t.fatal !== "") return { code: 2, out: "", err: `${me}: ${t.fatal}\n` };
    findings.push(...t.findings);
  }
  const cfg = readJson(join(root, ".oxlintrc.json"));
  if (!cfg.ok)
    return { code: 2, out: "", err: `${me}: cannot read ${join(root, ".oxlintrc.json")}\n` };
  findings.push(...lintConfigFindings(cfg.value));
  const pkg = readJson(join(root, "package.json"));
  if (!pkg.ok)
    return { code: 2, out: "", err: `${me}: cannot read ${join(root, "package.json")}\n` };
  findings.push(...gateFindings(pkg.value));
  const hits: Hit[] = [];
  for (const dir of ["scripts", "lint", "types"]) walk(join(root, dir), root, hits);
  hits.sort((a, b) => (a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0));
  findings.push(...suppressionFindings(hits));
  const counted = run([...COUNT_ARGS], root);
  if (!counted.ran) {
    return { code: 2, out: "", err: `${me}: the count run never started: ${counted.err}` };
  }
  // At zero the count run prints nothing and exits 0; the "N problems" line only
  // appears when N is not zero, singular for one.
  const m = /([0-9]+) problems?/u.exec(counted.out);
  const n = m === null ? 0 : Number(m[1]);
  if (counted.code !== 0 || n !== 0) {
    findings.push(
      `${RULE}: ${m === null ? `exit ${counted.code}` : m[0]} reported, want 0 problems`,
    );
  }
  const probe = join(root, "scripts", "zz-probe.ts");
  if (existsSync(probe)) {
    return { code: 2, out: "", err: `${me}: ${PROBE_REL} already exists; remove it first\n` };
  }
  try {
    writeFileSync(probe, PROBE_SRC);
  } catch (e) {
    return { code: 2, out: "", err: `${me}: cannot plant the probe: ${String(e)}\n` };
  }
  const flagged = run(["bunx", "oxlint"], root);
  const control = run([...COUNT_ARGS], root);
  let leftover = false;
  try {
    rmSync(probe);
  } catch {
    leftover = true;
  }
  if (leftover) {
    return {
      code: 2,
      out: "",
      err: `${me}: the probe is left behind at ${PROBE_REL}; remove it\n`,
    };
  }
  if (!flagged.ran) {
    return { code: 2, out: "", err: `${me}: the planted run never started: ${flagged.err}` };
  }
  if (
    flagged.code !== 1 ||
    !flagged.out.includes(RULE_RENDERED) ||
    !flagged.out.includes(`${PROBE_REL}:1`)
  ) {
    findings.push(
      `probe: the gate exits ${flagged.code} on the planted file without naming ${RULE} at ${PROBE_REL}:1`,
    );
  }
  if (!control.ran) {
    return { code: 2, out: "", err: `${me}: the count control never started: ${control.err}` };
  }
  const mc = /([0-9]+) problems?/u.exec(control.out);
  const nc = mc === null ? 0 : Number(mc[1]);
  if (nc === 0) {
    findings.push(
      "count: the planted probe reads 0 problems through the count command, want nonzero",
    );
  }
  const calm = run(["bunx", "oxlint"], root);
  if (!calm.ran) {
    return { code: 2, out: "", err: `${me}: the calm run never started: ${calm.err}` };
  }
  if (calm.code !== 0) {
    findings.push(`probe: the gate exits ${calm.code} without the probe, want 0`);
  }
  return {
    code: findings.length === 0 ? 0 : 1,
    out: findings.map((l) => `${l}\n`).join(""),
    err: "",
  };
}

function printAccept(r: AcceptResult): never {
  if (r.out) process.stdout.write(r.out);
  if (r.err) process.stderr.write(r.err);
  process.exit(r.code);
}

function usage(): never {
  console.error("usage: run no-explicit-any-acceptance [--base <commit>] [repo-root]");
  process.exit(2);
}

function parseArgs(argv: string[]): { base?: string; root?: string } {
  let base: string | undefined;
  let root: string | undefined;
  let i = 0;
  while (i < argv.length) {
    const a: string = argv[i] ?? "";
    if (a === "--base") {
      const v: string = argv[i + 1] ?? "";
      if (v === "" || v.startsWith("-") || base !== undefined) usage();
      base = v;
      i += 2;
    } else if (a === "" || a.startsWith("-")) {
      usage();
    } else if (root !== undefined) {
      usage();
    } else {
      root = a;
      i++;
    }
  }
  return { base, root };
}

// --- entry ------------------------------------------------------------------------------
const ROOT = toolRoot(import.meta);
const argv = process.argv.slice(2);

if (import.meta.main) {
  const args = parseArgs(argv);
  printAccept(accept(args.root ?? ROOT, spawnRunner, args.base));
}
