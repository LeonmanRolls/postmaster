// Which lanes review under each lens. A lens is reviewed by the lanes the config names for it in
// [team.lens_reviewers], or, where it names none, by [team] reviewers, which default to the
// workhorses. Bug reviewers are then limited to lanes whose harness has a code-review form.
// The postmaster writes the result into the waybill's Team section, and the coachman reads it
// back from there, so a run keeps the reviewers it was dispatched with.
//
//   reviewers.sh lines [--config <path>] [--project <repo>]   the waybill's reviewer lines, from the config (or the project's effective config)
//   reviewers.sh eligible <lens> [--config <path>] [--project <repo>]  configured lanes for a lens, checked for eligibility
//   reviewers.sh lanes <waybill> <lens>    the lanes for one lens, one per line, from a waybill
//   reviewers.sh lenses                    the lenses, in the order the review stage runs them
//
// `lines` prints `reviewers: <lane>, <lane>`, a `bug reviewers:` line containing only eligible
// lanes, then each other lens the config gives its own lanes. `eligible` resolves a configured
// lens and exits 2 if it has no eligible reviewers. With `--project`, both resolve the
// project's effective config instead of the live one. `lanes` reads only the waybill's `## Team`
// section: the lens's own line where it has one, the `reviewers:` line otherwise, except the
// bug lens, which is refused when its own line is missing rather than reading unfiltered
// reviewers. The lenses are the entries of the review stage in skills/postmaster/coachman.md,
// and change with it.
//
//   exit 0  printed
//   exit 1  usage, no config or one that does not parse, or no such waybill
//   exit 2  a lens the review stage does not have, a lane the config does not define, a lens with
//           no eligible lanes, or a waybill whose Team section has no reviewers line
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readTomlFile } from "./lib/data.ts";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import { PY_DOT, PY_S_CLASS, pySplitLines, pyTrim } from "./lib/text.ts";

const LENSES = ["style", "bug", "security"] as const;
type Lens = (typeof LENSES)[number];

interface CmdResult {
  code: number;
  out: string;
  err: string;
}

function usage(): never {
  console.error(
    "usage: reviewers.sh lines [--config <path>] [--project <repo>] | eligible <lens> [--config <path>] [--project <repo>] | lanes <waybill> <lens> | lenses",
  );
  process.exit(1);
}

function isLens(s: string): s is Lens {
  return (LENSES as readonly string[]).includes(s);
}

function hasForm(harness: string): boolean {
  return run("bash", [join(scriptsDir(import.meta), "review-forms.sh"), "has", harness]).code === 0;
}

/** resolved <lines|eligible> <config> [lens] [project]: the reviewer lines or one lens's lanes. */
function resolved(
  mode: "lines" | "eligible",
  configPath: string,
  selected: string,
  project: string,
): CmdResult {
  const err: string[] = [];
  const out: string[] = [];
  const fail1 = (msg: string): CmdResult => {
    err.push(msg);
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  };
  const fail2 = (msg: string): CmdResult => {
    err.push(msg);
    return { code: 2, out: "", err: `${err.join("\n")}\n` };
  };
  if (!existsSync(configPath)) {
    return fail1(`reviewers: no config at ${configPath} (POSTMASTER_CONFIG overrides the path)`);
  }
  let cfg: Record<string, unknown>;
  if (project !== "") {
    const r = run("bash", [
      join(scriptsDir(import.meta), "project-settings.sh"),
      "effective",
      project,
      configPath,
    ]);
    if (r.code !== 0) return { code: 1, out: "", err: r.err };
    try {
      cfg = JSON.parse(r.out);
    } catch (e) {
      return fail1(`reviewers: ${configPath} does not parse: ${String(e)}`);
    }
  } else {
    try {
      cfg = readTomlFile(configPath);
    } catch (e) {
      return fail1(`reviewers: ${configPath} does not parse: ${String(e)}`);
    }
  }
  const laneMap = (cfg.lanes as Record<string, Record<string, unknown>>) ?? {};
  const defined = new Set(Object.keys(laneMap));
  const team = (cfg.team as Record<string, unknown>) ?? {};
  const faults: string[] = [];
  const lanesOf = (value: unknown, where: string): string[] => {
    if (
      !Array.isArray(value) ||
      value.length === 0 ||
      !value.every((v) => typeof v === "string" && v !== "")
    ) {
      faults.push(`${where} is not a list of lane names`);
      return [];
    }
    for (const lane of value as string[]) {
      if (!defined.has(lane)) {
        faults.push(`${where} names ${lane}, which is not a lane in [lanes]`);
      }
    }
    return value as string[];
  };
  // Python's `team.get("reviewers") or team.get("workhorses") or []` falls through on a falsey value.
  const reviewers = team.reviewers;
  const workhorses = team.workhorses;
  const defaultList = lanesOf(
    (Array.isArray(reviewers) && reviewers.length ? reviewers : undefined) ??
      (Array.isArray(workhorses) && workhorses.length ? workhorses : undefined) ??
      [],
    "[team] reviewers",
  );
  let perLens = (team.lens_reviewers as Record<string, unknown>) ?? {};
  if (perLens === null || typeof perLens !== "object" || Array.isArray(perLens)) {
    faults.push("[team.lens_reviewers] is not a table");
    perLens = {};
  }
  for (const lens of Object.keys(perLens)) {
    if (!isLens(lens)) {
      faults.push(
        `[team.lens_reviewers] names ${lens}, which is not a lens (one of: ${LENSES.join(", ")})`,
      );
    }
  }
  const own = new Map<string, string[]>();
  for (const lens of LENSES) {
    if (lens in perLens) {
      own.set(lens, lanesOf(perLens[lens], `[team.lens_reviewers] ${lens}`));
    }
  }
  if (faults.length > 0) {
    for (const f of faults) err.push(`reviewers: ${f}`);
    return { code: 2, out: "", err: `${err.join("\n")}\n` };
  }
  const configured = (lens: string): string[] => own.get(lens) ?? defaultList;
  const eligibleFor = (lens: string): string[] => {
    const names = configured(lens);
    if (lens !== "bug") return names;
    return names.filter((name) => hasForm(String(laneMap[name]?.harness ?? "")));
  };
  if (mode === "lines") {
    out.push(`reviewers: ${defaultList.join(", ")}`);
    for (const lens of LENSES) {
      if (lens === "bug" || own.has(lens)) {
        out.push(`${lens} reviewers: ${eligibleFor(lens).join(", ")}`);
      }
    }
    return { code: 0, out: `${out.join("\n")}\n`, err: "" };
  }
  if (!isLens(selected)) {
    return fail2(`reviewers: ${selected} is not a lens (one of: ${LENSES.join(", ")})`);
  }
  const names = eligibleFor(selected);
  if (names.length === 0) {
    if (selected === "bug") {
      return fail2(
        "reviewers: no configured bug reviewer has a code-review form; the bug turnpike cannot run",
      );
    }
    return fail2(`reviewers: ${selected} has no configured reviewers`);
  }
  return { code: 0, out: `${names.join("\n")}\n`, err: "" };
}

export function lines(configPath: string, project = ""): CmdResult {
  return resolved("lines", configPath, "", project);
}

export function eligible(configPath: string, lens: string, project = ""): CmdResult {
  return resolved("eligible", configPath, lens, project);
}

const ANY_HEAD_RE = new RegExp(`^##[${PY_S_CLASS}]`, "u");
const TEAM_HEAD_RE = new RegExp(`^##[${PY_S_CLASS}]+Team[${PY_S_CLASS}]*$`, "u");

/** lanes <waybill> <lens>: the lanes for one lens, one per line, from a waybill. */
export function lanes(waybill: string, lens: string): CmdResult {
  const err: string[] = [];
  const fail1 = (msg: string): CmdResult => {
    err.push(msg);
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  };
  const fail2 = (msg: string): CmdResult => {
    err.push(msg);
    return { code: 2, out: "", err: `${err.join("\n")}\n` };
  };
  if (!existsSync(waybill)) {
    return fail1(`reviewers: no such waybill: ${waybill}`);
  }
  if (!isLens(lens)) {
    return fail2(`reviewers: ${lens} is not a lens (one of: ${LENSES.join(" ")})`);
  }
  const team: string[] = [];
  let inside = false;
  for (const line of pySplitLines(readFileSync(waybill, "utf8"))) {
    if (ANY_HEAD_RE.test(line)) {
      inside = TEAM_HEAD_RE.test(line);
      continue;
    }
    if (inside) team.push(line);
  }
  const listed = (prefix: string): string[] | null => {
    for (const line of team) {
      const m = new RegExp(
        `^[${PY_S_CLASS}]*${prefix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[${PY_S_CLASS}]*:[${PY_S_CLASS}]*(${PY_DOT}*?)[${PY_S_CLASS}]*$`,
        "u",
      ).exec(line);
      if (m) {
        return (m[1] ?? "")
          .split(",")
          .map((name) => pyTrim(name))
          .filter((name) => name !== "");
      }
    }
    return null;
  };
  let found = listed(`${lens} reviewers`);
  if (found === null && lens === "bug") {
    return fail2(
      `reviewers: the Team section of ${waybill} has no bug reviewers line (the bug lens never falls back to reviewers:)`,
    );
  }
  if (lens === "bug" && found !== null && found.length === 0) {
    return fail2(
      `reviewers: the Team section of ${waybill} has an empty bug reviewers line (it reviews nothing, and never falls back to reviewers:)`,
    );
  }
  if (found === null) found = listed("reviewers");
  if (!found || found.length === 0) {
    return fail2(`reviewers: the Team section of ${waybill} has no reviewers line for ${lens}`);
  }
  return { code: 0, out: `${found.join("\n")}\n`, err: "" };
}

function printResult(r: CmdResult): never {
  if (r.out) process.stdout.write(r.out);
  if (r.err) process.stderr.write(r.err);
  process.exit(r.code);
}

// --- entry ------------------------------------------------------------------------------
const CONFIG =
  process.env.POSTMASTER_CONFIG ?? join(process.env.HOME ?? "", ".postmaster/config.toml");

function configFlags(args: string[]): [string, string] {
  let configPath = CONFIG;
  let project = "";
  let i = 0;
  while (i < args.length) {
    if (args[i] === "--config") {
      if (i + 1 >= args.length) usage();
      configPath = args[i + 1] ?? "";
      i += 2;
    } else if (args[i] === "--project") {
      if (i + 1 >= args.length) usage();
      const val = args[i + 1] ?? "";
      if (!val) {
        console.error(`reviewers: no such project directory: ${val}`);
        process.exit(1);
      }
      project = val;
      i += 2;
    } else {
      usage();
    }
  }
  return [configPath, project];
}

function main(argv: string[]): void {
  switch (argv[0]) {
    case "lines": {
      const [configPath, project] = configFlags(argv.slice(1));
      printResult(lines(configPath, project));
      break;
    }
    case "eligible": {
      if (argv.length < 2) usage();
      const [configPath, project] = configFlags(argv.slice(2));
      printResult(eligible(configPath, argv[1] ?? "", project));
      break;
    }
    case "lanes": {
      if (argv.length !== 3) usage();
      printResult(lanes(argv[1] ?? "", argv[2] ?? ""));
      break;
    }
    case "lenses": {
      if (argv.length !== 1) usage();
      console.log(LENSES.join("\n"));
      process.exit(0);
      break;
    }
    default:
      usage();
  }
}

if (import.meta.main) {
  main(process.argv.slice(2));
}
