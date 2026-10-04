// Tests beside scripts/log-action.ts, moved from its --self-test on #109: 61 controls.
// Each test repeats the write it checks, so it passes alone as well as in file order.
// Repeated tool-fault argument lists are module constants; the mixed bad-byte write is a helper.
// Without iconv the differential is gated off and the file logs a skip notice naming it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { toolRoot } from "./lib/paths.ts";
import { decodeDropInvalid } from "./lib/proc.ts";
import { controlOf, kindsOf } from "./log-action";

const SELF = join(import.meta.dir, "run");
const TOOL = toolRoot(import.meta);
const noIconv = spawnSync("bash", ["-c", "command -v iconv"], { encoding: "utf8" }).status !== 0;
if (noIconv) {
  console.log(
    "skip the decoder matches iconv -c on 300 seeded cases: no iconv here; BASE skips it too",
  );
}

const FIELDS = [
  "--ran",
  "scripts/run wait-for-markers <dispatch>/logs 'r1-*.done' 2 60",
  "--failed",
  "returned before every marker was in",
  "--error",
  "exit 0\n\tall 2 markers present, \x1b[1mone a directory\x1b[0m",
  "--diagnosis",
  "find counts directories",
  "--fix",
  "count regular files only",
];
const FAULT_EVERY = [
  "coachman",
  "tool-fault",
  "scripts/verify.ts",
  ...FIELDS,
  "--workaround",
  "launched in the recorded form by hand",
];
const FAULT_ABS = [
  "coachman",
  "tool-fault",
  join(TOOL, "scripts/log-action.ts"),
  ...FIELDS,
  "--failed",
  "first",
];
const FAULT_OTHER = [
  "coachman",
  "tool-fault",
  "scripts/log-action.ts",
  ...FIELDS,
  "--failed",
  "second",
  "--control",
  "gate",
];
const FAULT_STEP = [
  "coachman",
  "tool-fault",
  "skills/postmaster/coachman.md",
  ...FIELDS,
  "--failed",
  "third",
  "--control",
  "wait",
];
const FAULT_SPELL = [
  "coachman",
  "tool-fault",
  "scripts//./wait-for-markers.ts",
  ...FIELDS,
  "--failed",
  "fourth",
];
const FAULT_DOTDOT = [
  "coachman",
  "tool-fault",
  "scripts/../scripts/log-action.ts",
  ...FIELDS,
  "--failed",
  "fifth",
];

let tmp = "";
let d = "";

function logAction(args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(SELF, ["log-action", d, ...args], { encoding: "utf8" });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

function lines(): number {
  try {
    return readFileSync(join(d, "actions.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l !== "").length;
  } catch {
    return 0;
  }
}

function lastLine(): Record<string, any> | null {
  try {
    const all = readFileSync(join(d, "actions.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l !== "");
    return all.length > 0 ? JSON.parse(all[all.length - 1]!) : null;
  } catch {
    return null;
  }
}

// The detail carries bytes printf makes that are not UTF-8. spawnSync encodes every argument
// as UTF-8, so a shell builds the bytes.
function rawDetail(
  octalDetail: string,
  actor: string,
  action: string,
  target: string,
): { code: number; err: string } {
  const q = (a: string): string => `'${a.replace(/'/gu, `'\\''`)}'`;
  const cmd = `${q(SELF)} log-action ${q(d)} ${q(actor)} ${q(action)} ${q(target)} "$(printf '${octalDetail}')"`;
  const r = spawnSync("bash", ["-c", cmd], { encoding: "utf8" });
  return { code: r.status ?? -1, err: r.stderr ?? "" };
}

// A bad byte in one detail argument must not cost another its characters: the damage is
// dropped entry by entry, as iconv -c drops it.
function mixedRawWrite(): { code: number; err: string } {
  const q = (a: string): string => `'${a.replace(/'/gu, `'\\''`)}'`;
  const cmd =
    `${q(SELF)} log-action ${q(d)} ${q("postmaster")} ${q("note")} ${q("RUN-1")} "$(printf 'x\\377y')" ` +
    q("keep \uFFFDhere");
  const r = spawnSync("bash", ["-c", cmd], { encoding: "utf8" });
  return { code: r.status ?? -1, err: r.stderr ?? "" };
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmaster-"));
  d = join(tmp, "proj", ".postmaster", "runs", "RUN-1");
  mkdirSync(d, { recursive: true });
  const setup = `ln -s "${TOOL}" "${join(tmp, "link")}" && : > "${join(tmp, "outside.sh")}"`;
  const link = spawnSync("bash", ["-c", setup], { encoding: "utf8" });
  if (link.status !== 0) throw new Error(`setup link failed: ${link.stderr}`);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("unicode primitives", () => {
  test("kinds keep NBSP and join inner spaces (awk gsub)", () => {
    const kinds = kindsOf("| `a` | k\u00a0ind |\n| `b` | k ind |\n");
    expect(kinds).toEqual(["kind", "k\u00a0ind"]);
  }, 30000);

  test("an NBSP-padded path does not match (ASCII trim)", () => {
    expect(controlOf("| \u00a0`t`\u00a0 | kind |\n", "t")).toBeUndefined();
  }, 30000);

  test("a plain path still matches", () => {
    expect(controlOf("| `t` | kind |\n", "t")).toBe("kind");
  }, 30000);

  test("a diagnosis of only NBSP is non-blank (ASCII space)", () => {
    const fields = [...FIELDS];
    fields[7] = "\u00a0";
    const before = lines();
    const r = logAction(["coachman", "tool-fault", "scripts/launch.ts", ...fields]);
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("a finding whose class is followed by a tab is refused", () => {
    const before = lines();
    const r = logAction(["coachman", "finding", "src/c.ts:7", "gating\tP3 r1 bug luna reading"]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("opens with its class")).toBe(true);
  }, 30000);
});

describe("positive controls", () => {
  test("an action is written", () => {
    const before = lines();
    const r = logAction(["postmaster", "note", "RUN-1", "a plain", '"detail"']);
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("as one line in the run's log and the same line in the ledger", () => {
    const r = logAction(["postmaster", "note", "RUN-1", "ledger check"]);
    expect(r.code).toBe(0);
    const actions = readFileSync(join(d, "actions.jsonl"), "utf8");
    const ledger = readFileSync(join(tmp, "proj", ".postmaster", "runs", "ledger.jsonl"), "utf8");
    expect(actions).toBe(ledger);
  }, 30000);

  test("the detail is everything after the target", () => {
    const r = logAction(["postmaster", "note", "RUN-1", "a plain", '"detail"']);
    expect(r.code).toBe(0);
    const last = lastLine();
    expect(
      last !== null &&
        last.detail === 'a plain "detail"' &&
        last.project === "proj" &&
        last.run === "RUN-1" &&
        !last.fault,
    ).toBe(true);
  }, 30000);

  test("a tool-fault with every field is written", () => {
    const before = lines();
    const r = logAction(FAULT_EVERY);
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("its fields are a fault object, with --failed as the detail and the error whole", () => {
    const r = logAction(FAULT_EVERY);
    expect(r.code).toBe(0);
    const last = lastLine();
    expect(
      last !== null &&
        last.action === "tool-fault" &&
        last.target === "scripts/verify.ts" &&
        last.detail === "returned before every marker was in" &&
        last.fault?.failed === "returned before every marker was in" &&
        last.fault?.error === "exit 0\n\tall 2 markers present, [1mone a directory[0m" &&
        String(last.fault?.workaround ?? "").startsWith("launched") &&
        last.fault?.control === "",
    ).toBe(true);
  }, 30000);

  test("and a part that is no control says nothing", () => {
    const r = logAction(FAULT_EVERY);
    expect(r.code).toBe(0);
    expect(r.err.trim()).toBe("");
  }, 30000);

  test("a listed script named by its absolute path is written", () => {
    const before = lines();
    const r = logAction(FAULT_ABS);
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("as a control of its kind, relative to the checkout", () => {
    const r = logAction(FAULT_ABS);
    expect(r.code).toBe(0);
    const last = lastLine();
    expect(
      last !== null &&
        last.fault?.failed === "first" &&
        last.target === "scripts/log-action.ts" &&
        last.fault?.control === "action-log",
    ).toBe(true);
  }, 30000);

  test("and the message says to stop", () => {
    const r = logAction(FAULT_ABS);
    expect(r.code).toBe(0);
    expect(r.err.includes("scripts/log-action.ts is a control (action-log): stop the leg")).toBe(
      true,
    );
  }, 30000);

  test("the entry itself is a control that stops the leg", () => {
    const r = logAction(["coachman", "tool-fault", "scripts/run", ...FIELDS]);
    expect(r.code).toBe(0);
    const last = lastLine();
    expect(last !== null && last.fault?.control === "check").toBe(true);
    expect(r.err.includes("scripts/run is a control (check): stop the leg")).toBe(true);
  }, 30000);

  test("a listed script with another --control is written", () => {
    const before = lines();
    const r = logAction(FAULT_OTHER);
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("with the list's kind", () => {
    const r = logAction(FAULT_OTHER);
    expect(r.code).toBe(0);
    const last = lastLine();
    expect(
      last !== null && last.fault?.failed === "second" && last.fault?.control === "action-log",
    ).toBe(true);
  }, 30000);

  test("a runbook step with --control is written", () => {
    const before = lines();
    const r = logAction(FAULT_STEP);
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("with the kind --control gives", () => {
    const r = logAction(FAULT_STEP);
    expect(r.code).toBe(0);
    const last = lastLine();
    expect(
      last !== null &&
        last.fault?.failed === "third" &&
        last.target === "skills/postmaster/coachman.md" &&
        last.fault?.control === "wait",
    ).toBe(true);
  }, 30000);

  test("another spelling of a listed path is written", () => {
    const before = lines();
    const r = logAction(FAULT_SPELL);
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("as that path, and that control", () => {
    const r = logAction(FAULT_SPELL);
    expect(r.code).toBe(0);
    const last = lastLine();
    expect(
      last !== null &&
        last.fault?.failed === "fourth" &&
        last.target === "scripts/wait-for-markers.ts" &&
        last.fault?.control === "wait",
    ).toBe(true);
  }, 30000);

  test("a path through .. that stays in the checkout is written", () => {
    const before = lines();
    const r = logAction(FAULT_DOTDOT);
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("as the file it reaches", () => {
    const r = logAction(FAULT_DOTDOT);
    expect(r.code).toBe(0);
    const last = lastLine();
    expect(
      last !== null &&
        last.fault?.failed === "fifth" &&
        last.target === "scripts/log-action.ts" &&
        last.fault?.control === "action-log",
    ).toBe(true);
  }, 30000);

  test("a path through a link to the checkout is written", () => {
    const before = lines();
    const r = logAction([
      "coachman",
      "tool-fault",
      join(tmp, "link/scripts/verify.ts"),
      ...FIELDS,
      "--failed",
      "sixth",
    ]);
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("as the real path", () => {
    const r = logAction([
      "coachman",
      "tool-fault",
      join(tmp, "link/scripts/verify.ts"),
      ...FIELDS,
      "--failed",
      "sixth",
    ]);
    expect(r.code).toBe(0);
    const last = lastLine();
    expect(
      last !== null && last.fault?.failed === "sixth" && last.target === "scripts/verify.ts",
    ).toBe(true);
  }, 30000);

  test("a style finding is written", () => {
    const before = lines();
    const r = logAction([
      "coachman",
      "finding",
      "src/a.ts:12",
      "style P3 r1 style luna reading: a list named map",
    ]);
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("with its class as the first word of its detail", () => {
    const r = logAction([
      "coachman",
      "finding",
      "src/a.ts:12",
      "style P3 r1 style luna reading: a list named map",
    ]);
    expect(r.code).toBe(0);
    const last = lastLine();
    expect(
      last !== null && last.action === "finding" && String(last.detail).split(" ")[0] === "style",
    ).toBe(true);
  }, 30000);

  test("a gating finding is written", () => {
    const before = lines();
    const r = logAction([
      "coachman",
      "finding",
      "src/b.ts:40",
      "gating P1 r1 bug luna execution: an off-by-one",
    ]);
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("an approved spec review is written", () => {
    const before = lines();
    const r = logAction(["postmaster", "spec-review", "luna", "approved abc123"]);
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("with its decision, then the commit", () => {
    const r = logAction(["postmaster", "spec-review", "luna", "approved abc123"]);
    expect(r.code).toBe(0);
    const last = lastLine();
    expect(
      last !== null &&
        last.action === "spec-review" &&
        last.target === "luna" &&
        last.detail === "approved abc123",
    ).toBe(true);
  }, 30000);

  test("a changes spec review is written", () => {
    const before = lines();
    const r = logAction([
      "postmaster",
      "spec-review",
      "deepseek",
      "changes def456 narrow the scope to the two named scripts",
    ]);
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("with the user's words after the commit", () => {
    const r = logAction([
      "postmaster",
      "spec-review",
      "deepseek",
      "changes def456 narrow the scope to the two named scripts",
    ]);
    expect(r.code).toBe(0);
    const last = lastLine();
    expect(
      last !== null && last.detail === "changes def456 narrow the scope to the two named scripts",
    ).toBe(true);
  }, 30000);

  test("a dropped spec review is written", () => {
    const before = lines();
    const args = ["postmaster", "spec-review", "luna", "dropped abc123 we only need one lane"];
    const r = logAction(args);
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("an approved switch-off is written", () => {
    const before = lines();
    const r = logAction([
      "postmaster",
      "switch-off",
      "comment:0123456789abcdef",
      "approved",
      "scripts/a.ts:1",
      "eslint-disable-next-line",
      "--",
      "yes,",
      "it",
      "is",
      "test-only",
    ]);
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("with its identity, decision and the user's words", () => {
    const r = logAction([
      "postmaster",
      "switch-off",
      "settings:89abcdef01234567",
      "approved",
      "bunfig.toml",
      "keep",
      "the",
      "test",
      "table",
    ]);
    expect(r.code).toBe(0);
    const last = lastLine();
    expect(
      last !== null &&
        last.action === "switch-off" &&
        last.target === "settings:89abcdef01234567" &&
        last.detail === "approved bunfig.toml keep the test table",
    ).toBe(true);
  }, 30000);

  test("a refused switch-off is written", () => {
    const before = lines();
    const r = logAction([
      "postmaster",
      "switch-off",
      "comment:fedcba9876543210",
      "refused",
      "scripts/a.ts:1",
      "ts-ignore",
      "--",
      "not",
      "while",
      "it",
      "hides",
      "a",
      "failure",
    ]);
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
    const last = lastLine();
    expect(
      last !== null &&
        last.action === "switch-off" &&
        last.detail.startsWith("refused scripts/a.ts:1 ts-ignore"),
    ).toBe(true);
  }, 30000);

  test("with the drop decision", () => {
    const args = ["postmaster", "spec-review", "luna", "dropped abc123 we only need one lane"];
    const r = logAction(args);
    expect(r.code).toBe(0);
    const last = lastLine();
    expect(
      last !== null &&
        last.action === "spec-review" &&
        String(last.detail).split(" ")[0] === "dropped",
    ).toBe(true);
  }, 30000);

  test("a detail ending in a newline is written", () => {
    const before = lines();
    const r = logAction(["postmaster", "note", "RUN-1", "kept whole\n"]);
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("with its newline", () => {
    const r = logAction(["postmaster", "note", "RUN-1", "kept whole\n"]);
    expect(r.code).toBe(0);
    const last = lastLine();
    expect(last !== null && last.detail === "kept whole\n").toBe(true);
  }, 30000);

  test("an older runs/<project>/<TICKET> layout is still read as that project", () => {
    const old = join(tmp, "oldlayout", "legacy-proj", "RUN-2");
    mkdirSync(old, { recursive: true });
    const r = spawnSync(SELF, ["log-action", old, "postmaster", "note", "RUN-2", "old"], {
      encoding: "utf8",
    });
    let oldEntry: Record<string, any> | null = null;
    try {
      const rows = readFileSync(join(old, "actions.jsonl"), "utf8").split("\n").filter(Boolean);
      oldEntry = JSON.parse(rows[rows.length - 1] ?? "null");
    } catch {
      oldEntry = null;
    }
    expect(
      r.status === 0 &&
        oldEntry !== null &&
        oldEntry.project === "legacy-proj" &&
        oldEntry.run === "RUN-2",
    ).toBe(true);
  }, 30000);

  test("a line separator and a byte that is not UTF-8 are written", () => {
    const before = lines();
    const r = rawDetail("one\\342\\200\\250two \\377 three", "postmaster", "note", "RUN-1");
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("the separator escaped and the byte dropped", () => {
    const r = rawDetail("one\\342\\200\\250two \\377 three", "postmaster", "note", "RUN-1");
    expect(r.code).toBe(0);
    const last = lastLine();
    expect(last !== null && last.detail === "one\u2028two  three").toBe(true);
  }, 30000);

  test("a literal U+FFFD is a legitimate character and is kept", () => {
    const before = lines();
    const r = logAction(["postmaster", "note", "RUN-1", "one\u2028two \uFFFD three"]);
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("the legitimate character survives the log", () => {
    const r = logAction(["postmaster", "note", "RUN-1", "one\u2028two \uFFFD three"]);
    expect(r.code).toBe(0);
    const last = lastLine();
    expect(last !== null && last.detail === "one\u2028two \uFFFD three").toBe(true);
  }, 30000);

  test("a mixed bad byte and literal U+FFFD are written", () => {
    const before = lines();
    const r = mixedRawWrite();
    expect(r.code).toBe(0);
    expect(lines()).toBe(before + 1);
  }, 30000);

  test("the damage dropped and the legitimate character kept", () => {
    const r = mixedRawWrite();
    expect(r.code).toBe(0);
    const last = lastLine();
    expect(last !== null && last.detail === "xy keep \uFFFDhere").toBe(true);
  }, 30000);

  test("the decoder drops damage and keeps valid edges", () => {
    const edges: Array<[number[], string]> = [
      [[], ""],
      [[0x61], "a"],
      [[0x80], ""],
      [[0xc2], ""],
      [[0xc0, 0xaf], ""],
      [[0xe1, 0x80], ""],
      [[0xe2, 0x82], ""],
      [[0xed, 0xa0, 0x80], ""],
      [[0xe0, 0x80, 0x80], ""],
      [[0xf0, 0x80, 0x80, 0x80], ""],
      [[0xf0, 0x8f, 0xbf, 0xbd], ""],
      [[0xf4, 0x8f, 0xbf, 0xbd], String.fromCodePoint(0x10fffd)],
      [[0xf4, 0x8f, 0xbf, 0xbf], String.fromCodePoint(0x10ffff)],
      [[0xf4, 0x90, 0x80, 0x80], ""],
      [[0xf5, 0x80, 0x80, 0x80], ""],
      [[0xf8, 0x88, 0x80, 0x80, 0x80], ""],
      [[0xef, 0xbf, 0xbd], String.fromCodePoint(0xfffd)],
      [[0x61, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9d, 0x84, 0x9e], "a\u00e9\u20ac\ud834\udd1e"],
      [[0xff, 0xef, 0xbf, 0xbd], String.fromCodePoint(0xfffd)],
      [[0xef, 0xbf, 0xbd, 0xff], String.fromCodePoint(0xfffd)],
    ];
    let edgeBad = 0;
    for (const [bytes, want] of edges) {
      const buf = Buffer.from(Uint8Array.from(bytes));
      if (decodeDropInvalid(buf) !== want) edgeBad++;
    }
    expect(edgeBad).toBe(0);
  }, 30000);

  test.skipIf(noIconv)(
    "the decoder matches iconv -c on 300 seeded cases",
    () => {
      let seed = 109;
      const rnd = (): number => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed;
      };
      const boundary = [
        0x00, 0x7f, 0x80, 0xbf, 0xc0, 0xc1, 0xc2, 0xdf, 0xe0, 0xed, 0xef, 0xf0, 0xf4, 0x8f, 0x90,
        0xa0,
      ];
      const cases: Buffer[] = [];
      for (let n = 0; n < 300; n++) {
        const len = rnd() % 9;
        const b = Buffer.alloc(len);
        for (let i = 0; i < len; i++) {
          const v = rnd() % 2 === 0 ? boundary[rnd() % boundary.length]! : rnd() % 256;
          b[i] = v >= 0xf5 ? v - 0x0b : v; // out of glibc's lenient corners
        }
        for (let i = 0; i + 1 < len; i++) {
          if (b[i] === 0xf4 && b[i + 1]! >= 0x90 && b[i + 1]! <= 0xbf) {
            b[i + 1] = 0x80 | (b[i + 1]! & 0x0f); // past U+10FFFF is glibc's corner too
          }
        }
        cases.push(b);
      }
      let bad = 0;
      let first = "";
      // The bytes travel in a file: spawnSync sends input as UTF-8, which would
      // re-encode them on the way to iconv's stdin.
      const q = (p: string): string => `'${p.replace(/'/gu, `'\\''`)}'`;
      const bin = join(tmp, "fuzz.bin");
      for (const c of cases) {
        writeFileSync(bin, c);
        const iconv = spawnSync("bash", ["-c", `iconv -f UTF-8 -t UTF-8 -c < ${q(bin)}`], {
          encoding: "utf8",
        });
        // iconv still drops trailing damage, but exits 1 for it
        // ("incomplete character at end of buffer"); the output is the oracle.
        const want = iconv.status === 0 || iconv.status === 1 ? (iconv.stdout ?? "") : null;
        const got = decodeDropInvalid(c);
        if (want === null || got !== want) {
          bad++;
          if (!first) {
            first = `${c.toString("hex")}: got ${JSON.stringify(got)}, iconv ${JSON.stringify(want)}`;
          }
        }
      }
      expect(bad).toBe(0);
    },
    30000,
  );

  test("every line in both files is UTF-8 JSON, one to a line", () => {
    const r = logAction(["postmaster", "note", "RUN-1", "json check"]);
    expect(r.code).toBe(0);
    const text = readFileSync(join(d, "actions.jsonl"), "utf8");
    for (const row of text.split("\n").filter((l) => l !== "")) JSON.parse(row);
    const ledger = readFileSync(join(tmp, "proj", ".postmaster", "runs", "ledger.jsonl"), "utf8");
    expect(text).toBe(ledger);
  }, 30000);
});

describe("negative controls: nothing is written", () => {
  test("an action outside the set", () => {
    const before = lines();
    const r = logAction(["coachman", "tool-faults", "scripts/launch.ts", "x"]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("is not an action")).toBe(true);
  }, 30000);

  test("an empty target", () => {
    const before = lines();
    const r = logAction(["coachman", "note", ""]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("usage:")).toBe(true);
  }, 30000);

  test("a finding with no class", () => {
    const before = lines();
    const r = logAction(["coachman", "finding", "src/c.ts:7", "P2 r1 bug luna reading: no class"]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("opens with its class, gating or style")).toBe(true);
  }, 30000);

  test("a finding whose class is another word", () => {
    const before = lines();
    const r = logAction(["coachman", "finding", "src/c.ts:7", "advisory P3 r1 style luna reading"]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("opens with its class, gating or style")).toBe(true);
  }, 30000);

  test("a spec-review with no decision", () => {
    const before = lines();
    const r = logAction(["coachman", "spec-review", "luna", "abc123 looks fine"]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("opens with its decision, approved, changes or dropped")).toBe(true);
  }, 30000);

  test("a spec-review whose decision is another word", () => {
    const before = lines();
    const r = logAction(["coachman", "spec-review", "luna", "ok abc123"]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("opens with its decision, approved, changes or dropped")).toBe(true);
  }, 30000);

  test("a switch-off with a target out of shape", () => {
    const before = lines();
    const r = logAction(["coachman", "switch-off", "scripts/a.ts:1", "approved fine by me"]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("comment:<16 hex> or settings:<16 hex>")).toBe(true);
  }, 30000);

  test("a switch-off whose decision is another word", () => {
    const before = lines();
    const r = logAction(["coachman", "switch-off", "comment:0123456789abcdef", "maybe yes"]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("opens with its decision, approved or refused")).toBe(true);
  }, 30000);

  test("a switch-off with the decision and nothing after it", () => {
    const before = lines();
    const r = logAction(["coachman", "switch-off", "comment:0123456789abcdef", "approved"]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("carries the decision")).toBe(true);
  }, 30000);

  test("a tool-fault with no fix", () => {
    const before = lines();
    const r = logAction(["coachman", "tool-fault", "scripts/launch.ts", ...FIELDS.slice(0, 8)]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("needs --fix")).toBe(true);
  }, 30000);

  test("a tool-fault with a blank diagnosis", () => {
    const before = lines();
    const r = logAction([
      "coachman",
      "tool-fault",
      "scripts/launch.ts",
      ...FIELDS,
      "--diagnosis",
      "  ",
    ]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("needs --diagnosis")).toBe(true);
  }, 30000);

  test("a tool-fault as plain words", () => {
    const before = lines();
    const r = logAction([
      "coachman",
      "tool-fault",
      "scripts/launch.ts",
      "the",
      "wait",
      "returned",
      "early",
    ]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("a tool-fault takes")).toBe(true);
  }, 30000);

  test("a flag with no value", () => {
    const before = lines();
    const r = logAction(["coachman", "tool-fault", "scripts/launch.ts", ...FIELDS, "--workaround"]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("--workaround needs a value")).toBe(true);
  }, 30000);

  test("a file postmaster does not have", () => {
    const before = lines();
    const r = logAction(["coachman", "tool-fault", "src/app.ts", ...FIELDS]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("names the postmaster file")).toBe(true);
  }, 30000);

  test("a file outside the checkout", () => {
    const before = lines();
    const r = logAction(["coachman", "tool-fault", join(tmp, "outside.sh"), ...FIELDS]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("names the postmaster file")).toBe(true);
  }, 30000);

  test("a path that climbs out of the checkout to a file", () => {
    const before = lines();
    const r = logAction([
      "coachman",
      "tool-fault",
      relative(TOOL, join(tmp, "outside.sh")),
      ...FIELDS,
    ]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("names the postmaster file")).toBe(true);
  }, 30000);

  test("an unknown kind of control", () => {
    const before = lines();
    const r = logAction([
      "coachman",
      "tool-fault",
      "skills/postmaster/coachman.md",
      ...FIELDS,
      "--control",
      "vibes",
    ]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("is not a kind of control")).toBe(true);
  }, 30000);

  test("two kinds of control in one", () => {
    const before = lines();
    const r = logAction([
      "coachman",
      "tool-fault",
      "skills/postmaster/coachman.md",
      ...FIELDS,
      "--control",
      "gate marker",
    ]);
    expect(r.code).toBe(1);
    expect(lines()).toBe(before);
    expect(r.err.includes("is not a kind of control")).toBe(true);
  }, 30000);

  test("a missing dispatch directory is refused, and named", () => {
    const missing = join(tmp, "nowhere");
    const r = spawnSync(SELF, ["log-action", missing, "coachman", "note", "x", "y"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
    expect((r.stderr ?? "").includes(`no such dir: ${missing}`)).toBe(true);
  }, 30000);
});
