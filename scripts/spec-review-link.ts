// Resolve the user's spec-review link from the config captured at dispatch.
//
//   spec-review-link.sh <dispatch> <spec-folder>
//   spec-review-link.sh --validate <dispatch>
//
// The optional config.planning.review_link template in run.json has {path} replaced by the
// absolute path of the folder that holds WORKHORSE-SPEC.md under review — code-server opens
// folders, not files, as {path} in ship.review_link is a folder. An empty or missing
// template prints the spec file's own path.
//
//   exit 0  link or path printed
//   exit 1  usage, unreadable run.json or missing spec
//   exit 2  malformed planning.review_link
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { die } from "./lib/proc.ts";

const FULL_USAGE = "usage: spec-review-link.sh <dispatch> <spec-folder> | --validate <dispatch>";

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
function render(dispatch: string, specFolder: string): void {
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
    path = realpathSync(join(specFolder, "WORKHORSE-SPEC.md"));
  } catch (e: unknown) {
    die(`spec-review-link: no WORKHORSE-SPEC.md in ${specFolder} (${errMsg(e)})`, 1);
  }
  let found = false;
  try {
    found = statSync(path).isFile();
  } catch {
    found = false;
  }
  if (!found) die(`spec-review-link: no WORKHORSE-SPEC.md in ${specFolder}`, 1);
  if (template === "") {
    console.log(path);
  } else if (!template.includes("{path}")) {
    die("spec-review-link: config.planning.review_link must contain {path}", 2);
  } else {
    // {path} is the folder that holds the spec, as ship.review_link fills a folder.
    const folder = realpathSync(specFolder);
    console.log(template.split("{path}").join(folder));
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
if (argv[0] === "--validate") {
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
