// Resolve the user's workhorse-spec link from the config captured at dispatch.
//
//   spec-review-link.sh <dispatch> <workhorse-worktree>
//   spec-review-link.sh --validate <dispatch>
//   spec-review-link.sh --self-test
//
// The optional config.planning.review_link template in run.json has {path} replaced by the
// absolute path to WORKHORSE-SPEC.md. An empty or missing template prints the path itself.
//
//   exit 0  link or path printed
//   exit 1  usage, unreadable run.json or missing spec
//   exit 2  malformed planning.review_link
import { mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { die, run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

const HERE = scriptsDir(import.meta);
const FULL_USAGE =
  "usage: spec-review-link.sh <dispatch> <workhorse-worktree> | --validate <dispatch> | --self-test";

// --- helpers --------------------------------------------------------------------------------
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function hasOwn(obj: object, key: string): boolean {
  return Object.hasOwn(obj, key);
}

function isDict(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Python's read_text(encoding="utf-8"): undecodable bytes are an error, not U+FFFD.
function readStrict(path: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
}

// --- verbs --------------------------------------------------------------------------------------
function render(dispatch: string, worktree: string): void {
  const runJson = join(dispatch, "run.json");
  let text: string;
  try {
    text = readStrict(runJson);
  } catch (e: unknown) {
    // Only a missing file names itself; every other failure cannot read.
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT")
      die(`spec-review-link: no run.json at ${runJson}`, 1);
    die(`spec-review-link: cannot read ${runJson} (${errMsg(e)})`, 1);
  }
  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch (e: unknown) {
    die(`spec-review-link: cannot read ${runJson} (${errMsg(e)})`, 1);
  }
  if (!isDict(record)) die("spec-review-link: run.json config must be an object", 1);
  const config: unknown = hasOwn(record, "config") ? record.config : {};
  if (!isDict(config)) die("spec-review-link: run.json config must be an object", 1);
  const planning: unknown = hasOwn(config, "planning") ? config.planning : {};
  if (!isDict(planning)) die("spec-review-link: config.planning must be a table", 2);
  const template: unknown = hasOwn(planning, "review_link") ? planning.review_link : "";
  if (typeof template !== "string")
    die("spec-review-link: config.planning.review_link must be a string", 2);
  let path: string;
  try {
    path = realpathSync(join(worktree, "WORKHORSE-SPEC.md"));
  } catch (e: unknown) {
    die(`spec-review-link: no WORKHORSE-SPEC.md in ${worktree} (${errMsg(e)})`, 1);
  }
  let found = false;
  try {
    found = statSync(path).isFile();
  } catch {
    found = false;
  }
  if (!found) die(`spec-review-link: no WORKHORSE-SPEC.md in ${worktree}`, 1);
  if (template === "") {
    console.log(path);
  } else if (!template.includes("{path}")) {
    die("spec-review-link: config.planning.review_link must contain {path}", 2);
  } else {
    // Python's str.replace replaces every occurrence.
    console.log(template.split("{path}").join(path));
  }
}

function validate(dispatch: string): void {
  // The shell concatenates "$1/run.json" rather than joining it.
  const path = `${dispatch}/run.json`;
  let record: unknown;
  try {
    record = JSON.parse(readStrict(path));
  } catch (e: unknown) {
    die(`spec-review-link: cannot read ${path} (${errMsg(e)})`, 1);
  }
  if (!isDict(record)) die("spec-review-link: run.json config must be an object", 1);
  const config: unknown = hasOwn(record, "config") ? record.config : {};
  if (!isDict(config)) die("spec-review-link: run.json config must be an object", 1);
  const planning: unknown = hasOwn(config, "planning") ? config.planning : {};
  if (!isDict(planning)) die("spec-review-link: config.planning must be a table", 2);
  const template: unknown = hasOwn(planning, "review_link") ? planning.review_link : "";
  if (typeof template !== "string" || (template !== "" && !template.includes("{path}")))
    die("spec-review-link: config.planning.review_link must be empty or contain {path}", 2);
}

// --- entry --------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv[0] === "--self-test") {
  selfTest();
} else if (argv[0] === "--validate") {
  if (argv.length !== 2) {
    console.error("usage: spec-review-link.sh --validate <dispatch>");
    process.exit(1);
  }
  validate(argv[1]!);
} else if (argv[0] === undefined || argv[0] === "" || argv[0].startsWith("-")) {
  console.error(FULL_USAGE);
  process.exit(1);
} else {
  if (argv.length !== 2) {
    console.error(FULL_USAGE);
    process.exit(1);
  }
  render(argv[0], argv[1]!);
}

// --- self-test ----------------------------------------------------------------------------------
function selfTest(): void {
  withTempDir((tmp) => {
    const d = join(tmp, "project", ".postmaster", "runs", "RUN-1");
    const w = join(tmp, "project", ".worktrees", "RUN-1-lane");
    mkdirSync(d, { recursive: true });
    mkdirSync(w, { recursive: true });
    const spec = join(w, "WORKHORSE-SPEC.md");
    writeFileSync(spec, "approved plan\n");
    const SELF = join(HERE, "spec-review-link.sh");
    const st = new SelfTest();
    const go = (...args: string[]) => run("bash", [SELF, ...args]);
    // The shell's $(...): trailing newlines stripped. The shell's expected path:
    // $(cd $w && pwd -P)/WORKHORSE-SPEC.md.
    const strip = (s: string): string => s.replace(/\n+$/u, "");
    const specPath = (): string => join(realpathSync(w), "WORKHORSE-SPEC.md");

    console.log("positive controls");
    writeFileSync(
      join(d, "run.json"),
      '{"config":{"planning":{"review_link":"https://code.example/open?file={path}"}}}\n',
    );
    let r = go(d, w);
    const expected = `https://code.example/open?file=${specPath()}`;
    if (r.code === 0 && strip(r.out) === expected)
      st.ok("the recorded template gets the absolute spec path");
    else
      st.fail(
        `the recorded template gets the absolute spec path (exit ${r.code})`,
        `${strip(r.out)} ${r.err}`,
      );

    writeFileSync(join(d, "run.json"), '{"config":{}}\n');
    r = go(d, w);
    if (r.code === 0 && strip(r.out) === specPath())
      st.ok("a missing template prints the absolute spec path");
    else
      st.fail(
        `a missing template prints the absolute spec path (exit ${r.code})`,
        `${strip(r.out)} ${r.err}`,
      );

    r = go("--validate", d);
    if (r.code === 0) st.ok("a run with no template passes config validation");
    else st.fail(`a run with no template passes config validation (exit ${r.code})`, r.err);

    console.log("negative controls");
    writeFileSync(
      join(d, "run.json"),
      '{"config":{"planning":{"review_link":"https://code.example/open"}}}\n',
    );
    r = go(d, w);
    if (r.code === 2 && strip(r.out) === "" && r.err.includes("must contain {path}"))
      st.ok("a template without {path} is refused");
    else
      st.fail(`a template without {path} is refused (exit ${r.code})`, `${strip(r.out)} ${r.err}`);

    r = go("--validate", d);
    if (r.code === 2 && r.err.includes("must be empty or contain {path}"))
      st.ok("a template without {path} is refused before the run starts");
    else
      st.fail(`a template without {path} is refused before the run starts (exit ${r.code})`, r.err);

    writeFileSync(join(d, "run.json"), '{"config": [1]}\n');
    r = go(d, w);
    if (r.code === 1 && r.err.includes("config must be an object"))
      st.ok("a malformed config object is refused");
    else st.fail(`a malformed config object is refused (exit ${r.code})`, r.err);

    writeFileSync(join(d, "run.json"), '{"config":{}}\n');
    rmSync(spec);
    r = go(d, w);
    if (r.code === 1 && r.err.includes("no WORKHORSE-SPEC.md")) st.ok("a missing spec is refused");
    else st.fail(`a missing spec is refused (exit ${r.code})`, r.err);

    mkdirSync(spec);
    r = go(d, w);
    if (r.code === 1 && r.err.includes("no WORKHORSE-SPEC.md"))
      st.ok("a directory as the spec is refused");
    else st.fail(`a directory as the spec is refused (exit ${r.code})`, r.err);
    rmSync(spec, { recursive: true });

    st.finish();
  });
}
