import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { command, makeTemp, removeTree, scriptDir, writeError, writeOut } from "./lib/core.ts";

const lenses = ["style", "bug", "security"];
const here = scriptDir(import.meta.url);
const wrapper = join(here, "reviewers.sh");
const configPath = () => process.env.POSTMASTER_CONFIG ?? join(process.env.HOME ?? "", ".postmaster/config.toml");
function usage(): never {
  writeError("usage: reviewers.sh lines [--config <path>] | lanes <waybill> <lens> | lenses | --self-test");
  process.exit(1);
}
function parseConfig(path: string): Record<string, any> {
  try {
    return Bun.TOML.parse(readFileSync(path, "utf8")) as Record<string, any>;
  } catch (error) {
    writeError(`reviewers: ${path} does not parse: ${String(error).replace(/^Error: /, "")}`);
    process.exit(1);
  }
}
function lines(path: string): number {
  if (!existsSync(path)) {
    writeError(`reviewers: no config at ${path} (POSTMASTER_CONFIG overrides the path)`);
    return 1;
  }
  const cfg = parseConfig(path);
  const defined = new Set(Object.keys(cfg.lanes ?? {}));
  const team = cfg.team ?? {};
  const faults: string[] = [];
  const lanesOf = (value: unknown, where: string): string[] => {
    if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string" && v.length > 0)) {
      faults.push(`${where} is not a list of lane names`);
      return [];
    }
    for (const lane of value)
      if (!defined.has(lane)) faults.push(`${where} names ${lane}, which is not a lane in [lanes]`);
    return value;
  };
  const defaults = lanesOf(team.reviewers || team.workhorses || [], "[team] reviewers");
  let perLens: Record<string, unknown> = team.lens_reviewers || {};
  if (typeof perLens !== "object" || Array.isArray(perLens)) {
    faults.push("[team.lens_reviewers] is not a table");
    perLens = {};
  }
  for (const lens of Object.keys(perLens)) {
    if (!lenses.includes(lens))
      faults.push(`[team.lens_reviewers] names ${lens}, which is not a lens (one of: ${lenses.join(", ")})`);
  }
  const own = new Map<string, string[]>();
  for (const lens of lenses)
    if (Object.hasOwn(perLens, lens)) own.set(lens, lanesOf(perLens[lens], `[team.lens_reviewers] ${lens}`));
  if (faults.length) {
    for (const fault of faults) writeError(`reviewers: ${fault}`);
    return 2;
  }
  writeOut(`reviewers: ${defaults.join(", ")}`);
  for (const [lens, names] of own) writeOut(`${lens} reviewers: ${names.join(", ")}`);
  return 0;
}
function laneList(path: string, lens: string): number {
  if (!existsSync(path)) {
    writeError(`reviewers: no such waybill: ${path}`);
    return 1;
  }
  if (!lenses.includes(lens)) {
    writeError(`reviewers: ${lens} is not a lens (one of: ${lenses.join(" ")})`);
    return 2;
  }
  let inTeam = false;
  const team: string[] = [];
  for (const line of readFileSync(path, "utf8").replaceAll("\r", "").split("\n")) {
    if (/^##\s/.test(line)) {
      inTeam = /^##\s+Team\s*$/.test(line);
      continue;
    }
    if (inTeam) team.push(line);
  }
  const listed = (prefix: string): string[] | null => {
    const escaped = prefix.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
    for (const line of team) {
      const match = line.match(new RegExp(`^\\s*${escaped}\\s*:\\s*(.*?)\\s*$`));
      if (match)
        return match[1]!
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean);
    }
    return null;
  };
  const found = listed(`${lens} reviewers`) ?? listed("reviewers");
  if (!found?.length) {
    writeError(`reviewers: the Team section of ${path} has no reviewers line for ${lens}`);
    return 2;
  }
  for (const name of found) writeOut(name);
  return 0;
}
function run(args: string[]): number {
  const [cmd, ...rest] = args;
  if (cmd === "lines" && rest.length === 0) return lines(configPath());
  if (cmd === "lines" && rest.length === 2 && rest[0] === "--config") return lines(rest[1]!);
  if (cmd === "lanes" && rest.length === 2) return laneList(rest[0]!, rest[1]!);
  if (cmd === "lenses" && rest.length === 0) {
    for (const lens of lenses) writeOut(lens);
    return 0;
  }
  if (cmd === "--self-test" && args.length === 1) return selfTest();
  return usage();
}
function selfTest(): number {
  const tmp = makeTemp("postmaster-reviewers-");
  let failures = 0;
  const ok = (label: string) => writeOut(`  ok   ${label}`);
  const fail = (label: string, details = "") => {
    writeOut(`  FAIL ${label}`);
    if (details) for (const line of details.split("\n")) writeOut(`         ${line}`);
    failures++;
  };
  const expect = (label: string, code: number, output: string, args: string[]) => {
    const r = command(wrapper, args);
    if (r.code === code && r.stdout.trimEnd() === output) ok(label);
    else fail(`${label}: wanted exit ${code} and ${JSON.stringify(output)}, got exit ${r.code}`, r.stdout + r.stderr);
  };
  const common =
    '[lanes.luna]\nharness = "codex"\nmodel = "m1"\n[lanes.mimo]\nharness = "mimo"\nmodel = "m2"\n[lanes.sentinel]\nharness = "claude"\nmodel = "m3"';
  const config = (name: string, body: string) =>
    writeFileSync(join(tmp, `${name}.toml`), `${common}\n\n[team]\n${body}\n`);
  const waybill = (name: string, body: string) =>
    writeFileSync(
      join(tmp, `${name}.md`),
      "# Waybill: 7\n\n## Ticket\n\nsecurity reviewers: luna\nreviewers: sentinel\n\n## Team\nworkhorses: luna=codex/m1/, mimo=mimo/m2/\n" +
        body +
        "\ncoachman: muse/m4/\n\n## Dispatch\ndispatch: /tmp/x\n",
    );
  try {
    writeOut("positive controls");
    config(
      "one",
      'workhorses = ["luna", "mimo"]\nreviewers = ["luna", "mimo"]\n[team.lens_reviewers]\nsecurity = ["luna", "mimo", "sentinel"]',
    );
    expect(
      "the waybill lines name the reviewers, then each lens with its own lanes",
      0,
      "reviewers: luna, mimo\nsecurity reviewers: luna, mimo, sentinel",
      ["lines", "--config", join(tmp, "one.toml")],
    );
    waybill("one", "security reviewers: luna, mimo, sentinel\nreviewers: luna, mimo");
    expect("a lens with its own line gets exactly those lanes", 0, "luna\nmimo\nsentinel", [
      "lanes",
      join(tmp, "one.md"),
      "security",
    ]);
    expect("a lens without one gets the reviewer list", 0, "luna\nmimo", ["lanes", join(tmp, "one.md"), "bug"]);
    expect("and so does style", 0, "luna\nmimo", ["lanes", join(tmp, "one.md"), "style"]);
    config("two", 'workhorses = ["luna", "mimo"]\nreviewers = ["sentinel"]');
    expect("a config without the table gives the reviewers line alone, as before", 0, "reviewers: sentinel", [
      "lines",
      "--config",
      join(tmp, "two.toml"),
    ]);
    config("three", 'workhorses = ["luna", "mimo"]');
    expect("reviewers default to the workhorses", 0, "reviewers: luna, mimo", [
      "lines",
      "--config",
      join(tmp, "three.toml"),
    ]);
    expect("the lenses are the review stage's, in order", 0, "style\nbug\nsecurity", ["lenses"]);
    writeOut("negative controls");
    config("bad-lens", 'workhorses = ["luna", "mimo"]\n[team.lens_reviewers]\nsecruity = ["sentinel"]');
    const badLens = command(wrapper, ["lines", "--config", join(tmp, "bad-lens.toml")]);
    if (badLens.code === 2 && badLens.stderr.includes("secruity, which is not a lens"))
      ok("a lens the review stage does not have is refused and named");
    else fail("a lens the review stage does not have is refused and named", badLens.stderr);
    config("bad-lane", 'workhorses = ["luna", "mimo"]\n[team.lens_reviewers]\nsecurity = ["luna", "nobody"]');
    const badLane = command(wrapper, ["lines", "--config", join(tmp, "bad-lane.toml")]);
    if (badLane.code === 2 && badLane.stderr.includes("nobody, which is not a lane"))
      ok("a lane the config does not define is refused and named");
    else fail("a lane the config does not define is refused and named", badLane.stderr);
    config("empty", 'workhorses = ["luna", "mimo"]\n[team.lens_reviewers]\nsecurity = []');
    expect("a lens with no lanes is refused", 2, "", ["lines", "--config", join(tmp, "empty.toml")]);
    config("bad-default", 'workhorses = ["luna", "mimo"]\nreviewers = ["ghost"]');
    expect("a reviewer that is not a lane is refused", 2, "", ["lines", "--config", join(tmp, "bad-default.toml")]);
    expect("no config is refused", 1, "", ["lines", join(tmp, "none.toml")]);
    waybill("one", "security reviewers: luna, mimo, sentinel\nreviewers: luna, mimo");
    expect("a waybill lens that is not a lens is refused", 2, "", ["lanes", join(tmp, "one.md"), "secruity"]);
    waybill("no-team", "");
    expect("a Team section with no reviewers line is refused, never read as no reviewers", 2, "", [
      "lanes",
      join(tmp, "no-team.md"),
      "bug",
    ]);
    expect("reviewer lines in the ticket's text are not read", 2, "", ["lanes", join(tmp, "no-team.md"), "security"]);
    expect("no such waybill is refused", 1, "", ["lanes", join(tmp, "none.md"), "bug"]);
  } finally {
    removeTree(tmp);
  }
  writeOut("");
  writeOut(failures === 0 ? "self-test: all controls behaved" : `self-test: ${failures} control(s) misbehaved`);
  return failures === 0 ? 0 : 1;
}
process.exit(run(process.argv.slice(2)));
