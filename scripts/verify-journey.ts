import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { command, makeTemp, removeTree, scriptDir, writeError, writeOut } from "./lib/core.ts";

const wrapper = join(scriptDir(import.meta.url), "verify-journey.sh");
const tick = String.fromCharCode(96);
const fence = /^\s*(\x60{3,}|~{3,})/;
const item = /^\s*(?:\d{1,9}[.)]|[-*+])\s+(.*)$/;
const heading = /^##\s+(.*?)\s*#*\s*$/;
const formatText =
  "Walk the ticket's User journey in a browser, through the project's own browser library, at the\n" +
  "commit you are reporting on. Write the report to the path " +
  tick +
  "verify.sh journey-path" +
  tick +
  " prints for\n" +
  "that commit. For each step, in the ticket's order: a " +
  tick +
  "## " +
  tick +
  " heading holding the step as the\n" +
  "ticket words it; under it a line " +
  tick +
  "did" +
  tick +
  ", or " +
  tick +
  "did not: <what happened instead>" +
  tick +
  "; then a line\n" +
  tick +
  "screenshot: <path>" +
  tick +
  ", the path, relative to the report, of a screenshot of that step saved in the\n" +
  "report's directory or below it. Steps of your own may follow the ticket's.\n";
type Section = { title: string; body: string[] };
type Result = { code: number; output: string; error?: string };
function ticketLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+Ticket\s*$/.test(line));
  if (start < 0) return lines;
  const end = lines.findIndex((line, i) => i > start && /^##\s+Project profile\s*$/.test(line));
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/\.$/, "").trim().toLocaleLowerCase();
}
function steps(lines: string[]): string[] | null {
  const start = lines.findIndex((line) => /^##\s+User journey\s*$/i.test(line));
  if (start < 0) return null;
  const body: string[] = [];
  let open: string | null = null;
  for (const line of lines.slice(start + 1)) {
    if (!open && /^#{1,2}\s/.test(line)) break;
    const m = line.match(fence);
    if (m && !open) open = m[1]!;
    else if (m && open && m[1]![0] === open[0] && m[1]!.length >= open.length) open = null;
    else if (!open) body.push(line);
  }
  if (body.some((line) => item.test(line))) {
    const found: string[][] = [];
    let current: string[] | null = null;
    for (const line of body) {
      const m = line.match(item);
      if (m) {
        current = [m[1]!];
        found.push(current);
      } else if (line.trim() && current) current.push(line.trim());
    }
    return found.map((parts) => parts.join(" ").trim()).filter(Boolean);
  }
  const text = body
    .filter((line) => line.trim())
    .map((line) => line.trim())
    .join(" ");
  const masked = text.replace(/\x60[^\x60]*\x60/g, (match) => "x".repeat(match.length));
  const out: string[] = [];
  let last = 0;
  for (const match of masked.matchAll(/[.!?]["')\]]*(?=\s|$)/g)) {
    const end = match.index! + match[0].length;
    out.push(text.slice(last, end).trim());
    last = end;
  }
  if (text.slice(last).trim()) out.push(text.slice(last).trim());
  return out.filter(Boolean);
}
function reportPath(wt: string, givenDir: string): Result {
  const r = command("git", ["-C", wt, "rev-parse", "HEAD"]);
  if (r.code !== 0)
    return { code: 1, output: "", error: "verify-journey: " + wt + " is not a git worktree with a commit\n" };
  let dir = givenDir;
  if (!dir) {
    try {
      const specDir = process.env.POSTMASTER_VERIFY || join(wt, ".postmaster", "verify");
      const spec = JSON.parse(readFileSync(join(specDir, "spec.json"), "utf8"));
      dir = typeof spec.journey_dir === "string" ? spec.journey_dir : "";
    } catch {
      dir = "";
    }
  }
  return { code: 0, output: join(dir || join(wt, ".postmaster", "verify", "journey"), r.stdout.trim() + ".md") + "\n" };
}
function judge(wt: string, ticket: string, report: string): Result {
  const specDir = process.env.POSTMASTER_VERIFY || join(wt, ".postmaster", "verify");
  ticket ||= join(specDir, "ticket.md");
  if (!existsSync(ticket))
    return { code: 3, output: "not run: no ticket at " + ticket + "; scripts/verify.sh arm copies the run's there\n" };
  const wanted = steps(ticketLines(readFileSync(ticket, "utf8")));
  if (wanted === null) return { code: 3, output: "not run: the ticket has no User journey\n" };
  if (!wanted.length) return { code: 3, output: "not run: the ticket's User journey has no steps\n" };
  if (!report) {
    const path = reportPath(wt, "");
    if (path.code) return path;
    report = path.output.trim();
  }
  if (!existsSync(report))
    return {
      code: 3,
      output: "not run: no journey report at " + report + ": walk the journey in a browser and write it there\n",
    };
  const got = readFileSync(report, "utf8").split(/\r?\n/);
  const sections: Section[] = [];
  for (const line of got) {
    const match = line.match(heading);
    if (match) sections.push({ title: match[1]!, body: [] });
    else if (sections.length) sections.at(-1)!.body.push(line);
  }
  const didNot: string[] = [],
    missing: string[] = [];
  let at = 0;
  for (const [index, step] of wanted.entries()) {
    const found = sections.findIndex((s, i) => i >= at && normalize(s.title) === normalize(step));
    if (found < 0) {
      missing.push("step " + (index + 1) + " not walked: " + step);
      continue;
    }
    at = found + 1;
    const body = sections[found]!.body;
    let verdict: RegExpMatchArray | null = null;
    for (const line of body) {
      const m = line.match(/^\s*(did not|did)\b:?\s*(.*)$/i);
      if (m) {
        verdict = m;
        break;
      }
    }
    const screenshot = body.map((line) => line.match(/^\s*screenshot:\s*(.+?)\s*$/i)).find(Boolean)?.[1];
    if (!verdict) {
      missing.push("step " + (index + 1) + " has no verdict, did or did not: " + step);
      continue;
    }
    if (verdict[1]!.toLowerCase() === "did not") {
      didNot.push("step " + (index + 1) + " did not: " + step + (verdict[2] ? " (" + verdict[2] + ")" : ""));
      continue;
    }
    let image = screenshot ? (isAbsolute(screenshot) ? screenshot : join(dirname(report), screenshot)) : "";
    let beside = false;
    if (image) {
      try {
        const parent = realpathSync(dirname(report));
        image = realpathSync(resolve(image));
        beside = image.startsWith(parent + "/");
      } catch {
        beside = false;
      }
    }
    if (!beside || !existsSync(image) || !statSync(image).isFile() || statSync(image).size === 0)
      missing.push(
        "step " + (index + 1) + " has no screenshot beside the report" + (image ? " at " + image : "") + ": " + step,
      );
  }
  const lines = [...didNot, ...missing];
  if (didNot.length) lines.push(didNot.length + " of " + wanted.length + " steps did not do what the ticket says");
  if (missing.length)
    lines.push("not run: " + missing.length + " of " + wanted.length + " steps have no complete record in " + report);
  if (didNot.length) return { code: 1, output: lines.join("\n") + "\n" };
  if (missing.length) return { code: 3, output: lines.join("\n") + "\n" };
  return { code: 0, output: "all " + wanted.length + " steps walked, each did what the ticket says\n" };
}
function usage(): never {
  writeError(
    "usage: verify-journey.sh [<worktree>] [--ticket <file>] [--report <file>] | --path [<worktree>] [--dir <dir>] | --format | --self-test",
  );
  process.exit(1);
}
function run(args: string[]): number {
  if (args[0] === "--self-test") return args.length === 1 ? selfTest() : usage();
  if (args[0] === "--format") {
    if (args.length !== 1) return usage();
    process.stdout.write(formatText);
    return 0;
  }
  if (args[0] === "--path") {
    let wt = ".",
      dir = "";
    for (let i = 1; i < args.length; ) {
      if (args[i] === "--dir") {
        if (!args[i + 1]) return usage();
        dir = args[i + 1]!;
        i += 2;
      } else if (args[i]!.startsWith("-")) return usage();
      else {
        wt = args[i]!;
        i++;
      }
    }
    if (!existsSync(wt)) {
      writeError("verify-journey: no such directory: " + wt);
      return 1;
    }
    const path = reportPath(realpathSync(wt), dir);
    if (path.error) process.stderr.write(path.error);
    else process.stdout.write(path.output);
    return path.code;
  }
  let wt = ".",
    ticket = "",
    report = "";
  for (let i = 0; i < args.length; ) {
    if (args[i] === "--ticket" || args[i] === "--report") {
      if (!args[i + 1]) return usage();
      if (args[i] === "--ticket") ticket = args[i + 1]!;
      else report = args[i + 1]!;
      i += 2;
    } else if (args[i]!.startsWith("-")) return usage();
    else {
      wt = args[i]!;
      i++;
    }
  }
  if (!existsSync(wt)) {
    writeError("verify-journey: no such directory: " + wt);
    return 1;
  }
  const result = judge(realpathSync(wt), ticket, report);
  if (result.output) process.stdout.write(result.output);
  if (result.error) process.stderr.write(result.error);
  return result.code;
}
function selfTest(): number {
  const tmp = makeTemp("verify-journey-test-");
  const wt = join(tmp, "app"),
    shots = join(tmp, "shots");
  mkdirSync(wt, { recursive: true });
  mkdirSync(shots);
  let fails = 0;
  const ok = (label: string) => writeOut("  ok   " + label);
  const fail = (label: string, output = "") => {
    writeOut("  FAIL " + label);
    if (output) for (const line of output.split("\n")) writeOut("         " + line);
    fails++;
  };
  const report = (file: string, ...rows: string[]) => {
    const out: string[] = [];
    for (let i = 0; i < rows.length; i += 3)
      out.push("## " + rows[i]!, rows[i + 1]!, "screenshot: " + rows[i + 2]!, "");
    writeFileSync(file, out.join("\n"));
  };
  const expect = (label: string, code: number, ticket: string, reportFile: string, contains = "") => {
    const r = command(wrapper, [wt, "--ticket", ticket, ...(reportFile ? ["--report", reportFile] : [])]),
      output = r.stdout + r.stderr;
    if (r.code === code && (!contains || output.includes(contains))) ok(label);
    else fail(label + " (exit " + r.code + ")", output);
  };
  try {
    command("git", ["init", "-q", "-b", "main", wt]);
    command("git", [
      "-C",
      wt,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "first",
    ]);
    writeFileSync(join(shots, "1.png"), "png");
    writeFileSync(join(shots, "2.png"), "png");
    writeFileSync(join(shots, "empty.png"), "");
    const prose = join(tmp, "prose.md"),
      list = join(tmp, "list.md");
    const s1 =
      "On the board, the user taps " +
      tick +
      "Add task" +
      tick +
      " and types " +
      tick +
      "buy milk." +
      tick +
      " into the box.";
    const s2 = "They press Enter and see the task at the top of the list!";
    writeFileSync(
      prose,
      "# Waybill: T-1\n\n## Ticket\n## User journey\nOn the board, the user taps " +
        tick +
        "Add task" +
        tick +
        " and types " +
        tick +
        "buy milk." +
        tick +
        " into the box.\nThey press Enter and see the task at the top of the list!\n\n" +
        tick.repeat(3) +
        "\n$ fenced commands are not a step\n" +
        tick.repeat(3) +
        "\n\n## Project profile\nrepo: elsewhere\n",
    );
    writeFileSync(
      list,
      "## User journey\n1. The user opens the board.\n2. They tap Add task\n   and type a title.\n## Notes\nNot a step.\n",
    );
    const good = join(tmp, "good.md"),
      loose = join(tmp, "loose.md"),
      didnot = join(tmp, "didnot.md");
    report(good, s1, "did", "shots/1.png", s2, "did", "shots/2.png");
    report(
      loose,
      "on the board,  the user taps " +
        tick +
        "Add task" +
        tick +
        " and types " +
        tick +
        "buy milk." +
        tick +
        " into the box",
      "did",
      "shots/1.png",
      s2,
      "did",
      "shots/2.png",
      "A check of my own",
      "did not: it is only mine",
      "shots/1.png",
    );
    report(didnot, s1, "did", "shots/1.png", s2, "did not: the list stayed empty", "shots/2.png");
    const missing = join(tmp, "missing.md"),
      order = join(tmp, "order.md"),
      noshot = join(tmp, "noshot.md"),
      emptyshot = join(tmp, "emptyshot.md"),
      noverdict = join(tmp, "noverdict.md"),
      listgood = join(tmp, "listgood.md");
    report(missing, s1, "did", "shots/1.png");
    report(order, s2, "did", "shots/2.png", s1, "did", "shots/1.png");
    report(noshot, s1, "did", "shots/1.png", s2, "did", "shots/none.png");
    report(emptyshot, s1, "did", "shots/1.png", s2, "did", "shots/empty.png");
    report(noverdict, s1, "did", "shots/1.png", s2, "looked fine", "shots/2.png");
    report(
      listgood,
      "The user opens the board.",
      "did",
      "shots/1.png",
      "They tap Add task and type a title.",
      "did",
      "shots/2.png",
    );
    writeOut("positive controls");
    expect("a complete report passes", 0, prose, good, "all 2 steps walked");
    expect("case, spacing, a closing stop and steps of its own do not matter", 0, prose, loose, "all 2 steps walked");
    expect("a list's items are its steps, continuation lines included", 0, list, listgood, "all 2 steps walked");
    const p = command(wrapper, ["--path", wt, "--dir", join(tmp, "j")]).stdout.trim();
    const sha = command("git", ["-C", wt, "rev-parse", "HEAD"]).stdout.trim();
    if (p === join(tmp, "j", sha + ".md")) ok("the report's path names the commit");
    else fail("the report's path names the commit", p);
    const jdir = join(tmp, "j"),
      spec = join(tmp, "spec");
    mkdirSync(jdir);
    mkdirSync(spec);
    const defaultReport = join(jdir, sha + ".md");
    writeFileSync(defaultReport, readFileSync(good));
    writeFileSync(join(spec, "spec.json"), JSON.stringify({ journey_dir: jdir }));
    const autoArgs = [wt, "--ticket", prose];
    let r = command(wrapper, autoArgs, { env: { POSTMASTER_VERIFY: spec } });
    if (r.code === 3 && r.stdout.includes("no screenshot beside the report"))
      ok("the report for HEAD is found through the armed checks");
    else fail("the report for HEAD is found through the armed checks (exit " + r.code + ")", r.stdout + r.stderr);
    mkdirSync(join(jdir, "shots"));
    writeFileSync(join(jdir, "shots/1.png"), "png");
    writeFileSync(join(jdir, "shots/2.png"), "png");
    r = command(wrapper, autoArgs, { env: { POSTMASTER_VERIFY: spec } });
    if (r.code === 0) ok("and passes once its screenshots are beside it");
    else fail("and passes once its screenshots are beside it (exit " + r.code + ")", r.stdout + r.stderr);
    if (command(wrapper, ["--format"]).stdout.includes("did not: <what happened instead>"))
      ok("the format says how a step is marked");
    else fail("the format says how a step is marked");
    writeOut("negative controls");
    expect("a step marked did not fails, and says what happened", 1, prose, didnot, "the list stayed empty");
    expect("a step not in the report is not run", 3, prose, missing, "step 2 not walked");
    expect("steps out of order are not run", 3, prose, order, "not walked");
    expect("a missing screenshot is not run", 3, prose, noshot, "no screenshot beside the report");
    expect("an empty screenshot is not run", 3, prose, emptyshot, "no screenshot beside the report");
    const outside = join(tmp, "r");
    mkdirSync(outside);
    const escaped = join(outside, "outside.md");
    report(escaped, s1, "did", join(shots, "1.png"), s2, "did", "../shots/2.png");
    expect(
      "a screenshot outside the report's directory is not run",
      3,
      prose,
      escaped,
      "step 1 has no screenshot beside the report",
    );
    expect("a step with no verdict is not run", 3, prose, noverdict, "has no verdict");
    expect("no report is not run", 3, prose, join(tmp, "none.md"), "no journey report at");
    const noJourney = join(tmp, "nojourney.md"),
      emptyJourney = join(tmp, "emptyjourney.md");
    writeFileSync(noJourney, "## Problem / feature\nNo journey here.\n");
    writeFileSync(emptyJourney, "## User journey\n\n## Notes\nx\n");
    expect("a ticket with no User journey is not run", 3, noJourney, good, "has no User journey");
    expect("a User journey with no steps is not run", 3, emptyJourney, good, "has no steps");
    command("git", [
      "-C",
      wt,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "second",
    ]);
    r = command(wrapper, autoArgs, { env: { POSTMASTER_VERIFY: spec } });
    if (r.code === 3 && r.stdout.includes("no journey report at"))
      ok("a walk of an earlier commit does not count for a later one");
    else fail("a walk of an earlier commit does not count for a later one (exit " + r.code + ")", r.stdout + r.stderr);
  } finally {
    removeTree(tmp);
  }
  writeOut("");
  writeOut(fails ? "self-test: " + fails + " control(s) misbehaved" : "self-test: all controls behaved");
  return fails ? 1 : 0;
}
process.exit(run(process.argv.slice(2)));
