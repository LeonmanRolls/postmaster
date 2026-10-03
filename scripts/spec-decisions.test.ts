// Tests beside scripts/spec-decisions.ts, moved from its --self-test on #109: 28 controls.
// Each test sets up its own manifest and decisions file instead of relying on files an
// earlier control left behind; the wrapper is spawned directly rather than through bash.
// Merge 8 migrates record to the one-spec shape (#170): per-lane record tests become
// legacy-file tests where the legacy count still implements them, and main's one-spec
// controls join below under one-spec helpers.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SELF = join(import.meta.dir, "run");

interface Run {
  code: number;
  out: string;
  err: string;
}

function go(...args: string[]): Run {
  const r = spawnSync(SELF, ["spec-decisions", ...args], { encoding: "utf8", timeout: 10000 });
  return { code: r.status ?? 1, out: String(r.stdout ?? ""), err: String(r.stderr ?? "") };
}

let tmp = "";
let d = "";
let decisions = "";
let actions = "";

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "spec-decisions-"));
  d = join(tmp, "project", ".postmaster", "runs", "RUN-1");
  mkdirSync(d, { recursive: true });
  decisions = join(d, "spec-decisions.md");
  actions = join(d, "actions.jsonl");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function manifest(lanesJson: string): void {
  writeFileSync(join(d, "manifest.json"), `{"lanes": {${lanesJson}}}\n`);
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// The self-test's stanzas(): grep -c '^## '.
function stanzas(): number {
  try {
    return readFileSync(decisions, "utf8")
      .split("\n")
      .filter((l) => l.startsWith("## ")).length;
  } catch {
    return 0;
  }
}

// The self-test's logged(): tail -1 of the action log.
function logged(): string {
  const lines = readFileSync(actions, "utf8")
    .split("\n")
    .filter((l) => l !== "");
  return lines.length > 0 ? lines[lines.length - 1]! : "";
}

function actionsText(): string {
  try {
    return readFileSync(actions, "utf8");
  } catch {
    return "";
  }
}

// The shell's $(...): trailing newlines stripped.
function strip(s: string): string {
  return s.replace(/\n+$/u, "");
}

function approvedLines(): number {
  return readFileSync(decisions, "utf8")
    .split("\n")
    .filter((l) => l.includes("decision: approved")).length;
}

describe("positive controls", () => {
  test("fresh starts an empty decisions file", () => {
    const r = go(d, "fresh");
    expect(r.code).toBe(0);
    expect(isFile(decisions)).toBe(true);
    expect(statSync(decisions).size).toBe(0);
  }, 10000);

  test("record writes the stanza and logs the spec-review line", () => {
    manifest('"alpha": {}');
    go(d, "fresh");
    const r = go(d, "record", "approved", "abc123");
    expect(r.code).toBe(0);
    expect(stanzas()).toBe(1);
    expect(logged()).toContain('"detail":"approved abc123"');
  }, 10000);

  test("fresh truncates a decided file", () => {
    manifest('"alpha": {}');
    go(d, "fresh");
    go(d, "record", "approved", "abc123");
    go(d, "fresh");
    expect(statSync(decisions).size).toBe(0);
  }, 10000);

  test("a legacy package beside a manifest outcome reads two approvals where the file alone reads one", () => {
    manifest('"alpha": {"outcome": "approved"}, "beta": {}');
    writeFileSync(decisions, "## beta\ndecision: approved\ncommit: def456\nwords: \n\n");
    const c = go(d, "count");
    expect(c.code).toBe(0);
    expect(strip(c.out)).toBe("approved 2\nchanges 0");
    expect(approvedLines()).toBe(1);
  }, 10000);

  test("a legacy drop beside a manifest outcome reads one approval", () => {
    manifest('"alpha": {"outcome": "approved"}, "beta": {}');
    writeFileSync(
      decisions,
      "## beta\ndecision: dropped\ncommit: def456\nwords: we only need one lane\n\n",
    );
    const c = go(d, "count");
    expect(c.code).toBe(0);
    expect(strip(c.out)).toBe("approved 1\nchanges 0");
  }, 10000);

  test("a singleton spec stanza for a lane named spec reads the legacy count, not the shortcut", () => {
    manifest('"spec": {}, "alpha": {"outcome": "approved"}');
    writeFileSync(decisions, "## spec\ndecision: approved\ncommit: abc123\nwords: \n\n");
    const c = go(d, "count");
    expect(c.code).toBe(0);
    expect(strip(c.out)).toBe("approved 2\nchanges 0");
  }, 10000);

  test("a duplicate stanza for one lane counts once", () => {
    manifest('"alpha": {}');
    writeFileSync(
      decisions,
      "## alpha\ndecision: approved\ncommit: abc123\nwords: \n\n## alpha\ndecision: changes\ncommit: def456\nwords: narrower\n\n",
    );
    const r = go(d, "count");
    expect(r.code).toBe(0);
    expect(strip(r.out)).toBe("approved 1\nchanges 1");
  }, 10000);

  test("an approved stanza with a blank commit contributes nothing", () => {
    manifest('"alpha": {}, "beta": {}');
    writeFileSync(
      decisions,
      "## alpha\ndecision: approved\ncommit: \nwords: \n\n## beta\ndecision: approved\ncommit: def456\nwords: \n\n",
    );
    const r = go(d, "count");
    expect(r.code).toBe(0);
    expect(strip(r.out)).toBe("approved 1\nchanges 0");
  }, 10000);
});

describe("negative controls", () => {
  test("a decision outside the triple is refused, and nothing is written", () => {
    manifest('"beta": {}');
    go(d, "fresh");
    const before = stanzas();
    const linesBefore = actionsText();
    const r = go(d, "record", "ok", "abc123");
    expect(r.code).toBe(2);
    expect(stanzas()).toBe(before);
    expect(actionsText()).toBe(linesBefore);
    expect(r.err).toContain("a decision is approved, changes or dropped");
  }, 10000);

  test("a changes with no words is refused", () => {
    manifest('"beta": {}');
    go(d, "fresh");
    const r = go(d, "record", "changes", "def456");
    expect(r.code).toBe(2);
    expect(r.err).toContain("carries the user's words");
  }, 10000);

  test("an approval with words is refused", () => {
    manifest('"beta": {}');
    go(d, "fresh");
    const r = go(d, "record", "approved", "def456", "nice", "work");
    expect(r.code).toBe(2);
    expect(r.err).toContain("carries no words");
  }, 10000);

  test("a missing commit is a usage error", () => {
    const r = go(d, "record", "approved");
    expect(r.code).toBe(1);
    expect(r.err).toContain("usage:");
  }, 10000);

  test("a second record in one package is refused", () => {
    manifest('"beta": {}');
    go(d, "fresh");
    go(d, "record", "approved", "def456");
    const r = go(d, "record", "dropped", "def456", "out");
    expect(r.code).toBe(2);
    expect(stanzas()).toBe(1);
    expect(r.err).toContain("already recorded");
  }, 10000);

  test("a record with no package file is refused", () => {
    manifest('"beta": {}');
    go(d, "fresh");
    rmSync(decisions);
    const r = go(d, "record", "approved", "def456");
    expect(r.code).toBe(1);
    expect(r.err).toContain("run fresh first");
  }, 10000);

  test("a count with no package file is refused", () => {
    manifest('"beta": {}');
    rmSync(decisions, { force: true });
    const r = go(d, "count");
    expect(r.code).toBe(1);
    expect(r.err).toContain("run fresh first");
  }, 10000);

  test("a hand-mangled stanza is refused, not miscounted", () => {
    manifest('"beta": {}');
    writeFileSync(decisions, "## beta\ndecision: approved\n");
    const r = go(d, "count");
    expect(r.code).toBe(2);
    expect(r.err).toContain("incomplete stanza");
  }, 10000);

  test("a count with no manifest is refused", () => {
    manifest('"beta": {}');
    go(d, "fresh");
    rmSync(join(d, "manifest.json"));
    const r = go(d, "count");
    expect(r.code).toBe(1);
    expect(r.err).toContain("cannot read");
  }, 10000);

  test("a dispatch that does not exist is refused", () => {
    const r = go(join(tmp, "nowhere"), "count");
    expect(r.code).toBe(1);
    expect(r.err).toContain("no such dir");
  }, 10000);
});

// One-spec controls from #170, under their own helpers: a one-spec package, a changes
// round, an approval, a stop, a decisions file from before the one-spec change, a legacy
// lane literally named spec, and a mixed file refused.
function oneSpecRun(fn: (d: string) => void): void {
  const tmp = mkdtempSync(join(tmpdir(), "spec-decisions-test-"));
  try {
    const d = join(tmp, "project", ".postmaster", "runs", "RUN-1");
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "manifest.json"), '{"lanes": {"alpha": {}, "beta": {}}}\n');
    fn(d);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function oneSpecGo(
  d: string,
  ...args: string[]
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(SELF, ["spec-decisions", d, ...args], {
    encoding: "utf8",
    timeout: 15_000,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function oneSpecCount(d: string): { status: number | null; approved: number; changes: number } {
  const r = oneSpecGo(d, "count");
  const lines = r.stdout.trim().split("\n");
  const approved = Number((lines[0] ?? "").replace("approved ", ""));
  const changes = Number((lines[1] ?? "").replace("changes ", ""));
  return { status: r.status, approved, changes };
}

describe("a one-spec package", () => {
  test("fresh then record writes one ## spec stanza", () => {
    oneSpecRun((d) => {
      expect(oneSpecGo(d, "fresh").status).toBe(0);
      expect(oneSpecGo(d, "record", "approved", "abc123").status).toBe(0);
      const text = readFileSync(join(d, "spec-decisions.md"), "utf8");
      expect(text).toContain("## spec");
      expect(text).toContain("decision: approved");
      expect(text).toContain("commit: abc123");
      expect(text.split("## ").length - 1).toBe(1);
    });
  });

  test("the log line targets the spec, not a lane", () => {
    oneSpecRun((d) => {
      oneSpecGo(d, "fresh");
      oneSpecGo(d, "record", "approved", "abc123");
      const last = readFileSync(join(d, "actions.jsonl"), "utf8").trim().split("\n").pop() ?? "";
      expect(last).toContain('"target":"spec"');
      expect(last).toContain('"detail":"approved abc123"');
    });
  });
});

describe("an approval", () => {
  test("count reads approved 1 and changes 0", () => {
    oneSpecRun((d) => {
      oneSpecGo(d, "fresh");
      oneSpecGo(d, "record", "approved", "abc123");
      const c = oneSpecCount(d);
      expect(c.status).toBe(0);
      expect(c.approved).toBe(1);
      expect(c.changes).toBe(0);
    });
  });
});

describe("a changes round", () => {
  test("count reads approved 0 and changes 1, and the words are logged", () => {
    oneSpecRun((d) => {
      oneSpecGo(d, "fresh");
      expect(oneSpecGo(d, "record", "changes", "abc123", "narrow", "the", "scope").status).toBe(0);
      const c = oneSpecCount(d);
      expect(c.status).toBe(0);
      expect(c.approved).toBe(0);
      expect(c.changes).toBe(1);
      const last = readFileSync(join(d, "actions.jsonl"), "utf8").trim().split("\n").pop() ?? "";
      expect(last).toContain('"detail":"changes abc123 narrow the scope"');
    });
  });

  test("a revised package after changes can be approved", () => {
    oneSpecRun((d) => {
      oneSpecGo(d, "fresh");
      oneSpecGo(d, "record", "changes", "abc123", "narrow", "the", "scope");
      oneSpecGo(d, "fresh");
      oneSpecGo(d, "record", "approved", "def456");
      const c = oneSpecCount(d);
      expect(c.approved).toBe(1);
      expect(c.changes).toBe(0);
    });
  });
});

describe("a stop", () => {
  test("count reads approved 0 and changes 0", () => {
    oneSpecRun((d) => {
      oneSpecGo(d, "fresh");
      expect(oneSpecGo(d, "record", "dropped", "abc123", "stop", "the", "run").status).toBe(0);
      const c = oneSpecCount(d);
      expect(c.status).toBe(0);
      expect(c.approved).toBe(0);
      expect(c.changes).toBe(0);
    });
  });
});

describe("a decisions file from before the change", () => {
  test("per-lane changes stanzas still count as changes 2", () => {
    oneSpecRun((d) => {
      writeFileSync(
        join(d, "spec-decisions.md"),
        "## alpha\ndecision: changes\ncommit: abc123\nwords: tighter\n\n## beta\ndecision: changes\ncommit: def456\nwords: smaller\n\n",
      );
      const c = oneSpecCount(d);
      expect(c.status).toBe(0);
      expect(c.approved).toBe(0);
      expect(c.changes).toBe(2);
    });
  });

  test("per-lane approvals still count, each lane once", () => {
    oneSpecRun((d) => {
      writeFileSync(
        join(d, "manifest.json"),
        '{"lanes": {"alpha": {"outcome": "approved"}, "beta": {}}}\n',
      );
      writeFileSync(
        join(d, "spec-decisions.md"),
        "## alpha\ndecision: approved\ncommit: abc123\nwords: \n\n## beta\ndecision: approved\ncommit: def456\nwords: \n\n",
      );
      const c = oneSpecCount(d);
      expect(c.status).toBe(0);
      expect(c.approved).toBe(2);
      expect(c.changes).toBe(0);
    });
  });

  test("a lane literally named spec still counts as a lane, not the run-level stanza", () => {
    oneSpecRun((d) => {
      writeFileSync(join(d, "manifest.json"), '{"lanes": {"spec": {}, "alpha": {}}}\n');
      writeFileSync(
        join(d, "spec-decisions.md"),
        "## spec\ndecision: changes\ncommit: abc123\nwords: tighter\n\n## alpha\ndecision: approved\ncommit: def456\nwords: \n\n",
      );
      const c = oneSpecCount(d);
      expect(c.status).toBe(0);
      expect(c.approved).toBe(1);
      expect(c.changes).toBe(1);
    });
  });
});

describe("a mixed file", () => {
  test("count refuses a spec stanza beside lane stanzas instead of miscounting", () => {
    oneSpecRun((d) => {
      writeFileSync(
        join(d, "spec-decisions.md"),
        "## spec\ndecision: approved\ncommit: abc123\nwords: \n\n## alpha\ndecision: changes\ncommit: def456\nwords: narrower\n\n",
      );
      const r = oneSpecGo(d, "count");
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("more than one stanza");
    });
  });

  test("record refuses to append a spec stanza beside lane stanzas", () => {
    oneSpecRun((d) => {
      writeFileSync(
        join(d, "spec-decisions.md"),
        "## alpha\ndecision: changes\ncommit: abc123\nwords: tighter\n\n",
      );
      const r = oneSpecGo(d, "record", "approved", "def456");
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("already recorded");
      expect(readFileSync(join(d, "spec-decisions.md"), "utf8")).not.toContain("## spec");
    });
  });
});
