// Copy one file or tree into raw/, scrubbed before the copy completes.
//
//   raw-promote.sh <src> <dest>     copy src to dest under raw/
//   raw-promote.sh --help
//
// Run from the repository root. The copy is the moment of publication,
// so the scrub runs first: every regular file under src goes through the
// scrub's span protocol, and each finding is replaced with a placeholder
// naming its rule. The copy is checked again, and it completes only when
// clean. A file with no findings is copied byte for byte. The original
// is never touched.
//
// A marker fault in the source refuses the copy. The destination must be
// under raw/ and must not exist.
//
//   exit 0  copied, scrubbed where the scan found anything
//   exit 1  the scan tripped; nothing was copied
//   exit 2  usage, not a repository, the scan failed, the destination
//           is outside raw/ or already exists, or the source is unusable
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";

const HERE = resolve(import.meta.dir);
const USAGE = "usage: raw-promote.sh <src> <dest> | --help";

function fail(msg: string, code = 2): never {
  console.error(`raw-promote: ${msg}`);
  process.exit(code);
}

function git(args: string[], cwd?: string): string {
  try {
    return (execFileSync("git", args, { cwd, encoding: "utf-8" }) as string).trim();
  } catch {
    fail("Git could not read the requested history");
  }
}

function safePath(path: string): string {
  return path.replace(/[^\x20-\x7e]/gu, (c) => {
    const cp = c.codePointAt(0)!;
    return `\\x${cp.toString(16).padStart(2, "0")}`;
  });
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function main(): number {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.error(USAGE);
    return 0;
  }
  if (args.length !== 2) {
    console.error(USAGE);
    return 2;
  }
  const root = git(["rev-parse", "--show-toplevel"]);
  if (resolve(process.cwd()) !== resolve(root)) {
    fail("run from the repository root");
  }
  const src = resolve(args[0]!);
  const dest = resolve(args[1]!);

  // The destination must be under raw/.
  const rawDir = join(root, "raw");
  const relDest = relative(root, dest);
  if (relDest.startsWith("..") || resolve(relDest) === resolve(root)) {
    fail("the destination must be under raw/");
  }
  if (!relDest.split(sep)[0]?.startsWith("raw")) {
    fail("the destination must be under raw/");
  }
  if (existsSync(dest)) {
    fail("the destination already exists; evidence is never overwritten");
  }

  // Collect source files.
  let files: string[];
  if (statSync(src).isDirectory()) {
    files = walkFiles(src);
  } else {
    files = [src];
  }

  const report: string[] = [];
  const scrubBin = join(HERE, "scrub-check.sh");
  const tmpDir = join(root, ".git", "raw-promote-tmp");
  mkdirSync(tmpDir, { recursive: true });

  try {
    for (const file of files) {
      const rel = relative(src, file);
      const destFile = join(dest, rel);
      mkdirSync(dirname(destFile), { recursive: true });

      // Scan the file.
      const tmpScan = join(tmpDir, "scan.txt");
      copyFileSync(file, tmpScan);
      let scanOut = "";
      let scanCode = 0;
      try {
        scanOut = execFileSync(scrubBin, ["--spans", tmpScan], {
          cwd: root,
          encoding: "utf-8",
          env: { ...process.env, POSTMASTER_DETECTIONS_LOG: "" },
        }) as string;
      } catch (e) {
        scanCode = (e as { status?: number }).status ?? 2;
        scanOut = (e as { stdout?: string }).stdout ?? "";
      }
      if (scanCode === 2) {
        fail("the scan could not finish");
      }

      const spans = scanOut.trim().split("\n").filter(Boolean);
      if (spans.length === 0) {
        copyFileSync(file, destFile);
        continue;
      }

      // Check for marker faults (span rule is "marker").
      const hasMarkerFault = spans.some((s) => s.endsWith(":marker"));
      if (hasMarkerFault) {
        fail("a marker fault in the source refuses the copy");
      }

      // Replace each finding with a placeholder naming its rule.
      const buf = readFileSync(file);
      let text = buf.toString("utf-8");
      const byLine = new Map<number, Array<[number, number, string]>>();
      for (const span of spans) {
        const parts = span.split(":");
        if (parts.length !== 5) continue;
        const [idx, line, start, end, rule] = parts.map(Number) as [
          number,
          number,
          number,
          number,
          number,
        ];
        void idx;
        const list = byLine.get(line) ?? [];
        list.push([start, end, String(rule)]);
        byLine.set(line, list);
      }
      // Actually the span format is index:line:start:end:rule where rule is a string.
      const byLine2 = new Map<number, Array<[number, number, string]>>();
      for (const span of spans) {
        const parts = span.split(":");
        if (parts.length !== 5) continue;
        const line = parseInt(parts[1]!, 10);
        const start = parseInt(parts[2]!, 10);
        const end = parseInt(parts[3]!, 10);
        const rule = parts[4]!;
        const list = byLine2.get(line) ?? [];
        list.push([start, end, rule]);
        byLine2.set(line, list);
      }

      const lines = text.split("\n");
      for (const [lineNum, group] of byLine2) {
        if (lineNum < 1 || lineNum > lines.length) continue;
        // Merge overlapping spans, outer-first.
        group.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
        const kept: Array<[number, number, string]> = [];
        for (const [s, e, r] of group) {
          if (kept.length > 0 && s < kept[kept.length - 1]![1] && kept[kept.length - 1]![0] < e) {
            if (e > kept[kept.length - 1]![1]) {
              kept[kept.length - 1] = [kept[kept.length - 1]![0], e, kept[kept.length - 1]![2]];
            }
          } else {
            kept.push([s, e, r]);
          }
        }
        // Apply right-to-left.
        kept.sort((a, b) => b[0] - a[0]);
        let lineText = lines[lineNum - 1]!;
        for (const [s, e, r] of kept) {
          lineText = lineText.slice(0, s) + `<redacted:${r}>` + lineText.slice(e);
        }
        lines[lineNum - 1] = lineText;
      }
      writeFileSync(destFile, lines.join("\n"));

      // Recheck the copy.
      let recheckCode = 0;
      try {
        execFileSync(scrubBin, ["--files", destFile], {
          cwd: root,
          encoding: "utf-8",
          env: { ...process.env, POSTMASTER_DETECTIONS_LOG: "" },
          stdio: ["ignore", "ignore", "ignore"],
        });
      } catch (e) {
        recheckCode = (e as { status?: number }).status ?? 2;
      }
      if (recheckCode !== 0) {
        rmSync(dest, { recursive: true, force: true });
        fail("the recheck tripped; nothing was copied", 1);
      }

      // Report.
      for (const span of spans) {
        const parts = span.split(":");
        if (parts.length !== 5) continue;
        const line = parts[1];
        const rule = parts[4];
        report.push(`${safePath(destFile)}:${line}: ${rule} scrubbed`);
      }
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  for (const line of report) console.log(line);
  return 0;
}

try {
  process.exit(main());
} catch {
  console.error("raw-promote: failed");
  process.exit(2);
}
