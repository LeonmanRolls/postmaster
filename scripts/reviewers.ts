// Which lanes review under each lens. A lens is reviewed by the lanes the config names for it in
// [team.lens_reviewers], or, where it names none, by [team] reviewers, which default to the
// workhorses. The postmaster writes the result into the waybill's Team section, and the coachman
// reads it back from there, so a run keeps the reviewers it was dispatched with.
//
//   reviewers.sh lines [--config <path>]   the waybill's reviewer lines, from the config
//   reviewers.sh lanes <waybill> <lens>    the lanes for one lens, one per line, from a waybill
//   reviewers.sh lenses                    the lenses, in the order the review stage runs them
//   reviewers.sh --self-test
//
// `lines` prints `reviewers: <lane>, <lane>`, then `<lens> reviewers: <lane>, …` for each lens the
// config gives its own lanes. `lanes` reads only the waybill's `## Team` section: the lens's own
// line where it has one, the `reviewers:` line otherwise. The lenses are the entries of the review
// stage in skills/postmaster/coachman.md, and change with it.
//
//   exit 0  printed
//   exit 1  usage, no config or one that does not parse, or no such waybill
//   exit 2  a lens the review stage does not have, a lane the config does not define, a lens with
//           no lanes, or a waybill whose Team section has no reviewers line
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readTomlFile } from "./lib/data.ts";
import { scriptsDir } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

const LENSES = ["style", "bug", "security"] as const;
type Lens = (typeof LENSES)[number];

interface CmdResult {
  code: number;
  out: string;
  err: string;
}

function usage(): never {
  console.error(
    "usage: reviewers.sh lines [--config <path>] | lanes <waybill> <lens> | lenses | --self-test",
  );
  process.exit(1);
}

function isLens(s: string): s is Lens {
  return (LENSES as readonly string[]).includes(s);
}

/** lines <config>: the waybill's reviewer lines, from the config. */
function lines(configPath: string): CmdResult {
  const err: string[] = [];
  const out: string[] = [];
  const fail1 = (msg: string): CmdResult => {
    err.push(msg);
    return { code: 1, out: "", err: `${err.join("\n")}\n` };
  };
  const _fail2 = (msg: string): CmdResult => {
    err.push(msg);
    return { code: 2, out: "", err: `${err.join("\n")}\n` };
  };
  if (!existsSync(configPath)) {
    return fail1(`reviewers: no config at ${configPath} (POSTMASTER_CONFIG overrides the path)`);
  }
  let cfg: Record<string, unknown>;
  try {
    cfg = readTomlFile(configPath);
  } catch (e) {
    return fail1(`reviewers: ${configPath} does not parse: ${String(e)}`);
  }
  const defined = new Set(Object.keys((cfg.lanes as Record<string, unknown>) ?? {}));
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
  const own: Array<[string, string[]]> = [];
  for (const lens of LENSES) {
    if (lens in perLens) {
      own.push([lens, lanesOf(perLens[lens], `[team.lens_reviewers] ${lens}`)]);
    }
  }
  if (faults.length > 0) {
    for (const f of faults) err.push(`reviewers: ${f}`);
    return { code: 2, out: "", err: `${err.join("\n")}\n` };
  }
  out.push(`reviewers: ${defaultList.join(", ")}`);
  for (const [lens, names] of own) {
    out.push(`${lens} reviewers: ${names.join(", ")}`);
  }
  return { code: 0, out: `${out.join("\n")}\n`, err: "" };
}

/** lanes <waybill> <lens>: the lanes for one lens, one per line, from a waybill. */
function lanes(waybill: string, lens: string): CmdResult {
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
  for (const line of readFileSync(waybill, "utf8").split("\n")) {
    if (/^##\s/.test(line)) {
      inside = /^##\s+Team\s*$/.test(line);
      continue;
    }
    if (inside) team.push(line);
  }
  const listed = (prefix: string): string[] | null => {
    for (const line of team) {
      const m = new RegExp(
        `^\\s*${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(.*?)\\s*$`,
      ).exec(line);
      if (m) {
        return (m[1] ?? "")
          .split(",")
          .map((name) => name.trim())
          .filter((name) => name !== "");
      }
    }
    return null;
  };
  let found = listed(`${lens} reviewers`);
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
const argv = process.argv.slice(2);
const CONFIG =
  process.env.POSTMASTER_CONFIG ?? join(process.env.HOME ?? "", ".postmaster/config.toml");

if (argv[0] !== "--self-test") {
  switch (argv[0]) {
    case "lines": {
      if (argv.length === 1) printResult(lines(CONFIG));
      else if (argv.length === 3 && argv[1] === "--config") printResult(lines(argv[2] ?? ""));
      else usage();
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
  process.exit(0);
}

// --- self-test ----------------------------------------------------------------------------
const self = join(scriptsDir(import.meta), "reviewers.sh");
withTempDir((tmp) => {
  const st = new SelfTest();
  const errFile = join(tmp, "err");

  const lanesBlock = `[lanes.luna]
harness = "codex"
model = "m1"
[lanes.mimo]
harness = "mimo"
model = "m2"
[lanes.sentinel]
harness = "claude"
model = "m3"`;
  const config = (name: string, teamBody: string): void => {
    writeFileSync(join(tmp, `${name}.toml`), `${lanesBlock}\n\n[team]\n${teamBody}\n`);
  };
  const waybill = (name: string, reviewerLines: string): void => {
    writeFileSync(
      join(tmp, `${name}.md`),
      `# Waybill: 7\n\n## Ticket\n\nsecurity reviewers: luna\nreviewers: sentinel\n\n` +
        `## Team\nworkhorses: luna=codex/m1/, mimo=mimo/m2/\n${reviewerLines}\ncoachman: muse/m4/\n\n` +
        `## Dispatch\ndispatch: /tmp/x\n`,
    );
  };

  let lastErr = "";
  const expect = (label: string, wantRc: number, wantOut: string, call: () => CmdResult): void => {
    const r = call();
    lastErr = r.err;
    writeFileSync(errFile, r.err);
    const want = wantOut.replace(/\\n/g, "\n").replace(/\n+$/, "");
    const got = r.out.replace(/\n+$/, "");
    if (r.code === wantRc && got === want) st.ok(label);
    else {
      st.fail(`${label}: wanted exit ${wantRc} and "${wantOut}", got exit ${r.code}`, got + r.err);
    }
  };

  console.log("positive controls");
  config(
    "one",
    `workhorses = ["luna", "mimo"]
reviewers = ["luna", "mimo"]
[team.lens_reviewers]
security = ["luna", "mimo", "sentinel"]`,
  );
  expect(
    "the waybill lines name the reviewers, then each lens with its own lanes",
    0,
    "reviewers: luna, mimo\\nsecurity reviewers: luna, mimo, sentinel",
    () => lines(join(tmp, "one.toml")),
  );
  waybill("one", lines(join(tmp, "one.toml")).out.trimEnd());
  expect("a lens with its own line gets exactly those lanes", 0, "luna\\nmimo\\nsentinel", () =>
    lanes(join(tmp, "one.md"), "security"),
  );
  expect("a lens without one gets the reviewer list", 0, "luna\\nmimo", () =>
    lanes(join(tmp, "one.md"), "bug"),
  );
  expect("and so does style", 0, "luna\\nmimo", () => lanes(join(tmp, "one.md"), "style"));
  config(
    "two",
    `workhorses = ["luna", "mimo"]
reviewers = ["sentinel"]`,
  );
  expect(
    "a config without the table gives the reviewers line alone, as before",
    0,
    "reviewers: sentinel",
    () => lines(join(tmp, "two.toml")),
  );
  config("three", `workhorses = ["luna", "mimo"]`);
  expect("reviewers default to the workhorses", 0, "reviewers: luna, mimo", () =>
    lines(join(tmp, "three.toml")),
  );
  expect("the lenses are the review stage's, in order", 0, "style\\nbug\\nsecurity", () =>
    run(self, ["lenses"]),
  );

  console.log("negative controls");
  config(
    "bad-lens",
    `workhorses = ["luna", "mimo"]
[team.lens_reviewers]
secruity = ["sentinel"]`,
  );
  expect("a lens the review stage does not have is refused", 2, "", () =>
    lines(join(tmp, "bad-lens.toml")),
  );
  if (lastErr.includes("secruity, which is not a lens")) st.ok("and named");
  else st.fail("and named", lastErr);
  config(
    "bad-lane",
    `workhorses = ["luna", "mimo"]
[team.lens_reviewers]
security = ["luna", "nobody"]`,
  );
  expect("a lane the config does not define is refused", 2, "", () =>
    lines(join(tmp, "bad-lane.toml")),
  );
  if (lastErr.includes("nobody, which is not a lane")) st.ok("and named");
  else st.fail("and named", lastErr);
  config(
    "empty",
    `workhorses = ["luna", "mimo"]
[team.lens_reviewers]
security = []`,
  );
  expect("a lens with no lanes is refused", 2, "", () => lines(join(tmp, "empty.toml")));
  config(
    "bad-default",
    `workhorses = ["luna", "mimo"]
reviewers = ["ghost"]`,
  );
  expect("a reviewer that is not a lane is refused", 2, "", () =>
    lines(join(tmp, "bad-default.toml")),
  );
  expect("no config is refused", 1, "", () => lines(join(tmp, "none.toml")));
  expect("a waybill lens that is not a lens is refused", 2, "", () =>
    lanes(join(tmp, "one.md"), "secruity"),
  );
  waybill("no-team", "");
  expect(
    "a Team section with no reviewers line is refused, never read as no reviewers",
    2,
    "",
    () => lanes(join(tmp, "no-team.md"), "bug"),
  );
  expect("reviewer lines in the ticket's text are not read", 2, "", () =>
    lanes(join(tmp, "no-team.md"), "security"),
  );
  expect("no such waybill is refused", 1, "", () => lanes(join(tmp, "none.md"), "bug"));

  st.finish();
});
