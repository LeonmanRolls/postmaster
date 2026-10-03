// # Check the ticket's premises still hold at the run's base.
// Check the ticket's premises still hold at the run's base. Each place the agents' part
// cites — by a link at a commit or as a path in a code span — is compared between its
// Verified at commit and the run's base: same, moved (the cited text is elsewhere in the
// file), changed or missing. A premise that only moved goes to the lanes in their briefs;
// one that changed or is missing fails the check.
//
//   premises.sh <repo> <base-commit> <ticket-file>   check the ticket's premises
//   premises.sh <repo> <base-commit> --body <file>   check a body file directly
//
// The Verified at commit is read from the ticket's `### Verified at <hex>` heading. A
// Verified at commit the repository lacks makes every place unknown, for the coachman
// to read: the script prints `unknown` for each and exits 0.
//
//   exit 0  every place is same or moved, or the verified commit is unknown
//   exit 2  a place is changed or missing
//   exit 1  usage, or the repository or ticket cannot be read
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";

const HERE = scriptsDir(import.meta);

function die(msg: string, code = 1): never {
  console.error(`premises: ${msg}`);
  process.exit(code);
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Extract the Verified at commit from the agents' part.
function verifiedAt(body: string): string {
  const m = /^###\s+Verified at\s+([0-9a-f]{7,40})\s*$/imu.exec(body);
  return m ? (m[1] ?? "") : "";
}

// Extract the agents' part (everything below the first `## For the agents`).
function agentsPart(body: string): string {
  const m = /^##\s+For the agents\s*$/imu.exec(body);
  return m ? body.slice(m.index + m[0].length) : body;
}

interface CitedPlace {
  path: string;
  lines: [number, number] | null;
  text: string;
  source: string;
}

// Find each place the agents' part cites: a link at a commit (github blob/commit URLs)
// or a path in a code span.
function citedPlaces(agents: string): CitedPlace[] {
  const places: CitedPlace[] = [];
  const seen = new Set<string>();
  // Links at a commit: https://github.com/owner/repo/blob/<commit>/<path>#L<a>-L<b>
  const linkRe =
    /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/(?:blob|commit)\/([0-9a-f]{7,40})\/([^\s#)]+)(?:#L(\d+)(?:-L(\d+))?)?/gu;
  for (const m of agents.matchAll(linkRe)) {
    const path = m[2] ?? "";
    const lineA = m[3] ? parseInt(m[3], 10) : null;
    const lineB = m[4] ? parseInt(m[4], 10) : null;
    const key = `${path}:${lineA ?? ""}-${lineB ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      places.push({
        path,
        lines: lineA !== null ? [lineA, lineB ?? lineA] : null,
        text: "",
        source: "link",
      });
    }
  }
  // Paths in code spans: `scripts/...`, `skills/...`, `docs/...`, `config.example.toml`, etc.
  const spanRe = /`([a-zA-Z0-9_][a-zA-Z0-9_./-]*\.[a-zA-Z]{1,6}(?:#L\d+(?:-L\d+)?)?)`/gu;
  for (const m of agents.matchAll(spanRe)) {
    const raw = m[1] ?? "";
    const path = raw.split("#")[0] ?? "";
    if (!/^(scripts|skills|docs|lint|types)\//u.test(path) && path !== "config.example.toml")
      continue;
    const key = path;
    if (!seen.has(key)) {
      seen.add(key);
      const lineM = /#L(\d+)(?:-L(\d+))?/u.exec(raw);
      places.push({
        path,
        lines: lineM
          ? [parseInt(lineM[1] ?? "0", 10), parseInt(lineM[2] ?? lineM[1] ?? "0", 10)]
          : null,
        text: "",
        source: "span",
      });
    }
  }
  return places;
}

// Read a file at a commit.
function fileAt(repo: string, commit: string, path: string): string | null {
  const r = run("git", ["-C", repo, "show", `${commit}:${path}`]);
  return r.code === 0 ? r.out : null;
}

// Compare a cited place between the verified commit and the base.
function comparePlace(
  repo: string,
  verified: string,
  base: string,
  place: CitedPlace,
): "same" | "moved" | "changed" | "missing" {
  const atVerified = fileAt(repo, verified, place.path);
  const atBase = fileAt(repo, base, place.path);
  if (atVerified === null && atBase === null) return "missing";
  if (atVerified === null || atBase === null) return "missing";
  if (place.lines) {
    // Compare the cited line range.
    const slice = (text: string, [a, b]: [number, number]): string =>
      text
        .split("\n")
        .slice(a - 1, b)
        .join("\n");
    const vText = slice(atVerified, place.lines);
    const bText = slice(atBase, place.lines);
    if (vText === bText) return "same";
    // Check if the text moved elsewhere in the file.
    if (atBase.includes(vText)) return "moved";
    return "changed";
  }
  // Whole-file comparison.
  if (atVerified === atBase) return "same";
  return "changed";
}

function main(argv: string[]): number {
  // premises.sh <repo> <base-commit> <ticket-file>
  // premises.sh <repo> <base-commit> --body <file>
  if (argv.length !== 3) {
    console.error("usage: premises.sh <repo> <base-commit> <ticket-file|--body <file>>");
    return 1;
  }
  const repo = argv[0]!;
  const base = argv[1]!;
  const ticketArg = argv[2]!;
  if (!isDir(repo)) die(`no such directory: ${repo}`, 1);
  if (!existsSync(ticketArg)) die(`no such file: ${ticketArg}`, 1);
  const body = readFileSync(ticketArg, "utf8");
  const verified = verifiedAt(body);
  const agents = agentsPart(body);
  const places = citedPlaces(agents);
  if (!verified) {
    console.log("no Verified at commit: every place is unknown");
    for (const p of places) console.log(`unknown ${p.path}`);
    return 0;
  }
  // Check the verified commit exists.
  const vc = run("git", ["-C", repo, "cat-file", "-t", verified]);
  if (vc.code !== 0) {
    console.log(`verified commit ${verified} is not in the repository: every place is unknown`);
    for (const p of places) console.log(`unknown ${p.path}`);
    return 0;
  }
  let anyBad = false;
  for (const p of places) {
    const result = comparePlace(repo, verified, base, p);
    console.log(`${result} ${p.path}`);
    if (result === "changed" || result === "missing") anyBad = true;
  }
  return anyBad ? 2 : 0;
}

if (import.meta.main) {
  process.exit(main(process.argv.slice(2)));
}
