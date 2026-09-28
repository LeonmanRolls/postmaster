// The default check for a web app's User journey. A script cannot click through prose, so the walk
// is the agent's: it follows each step in a browser, through the project's own browser library,
// and writes a report. This script holds that report to the ticket: every step of the ticket's
// `## User journey`, in the ticket's order, marked did or did not, with a screenshot beside the
// report, in its directory or below it, so a walk leaves nothing in the worktree it walked.
//
//   verify-journey.sh [<worktree>] [--ticket <file>] [--report <file>]
//   verify-journey.sh --path [<worktree>] [--dir <dir>]   where the report for <worktree>'s HEAD goes
//   verify-journey.sh --format                            the report's format, for a brief
//   verify-journey.sh --self-test
//
//   exit 0  every step is in the report, in order, marked did, with its screenshot beside it
//   exit 1  a step is marked did not
//   exit 3  not run: no User journey, no report for this commit, or a step not walked, with no
//           verdict or with no screenshot; each is named, and the reason is the last line
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { tryJsonFile } from "./lib/data.ts";
import { die, run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

const FENCE = /^\s*(`{3,}|~{3,})/;
const ITEM = /^\s*(?:\d{1,9}[.)]|[-*+])\s+(.*)$/;
const HEADING = /^##\s+(.*?)\s*#*\s*$/;

function notRun(msg: string): never {
  console.log(`not run: ${msg}`);
  process.exit(3);
  throw new Error("unreachable");
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().replace(/\.+$/, "").trim().toLowerCase();
}

function ticketLines(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^##\s+Ticket\s*$/.test(l));
  if (start === -1) return lines;
  const end = lines.findIndex((l, i) => i > start && /^##\s+Project profile\s*$/.test(l));
  return lines.slice(start + 1, end === -1 ? lines.length : end);
}

function steps(lines: string[]): string[] | null {
  const start = lines.findIndex((l) => /^##\s+User journey\s*$/i.test(l));
  if (start === -1) return null;
  const body: string[] = [];
  let fence: string | null = null;
  for (const l of lines.slice(start + 1)) {
    if (fence === null && /^#{1,2}\s/.test(l)) break;
    const m = FENCE.exec(l);
    if (m && fence === null) {
      fence = m[1] ?? "";
    } else if (
      m &&
      fence !== null &&
      (m[1] ?? "")[0] === fence[0] &&
      (m[1] ?? "").length >= fence.length
    ) {
      fence = null;
    } else if (fence === null) {
      body.push(l);
    }
  }
  if (body.some((l) => ITEM.test(l))) {
    const items: string[][] = [];
    let cur: string[] | null = null;
    for (const l of body) {
      const m = ITEM.exec(l);
      if (m) {
        cur = [m[1] ?? ""];
        items.push(cur);
      } else if (l.trim() && cur !== null) {
        cur.push(l.trim());
      }
    }
    return items.map((i) => i.join(" ").trim()).filter((s) => s !== "");
  }
  const text = body
    .filter((l) => l.trim())
    .map((l) => l.trim())
    .join(" ");
  const masked = text.replace(/`[^`]*`/g, (m) => "x".repeat(m.length));
  const out: string[] = [];
  let last = 0;
  for (const m of masked.matchAll(/[.!?]["')\]]*(?=\s|$)/g)) {
    out.push(text.slice(last, m.index! + m[0].length).trim());
    last = m.index! + m[0].length;
  }
  if (text.slice(last).trim()) out.push(text.slice(last).trim());
  return out.filter((s) => s !== "");
}

function format(): void {
  console.log(`Walk the ticket's User journey in a browser, through the project's own browser library, at the
commit you are reporting on. Write the report to the path \`verify.sh journey-path\` prints for
that commit. For each step, in the ticket's order: a \`## \` heading holding the step as the
ticket words it; under it a line \`did\`, or \`did not: <what happened instead>\`; then a line
\`screenshot: <path>\`, the path, relative to the report, of a screenshot of that step saved in the
report's directory or below it. Steps of your own may follow the ticket's.`);
}

function journey(mode: "path" | "judge", wtArg: string, ...rest: string[]): number {
  const wt = resolve(wtArg);

  function specDir(): string {
    return process.env.POSTMASTER_VERIFY || join(wt, ".postmaster", "verify");
  }

  function reportPath(givenDir: string | null): string {
    const r = run("git", ["-C", wt, "rev-parse", "HEAD"]);
    if (r.code !== 0) {
      console.error(`verify-journey: ${wt} is not a git worktree with a commit`);
      process.exit(1);
    }
    let d: string | null = givenDir;
    if (!d) {
      try {
        const j = tryJsonFile<Record<string, unknown>>(join(specDir(), "spec.json"));
        d = (j?.journey_dir as string) ?? null;
      } catch {
        d = null;
      }
    }
    return join(d || join(wt, ".postmaster", "verify", "journey"), `${r.out.trim()}.md`);
  }

  if (mode === "path") {
    console.log(reportPath(rest[0] || null));
    return 0;
  }

  const ticketArg = rest[0] ?? "";
  const reportArg = rest[1] ?? "";
  const ticket = ticketArg || join(specDir(), "ticket.md");
  let text: string;
  try {
    text = readFileSync(ticket, "utf8");
  } catch {
    notRun(`no ticket at ${ticket}; scripts/verify.sh arm copies the run's there`);
  }
  const want = steps(ticketLines(text!));
  if (want === null) notRun("the ticket has no User journey");
  if (want?.length === 0) notRun("the ticket's User journey has no steps");
  const report = reportArg ? reportArg : reportPath(null);
  let got: string[];
  try {
    got = readFileSync(report, "utf8").split("\n");
  } catch {
    notRun(`no journey report at ${report}: walk the journey in a browser and write it there`);
  }

  const sections: Array<[string, string[]]> = [];
  for (const l of got!) {
    const m = HEADING.exec(l);
    if (m) {
      sections.push([m[1] ?? "", []]);
    } else if (sections.length > 0) {
      sections[sections.length - 1]?.[1].push(l);
    }
  }

  const didNot: string[] = [];
  const missing: string[] = [];
  let at = 0;
  for (let n = 0; n < want?.length; n++) {
    const step = want?.[n] ?? "";
    const k = sections.findIndex((s, i) => i >= at && norm(s[0]) === norm(step));
    if (k === -1) {
      missing.push(`step ${n + 1} not walked: ${step}`);
      continue;
    }
    at = k + 1;
    const body = sections[k]?.[1];
    const verdictLine = body.find((l) => /^\s*(did not|did)\b/i.test(l));
    const verdict = verdictLine ? /^\s*(did not|did)\b:?\s*(.*)$/i.exec(verdictLine) : null;
    const shotLine = body.find((l) => /^\s*screenshot:\s*\S/i.test(l));
    const shot = shotLine ? /^\s*screenshot:\s*(.+?)\s*$/i.exec(shotLine)?.[1] : null;
    if (!verdict) {
      missing.push(`step ${n + 1} has no verdict, did or did not: ${step}`);
      continue;
    }
    if ((verdict[1] ?? "").toLowerCase() === "did not") {
      didNot.push(`step ${n + 1} did not: ${step}${verdict[2] ? ` (${verdict[2]})` : ""}`);
      continue;
    }
    let path: string | null = shot ? shot : null;
    if (path !== null && !isAbsolute(path)) {
      path = join(dirname(report), path);
    }
    let beside = false;
    if (path !== null) {
      try {
        beside = realpathSync(path).startsWith(realpathSync(dirname(report)) + sep);
      } catch {
        beside = false;
      }
    }
    if (!beside || !path || !existsSync(path) || statSync(path).size === 0) {
      missing.push(
        `step ${n + 1} has no screenshot beside the report${path ? ` at ${path}` : ""}: ${step}`,
      );
    }
  }

  for (const line of [...didNot, ...missing]) console.log(line);
  if (didNot.length > 0) {
    console.log(`${didNot.length} of ${want?.length} steps did not do what the ticket says`);
    return 1;
  }
  if (missing.length > 0) {
    console.log(
      `not run: ${missing.length} of ${want?.length} steps have no complete record in ${report}`,
    );
    return 3;
  }
  console.log(`all ${want?.length} steps walked, each did what the ticket says`);
  return 0;
}

// --- entry -----------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv[0] === "--self-test") {
  // fall through
} else if (argv[0] === "--format") {
  if (argv.length !== 1)
    die(
      "usage: verify-journey.sh [<worktree>] [--ticket <file>] [--report <file>] | --path [<worktree>] [--dir <dir>] | --format | --self-test",
      1,
    );
  format();
  process.exit(0);
} else if (argv[0] === "--path") {
  let WT = ".";
  let DIR = "";
  const rest = argv.slice(1);
  let i = 0;
  while (i < rest.length) {
    if (rest[i] === "--dir") {
      if (rest.length < i + 2)
        die(
          "usage: verify-journey.sh [<worktree>] [--ticket <file>] [--report <file>] | --path [<worktree>] [--dir <dir>] | --format | --self-test",
          1,
        );
      DIR = rest[i + 1] ?? "";
      i += 2;
    } else if (rest[i]?.startsWith("-")) {
      die(
        "usage: verify-journey.sh [<worktree>] [--ticket <file>] [--report <file>] | --path [<worktree>] [--dir <dir>] | --format | --self-test",
        1,
      );
    } else {
      WT = rest[i] ?? ".";
      i += 1;
    }
  }
  process.exit(journey("path", WT, DIR));
} else {
  let WT = ".";
  let TICKET = "";
  let REPORT = "";
  let i = 0;
  while (i < argv.length) {
    if (argv[i] === "--ticket") {
      if (argv.length < i + 2)
        die(
          "usage: verify-journey.sh [<worktree>] [--ticket <file>] [--report <file>] | --path [<worktree>] [--dir <dir>] | --format | --self-test",
          1,
        );
      TICKET = argv[i + 1] ?? "";
      i += 2;
    } else if (argv[i] === "--report") {
      if (argv.length < i + 2)
        die(
          "usage: verify-journey.sh [<worktree>] [--ticket <file>] [--report <file>] | --path [<worktree>] [--dir <dir>] | --format | --self-test",
          1,
        );
      REPORT = argv[i + 1] ?? "";
      i += 2;
    } else if (argv[i]?.startsWith("-")) {
      die(
        "usage: verify-journey.sh [<worktree>] [--ticket <file>] [--report <file>] | --path [<worktree>] [--dir <dir>] | --format | --self-test",
        1,
      );
    } else {
      WT = argv[i] ?? ".";
      i += 1;
    }
  }
  if (!existsSync(WT)) {
    console.error(`verify-journey: no such directory: ${WT}`);
    process.exit(1);
  }
  process.exit(journey("judge", WT, TICKET, REPORT));
}

// --- self-test ---------------------------------------------------------------------------------
withTempDir((tmp) => {
  const SELF = join(dirname(new URL(import.meta.url).pathname), "verify-journey.sh");
  const st = new SelfTest();

  function expect(
    label: string,
    exit: number,
    ticket: string,
    report: string,
    wantIn?: string,
  ): void {
    const args = [SELF, wt, "--ticket", ticket];
    if (report) args.push("--report", report);
    const r = run("bash", args);
    const out = r.out + r.err;
    if (r.code === exit && (wantIn === undefined || wantIn === "" || out.includes(wantIn))) {
      st.ok(label);
    } else {
      st.fail(`${label} (exit ${r.code})`, out);
    }
  }

  const wt = join(tmp, "app");
  mkdirSync(wt, { recursive: true });
  run("git", ["-C", wt, "init", "-q", "-b", "main"]);
  run("git", [
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

  const shots = join(tmp, "shots");
  mkdirSync(shots, { recursive: true });
  writeFileSync(join(shots, "1.png"), "png", "utf8");
  writeFileSync(join(shots, "2.png"), "png", "utf8");
  writeFileSync(join(shots, "empty.png"), "", "utf8");

  const prose = `# Waybill: T-1

## Ticket
## User journey
On the board, the user taps \`Add task\` and types \`buy milk.\` into the box.
They press Enter and see the task at the top of the list!

\`\`\`
$ this fenced block is not a step.
\`\`\`

## Project profile
repo: /somewhere
`;
  const list = `## User journey
1. The user opens the board.
2. They tap \`Add task\`
   and type a title.
## Notes
Not a step.
`;
  writeFileSync(join(tmp, "prose.md"), prose, "utf8");
  writeFileSync(join(tmp, "list.md"), list, "utf8");

  function report(f: string, ...groups: string[]): void {
    writeFileSync(f, "", "utf8");
    for (let i = 0; i + 2 < groups.length + 1; i += 3) {
      const h = groups[i] ?? "";
      const v = groups[i + 1] ?? "";
      const s = groups[i + 2] ?? "";
      if (!h) break;
      writeFileSync(f, `## ${h}\n${v}\nscreenshot: ${s}\n\n`, { encoding: "utf8", flag: "a" });
    }
  }

  const S1 = "On the board, the user taps `Add task` and types `buy milk.` into the box.";
  const S2 = "They press Enter and see the task at the top of the list!";
  report(join(tmp, "good.md"), S1, "did", "shots/1.png", S2, "did", "shots/2.png");
  report(
    join(tmp, "loose.md"),
    "on the board,  the user taps `Add task` and types `buy milk.` into the box",
    "did",
    "shots/1.png",
    S2,
    "did",
    "shots/2.png",
    "A check of my own",
    "did not: it is only mine",
    "shots/1.png",
  );
  report(
    join(tmp, "didnot.md"),
    S1,
    "did",
    "shots/1.png",
    S2,
    "did not: the list stayed empty",
    "shots/2.png",
  );
  report(join(tmp, "missing.md"), S1, "did", "shots/1.png");
  report(join(tmp, "order.md"), S2, "did", "shots/2.png", S1, "did", "shots/1.png");
  report(join(tmp, "noshot.md"), S1, "did", "shots/1.png", S2, "did", "shots/none.png");
  report(join(tmp, "emptyshot.md"), S1, "did", "shots/1.png", S2, "did", "shots/empty.png");
  report(join(tmp, "noverdict.md"), S1, "did", "shots/1.png", S2, "looked fine", "shots/2.png");
  report(
    join(tmp, "listgood.md"),
    "The user opens the board.",
    "did",
    "shots/1.png",
    "They tap `Add task` and type a title.",
    "did",
    "shots/2.png",
  );

  console.log("positive controls");
  expect(
    "a complete report passes",
    0,
    join(tmp, "prose.md"),
    join(tmp, "good.md"),
    "all 2 steps walked",
  );
  expect(
    "case, spacing, a closing stop and steps of its own do not matter",
    0,
    join(tmp, "prose.md"),
    join(tmp, "loose.md"),
    "all 2 steps walked",
  );
  expect(
    "a list's items are its steps, continuation lines included",
    0,
    join(tmp, "list.md"),
    join(tmp, "listgood.md"),
    "all 2 steps walked",
  );
  {
    const r = run("bash", [SELF, "--path", wt, "--dir", join(tmp, "j")]);
    const head = run("git", ["-C", wt, "rev-parse", "HEAD"]);
    const expected = join(tmp, "j", `${head.out.trim()}.md`);
    st.check("the report's path names the commit", r.out.trim() === expected, r.out);
  }
  // good.md gives its screenshots relative to the report
  const jDir = join(tmp, "j");
  const specDir = join(tmp, "spec");
  mkdirSync(jDir, { recursive: true });
  mkdirSync(specDir, { recursive: true });
  {
    const r = run("bash", [SELF, "--path", wt, "--dir", jDir]);
    const p = r.out.trim();
    cpSync(join(tmp, "good.md"), p);
    writeFileSync(join(specDir, "spec.json"), `${JSON.stringify({ journey_dir: jDir })}\n`, "utf8");
    const r2 = run("bash", [
      "-c",
      `cd "${wt}" && POSTMASTER_VERIFY="${specDir}" "${SELF}" --ticket "${join(tmp, "prose.md")}"`,
    ]);
    const out = r2.out + r2.err;
    st.check(
      "the report for HEAD is found through the armed checks",
      r2.code === 3 && out.includes("no screenshot beside the report"),
      out,
    );
    mkdirSync(join(jDir, "shots"), { recursive: true });
    cpSync(join(shots, "1.png"), join(jDir, "shots", "1.png"));
    cpSync(join(shots, "2.png"), join(jDir, "shots", "2.png"));
    const r3 = run("bash", [
      "-c",
      `cd "${wt}" && POSTMASTER_VERIFY="${specDir}" "${SELF}" --ticket "${join(tmp, "prose.md")}"`,
    ]);
    st.check("and passes once its screenshots are beside it", r3.code === 0, r3.out + r3.err);
  }
  {
    const r = run("bash", [SELF, "--format"]);
    st.check(
      "the format says how a step is marked",
      r.out.includes("did not: <what happened instead>"),
    );
  }

  console.log("negative controls");
  expect(
    "a step marked did not fails, and says what happened",
    1,
    join(tmp, "prose.md"),
    join(tmp, "didnot.md"),
    "the list stayed empty",
  );
  expect(
    "a step not in the report is not run",
    3,
    join(tmp, "prose.md"),
    join(tmp, "missing.md"),
    "step 2 not walked",
  );
  expect(
    "steps out of order are not run",
    3,
    join(tmp, "prose.md"),
    join(tmp, "order.md"),
    "not walked",
  );
  expect(
    "a missing screenshot is not run",
    3,
    join(tmp, "prose.md"),
    join(tmp, "noshot.md"),
    "no screenshot beside the report",
  );
  expect(
    "an empty screenshot is not run",
    3,
    join(tmp, "prose.md"),
    join(tmp, "emptyshot.md"),
    "no screenshot beside the report",
  );
  mkdirSync(join(tmp, "r"), { recursive: true });
  report(
    join(tmp, "r", "outside.md"),
    S1,
    "did",
    join(shots, "1.png"),
    S2,
    "did",
    "../shots/2.png",
  );
  expect(
    "a screenshot outside the report's directory is not run",
    3,
    join(tmp, "prose.md"),
    join(tmp, "r", "outside.md"),
    "step 1 has no screenshot beside the report",
  );
  expect(
    "a step with no verdict is not run",
    3,
    join(tmp, "prose.md"),
    join(tmp, "noverdict.md"),
    "has no verdict",
  );
  expect(
    "no report is not run",
    3,
    join(tmp, "prose.md"),
    join(tmp, "none.md"),
    "no journey report at",
  );
  writeFileSync(join(tmp, "nojourney.md"), "## Problem / feature\nNo journey here.\n", "utf8");
  expect(
    "a ticket with no User journey is not run",
    3,
    join(tmp, "nojourney.md"),
    join(tmp, "good.md"),
    "has no User journey",
  );
  writeFileSync(join(tmp, "emptyjourney.md"), "## User journey\n\n## Notes\nx\n", "utf8");
  expect(
    "a User journey with no steps is not run",
    3,
    join(tmp, "emptyjourney.md"),
    join(tmp, "good.md"),
    "has no steps",
  );
  run("git", [
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
  {
    const r = run("bash", [
      "-c",
      `cd "${wt}" && POSTMASTER_VERIFY="${specDir}" "${SELF}" --ticket "${join(tmp, "prose.md")}"`,
    ]);
    const out = r.out + r.err;
    st.check(
      "a walk of an earlier commit does not count for a later one",
      r.code === 3 && out.includes("no journey report at"),
      out,
    );
  }

  st.finish();
});
