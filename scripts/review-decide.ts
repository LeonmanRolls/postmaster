// Decide whether the review loop runs another round, from the round's finding, apply,
// launch and degrade lines. The runbook calls this rather than counting findings itself.
//
//   run review-decide <dispatch> <round>
//
//   round    the round that just finished, a whole number of 1 or more
//
// Reads <dispatch>/actions.jsonl. A finding is a `finding` line whose detail opens with its class,
// `gating` or `style`, then its severity (P1, P2 or P3), its round (r1, r2, ...) and the rest. An
// apply is an `apply` line whose detail names the finding targets it fixes, as whitespace-separated
// bare targets; it counts for round r when any target it names has a finding line of round r. A
// round's serious count is the number of its finding lines that open `gating P1 r<n>` or
// `gating P2 r<n>`, each line in its own round, so a fix that does not verify closed, logged
// again in the round that checked it, counts there. Only `gating` findings keep the loop
// going; a `style` finding never does. A launch is a `review-launch` line whose detail is
// `<lens> round <n>`; a degrade is a `degrade` line whose detail opens `<lens> r<n>:` or
// `<lens> round <n>:`. A gating lens had no working reviewer in round n when every lane with
// a launch for it in round n has a degrade for it in round n. Style is never gating; launch
// and degrade lines in any other spelling are ignored.
//
// The rule (ticket #316, the user's): round 2 runs whenever round 1 applied a fix; from round
// 2 on, the loop goes on while no round finds more serious defects than the round before, and
// stops for a ruling when a round finds more. Two rounds running that each lacked a working
// reviewer for a gating lens stop the loop whatever the counts, and a round that lacked one
// is never the last. There is no cap on rounds.
//
// Prints one decision line:
//   RUN <next>: <reason>
//   STOP <round>: <reason>
//   RULING <round>: <reason>; escalate with residue
//
//   exit 0  the decision is printed
//   exit 1  usage, a round below 1, a missing or unreadable action log, a line that is
//           not JSON or not an action object, an action object with no action, a finding whose
//           detail does not open with its class, a finding with no readable severity or round,
//           two findings sharing one target in one round, or an apply naming no target or a
//           target with no finding line
import { readFileSync, statSync } from "node:fs";
import { D_CLASS, digitValue, END_OF_STRING, pySplitLines, pyTrim, pyWords } from "./lib/text.ts";

const USAGE = "usage: run review-decide <dispatch> <round>";

function die(msg: string): never {
  console.error(`review-decide: ${msg}`);
  process.exit(1);
  throw new Error("unreachable");
}

// Python str() of a parsed JSON value, for detail and target fields: the
// spellings scripts compare against. Objects keep JSON's spelling, where
// Python would print its repr; only malformed lines ever reach that, as do
// floats (1.0 prints "1" here, "1.0" there) and integers past 2^53.
function pyStr(value: unknown, missing: boolean): string {
  if (missing || typeof value === "string") return missing ? "" : (value as string);
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  const mark = pyFloatMark(value);
  if (mark !== null) return mark;
  return JSON.stringify(value) ?? "None";
}

// json.loads accepts bare NaN, Infinity and -Infinity (what json.dumps
// writes for them); JSON.parse rejects them. A first plain parse keeps the
// common path; the fallback quotes bare constants outside strings as float
// markers, and whatever still fails is not JSON in both languages. A real
// line that is exactly a marker object faults as not-an-object rather than
// missing its action; no log line is shaped that way.
const JSON_CONST_RE = /"(?:[^"\\\n]|\\.)*"|(-?Infinity|NaN)/gu;
const PY_FLOAT_MARK = "$pyfloat";
function tolerantParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    // fall through to the constants-tolerant parse
  }
  const marked = line.replace(JSON_CONST_RE, (m, c: string | undefined) =>
    c === undefined
      ? m
      : `{"${PY_FLOAT_MARK}":"${c === "NaN" ? "nan" : c === "Infinity" ? "inf" : "-inf"}"}`,
  );
  return JSON.parse(marked);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pyFloatMark(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== PY_FLOAT_MARK) return null;
  const tag = value[PY_FLOAT_MARK];
  return tag === "nan" || tag === "inf" || tag === "-inf" ? tag : null;
}

// Python int(s, 10): stripped, one sign, single underscores between digits,
// Unicode decimal digits. The normalized decimal spelling, or null where
// int() raises. Kept a string: huge rounds print in full, exactly as %d does.
const PY_INT_RE = new RegExp(`^([+-])?([${D_CLASS}](?:_?[${D_CLASS}])*)${END_OF_STRING}`, "u");
const UNDERSCORE_RE = /_/gu;
const LEADING_ZEROS_RE = /^0+/u;
function pyIntDigits(s: string): string | null {
  const m = PY_INT_RE.exec(pyTrim(s));
  if (!m) return null;
  let digits = digitValue(m[2]!.replace(UNDERSCORE_RE, "")).replace(LEADING_ZEROS_RE, "");
  if (digits === "") digits = "0";
  if (m[1] === "-" && digits !== "0") digits = `-${digits}`;
  return digits;
}

// Python str(OSError) for a failed read, as open().read() reports it.
function readErrorText(path: string, e: unknown): string {
  const code = (e as NodeJS.ErrnoException)?.code ?? "";
  const errno =
    code === "ENOENT"
      ? "[Errno 2] No such file or directory"
      : code === "EACCES"
        ? "[Errno 13] Permission denied"
        : code === "EISDIR"
          ? "[Errno 21] Is a directory"
          : code === "ENOTDIR"
            ? "[Errno 20] Not a directory"
            : code === "ELOOP"
              ? "[Errno 40] Too many levels of symbolic links"
              : null;
  if (errno !== null) return `${errno}: '${path}'`;
  return (e as Error)?.message ?? String(e);
}

function readActions(path: string): string[] {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (e) {
    die(`cannot read ${path}: ${readErrorText(path, e)}`);
  }
  try {
    // main opens utf-8 strict: undecodable bytes fail the read outright.
    return pySplitLines(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    die(`cannot read ${path}: not valid UTF-8`);
  }
}

// Python truthiness for parsed JSON: empty arrays and objects are falsy too.
function pyTruthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object" && value !== null) return Object.keys(value).length > 0;
  return Boolean(value);
}

const ROUND_RE = new RegExp(`^r([1-9][0-9]*)${END_OF_STRING}`, "u");

const ROUND_NUM_RE = /^[1-9][0-9]*$/u;
const DEGRADE_R_RE = new RegExp(`^r([1-9][0-9]*):${END_OF_STRING}`, "u");
const DEGRADE_N_RE = new RegExp(`^([1-9][0-9]*):${END_OF_STRING}`, "u");

// Add one to a digit string of any length, with no precision ceiling.
function incStr(d: string): string {
  let out = "";
  let carry = 1;
  for (let i = d.length - 1; i >= 0; i--) {
    const s = d.charCodeAt(i) - 48 + carry;
    carry = s > 9 ? 1 : 0;
    out = String(s > 9 ? 0 : s) + out;
  }
  return carry ? `1${out}` : out;
}

// Subtract one from a digit string of 2 or more.
function decStr(d: string): string {
  let out = "";
  let borrow = 1;
  for (let i = d.length - 1; i >= 0; i--) {
    let s = d.charCodeAt(i) - 48 - borrow;
    borrow = 0;
    if (s < 0) {
      s += 10;
      borrow = 1;
    }
    out = String(s) + out;
  }
  return out.replace(/^0+/u, "") || "0";
}

function decide(dispatch: string, roundS: string): void {
  const digits = pyIntDigits(roundS);
  if (digits === null || !ROUND_NUM_RE.test(digits)) {
    die(`round is a whole number of 1 or more: ${roundS}`);
  }
  const r = digits;
  const path = `${dispatch}/actions.jsonl`;
  const lines = readActions(path);

  const findings: Array<{ sev: string; rnd: string; cls: string }> = [];
  const launches = new Map<string, Set<string>>();
  const degrades = new Map<string, Set<string>>();
  const roundsSeen = new Map<string, Set<string>>();
  const seenPairs = new Set<string>();
  const applies: Array<{ n: number; targets: string[] }> = [];
  const faults: string[] = [];
  lines.forEach((line, idx) => {
    const n = idx + 1;
    if (pyTrim(line) === "") return;
    let e: unknown;
    try {
      e = tolerantParse(line);
    } catch {
      faults.push(`actions.jsonl line ${n} is not JSON`);
      return;
    }
    if (!isRecord(e) || pyFloatMark(e) !== null) {
      faults.push(`actions.jsonl line ${n} is not an action object`);
      return;
    }
    const rec = e as Record<string, unknown>;
    const action = rec.action;
    if (!pyTruthy(action)) {
      faults.push(`actions.jsonl line ${n} has no action`);
      return;
    }
    if (action === "finding") {
      const words = pyWords(pyStr(rec.detail, !("detail" in rec)));
      if (words.length === 0 || (words[0] !== "gating" && words[0] !== "style")) {
        faults.push(
          `actions.jsonl line ${n}: a finding whose detail opens with ${words.length > 0 ? `"${words[0]}"` : "nothing"}, not gating or style`,
        );
        return;
      }
      const cls = words[0]!;
      const sev = words.length > 1 ? words[1]! : "";
      const rnd = words.length > 2 ? words[2]! : "";
      if (sev !== "P1" && sev !== "P2" && sev !== "P3") {
        faults.push(
          `actions.jsonl line ${n}: a finding with severity ${sev || "none"}, not P1, P2 or P3`,
        );
        return;
      }
      const m = ROUND_RE.exec(rnd);
      if (!m) {
        faults.push(`actions.jsonl line ${n}: a finding with round ${rnd || "none"}, not rN`);
        return;
      }
      // The round stays a digit string: rN has no leading zero, so string
      // equality is int equality, with no precision ceiling.
      const target = pyStr(rec.target, !("target" in rec));
      const rndN = m[1]!;
      // The round holds digits only, so the join splits deterministically.
      const pair = `${target}\0${rndN}`;
      if (seenPairs.has(pair)) {
        faults.push(
          `actions.jsonl line ${n}: a second finding for ${target} in round r${rndN}; ` +
            "two findings at one place take targets that differ",
        );
        return;
      }
      seenPairs.add(pair);
      let set = roundsSeen.get(target);
      if (!set) {
        set = new Set();
        roundsSeen.set(target, set);
      }
      set.add(rndN);
      findings.push({ sev, rnd: rndN, cls });
    } else if (action === "apply") {
      applies.push({ n, targets: pyWords(pyStr(rec.detail, !("detail" in rec))) });
    } else if (action === "review-launch" || action === "degrade") {
      // Launch and degrade spellings outside the known forms are ignored, never
      // faults: older records spell these lines in other ways.
      const words = pyWords(pyStr(rec.detail, !("detail" in rec)));
      const lens = words.length > 0 ? words[0]! : "";
      let rndN: string | null = null;
      if (action === "review-launch") {
        if (words.length >= 3 && words[1] === "round" && ROUND_NUM_RE.test(words[2]!)) {
          rndN = words[2]!;
        }
      } else if (words.length >= 2) {
        if (words[1] === "round" && words.length >= 3) {
          rndN = DEGRADE_N_RE.exec(words[2]!)?.[1] ?? null;
        } else {
          rndN = DEGRADE_R_RE.exec(words[1]!)?.[1] ?? null;
        }
      }
      if (lens !== "" && rndN !== null) {
        // Lenses and rounds hold no NUL, so the join splits deterministically.
        const key = `${lens}\0${rndN}`;
        const pool = action === "review-launch" ? launches : degrades;
        let lanes = pool.get(key);
        if (!lanes) {
          lanes = new Set();
          pool.set(key, lanes);
        }
        lanes.add(pyStr(rec.target, !("target" in rec)));
      }
    }
  });

  for (const { n, targets } of applies) {
    if (targets.length === 0) {
      faults.push(`actions.jsonl line ${n}: an apply naming no finding target`);
    }
    for (const t of targets) {
      if (!roundsSeen.has(t)) {
        faults.push(`actions.jsonl line ${n}: an apply naming ${t}, which has no finding line`);
      }
    }
  }
  if (faults.length > 0) die(faults.join("; "));

  const appliedIn = (roundNum: string): boolean =>
    applies.some(({ targets }) => targets.some((t) => roundsSeen.get(t)?.has(roundNum) ?? false));
  const countSerious = (roundNum: string): number =>
    findings.filter(
      ({ sev, rnd, cls }) => rnd === roundNum && (sev === "P1" || sev === "P2") && cls === "gating",
    ).length;
  // The gating lenses with no working reviewer in a round, sorted: every launched
  // lane degraded. Style is never gating; a lens with no launch had no reviewer
  // to lose.
  const lacking = (roundNum: string): string[] => {
    const out: string[] = [];
    for (const [key, lanes] of launches) {
      const [lens = "", rnd = ""] = key.split("\0");
      if (rnd !== roundNum || lens === "style" || lens === "" || lanes.size === 0) continue;
      const down = degrades.get(key) ?? new Set<string>();
      if ([...lanes].every((lane) => down.has(lane)) && !out.includes(lens)) out.push(lens);
    }
    return out.sort();
  };

  if (r === "1") {
    const lacking1 = lacking("1");
    if (lacking1.length > 0) {
      console.log(`RUN 2: round 1 had no working reviewer for ${lacking1.join(" and ")}`);
    } else {
      console.log(
        appliedIn("1") ? "RUN 2: round 1 applied a fix" : "STOP 1: round 1 applied no fixes",
      );
    }
    return;
  }
  const prev = decStr(r);
  const lackingPrev = lacking(prev);
  const lackingR = lacking(r);
  if (lackingPrev.length > 0 && lackingR.length > 0) {
    const same =
      lackingPrev.length === lackingR.length && lackingPrev.every((l, i) => l === lackingR[i]);
    console.log(
      same
        ? `RULING ${r}: no working reviewer for ${lackingR.join(" and ")} in rounds ${prev} and ${r}; escalate with residue`
        : `RULING ${r}: no working reviewer for ${lackingPrev.join(" and ")} in round ${prev} and ${lackingR.join(" and ")} in round ${r}; escalate with residue`,
    );
    return;
  }
  const count = countSerious(r);
  const before = countSerious(prev);
  const next = incStr(r);
  if (count === 0 && lackingR.length > 0) {
    console.log(`RUN ${next}: round ${r} had no working reviewer for ${lackingR.join(" and ")}`);
  } else if (count === 0) {
    console.log(`STOP ${r}: round ${r} logged no P1 or P2 finding`);
  } else if (count <= before) {
    console.log(`RUN ${next}: round ${r} logged no more P1 or P2 findings than round ${prev}`);
  } else {
    console.log(
      `RULING ${r}: round ${r} logged more P1 or P2 findings than round ${prev}; escalate with residue`,
    );
  }
}

const argv = process.argv.slice(2);

if (argv.length !== 2 || argv[0] === "" || argv[1] === "") {
  console.error(USAGE);
  process.exit(1);
}
let isDir = false;
try {
  isDir = statSync(argv[0]!).isDirectory();
} catch {
  isDir = false;
}
if (!isDir) die(`no dispatch directory at ${argv[0]}`);
decide(argv[0]!, argv[1]!);
