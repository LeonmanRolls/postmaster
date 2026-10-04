// Controls for spec-session, beside the script: a brief with and without a preferences
// file, and with and without lane drafts; a brief that fails when the editor link
// cannot be built; a brief that finds drafts under a repo path with spaces; an
// approval through a synthesis path with a colon and a space; an approval of unchanged
// text that commits nothing and records the existing commit; an approval of changed
// text that makes one commit holding exactly the copy; an approval refused while the
// synthesis worktree holds another change; an approval refused over a stray spec edit
// or a missing spec; and an approval refused when no spec is committed there. A
// ticket holding waybill-like headers keeps every line in the brief.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tool = dirname(here);
const script = join(here, "run");

interface Scratch {
  d: string;
  synth: string;
  wtA: string;
  root: string;
  cfgDir: string;
  cleanup: () => void;
}

function scratch(): Scratch {
  const tmp = mkdtempSync(join(tmpdir(), "spec-session-test-"));
  const root = join(tmp, "project");
  const d = join(root, ".postmaster", "runs", "RUN-1");
  const synth = join(root, ".worktrees", "RUN-1");
  const wtA = join(root, ".worktrees", "RUN-1-alpha");
  const cfgDir = join(tmp, "config");
  mkdirSync(join(d, "spec-review"), { recursive: true });
  mkdirSync(join(root, ".worktrees"), { recursive: true });
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(join(cfgDir, "config.toml"), "");

  const specText = "# Workhorse spec: scratch\n\nBuild the thing.\n";
  writeFileSync(join(d, "spec-review", "WORKHORSE-SPEC.md"), specText);
  writeFileSync(join(d, "manifest.json"), '{"lanes": {"alpha": {}, "beta": {}}}\n');
  writeFileSync(
    join(d, "run.json"),
    '{"config":{"planning":{"review_link":"https://code.example/?folder={path}"}}}\n',
  );
  writeFileSync(
    join(d, "brief.md"),
    [
      "# Waybill: 7",
      "turnpikes: none",
      "",
      "## Ticket",
      "Do the thing.",
      "## Problem / feature",
      "Accept it when it works.",
      "",
      "## Project profile",
      `repo: ${root}          default branch: main       BASE: abc`,
      "",
      "## Dispatch",
      "name: 7, Do the thing",
      `dispatch: ${d}`,
      `synthesis worktree: ${synth}`,
      "tool: /nowhere",
      "",
    ].join("\n"),
  );

  for (const path of [synth, wtA]) {
    mkdirSync(path, { recursive: true });
    const g = (...args: string[]) => {
      const r = spawnSync("git", ["-C", path, ...args], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    };
    g("init", "-q", "-b", "main");
    g("config", "user.email", "t@example.com");
    g("config", "user.name", "t");
    writeFileSync(join(path, "README"), "scratch\n");
    g("add", "README");
    g("commit", "-q", "-m", "base");
  }
  writeFileSync(join(synth, "WORKHORSE-SPEC.md"), specText);
  {
    const g = (...args: string[]) => {
      const r = spawnSync("git", ["-C", synth, ...args], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    };
    g("add", "WORKHORSE-SPEC.md");
    g("commit", "-q", "-m", "workhorse spec");
  }

  return {
    d,
    synth,
    wtA,
    root,
    cfgDir,
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
  };
}

function go(
  cfgDir: string,
  ...args: string[]
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(script, ["spec-session", ...args], {
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, POSTMASTER_CONFIG: join(cfgDir, "config.toml") },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function head(synth: string): string {
  const r = spawnSync("git", ["-C", synth, "rev-parse", "HEAD"], { encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

function initRepo(path: string): void {
  mkdirSync(path, { recursive: true });
  const g = (...args: string[]) => {
    const r = spawnSync("git", ["-C", path, ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  };
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "t");
}

function commitFile(path: string, name: string, text: string, message: string): void {
  writeFileSync(join(path, name), text);
  const g = (...args: string[]) => {
    const r = spawnSync("git", ["-C", path, ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  };
  g("add", name);
  g("commit", "-q", "-m", message);
}

function rewriteWaybillLine(d: string, prefix: string, value: string): void {
  const briefPath = join(d, "brief.md");
  const lines = readFileSync(briefPath, "utf8").split("\n");
  const i = lines.findIndex((l) => l.startsWith(prefix));
  if (i < 0) throw new Error(`no ${prefix} line in the waybill`);
  lines[i] = value;
  writeFileSync(briefPath, lines.join("\n"));
}

describe("a brief", () => {
  test("holds the ticket, the link, the copy's path, no drafts, no preferences, and the runbook", () => {
    const s = scratch();
    try {
      const r = go(s.cfgDir, "brief", s.d);
      const briefPath = join(s.d, "spec-session-brief.md");
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(briefPath);
      const body = readFileSync(briefPath, "utf8");
      expect(body).toContain("Do the thing.");
      expect(body).toContain("## Problem / feature");
      expect(body).toContain("Accept it when it works.");
      // The link's folder is realpath'd by spec-review-link, and macOS's
      // /var/folders is a symlink to /private/var/folders.
      expect(body).toContain(
        `https://code.example/?folder=${realpathSync(join(s.d, "spec-review"))}`,
      );
      expect(body).toContain(join(s.d, "spec-review", "WORKHORSE-SPEC.md"));
      expect(body).toContain("There are no lane drafts.");
      expect(body).toContain("None are set.");
      expect(body).toContain(join(tool, "skills", "postmaster", "spec-session.md"));
    } finally {
      s.cleanup();
    }
  });

  test("copies a preferences file word for word", () => {
    const s = scratch();
    try {
      writeFileSync(
        join(s.cfgDir, "preferences.md"),
        "Prefer short sentences.\nAnd concrete names.\n",
      );
      const r = go(s.cfgDir, "brief", s.d);
      expect(r.status).toBe(0);
      const body = readFileSync(join(s.d, "spec-session-brief.md"), "utf8");
      expect(body).toContain("Prefer short sentences.\nAnd concrete names.");
      expect(body).not.toContain("None are set.");
    } finally {
      s.cleanup();
    }
  });

  test("lists a lane draft by commit, with its text", () => {
    const s = scratch();
    try {
      writeFileSync(join(s.wtA, "WORKHORSE-SPEC.md"), "draft A\n");
      const g = (...args: string[]) => {
        const r = spawnSync("git", ["-C", s.wtA, ...args], { encoding: "utf8" });
        if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
      };
      g("add", "WORKHORSE-SPEC.md");
      g("commit", "-q", "-m", "draft A");
      const r = go(s.cfgDir, "brief", s.d);
      expect(r.status).toBe(0);
      const body = readFileSync(join(s.d, "spec-session-brief.md"), "utf8");
      expect(body).toMatch(/alpha: commit `[0-9a-f]{40}`/u);
      expect(body).toContain("Draft text:");
      expect(body).toContain("  draft A");
      expect(body).not.toContain("There are no lane drafts.");
    } finally {
      s.cleanup();
    }
  });

  test("fails when the editor link cannot be built", () => {
    const s = scratch();
    try {
      writeFileSync(
        join(s.d, "run.json"),
        '{"config":{"planning":{"review_link":"https://code.example/open"}}}\n',
      );
      const r = go(s.cfgDir, "brief", s.d);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("cannot build the editor link");
    } finally {
      s.cleanup();
    }
  });

  test("keeps ticket headers that resemble waybill sections", () => {
    const s = scratch();
    try {
      writeFileSync(
        join(s.d, "brief.md"),
        [
          "# Waybill: 7",
          "turnpikes: none",
          "",
          "## Ticket",
          "Do the thing.",
          "",
          "## Dispatch",
          "A section of the ticket's own.",
          "",
          "```",
          "## Project profile",
          "repo: /example",
          "```",
          "",
          "The last acceptance criterion lives here.",
          "",
          "## Project profile",
          `repo: ${s.root}          default branch: main       BASE: abc`,
          "",
          "## Dispatch",
          "name: 7, Do the thing",
          `dispatch: ${s.d}`,
          `synthesis worktree: ${s.synth}`,
          "tool: /nowhere",
          "",
        ].join("\n"),
      );
      const r = go(s.cfgDir, "brief", s.d);
      expect(r.status).toBe(0);
      const body = readFileSync(join(s.d, "spec-session-brief.md"), "utf8");
      expect(body).toContain("## Dispatch\nA section of the ticket's own.");
      expect(body).toContain("## Project profile\nrepo: /example");
      expect(body).toContain("The last acceptance criterion lives here.");
    } finally {
      s.cleanup();
    }
  });

  test("finds lane drafts when the repo path holds spaces", () => {
    const s = scratch();
    try {
      const repoDir = join(s.root, "My Projects", "app");
      const wt = join(repoDir, ".worktrees", "RUN-1-alpha");
      initRepo(wt);
      commitFile(wt, "WORKHORSE-SPEC.md", "spaced draft\n", "draft");
      rewriteWaybillLine(
        s.d,
        "repo:",
        `repo: ${repoDir}          default branch: main       BASE: abc`,
      );
      const r = go(s.cfgDir, "brief", s.d);
      expect(r.status).toBe(0);
      const body = readFileSync(join(s.d, "spec-session-brief.md"), "utf8");
      expect(body).toContain("spaced draft");
      expect(body).not.toContain("There are no lane drafts.");
    } finally {
      s.cleanup();
    }
  });
});

describe("an approval", () => {
  test("of unchanged text commits nothing and records the existing commit", () => {
    const s = scratch();
    try {
      writeFileSync(join(s.d, "spec-decisions.md"), "");
      const before = head(s.synth);
      const r = go(s.cfgDir, "approve", s.d);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(before);
      expect(head(s.synth)).toBe(before);
      const decisions = readFileSync(join(s.d, "spec-decisions.md"), "utf8");
      expect(decisions).toContain("decision: approved");
      expect(decisions).toContain(`commit: ${before}`);
    } finally {
      s.cleanup();
    }
  });

  test("of changed text makes one commit holding exactly the copy", () => {
    const s = scratch();
    try {
      writeFileSync(join(s.d, "spec-decisions.md"), "");
      const before = head(s.synth);
      const edited =
        "# Workhorse spec: scratch\n\nBuild the thing.\n\nA new line the user added.\n";
      writeFileSync(join(s.d, "spec-review", "WORKHORSE-SPEC.md"), edited);
      const r = go(s.cfgDir, "approve", s.d);
      expect(r.status).toBe(0);
      const after = head(s.synth);
      expect(r.stdout.trim()).toBe(after);
      expect(after).not.toBe(before);
      const show = spawnSync("git", ["-C", s.synth, "show", "HEAD:WORKHORSE-SPEC.md"], {
        encoding: "utf8",
      });
      expect(show.stdout).toBe(edited);
      const decisions = readFileSync(join(s.d, "spec-decisions.md"), "utf8");
      expect(decisions).toContain(`commit: ${after}`);
    } finally {
      s.cleanup();
    }
  });

  test("is refused while the synthesis worktree holds another change", () => {
    const s = scratch();
    try {
      writeFileSync(join(s.d, "spec-decisions.md"), "");
      writeFileSync(join(s.synth, "stray.txt"), "stray\n");
      const r = go(s.cfgDir, "approve", s.d);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("another change");
      expect(readFileSync(join(s.d, "spec-decisions.md"), "utf8")).toBe("");
    } finally {
      s.cleanup();
    }
  });

  test("runs when the synthesis worktree path holds a colon and a space", () => {
    const s = scratch();
    try {
      const synth = join(s.root, "my:project", "My Work", "wt");
      initRepo(synth);
      const copy = readFileSync(join(s.d, "spec-review", "WORKHORSE-SPEC.md"), "utf8");
      commitFile(synth, "WORKHORSE-SPEC.md", copy, "workhorse spec");
      rewriteWaybillLine(s.d, "synthesis worktree:", `synthesis worktree: ${synth}`);
      writeFileSync(join(s.d, "spec-decisions.md"), "");
      const r = go(s.cfgDir, "approve", s.d);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(head(synth));
      expect(readFileSync(join(s.d, "spec-decisions.md"), "utf8")).toContain("decision: approved");
    } finally {
      s.cleanup();
    }
  });

  test("is refused over a worktree spec edit matching neither the committed spec nor the copy", () => {
    const s = scratch();
    try {
      writeFileSync(join(s.d, "spec-decisions.md"), "");
      writeFileSync(
        join(s.synth, "WORKHORSE-SPEC.md"),
        "# Workhorse spec: scratch\n\nA stray edit.\n",
      );
      const before = head(s.synth);
      const r = go(s.cfgDir, "approve", s.d);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("uncommitted edit");
      expect(head(s.synth)).toBe(before);
      expect(readFileSync(join(s.d, "spec-decisions.md"), "utf8")).toBe("");
    } finally {
      s.cleanup();
    }
  });

  test("is refused over a worktree spec edit beside a changed copy", () => {
    const s = scratch();
    try {
      writeFileSync(join(s.d, "spec-decisions.md"), "");
      writeFileSync(
        join(s.synth, "WORKHORSE-SPEC.md"),
        "# Workhorse spec: scratch\n\nA stray edit.\n",
      );
      writeFileSync(
        join(s.d, "spec-review", "WORKHORSE-SPEC.md"),
        "# Workhorse spec: scratch\n\nBuild the thing.\n\nA new line the user added.\n",
      );
      const before = head(s.synth);
      const r = go(s.cfgDir, "approve", s.d);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("uncommitted edit");
      expect(head(s.synth)).toBe(before);
      expect(readFileSync(join(s.d, "spec-decisions.md"), "utf8")).toBe("");
    } finally {
      s.cleanup();
    }
  });

  test("is refused when the worktree spec is missing and the copy matches", () => {
    const s = scratch();
    try {
      writeFileSync(join(s.d, "spec-decisions.md"), "");
      rmSync(join(s.synth, "WORKHORSE-SPEC.md"));
      const before = head(s.synth);
      const r = go(s.cfgDir, "approve", s.d);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("missing from the synthesis worktree");
      expect(head(s.synth)).toBe(before);
      expect(readFileSync(join(s.d, "spec-decisions.md"), "utf8")).toBe("");
    } finally {
      s.cleanup();
    }
  });

  test("is refused when no spec is committed in the synthesis worktree", () => {
    const s = scratch();
    try {
      writeFileSync(join(s.d, "spec-decisions.md"), "");
      const g = (...args: string[]) => {
        const r = spawnSync("git", ["-C", s.synth, ...args], { encoding: "utf8" });
        if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
      };
      g("rm", "-q", "WORKHORSE-SPEC.md");
      g("commit", "-q", "-m", "drop the spec");
      const before = head(s.synth);
      const r = go(s.cfgDir, "approve", s.d);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("no committed WORKHORSE-SPEC.md");
      expect(head(s.synth)).toBe(before);
      expect(readFileSync(join(s.d, "spec-decisions.md"), "utf8")).toBe("");
    } finally {
      s.cleanup();
    }
  });
});
