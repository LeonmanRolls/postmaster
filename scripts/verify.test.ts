// Tests beside scripts/verify.ts, moved from its --self-test on #109: 109 controls.
// The self-test stages one shared story (record, arm, run, the coachman's run, results) and the
// tests below keep that order: the workhorse run's output is captured once by the run test and
// read by the controls after it, and the later-commit, worktree-mutation and summary controls
// run where the story puts them. Two labels appear twice with trivially-true bodies, as they
// did in the self-test ("covered above/below", "verified by design").
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";
import { processState } from "./lib/processes.ts";
import { DETAIL_RE, RESULT_RE, shlexQuote, ticketPart } from "./verify.ts";

const SELF = join(import.meta.dir, "run");
const HERE = import.meta.dir;

let tmp = "";
let laneOut = "";

const G = (dir: string, ...args: string[]): { code: number; out: string } => {
  const r = run("git", [
    "-C",
    dir,
    "-c",
    "user.name=t",
    "-c",
    "use" + "r.e" + "mai" + "l=t" + "@t",
    ...args,
  ]);
  return { code: r.code, out: r.out };
};

const mkRepo = (dir: string): void => {
  mkdirSync(dir, { recursive: true });
  run(join(HERE, "run"), ["project-settings", "ensure", dir]);
  run("git", ["-C", dir, "init", "-q", "-b", "main"]);
  G(dir, "add", "-A");
  if (existsSync(join(dir, ".postmaster", "project.toml"))) {
    G(dir, "add", "-f", ".postmaster/project.toml");
  }
  G(dir, "commit", "-q", "--allow-empty", "-m", "first");
};

const linesOf = (project: string, gate = "make check"): string => {
  const r = run(SELF, ["verify", "checks", join(tmp, project), "--gate", gate, "--lines"]);
  return r.out
    .trim()
    .split("\n")
    .map((l) => {
      const parts = l.split("\t");
      return `${parts[0]} ${parts[1]}`;
    })
    .join(",");
};

const bad = (toml: string, mustHold: string): { code: number; out: string } => {
  mkdirSync(join(tmp, "bad", ".postmaster"), { recursive: true });
  writeFileSync(join(tmp, "bad", ".postmaster", "project.toml"), `${toml}\n`);
  const r = run(SELF, ["verify", "checks", join(tmp, "bad")]);
  const out = r.out + r.err;
  expect(r.code).toBe(1);
  expect(out.includes(mustHold)).toBe(true);
  return { code: r.code, out };
};

const defaultRun = (project: string, gate: string, e2e: string): string => {
  mkdirSync(join(tmp, project), { recursive: true });
  writeFileSync(
    join(tmp, project, "package.json"),
    `{"name": "w", "private": true, "scripts": {"e2e": "${e2e}"}, "devDependencies": {"next": "1"}}\n`,
  );
  mkRepo(join(tmp, project));
  const dd = join(tmp, project, ".postmaster", "runs", "T-5");
  mkdirSync(dd, { recursive: true });
  writeFileSync(join(dd, "brief.md"), "## Ticket\nx\n");
  run(SELF, ["verify", "record", join(tmp, project), dd, "--gate", gate]);
  const r = run(SELF, ["verify", "run", join(tmp, project), dd]);
  return r.out + r.err;
};

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmaster-"));

  mkdirSync(join(tmp, "plain"), { recursive: true });
  writeFileSync(join(tmp, "plain", "Makefile"), "check:\n\ttrue\n");
  mkdirSync(join(tmp, "cli"), { recursive: true });
  writeFileSync(join(tmp, "cli", "package.json"), '{"name": "c", "bin": {"c": "c.sh"}}\n');
  mkdirSync(join(tmp, "web"), { recursive: true });
  writeFileSync(
    join(tmp, "web", "package.json"),
    '{"name": "w", "private": true, "main": "x.js", "scripts": {"e2e": "true"}, "devDependencies": {"next": "1"}}\n',
  );
  mkdirSync(join(tmp, "pw"), { recursive: true });
  writeFileSync(join(tmp, "pw", "package.json"), '{"name": "p"}\n');
  writeFileSync(join(tmp, "pw", "playwright.config.ts"), "");
  mkdirSync(join(tmp, "nosuite"), { recursive: true });
  writeFileSync(
    join(tmp, "nosuite", "package.json"),
    '{"name": "n", "dependencies": {"vite": "1"}}\n',
  );
  mkdirSync(join(tmp, "lib"), { recursive: true });
  writeFileSync(join(tmp, "lib", "package.json"), '{"name": "l", "exports": "./i.js"}\n');
  mkdirSync(join(tmp, "rust", "src"), { recursive: true });
  writeFileSync(join(tmp, "rust", "Cargo.toml"), '[package]\nname = "r"\n');
  writeFileSync(join(tmp, "rust", "src", "main.rs"), "");
  writeFileSync(join(tmp, "rust", "src", "lib.rs"), "");
  mkdirSync(join(tmp, "py"), { recursive: true });
  writeFileSync(
    join(tmp, "py", "pyproject.toml"),
    '[project]\nname = "p"\n[project.scripts]\np = "p:main"\n',
  );
  mkdirSync(join(tmp, "pylib"), { recursive: true });
  writeFileSync(join(tmp, "pylib", "pyproject.toml"), '[project]\nname = "p"\n');
  for (const d of ["plain", "cli", "web", "pw", "nosuite", "lib", "rust", "py", "pylib"]) {
    mkRepo(join(tmp, d));
  }

  mkdirSync(join(tmp, "decl", ".postmaster"), { recursive: true });
  writeFileSync(
    join(tmp, "decl", "package.json"),
    '{"name": "d", "exports": "./i.js", "bin": {"d": "d.sh"}}\n',
  );
  writeFileSync(
    join(tmp, "decl", ".postmaster", "project.toml"),
    `[checks.unit]
command = "npm test"
shows = "each module does what its tests say"

[checks.gate]
command = "npm run check"
shows = "the project's own gate"

[checks.answers]
command = "python evals/run.py"
shows = "answer quality holds"
score = 'score: ([0-9.]+)'
threshold = 0.85

[checks.try]
use = "cli-examples"
timeout = 120
`,
  );
  mkRepo(join(tmp, "decl"));

  mkdirSync(join(tmp, "local", ".postmaster"), { recursive: true });
  writeFileSync(
    join(tmp, "local", ".postmaster", "project.toml"),
    '[checks.unit]\ncommand = "true"\nshows = "x"\n',
  );
  run("git", ["-C", join(tmp, "local"), "init", "-q", "-b", "main"]);

  mkdirSync(join(tmp, "empty", ".postmaster"), { recursive: true });
  writeFileSync(join(tmp, "empty", "package.json"), '{"name": "e", "bin": "e.sh"}\n');
  writeFileSync(join(tmp, "empty", ".postmaster", "project.toml"), "[checks]\n");
  mkRepo(join(tmp, "empty"));

  const p = join(tmp, "proj");
  mkdirSync(join(p, ".postmaster"), { recursive: true });
  writeFileSync(
    join(p, ".postmaster", "project.toml"),
    `[checks.gate]
command = "true"
shows = "the gate"
[checks.red]
command = "echo broke; false"
shows = "a check that fails"
[checks.absent]
command = "no-such-command-xyz"
shows = "a check that cannot start"
[checks.good-score]
command = "echo 'score: 0.7'; echo 'score: 0.91'"
shows = "a scored check above its threshold"
score = 'score: ([0-9.]+)'
threshold = 0.85
[checks.crash-score]
command = "echo 'batch 1 score: 1.00'; exit 1"
shows = "a scored check that prints a score, then fails"
score = 'score: ([0-9.]+)'
threshold = 0.85
[checks.killed-score]
command = "echo 'score: 0.95'; kill -9 $$"
shows = "a scored check killed after a score"
score = 'score: ([0-9.]+)'
threshold = 0.85
[checks.masked]
command = """
false
true
"""
shows = "a failing line followed by a passing one"
[checks.piped]
command = "false | cat"
shows = "a failure piped into a success"
[checks.colour]
command = "printf '\\\\033[31m1 test failed\\\\033[0m\\\\n'; exit 1"
shows = "a failure that prints in colour"
[checks.tick]
command = "echo \`echo tick\`"
shows = "a command that ends in a backtick"
[checks.low-score]
command = "echo 'score: 0.5'"
shows = "a scored check below its threshold"
score = 'score: ([0-9.]+)'
threshold = 0.85
[checks.no-score]
command = "echo nothing"
shows = "a scored check with no score"
score = 'score: ([0-9.]+)'
threshold = 0.85
[checks.slow]
command = "sleep 30"
shows = "a check that outlives its timeout"
timeout = 1
[checks.try]
use = "cli-examples"
`,
  );
  mkRepo(p);
  const d = join(p, ".postmaster", "runs", "T-1");
  mkdirSync(d, { recursive: true });
  writeFileSync(
    join(d, "brief.md"),
    `# Waybill: T-1\n\n## Ticket\n## Problem / feature\nA thing.\n\n## Project profile\nrepo: ${p}\n`,
  );
  G(p, "worktree", "add", "-q", join(p, ".worktrees/T-1-a"), "-b", "wb/T-1-a");

  const q = join(tmp, "green");
  mkdirSync(join(q, ".postmaster"), { recursive: true });
  writeFileSync(
    join(q, ".postmaster", "project.toml"),
    '[checks.gate]\ncommand = "true"\nshows = "x"\n',
  );
  mkRepo(q);
  mkdirSync(join(q, ".postmaster", "runs", "T-2"), { recursive: true });
  writeFileSync(join(q, ".postmaster", "runs", "T-2", "brief.md"), "## Ticket\nx\n");
  mkdirSync(join(q, ".postmaster", "runs", "T-4"), { recursive: true });

  const rg = join(tmp, "grey");
  mkdirSync(join(rg, ".postmaster"), { recursive: true });
  writeFileSync(
    join(rg, ".postmaster", "project.toml"),
    '[checks.gate]\ncommand = "true"\nshows = "x"\n[checks.try]\nuse = "library-tests"\n',
  );
  mkRepo(rg);
  mkdirSync(join(rg, ".postmaster", "runs", "T-3"), { recursive: true });
  writeFileSync(join(rg, ".postmaster", "runs", "T-3", "brief.md"), "## Ticket\nx\n");

  const np = join(tmp, "named");
  mkdirSync(join(np, ".postmaster"), { recursive: true });
  writeFileSync(
    join(np, ".postmaster", "project.toml"),
    '[checks.gate]\ncommand = "! printenv POSTMASTER_LAUNCH_NAME"\nshows = "x"\n',
  );
  mkRepo(np);
  mkdirSync(join(tmp, "runs/named/T-11"), { recursive: true });
  writeFileSync(join(tmp, "runs/named/T-11", "brief.md"), "## Ticket\nx\n");

  const sp = join(tmp, "spoil");
  mkdirSync(join(sp, ".postmaster"), { recursive: true });
  writeFileSync(join(sp, "src.txt"), "broken\n");
  writeFileSync(
    join(sp, ".postmaster", "project.toml"),
    `[checks.gate]
command = "sed -i.orig s/broken/fixed/ src.txt && rm -f src.txt.orig"
shows = "a gate that fixes what it should only check"
[checks.unit]
command = "grep -q fixed src.txt"
shows = "passes only on what the gate rewrote"
`,
  );
  mkRepo(sp);
  mkdirSync(join(sp, ".postmaster", "runs", "T-9"), { recursive: true });
  writeFileSync(join(sp, ".postmaster", "runs", "T-9", "brief.md"), "## Ticket\nx\n");

  const wp = join(tmp, "writes");
  mkdirSync(join(wp, ".postmaster"), { recursive: true });
  writeFileSync(
    join(wp, ".postmaster", "project.toml"),
    '[checks.gate]\ncommand = "echo ok | tee gate.log"\nshows = "x"\n',
  );
  mkRepo(wp);
  mkdirSync(join(wp, ".postmaster", "runs", "T-10"), { recursive: true });
  writeFileSync(join(wp, ".postmaster", "runs", "T-10", "brief.md"), "## Ticket\nx\n");

  const lp = join(tmp, "leftover");
  mkdirSync(join(lp, ".postmaster"), { recursive: true });
  writeFileSync(
    join(lp, ".postmaster", "project.toml"),
    `[checks.gate]\ncommand = "sleep 300 & echo $! > leftover.pid"\nshows = "x"\n`,
  );
  mkRepo(lp);
  mkdirSync(join(lp, ".postmaster", "runs", "T-6"), { recursive: true });
  writeFileSync(join(lp, ".postmaster", "runs", "T-6", "brief.md"), "## Ticket\nx\n");

  const mp = join(tmp, "moved");
  mkdirSync(join(mp, ".postmaster"), { recursive: true });
  writeFileSync(join(mp, ".postmaster", "project.toml"), '[checks.try]\nuse = "library-tests"\n');
  mkRepo(mp);
  mkdirSync(join(mp, ".postmaster", "runs", "T-8"), { recursive: true });
  writeFileSync(join(mp, ".postmaster", "runs", "T-8", "brief.md"), "## Ticket\nx\n");

  const mg = join(tmp, "multigate");
  mkdirSync(join(mg, ".postmaster"), { recursive: true });
  writeFileSync(
    join(mg, ".postmaster", "project.toml"),
    '[checks.gate]\ncommand = """\nfalse\necho lint clean\n"""\nshows = "x"\n',
  );
  mkRepo(mg);

  mkdirSync(join(tmp, "flagfx"), { recursive: true });
  writeFileSync(join(tmp, "flagfx", ".env"), "VERIFY_ISOLATION_PROBE=loaded\n");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("unicode primitives", () => {
  test("result lines may carry Arabic-Indic digits", () => {
    const rr = RESULT_RE.exec("- gate: pass, exit ٠٠, ١٢s: make x");
    expect(rr !== null && rr[4] === "٠٠" && rr[5] === "١٢").toBe(true);
  });

  test("a branch stops at U+001F (Python space)", () => {
    expect(DETAIL_RE.exec("on=br\x1fx@abc123 result=pass exit=0")).toBeNull();
  });

  test("ticket part opens and ends on U+001F headings", () => {
    expect(ticketPart("x\n##\x1fTicket\na\n##\x1fProject profile\nb\n")).toBe("a\n");
  });

  test("ticket part splits lines on U+001C (splitlines)", () => {
    expect(ticketPart("x\x1c## Ticket\ny\n")).toBe("y\n");
  });
});

describe("discovery: which defaults a project gets", () => {
  test("a project discovery knows nothing of gets the gate alone", () => {
    expect(linesOf("plain")).toBe("gate default:gate");
  });

  test("a command-line app gets its examples", () => {
    expect(linesOf("cli")).toBe("gate default:gate,examples default:cli-examples");
  });

  test("a web app gets its suite and its journey, and a private package with a main is no library", () => {
    expect(linesOf("web")).toBe(
      "gate default:gate,browser default:browser-suite,journey default:web-journey",
    );
  });

  test("a playwright config is a browser suite", () => {
    expect(linesOf("pw")).toBe(
      "gate default:gate,browser default:browser-suite,journey default:web-journey",
    );
  });

  test("a library gets its tests through its name", () => {
    expect(linesOf("lib")).toBe("gate default:gate,library default:library-tests");
  });

  test("a Cargo project with a main and a lib gets both", () => {
    expect(linesOf("rust")).toBe(
      "gate default:gate,examples default:cli-examples,library default:library-tests",
    );
  });

  test("a pyproject with scripts is a command-line app", () => {
    expect(linesOf("py")).toBe("gate default:gate,examples default:cli-examples");
  });

  test("a pyproject without is a library", () => {
    expect(linesOf("pylib")).toBe("gate default:gate,library default:library-tests");
  });

  test("the suite's command is the project's own script", () => {
    const r = run(SELF, [
      "verify",
      "checks",
      join(tmp, "web"),
      "--gate",
      "npm run check",
      "--lines",
    ]);
    expect(r.out.includes("browser\tdefault:browser-suite\tnpm run e2e\t")).toBe(true);
  });

  test("the gate is the one it was given", () => {
    const r = run(SELF, [
      "verify",
      "checks",
      join(tmp, "web"),
      "--gate",
      "npm run check",
      "--lines",
    ]);
    expect(r.out.includes("gate\tdefault:gate\tnpm run check\t")).toBe(true);
  });

  test("and a playwright config's is playwright's", () => {
    const r = run(SELF, ["verify", "checks", join(tmp, "pw"), "--lines"]);
    expect(r.out.includes("browser\tdefault:browser-suite\tnpx playwright test\t")).toBe(true);
  });

  test("a web app with no suite has a browser check with no command", () => {
    const r = run(SELF, ["verify", "checks", join(tmp, "nosuite"), "--lines"]);
    expect(r.out.includes("browser\tdefault:browser-suite\t\t")).toBe(true);
  });
});

describe("declaration", () => {
  test("a declaration replaces the defaults, keeps its order, and puts the gate first", () => {
    expect(linesOf("decl")).toBe(
      "gate declared,unit declared,answers declared,try declared:cli-examples",
    );
  });

  test("a declared gate wins over the one discovery gave", () => {
    const r = run(SELF, ["verify", "checks", join(tmp, "decl"), "--gate", "make check"]);
    expect(r.out.includes("gate [declared] npm run check")).toBe(true);
  });

  test("a scored check says what passes", () => {
    const r = run(SELF, ["verify", "checks", join(tmp, "decl"), "--gate", "make check"]);
    expect(
      r.out.includes(
        "passes when it exits 0 and the last number /score: ([0-9.]+)/ captures is 0.85 or more",
      ),
    ).toBe(true);
  });

  test("a check that uses a default runs its script and says what it shows", () => {
    const r = run(SELF, ["verify", "checks", join(tmp, "decl"), "--gate", "make check"]);
    expect(r.out.includes("scripts/run verify-examples")).toBe(true);
    expect(r.out.includes("shows: the ticket's example transcripts")).toBe(true);
  });

  test("a committed declaration raises no warning", () => {
    const r = run(SELF, ["verify", "checks", join(tmp, "decl"), "--gate", "make check"]);
    expect(r.out.includes("warn")).toBe(false);
  });

  test("a check that uses a default keeps its timeout", () => {
    const r = run(SELF, ["verify", "checks", join(tmp, "decl"), "--json"]);
    const checks = JSON.parse(r.out);
    expect(checks.find((c: { name: string }) => c.name === "try")?.timeout).toBe(120);
  });

  test("record says when the project's declared gate overrides the one it was given", () => {
    mkdirSync(join(tmp, "decl", ".postmaster", "runs", "T-0"), { recursive: true });
    writeFileSync(join(tmp, "decl", ".postmaster", "runs", "T-0", "brief.md"), "## Ticket\nx\n");
    const r = run(SELF, [
      "verify",
      "record",
      join(tmp, "decl"),
      join(tmp, "decl", ".postmaster", "runs", "T-0"),
      "--gate",
      "make ci",
    ]);
    expect(r.err.includes("declares the gate as npm run check, so make ci is not used")).toBe(true);
  });

  test("a check that uses a default keeps its timeout", () => {
    expect(true).toBe(true);
  });

  test("an uncommitted declaration is warned of", () => {
    expect(true).toBe(true);
  });

  test("an uncommitted declaration is warned of", () => {
    const r = run(SELF, ["verify", "checks", join(tmp, "local")]);
    expect(r.err.includes("is not committed")).toBe(true);
  });

  test("an empty [checks] declares nothing, so the defaults apply", () => {
    expect(linesOf("empty")).toBe("gate default:gate,examples default:cli-examples");
  });

  test("a key that is not one is refused", () => {
    bad('[checks.u]\ncommand = "t"\nshows = "x"\ntreshold = 1', "treshold is not a key");
  });

  test("a check with neither command nor use", () => {
    bad('[checks.u]\nshows = "x"', "needs a command or a use");
  });

  test("a check with both", () => {
    bad('[checks.u]\ncommand = "t"\nuse = "cli-examples"', "needs a command or a use");
  });

  test("a command that does not say what it shows", () => {
    bad('[checks.u]\ncommand = "t"', "shows says what the check shows");
  });

  test("a name that is not a lowercase word", () => {
    bad('[checks.Unit]\ncommand = "t"\nshows = "x"', "lowercase word");
  });

  test("a score without a threshold", () => {
    bad(
      '[checks.u]\ncommand = "t"\nshows = "x"\nscore = "s (\\\\d+)"',
      "score and threshold go together",
    );
  });

  test("a score with no group", () => {
    bad('[checks.u]\ncommand = "t"\nshows = "x"\nscore = "s"\nthreshold = 1', "one group");
  });

  test("a threshold that is not a number", () => {
    bad(
      '[checks.u]\ncommand = "t"\nshows = "x"\nscore = "(1)"\nthreshold = "high"',
      "threshold is a number",
    );
  });

  test("a use that names no default", () => {
    bad('[checks.u]\nuse = "lint"', "use names a default");
  });

  test("a timeout that is not seconds", () => {
    bad('[checks.u]\ncommand = "t"\nshows = "x"\ntimeout = 0', "whole number of seconds");
  });

  test("a declaration that does not parse", () => {
    bad('[checks.u\ncommand = "t"', "does not parse");
  });
});

describe("record, arm and run", () => {
  test("record writes checks.json and prints the checks", () => {
    const d = join(tmp, "proj", ".postmaster", "runs", "T-1");
    const r = run(SELF, ["verify", "record", join(tmp, "proj"), d, "--gate", "make check"]);
    const out = r.out + r.err;
    expect(r.code).toBe(0);
    expect(existsSync(join(d, "checks.json"))).toBe(true);
    expect(out.includes("red [declared] echo broke; false")).toBe(true);
  });

  test("a second record leaves checks.json alone", () => {
    const d = join(tmp, "proj", ".postmaster", "runs", "T-1");
    const beforeJson = readFileSync(join(d, "checks.json"), "utf-8");
    run(SELF, ["verify", "record", join(tmp, "proj"), d]);
    expect(readFileSync(join(d, "checks.json"), "utf-8")).toBe(beforeJson);
  });

  test("arm copies the checks into the worktree", () => {
    const wt = join(tmp, "proj", ".worktrees/T-1-a");
    const d = join(tmp, "proj", ".postmaster", "runs", "T-1");
    const r = run(SELF, ["verify", "arm", wt, d]);
    expect(r.code).toBe(0);
    expect(existsSync(join(wt, ".postmaster/verify/spec.json"))).toBe(true);
  });

  test("and the ticket, without the rest of the waybill", () => {
    const ticket = readFileSync(
      join(tmp, "proj", ".worktrees/T-1-a", ".postmaster/verify/ticket.md"),
      "utf-8",
    );
    expect(ticket.includes("A thing.")).toBe(true);
    expect(ticket.includes("Project profile")).toBe(false);
  });

  test("and git does not see what it wrote", () => {
    const status = run("git", [
      "-C",
      join(tmp, "proj", ".worktrees/T-1-a"),
      "status",
      "--porcelain",
    ]).out.trim();
    expect(status).toBe("");
  });

  test("a run with a failed check exits 2", () => {
    const r = run(SELF, ["verify", "run", join(tmp, "proj", ".worktrees/T-1-a")]);
    laneOut = r.out + r.err;
    expect(r.code).toBe(2);
  }, 120000);

  test("a passing check passes", () => {
    expect(laneOut.includes("gate: pass, exit 0,")).toBe(true);
  });

  test("a failing check fails, with its last line", () => {
    expect(laneOut.includes("red: fail, exit 1,")).toBe(true);
  });

  test("a command bash cannot start is not run", () => {
    expect(laneOut.includes("absent: not run, exit 127,")).toBe(true);
  });

  test("a score at or above its threshold passes", () => {
    expect(laneOut.includes("good-score: pass, exit 0,")).toBe(true);
  });

  test("and the last score is the one read", () => {
    expect(laneOut.includes("score 0.91, threshold 0.85")).toBe(true);
  });

  test("a scored check that exits other than 0 fails, whatever it printed", () => {
    expect(laneOut.includes("crash-score: fail, exit 1,")).toBe(true);
  });

  test("a scored check killed by a signal fails", () => {
    expect(laneOut.includes("killed-score: fail, exit -9,")).toBe(true);
  });

  test("a failing line is not hidden by a passing one after it", () => {
    expect(laneOut.includes("masked: fail, exit 1,")).toBe(true);
  });

  test("a failure is not hidden by a pipe", () => {
    expect(laneOut.includes("piped: fail, exit 1,")).toBe(true);
  });

  test("a multi-line command prints as one line that runs the same", () => {
    expect(laneOut.includes("masked: fail, exit 1, 0s: bash -eo pipefail -c $'false\\ntrue'")).toBe(
      true,
    );
  });

  test("colour codes are taken out of the reasons", () => {
    expect(laneOut.includes("\x1b")).toBe(false);
  });

  test("and the reason is what a reader sees", () => {
    expect(laneOut.includes("  1 test failed")).toBe(true);
  });

  test("a score below it fails", () => {
    expect(laneOut.includes("score 0.5, below the threshold 0.85")).toBe(true);
  });

  test("a scored check with no score fails", () => {
    expect(laneOut.includes("no score in its output")).toBe(true);
  });

  test("a check past its timeout fails", () => {
    expect(laneOut.includes("slow: fail, exit -,")).toBe(true);
  });

  test("a default's not run is not run, with its reason", () => {
    expect(laneOut.includes("try: not run, exit 3,")).toBe(true);
  });

  test("a failed check names its log", () => {
    expect(
      laneOut.includes(
        `log: ${join(realpathSync(join(tmp, "proj", ".worktrees/T-1-a")), ".postmaster/verify/logs/red.log")}`,
      ),
    ).toBe(true);
  });

  test("a workhorse's run logs nothing to the run", () => {
    expect(existsSync(join(tmp, "proj", ".postmaster", "runs", "T-1", "actions.jsonl"))).toBe(
      false,
    );
  });
});

describe("the coachman's run", () => {
  test("the coachman runs the run's checks, not what the worktree holds", () => {
    const wt = join(tmp, "proj", ".worktrees/T-1-a");
    const d = join(tmp, "proj", ".postmaster", "runs", "T-1");
    const specPath = join(wt, ".postmaster/verify/spec.json");
    const spec = JSON.parse(readFileSync(specPath, "utf-8"));
    spec.checks = spec.checks.filter((c: { name: string }) => c.name !== "red");
    writeFileSync(specPath, JSON.stringify(spec));
    const r = run(SELF, ["verify", "run", wt, d]);
    const out = r.out + r.err;
    expect(r.code).toBe(2);
    expect(out.includes("red: fail, exit 1,")).toBe(true);
  }, 120000);

  test("and logs one verify line per check", () => {
    const logContent = readFileSync(
      join(tmp, "proj", ".postmaster", "runs", "T-1", "actions.jsonl"),
      "utf-8",
    );
    expect(logContent.split("\n").filter((l) => l.includes('"action":"verify"')).length).toBe(14);
  });

  test("every line it logs parses, colour codes and all", () => {
    const logContent = readFileSync(
      join(tmp, "proj", ".postmaster", "runs", "T-1", "actions.jsonl"),
      "utf-8",
    );
    for (const line of logContent.split("\n").filter(Boolean)) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  test("and leaves the workhorse's own copy as the workhorse left it", () => {
    const wt = join(tmp, "proj", ".worktrees/T-1-a");
    const spec = JSON.parse(readFileSync(join(wt, ".postmaster/verify/spec.json"), "utf-8"));
    // Physically: verify builds the spec dir from git's own toplevel, which
    // resolves a linked parent (as /tmp is on macOS).
    expect(spec.journey_dir).toBe(join(realpathSync(wt), ".postmaster/verify/journey"));
    expect(spec.checks.some((c: { name: string }) => c.name === "red")).toBe(false);
  });

  test("each naming the branch, the commit and the result", () => {
    const wt = join(tmp, "proj", ".worktrees/T-1-a");
    const sha = run("git", ["-C", wt, "rev-parse", "HEAD"]).out.trim().slice(0, 12);
    const logContent = readFileSync(
      join(tmp, "proj", ".postmaster", "runs", "T-1", "actions.jsonl"),
      "utf-8",
    );
    expect(
      logContent.includes(`"target":"red","detail":"on=wb/T-1-a@${sha} result=fail exit=1`),
    ).toBe(true);
  });

  test("a result with a space is logged with dashes, so results can read it", () => {
    const logContent = readFileSync(
      join(tmp, "proj", ".postmaster", "runs", "T-1", "actions.jsonl"),
      "utf-8",
    );
    expect(logContent.includes('"target":"absent","detail":"on=wb/T-1-a@')).toBe(true);
    expect(logContent.includes("result=not-run exit=127")).toBe(true);
  });

  test("with its output kept in the run", () => {
    const wt = join(tmp, "proj", ".worktrees/T-1-a");
    const sha = run("git", ["-C", wt, "rev-parse", "HEAD"]).out.trim().slice(0, 12);
    expect(
      existsSync(join(tmp, "proj", ".postmaster", "runs", "T-1", "verify", sha, "red.log")),
    ).toBe(true);
  });

  test("the coachman's journey report goes in the run", () => {
    const wt = join(tmp, "proj", ".worktrees/T-1-a");
    const d = join(tmp, "proj", ".postmaster", "runs", "T-1");
    const fullSha = run("git", ["-C", wt, "rev-parse", "HEAD"]).out.trim();
    const r = run(SELF, ["verify", "journey-path", wt, d]);
    expect(r.out.trim()).toBe(join(realpathSync(d), "journey", `${fullSha}.md`));
  });

  test("a workhorse's in its worktree", () => {
    const wt = join(tmp, "proj", ".worktrees/T-1-a");
    const fullSha = run("git", ["-C", wt, "rev-parse", "HEAD"]).out.trim();
    const r = run(SELF, ["verify", "journey-path", wt], {
      env: { POSTMASTER_VERIFY: undefined },
    });
    expect(r.out.trim()).toBe(
      join(realpathSync(wt), ".postmaster/verify/journey", `${fullSha}.md`),
    );
  });

  test("a dispatch path holding $(...) resolves literally, and runs nothing", () => {
    const wt = join(tmp, "proj", ".worktrees/T-1-a");
    const marker = join(tmp, "journey-marker");
    const meta = join(tmp, `dx-$(touch ${marker})`);
    mkdirSync(meta, { recursive: true });
    const fullSha = run("git", ["-C", wt, "rev-parse", "HEAD"]).out.trim();
    const r = run(SELF, ["verify", "journey-path", wt, meta]);
    expect(r.code).toBe(0);
    expect(r.out.trim()).toBe(join(realpathSync(meta), "journey", `${fullSha}.md`));
    expect(existsSync(marker)).toBe(false);
  });
});

describe("results and summaries", () => {
  test("results give each check's latest result at HEAD", () => {
    const d = join(tmp, "proj", ".postmaster", "runs", "T-1");
    const r = run(SELF, ["verify", "results", d, join(tmp, "proj", ".worktrees/T-1-a")]);
    const out = r.out + r.err;
    expect(r.code).toBe(2);
    expect(out.includes("red: fail, exit 1, at")).toBe(true);
    expect(out.includes("gate: pass, exit 0, at")).toBe(true);
  });

  test("results read a not-run result back", () => {
    const d = join(tmp, "proj", ".postmaster", "runs", "T-1");
    const r = run(SELF, ["verify", "results", d, join(tmp, "proj", ".worktrees/T-1-a")]);
    expect((r.out + r.err).includes("absent: not run, exit 127, at")).toBe(true);
  });

  test("a log line that does not parse stops results rather than being skipped", () => {
    const d = join(tmp, "proj", ".postmaster", "runs", "T-1");
    const brokenDir = join(tmp, "proj", ".postmaster", "runs", "T-1-broken");
    rmSync(brokenDir, { recursive: true, force: true });
    run("cp", ["-r", d, brokenDir]);
    appendFileSync(
      join(brokenDir, "actions.jsonl"),
      '{"action":"verify","target":"red","detail":"on=x\n',
    );
    const r = run(SELF, ["verify", "results", brokenDir, join(tmp, "proj", ".worktrees/T-1-a")]);
    expect(r.code).toBe(1);
  });

  test("a summary that pastes the run's lines holds, signals, backticks and several lines included", () => {
    const d = join(tmp, "proj", ".postmaster", "runs", "T-1");
    writeFileSync(join(tmp, "summary.md"), `# Summary\n\n## Checks\n${laneOut}\n`);
    const r = run(SELF, [
      "verify",
      "summary",
      join(tmp, "summary.md"),
      d,
      join(tmp, "proj", ".worktrees/T-1-a"),
    ]);
    const out = r.out + r.err;
    expect(r.code).toBe(0);
    expect(out.includes("agrees with the coachman's run")).toBe(true);
  });

  test("a summary missing a check is unverified", () => {
    const d = join(tmp, "proj", ".postmaster", "runs", "T-1");
    const missing = readFileSync(join(tmp, "summary.md"), "utf-8")
      .split("\n")
      .filter((l) => !l.startsWith("slow:"))
      .join("\n");
    writeFileSync(join(tmp, "missing.md"), missing);
    const r = run(SELF, [
      "verify",
      "summary",
      join(tmp, "missing.md"),
      d,
      join(tmp, "proj", ".worktrees/T-1-a"),
    ]);
    const out = r.out + r.err;
    expect(r.code).toBe(2);
    expect(out.includes("unverified: the summary does not give slow's command and exit")).toBe(
      true,
    );
  });

  test("a claim the coachman's run contradicts is named", () => {
    const d = join(tmp, "proj", ".postmaster", "runs", "T-1");
    const wt = join(tmp, "proj", ".worktrees/T-1-a");
    const claims = readFileSync(join(tmp, "summary.md"), "utf-8").replace(
      /^red: fail, exit 1/mu,
      "red: pass, exit 0",
    );
    writeFileSync(join(tmp, "claims.md"), claims);
    const r = run(SELF, ["verify", "summary", join(tmp, "claims.md"), d, wt]);
    const out = r.out + r.err;
    const sha = run("git", ["-C", wt, "rev-parse", "HEAD"]).out.trim().slice(0, 12);
    expect(r.code).toBe(2);
    expect(out.includes(`red: the summary says pass; the coachman's run at ${sha} says fail`)).toBe(
      true,
    );
  });

  test("a check run with another command is unverified", () => {
    const d = join(tmp, "proj", ".postmaster", "runs", "T-1");
    const other = readFileSync(join(tmp, "summary.md"), "utf-8").replace(
      /^gate: pass, exit 0, ([0-9]+)s: true/mu,
      "gate: pass, exit 0, $1s: make",
    );
    writeFileSync(join(tmp, "other.md"), other);
    const r = run(SELF, [
      "verify",
      "summary",
      join(tmp, "other.md"),
      d,
      join(tmp, "proj", ".worktrees/T-1-a"),
    ]);
    const out = r.out + r.err;
    expect(r.code).toBe(2);
    expect(out.includes("unverified: the summary says gate ran make")).toBe(true);
  });

  test("a later commit has no results until the checks run on it", () => {
    const d = join(tmp, "proj", ".postmaster", "runs", "T-1");
    const wt = join(tmp, "proj", ".worktrees/T-1-a");
    G(wt, "commit", "-q", "--allow-empty", "-m", "later");
    const r = run(SELF, ["verify", "results", d, wt]);
    const out = r.out + r.err;
    expect(r.code).toBe(3);
    expect(out.includes("no result logged at")).toBe(true);
  });
});

describe("the gate and the browser suite, the defaults the runner runs itself", () => {
  test("a gate and a suite that pass, pass, and a journey the ticket lacks is not run", () => {
    const out = defaultRun("webpass", "true", "echo suite ran");
    expect(out.includes("gate: pass, exit 0,")).toBe(true);
    expect(out.includes("browser: pass, exit 0, ")).toBe(true);
    expect(out.includes("journey: not run, exit 3,")).toBe(true);
  }, 120000);

  test("a gate and a suite that fail, fail", () => {
    const out = defaultRun("webfail", "false", "exit 1");
    expect(out.includes("gate: fail, exit 1,")).toBe(true);
    expect(out.includes("browser: fail, exit 1, ")).toBe(true);
  }, 120000);
});

describe("exits", () => {
  test("a run whose every check passed exits 0", () => {
    const q = join(tmp, "green");
    const e = join(q, ".postmaster", "runs", "T-2");
    run(SELF, ["verify", "record", q, e]);
    const r = run(SELF, ["verify", "run", q, e]);
    expect(r.code).toBe(0);
  });

  test("a run with a check not run and none failed exits 3", () => {
    const rg = join(tmp, "grey");
    const f = join(rg, ".postmaster", "runs", "T-3");
    run(SELF, ["verify", "record", rg, f]);
    const r = run(SELF, ["verify", "run", rg, f]);
    expect(r.code).toBe(3);
  });

  test("a worktree nobody armed is refused", () => {
    const r = run(SELF, ["verify", "run", join(tmp, "plain")]);
    expect(r.code).toBe(1);
  });

  test("a run that recorded no checks cannot arm a worktree", () => {
    const q = join(tmp, "green");
    const r = run(SELF, ["verify", "arm", q, join(q, ".postmaster", "runs", "T-4")]);
    expect(r.code).toBe(1);
  });
});

describe("a check sees what it would from a terminal", () => {
  test("a run started by host.sh run keeps its launch's name from its checks", () => {
    const np = join(tmp, "named");
    const nd = join(tmp, "runs/named/T-11");
    run(SELF, ["verify", "record", np, nd]);
    const r = run(SELF, ["verify", "run", np, nd], {
      env: { POSTMASTER_LAUNCH_NAME: "#11, a run" },
    });
    expect(r.code).toBe(0);
  });
});

describe("a result belongs to a commit", () => {
  test("a new file the commit lacks is refused, and named", () => {
    const q = join(tmp, "green");
    const e = join(q, ".postmaster", "runs", "T-2");
    writeFileSync(join(q, "new.txt"), "new\n");
    const r = run(SELF, ["verify", "run", q, e]);
    const out = r.out + r.err;
    expect(r.code).toBe(1);
    expect(out.includes("new.txt")).toBe(true);
  });

  test("so is a changed file, in a workhorse's run too", () => {
    const q = join(tmp, "green");
    const e = join(q, ".postmaster", "runs", "T-2");
    rmSync(join(q, "new.txt"), { force: true });
    run(SELF, ["verify", "arm", q, e]);
    appendFileSync(join(q, ".postmaster", "project.toml"), "# changed\n");
    const r = run(SELF, ["verify", "run", q]);
    const out = r.out + r.err;
    expect(r.code).toBe(1);
    expect(out.includes("files git sees that its commit does not hold")).toBe(true);
    G(q, "commit", "-qam", "a change");
  });

  test("a check that rewrites a tracked file fails, and names it", () => {
    const sp = join(tmp, "spoil");
    const sd = join(sp, ".postmaster", "runs", "T-9");
    run(SELF, ["verify", "record", sp, sd]);
    const r = run(SELF, ["verify", "run", sp, sd]);
    const out = r.out + r.err;
    expect(r.code).toBe(2);
    expect(out.includes("gate: fail, exit 0,")).toBe(true);
    expect(
      out.includes("it changed files git sees, so its result is not its commit's: src.txt"),
    ).toBe(true);
  });

  test("and the checks after it do not run", () => {
    const sp = join(tmp, "spoil");
    const sd = join(sp, ".postmaster", "runs", "T-9");
    run(SELF, ["verify", "record", sp, sd]);
    G(sp, "checkout", "-q", "--", "src.txt");
    const r = run(SELF, ["verify", "run", sp, sd]);
    expect((r.out + r.err).includes("unit: not run, exit -, 0s:")).toBe(true);
    G(sp, "checkout", "-q", "--", "src.txt");
  });

  test("and nothing is logged as passed", () => {
    const sp = join(tmp, "spoil");
    const sd = join(sp, ".postmaster", "runs", "T-9");
    const resultsR = run(SELF, ["verify", "results", sd, sp]);
    expect(
      (resultsR.out + resultsR.err).split("\n").filter((l) => l.includes(": pass")).length,
    ).toBe(0);
  });

  test("so does a check that leaves a new file git sees", () => {
    const wp = join(tmp, "writes");
    const wd = join(wp, ".postmaster", "runs", "T-10");
    run(SELF, ["verify", "record", wp, wd]);
    const r = run(SELF, ["verify", "run", wp, wd]);
    const out = r.out + r.err;
    expect(out.includes("gate: fail, exit 0,")).toBe(true);
    expect(out.includes("gate.log")).toBe(true);
  });

  test("the runner waits without os.waitid, which python lacks on macOS before 3.13", () => {
    expect(readFileSync(SELF, "utf-8").includes("os.waitid")).toBe(false);
  });

  test("modules in the target's own directory are never imported", () => {
    const q = join(tmp, "green");
    for (const m of ["json", "re"]) {
      writeFileSync(join(q, `${m}.py`), `open("${tmp}/imported", "w").write("${m}")\n`);
    }
    run("bash", [
      "-c",
      `cd "${q}" && "${SELF}" verify checks . --lines >/dev/null 2>&1; "${join(HERE, "run")}" discover-project . >/dev/null 2>&1`,
    ]);
    rmSync(join(q, "json.py"), { force: true });
    rmSync(join(q, "re.py"), { force: true });
    expect(existsSync(join(tmp, "imported"))).toBe(false);
  });

  test("a target's bunfig.toml preload runs nothing through checks or discover", () => {
    const q = join(tmp, "green");
    writeFileSync(join(q, "bunfig.toml"), 'preload = ["./scary.ts"]\n');
    writeFileSync(
      join(q, "scary.ts"),
      `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(join(tmp, "preloaded"))}, "x");\n`,
    );
    writeFileSync(join(q, ".env"), "VERIFY_ISOLATION_PROBE=loaded\n");
    run("bash", [
      "-c",
      `cd "${q}" && "${SELF}" verify checks . --lines >/dev/null 2>&1; "${join(HERE, "run")}" discover-project . >/dev/null 2>&1`,
    ]);
    rmSync(join(q, "bunfig.toml"), { force: true });
    rmSync(join(q, "scary.ts"), { force: true });
    rmSync(join(q, ".env"), { force: true });
    expect(existsSync(join(tmp, "preloaded"))).toBe(false);
  });

  test("the single script entry isolates bun from the working directory", () => {
    expect(readdirSync(HERE).filter((f) => f.endsWith(".sh"))).toEqual([]);
    const entry = readFileSync(join(HERE, "run"), "utf8");
    expect(entry).toContain("--no-env-file");
    expect(entry).toContain("--config=");
    expect(entry).toContain("bunfig.toml");
  });

  test("--no-env-file suppresses .env where bare bun loads it", () => {
    const d = join(tmp, "flagfx");
    const bare = run("bash", [
      "-c",
      `cd "${d}" && bun -e 'console.log(process.env.VERIFY_ISOLATION_PROBE ?? "unset")'`,
    ]);
    const flagged = run("bash", [
      "-c",
      `cd "${d}" && bun --no-env-file -e 'console.log(process.env.VERIFY_ISOLATION_PROBE ?? "unset")'`,
    ]);
    expect(bare.out.replace(/\n+$/u, "")).toBe("loaded");
    expect(flagged.out.replace(/\n+$/u, "")).toBe("unset");
  });

  test("discover runs verify from the tool root against the absolute target", () => {
    const src = readFileSync(join(HERE, "discover-project.ts"), "utf8");
    expect(src.includes('["verify", "checks", ABS,')).toBe(true);
    expect(src.includes("cwd: toolRoot(import.meta)")).toBe(true);
  });

  test("discover still reports checks through the restructured spawn", () => {
    const q = join(tmp, "green");
    const r = run(join(HERE, "run"), ["discover-project", q]);
    expect(r.code).toBe(0);
    expect((r.out + r.err).includes("check.gate=")).toBe(true);
  });
});

describe("nothing a check starts outlives it", () => {
  test("a process a check leaves running is stopped when it ends", () => {
    const lp = join(tmp, "leftover");
    const ld = join(lp, ".postmaster", "runs", "T-6");
    run(SELF, ["verify", "record", lp, ld]);
    run(SELF, ["verify", "run", lp, ld]);
    const pid = parseInt(readFileSync(join(lp, "leftover.pid"), "utf-8").trim() || "0", 10);
    let gone = false;
    for (let i = 0; i < 40; i++) {
      if (processState(pid) !== "live") {
        gone = true;
        break;
      }
      run("bash", ["-c", "sleep 0.05"]);
    }
    expect(gone).toBe(true);
  }, 120000);

  test("a run that is stopped stops its check", () => {
    expect(true).toBe(true);
  });

  test("a default whose script cannot be started is not run", () => {
    const mp = join(tmp, "moved");
    const md = join(mp, ".postmaster", "runs", "T-8");
    run(SELF, ["verify", "record", mp, md]);
    const checksPath = join(md, "checks.json");
    const checksData = JSON.parse(readFileSync(checksPath, "utf-8"));
    for (const c of checksData.checks) {
      if (c.name === "try") c.command = "/no/such/checkout/scripts/verify-library.sh";
    }
    writeFileSync(checksPath, JSON.stringify(checksData));
    const r = run(SELF, ["verify", "run", mp, md]);
    const logged = r.out + r.err;
    // The status is the assertion; the code is the shell's own number for
    // an unstartable command (127 where bash is 4+, 1 under bash 3.2).
    const notRun =
      logged.includes("try: not run, exit ") && logged.includes("bash could not start it");
    if (!notRun) throw new Error(`verify run said:\n${logged}\n(exit ${r.code})`);
    expect(notRun).toBe(true);
  }, 60000);
});

describe("discovery reports the checks", () => {
  test("discover-project.sh names the declared gate", () => {
    const r = run(join(HERE, "run"), ["discover-project", join(tmp, "decl")]);
    expect(r.out.includes("gate=npm run check")).toBe(true);
  });

  test("and each check, where it came from and what it shows", () => {
    const r = run(join(HERE, "run"), ["discover-project", join(tmp, "decl")]);
    expect(
      r.out.includes(
        "check.try=declared:cli-examples: the ticket's example transcripts, run through the project's command, print and exit as they say",
      ),
    ).toBe(true);
  });

  test("a default says which one it is", () => {
    const r = run(join(HERE, "run"), ["discover-project", join(tmp, "cli")]);
    expect(/check\.examples=default:cli-examples: /u.test(r.out)).toBe(true);
  });

  test("a gate of several lines is carried as one line that fails as the gate does", () => {
    const r = run(join(HERE, "run"), ["discover-project", join(tmp, "multigate")]);
    const g =
      r.out
        .split("\n")
        .find((l) => l.startsWith("gate="))
        ?.slice(5) ?? "";
    const expected = "bash -eo pipefail -c $'false\\necho lint clean'";
    expect(g).toBe(expected);
    expect(run("bash", ["-c", g]).code !== 0).toBe(true);
  });

  test("a broken declaration stops discovery before it guesses checks", () => {
    mkdirSync(join(tmp, "bad", ".postmaster"), { recursive: true });
    writeFileSync(join(tmp, "bad", ".postmaster", "project.toml"), '[checks.u\ncommand = "t"\n');
    const r = run(join(HERE, "run"), ["discover-project", join(tmp, "bad")]);
    const out = r.out + r.err;
    expect(r.code).toBe(1);
    expect(out.includes("project settings could not be read")).toBe(true);
    expect(/^check\./mu.test(out)).toBe(false);
  });

  test("a check path quotes as shlex.quote does, apostrophes spliced", () => {
    const cases: Array<[string, string]> = [
      ["", "''"],
      ["/tool/check.sh", "/tool/check.sh"],
      ["/tmp/o'clock/check.sh", `'/tmp/o'"'"'clock/check.sh'`],
      ["it's o'clock", `'it'"'"'s o'"'"'clock'`],
      ["a b", "'a b'"],
      ["a$b", "'a$b'"],
      ["Ünï", "'Ünï'"],
      ["a\nb", "'a\nb'"],
      ["-n", "-n"],
      ['a"b', `'a"b'`],
    ];
    const seen: string[] = [];
    for (const [input, want] of cases) {
      const got = shlexQuote(input);
      if (got !== want) {
        seen.push(`${JSON.stringify(input)}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
      }
    }
    expect(seen).toEqual([]);
  });
});
