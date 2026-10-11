// A run's libraries: the ticket's list, one library's facts, and the
// record that lets an approved install through.
//
//   run libraries list --ticket <file>
//   run libraries identity <name> <version>
//   run libraries facts <name> <version>
//   run libraries record <name> <version> --dispatch <dispatch> [--wt <dir>] [--vendored]
//
// list prints the ticket's ## Libraries section, one library per line with
// its name, its exact version and the clerk's vetting; nothing when the
// ticket lists none. identity prints the approval one user yes covers.
// facts prints the name, version, identity, publish date, source
// repository and Socket's verdict, from the registry or, under
// POSTMASTER_FACTS_FIXTURE, from the recorded packuments beside the
// recorded verdict. record caches an approved library with the packages it
// brings, so the install takes them: it refuses without the user's
// recorded word, or when Socket flags the library, and never caches what
// it was not asked to record. --vendored caches a copied-in library,
// which no install resolves, without running one.
//
//   exit 0  listed; the identity printed; the facts printed; recorded
//   exit 1  usage; an unreadable ticket, dispatch or worktree; the install failed
//   exit 2  refused: no recorded approval, a recorded refusal, a Socket flag,
//           or a version that is not exact
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  APPROVALS_FILE,
  isExactVersion,
  libraryIdentity,
  readTicketLibraries,
} from "./lib/library-approvals.ts";
import { readFacts } from "./lib/library-facts.ts";
import { recordedScan, socketScanOnly, type ScanAdvisory } from "./lib/install-scanner.ts";
import { run } from "./lib/proc.ts";
import { readApprovals } from "./lib/switch-offs.ts";

const USAGE =
  "usage: run libraries list --ticket <file> | identity <name> <version> | facts <name> <version> | record <name> <version> --dispatch <dispatch> [--wt <dir>] [--vendored]";

function usage(): never {
  console.error(USAGE);
  process.exit(1);
  throw new Error("unreachable");
}

function refuse(message: string): never {
  console.error(`libraries: ${message}`);
  process.exit(2);
  throw new Error("unreachable");
}

function fail(message: string): never {
  console.error(`libraries: ${message}`);
  process.exit(1);
  throw new Error("unreachable");
}

function listCmd(argv: string[]): void {
  if (argv.length !== 2 || argv[0] !== "--ticket") usage();
  const file = argv[1]!;
  if (!existsSync(file)) fail(`no such ticket file: ${file}`);
  for (const lib of readTicketLibraries(readFileSync(file, "utf8"))) {
    console.log(
      lib.vetting === ""
        ? `${lib.name} ${lib.version}`
        : `${lib.name} ${lib.version} ${lib.vetting}`,
    );
  }
}

function identityCmd(argv: string[]): void {
  if (argv.length !== 2 || argv[0] === "" || argv[1] === "") usage();
  console.log(libraryIdentity(argv[0]!, argv[1]!));
}

async function factsCmd(argv: string[]): Promise<void> {
  if (argv.length !== 2 || argv[0] === "" || argv[1] === "") usage();
  const name = argv[0]!;
  const version = argv[1]!;
  const fixtureDir = process.env["POSTMASTER_FACTS_FIXTURE"];
  const scan =
    fixtureDir === undefined
      ? socketScanOnly
      : (packages: { name: string; version: string }[]): Promise<ScanAdvisory[]> =>
          Promise.resolve(recordedScan(join(fixtureDir, "verdict.json"), packages));
  const facts = await readFacts(name, version, { fixtureDir, scan });
  console.log(`name: ${facts.name}`);
  console.log(`version: ${facts.version}`);
  console.log(`identity: ${libraryIdentity(name, version)}`);
  console.log(`published: ${facts.published ?? "unknown"}`);
  console.log(`source: ${facts.source ?? "unknown"}`);
  console.log(`verdict: ${facts.verdict}`);
  if (facts.note !== null) console.log(`note: ${facts.note}`);
}

interface RecordArgs {
  name: string;
  version: string;
  dispatch: string;
  wt: string;
  vendored: boolean;
}

function recordArgs(argv: string[]): RecordArgs {
  if (argv.length < 4) usage();
  const name = argv[0]!;
  const version = argv[1]!;
  if (name === "" || version === "") usage();
  if (argv[2] !== "--dispatch" || argv[3] === undefined || argv[3] === "") usage();
  let wt = process.cwd();
  let vendored = false;
  let i = 4;
  while (i < argv.length) {
    if (argv[i] === "--wt" && argv[i + 1] !== undefined && argv[i + 1] !== "") {
      wt = argv[i + 1]!;
      i += 2;
    } else if (argv[i] === "--vendored") {
      vendored = true;
      i += 1;
    } else {
      usage();
    }
  }
  return { name, version, dispatch: argv[3], wt, vendored };
}

/** The cache with keys added, each covered by the given approval identity.
 * A cache that does not parse is rebuilt: the record the run keeps is the
 * authority, and this file is its copy. */
export function mergeCache(
  existing: string | null,
  keys: string[],
  identity: string,
  runId: string,
): string {
  let approvals: Record<string, unknown> = {};
  if (existing !== null) {
    try {
      const doc = JSON.parse(existing) as unknown;
      if (
        typeof doc === "object" &&
        doc !== null &&
        !Array.isArray(doc) &&
        typeof (doc as Record<string, unknown>)["approvals"] === "object" &&
        (doc as Record<string, unknown>)["approvals"] !== null
      ) {
        approvals = (doc as Record<string, unknown>)["approvals"] as Record<string, unknown>;
      }
    } catch {
      approvals = {};
    }
  }
  for (const key of keys) approvals[key] = { identity, run: runId };
  return JSON.stringify({ version: 1, approvals });
}

function writeCache(wt: string, keys: string[], identity: string, runId: string): void {
  const path = join(wt, APPROVALS_FILE);
  mkdirSync(join(wt, ".postmaster"), { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
  writeFileSync(path, mergeCache(existing, keys, identity, runId));
}

function recordCmd(argv: string[]): void {
  const a = recordArgs(argv);
  if (!isExactVersion(a.version)) {
    refuse(`${a.name}@${a.version} is not an exact version; approve one version at a time`);
  }
  const identity = libraryIdentity(a.name, a.version);
  let approvals: Map<string, "approved" | "refused">;
  try {
    const warnings: string[] = [];
    approvals = readApprovals(a.dispatch, "library", (message) => warnings.push(message));
    for (const message of warnings) console.error(`libraries: ${message}`);
  } catch {
    refuse(`no recorded approval for ${a.name}@${a.version}`);
  }
  const decision = approvals.get(identity);
  if (decision === "refused") refuse(`the user refused ${a.name}@${a.version}`);
  if (decision !== "approved") refuse(`no recorded approval for ${a.name}@${a.version}`);
  const wt = resolve(a.wt);
  const runId = basename(resolve(a.dispatch));
  writeCache(wt, [`${a.name}@${a.version}`], identity, runId);
  if (a.vendored) {
    console.log(`recorded: ${a.name}@${a.version}`);
    return;
  }
  const recordPath = join(
    tmpdir(),
    `postmaster-libraries-record-${process.pid}-${Date.now()}.json`,
  );
  try {
    const first = run("bun", ["add", `${a.name}@${a.version}`], {
      cwd: wt,
      env: { POSTMASTER_RECORD_FILE: recordPath },
    });
    if (first.code === 0) {
      console.log(`recorded: ${a.name}@${a.version}`);
      return;
    }
    let report: unknown = null;
    try {
      report = JSON.parse(readFileSync(recordPath, "utf8")) as unknown;
    } catch {
      report = null;
    }
    const refused =
      typeof report === "object" &&
      report !== null &&
      Array.isArray((report as Record<string, unknown>)["refused"])
        ? ((report as Record<string, unknown>)["refused"] as unknown[])
        : null;
    const socketFlagged =
      typeof report === "object" && report !== null
        ? (report as Record<string, unknown>)["socketFlagged"]
        : false;
    if (refused === null) {
      fail(
        `the install failed before the scan recorded its refused set` +
          (first.err.trim() === "" ? "" : `: ${first.err.trim().split("\n").at(-1)}`),
      );
    }
    if (socketFlagged === true) {
      refuse(`Socket flags ${a.name}@${a.version}; not recording it`);
    }
    const keys = refused.filter((key): key is string => typeof key === "string" && key !== "");
    writeCache(wt, keys, identity, runId);
    const second = run("bun", ["add", `${a.name}@${a.version}`], { cwd: wt });
    if (second.code !== 0) {
      fail(
        `the install failed after recording` +
          (second.err.trim() === "" ? "" : `: ${second.err.trim().split("\n").at(-1)}`),
      );
    }
    console.log(
      [`recorded: ${a.name}@${a.version}`, ...keys.map((key) => `recorded: ${key}`)].join("\n"),
    );
  } finally {
    rmSync(recordPath, { force: true });
  }
}

async function main(argv: string[]): Promise<number> {
  const sub = argv[0];
  try {
    if (sub === "list") {
      listCmd(argv.slice(1));
      return 0;
    }
    if (sub === "identity") {
      identityCmd(argv.slice(1));
      return 0;
    }
    if (sub === "facts") {
      await factsCmd(argv.slice(1));
      return 0;
    }
    if (sub === "record") {
      recordCmd(argv.slice(1));
      return 0;
    }
    usage();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
