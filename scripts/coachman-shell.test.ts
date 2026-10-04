// Every sh block in coachman.md does the same in zsh as in bash: the same
// arguments and the same exit status. On Linux where zsh is not installed the
// comparison is skipped, never failed. A block that expands a multi-word
// variable unquoted fails here: bash word-splits it and zsh does not, so the
// recorded arguments differ.
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";

const COACHMAN = join(import.meta.dir, "..", "skills", "postmaster", "coachman.md");
const haveZsh = run("sh", ["-c", "command -v zsh"]).code === 0;

type Block = { index: number; body: string };

/** The fenced sh blocks in coachman.md, not inline commands. */
function shBlocks(): Block[] {
  const text = readFileSync(COACHMAN, "utf8");
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let open = -1;
  let body: string[] = [];
  let index = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (open < 0) {
      // ASCII: matches ASCII markdown fences.
      if (/^\s*```sh\s*$/u.test(line)) {
        open = i;
        body = [];
        index++;
      }
      // ASCII: matches ASCII markdown fences.
    } else if (/^\s*```\s*$/u.test(line)) {
      blocks.push({ index, body: body.join("\n") });
      open = -1;
    } else {
      body.push(line.replace(/^ {3}/u, ""));
    }
  }
  return blocks;
}

/** Fill placeholders so the stubs see plain words. Optional-marker brackets
 * are dropped only when they wrap a whole argument, never array syntax. */
function fill(body: string): string {
  return body
    .replaceAll("<tool>", "TOOLDIR")
    .replaceAll("<repo>", "REPODIR")
    .replaceAll("<dispatch>", "DISPATCH")
    .replaceAll("<synthesis-wt>", "SYNTHWT")
    .replaceAll("<TICKET>", "TICKET")
    .replaceAll("<round>", "1")
    .replaceAll("<open lenses>", "bug security")
    .replaceAll('<the launch step of $LENS, for "$L" in "$DEST">', "echo launch")
    .replaceAll("<BASE>", "BASECOMMIT")
    .replaceAll("<base>", "BASECOMMIT")
    .replaceAll("<lane>", "lane")
    .replaceAll("<harvested-head>", "HEADHASH")
    .replaceAll("<oracle-commit>", "ORCHASH")
    .replaceAll("<abs>", "/abs")
    .replaceAll("<lens>", "bug")
    .replaceAll("<action>", "act")
    .replaceAll("<target>", "tgt")
    .replaceAll("<detail>", "det")
    .replaceAll("<command or step>", "cmd")
    .replaceAll("<what failed>", "fail")
    .replaceAll("<the error, or none>", "err")
    .replaceAll("<why>", "why")
    .replaceAll("<proposed fix>", "fix")
    .replaceAll("<what you did instead>", "instead")
    .replaceAll("<kind>", "kind")
    .replaceAll("<workhorse-wt>", "WT")
    .replaceAll("<postmaster file>", "file")
    .replaceAll("[--workaround", "--workaround")
    .replaceAll("[--control", "--control")
    .replaceAll("[--lane", "--lane")
    .replaceAll("[--oracle", "--oracle")
    .replaceAll("[...]", "")
    .replaceAll("...]", "");
}

/** Stand-in <tool> scripts that record their arguments and exit 0. */
function installStubs(dir: string): string {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const tools = [
    "cut-scratch.sh",
    "reviewers.sh",
    "review-round.sh",
    "host.sh",
    "launch.sh",
    "review-findings.sh",
    "log-action.sh",
    "run-log.sh",
    "verify.sh",
  ];
  for (const t of tools) {
    writeFileSync(
      join(bin, t),
      `#!/bin/sh
me=$(basename "$0")
printf '%s' "$me" >> "$RECORD"
for a in "$@"; do printf '\\t%s' "$a" >> "$RECORD"; done
printf '\\n' >> "$RECORD"
if [ "$me" = "reviewers.sh" ] && [ "$1" = "lanes" ]; then
  printf 'lane\\n'
  printf 'lane2\\n'
fi
if [ "$me" = "review-findings.sh" ] && [ "$1" = "normalize" ]; then
  exit 1
fi
exit 0
`,
      { mode: 0o755 },
    );
  }
  return bin;
}

function runBlock(
  shell: string,
  body: string,
  dir: string,
): { out: string; exit: number; err: string } {
  const bin = installStubs(dir);
  const record = join(dir, "record.txt");
  writeFileSync(record, "");
  // The blocks write under <dispatch> and <repo>; give them a place to land.
  mkdirSync(join(dir, "DISPATCH", "logs"), { recursive: true });
  mkdirSync(join(dir, "REPODIR"), { recursive: true });
  const script = join(dir, "block.sh");
  const filled = fill(body).replaceAll("TOOLDIR/scripts/", `${bin}/`);
  writeFileSync(script, filled);
  const r = run(shell, [script], {
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      RECORD: record,
      HOME: dir,
    },
    cwd: dir,
    timeout: 15_000,
  });
  return {
    out: readFileSync(record, "utf8"),
    exit: r.code,
    err: r.err + r.out,
  };
}

describe("coachman.md's sh blocks agree between bash and zsh", () => {
  let blocks: Block[] = [];

  beforeAll(() => {
    blocks = shBlocks();
  });

  test("coachman.md has ten fenced sh blocks", () => {
    expect(blocks.length).toBe(10);
  });

  for (let i = 0; i < 10; i++) {
    test(`block ${i + 1} runs the same under bash${haveZsh ? " and zsh" : " (zsh not installed: comparison skipped)"}`, () => {
      const block = blocks[i];
      expect(block).toBeDefined();
      const dirA = mkdtempSync(join(tmpdir(), "coachman-bash."));
      try {
        const bash = runBlock("bash", block!.body, dirA);
        if (!haveZsh) {
          expect(bash.exit).toBe(0);
          return;
        }
        const dirZ = mkdtempSync(join(tmpdir(), "coachman-zsh."));
        try {
          const zsh = runBlock("zsh", block!.body, dirZ);
          expect(zsh.exit).toBe(bash.exit);
          expect(zsh.out).toBe(bash.out);
        } finally {
          rmSync(dirZ, { recursive: true, force: true });
        }
      } finally {
        rmSync(dirA, { recursive: true, force: true });
      }
    }, 30000);
  }

  test("--clone arrives as two arguments under the security lens only", () => {
    const block = blocks.find((b) => b.body.includes("CLONE=()"))!;
    expect(block).toBeDefined();
    const dir = mkdtempSync(join(tmpdir(), "coachman-clone."));
    try {
      const r = runBlock("bash", block.body, dir);
      const lines = r.out.split("\n").filter((l) => l.includes("cut-scratch"));
      const security = lines.filter((l) => l.includes("security"));
      const bug = lines.filter((l) => l.includes("bug"));
      for (const line of security) {
        const args = line.split("\t");
        const at = args.indexOf("--clone");
        expect(at).toBeGreaterThanOrEqual(0);
        expect(args[at + 1]).toBe("BASECOMMIT");
      }
      for (const line of bug) {
        expect(line.includes("\t--clone\t") || line.endsWith("\t--clone")).toBe(false);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("each lens:lane is its own argument to review-round.sh wait", () => {
    const block = blocks.find((b) => b.body.includes("REVIEWERS=()"))!;
    expect(block).toBeDefined();
    const dir = mkdtempSync(join(tmpdir(), "coachman-wait."));
    try {
      const r = runBlock("bash", block.body, dir);
      const wait = r.out.split("\n").find((l) => l.includes("review-round") && l.includes("wait"));
      expect(wait).toBeDefined();
      const args = wait!.split("\t").filter(Boolean);
      // Each lens:lane is one argument, not a space-joined string.
      const pairs = args.filter((a) => a.includes(":"));
      expect(pairs.length).toBeGreaterThanOrEqual(2);
      expect(pairs.every((a) => a.split(":").length === 2)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("one line per failed lane from the normalize loop", () => {
    const block = blocks.find((b) => b.body.includes("NORMALIZE_FAILED=()"))!;
    expect(block).toBeDefined();
    const dir = mkdtempSync(join(tmpdir(), "coachman-norm."));
    try {
      const r = runBlock("bash", block.body, dir);
      // Both lanes fail normalize (the stub normalize writes nothing to stdout
      // but the redirect target is created; the `||` arm needs a non-zero). Make
      // the stub's normalize fail so the arm runs.
      const lines = r.out
        .split("\n")
        .filter((l) => l.includes("run-log") && l.includes("normalize failed"));
      // With both lanes failing we expect one line each.
      expect(lines.length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  test("an unquoted multi-word expansion is caught: bash and zsh disagree", () => {
    const bad = `CLONE="--clone BASE"
printf 'start' >> "$RECORD"
for a in $CLONE; do printf '\\t%s' "$a" >> "$RECORD"; done
printf '\\n' >> "$RECORD"
`;
    const dirA = mkdtempSync(join(tmpdir(), "coachman-bad-bash."));
    try {
      const bash = runBlock("bash", bad, dirA);
      // bash word-splits: --clone and BASE are two fields after start.
      const parts = bash.out.trim().split("\t");
      expect(parts.length).toBe(3);
      if (haveZsh) {
        const dirZ = mkdtempSync(join(tmpdir(), "coachman-bad-zsh."));
        try {
          const zsh = runBlock("zsh", bad, dirZ);
          // zsh does not split: one field.
          const zparts = zsh.out.trim().split("\t");
          expect(zparts.length).toBe(2);
          expect(zsh.out).not.toBe(bash.out);
        } finally {
          rmSync(dirZ, { recursive: true, force: true });
        }
      }
    } finally {
      rmSync(dirA, { recursive: true, force: true });
    }
  }, 30000);
});
