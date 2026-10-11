// Oracle for #431, committed before the change: project setup refuses a
// Plane tracker with no API origin known from this setup's answers, the
// project's existing settings or the global config, leaving the settings
// as they were; the refusal names the API origin and the plane.url answer;
// an origin the global config or the existing settings already hold is
// enough. C1 and C3 drive `run setup --project` as a subprocess over
// scratch configs and scratch git repositories, never importing the
// change; C2 is asserted on each refused case; C3's first case proves the
// inherited origin works by listing one stub project through it.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  type Spawned,
  type Staged,
  planeProjects,
  setupInteractive,
  setupProject,
  stage,
  startStub,
  writeRepoFile,
} from "./acceptance-431.ts";
import { type RunResult } from "./lib/proc.ts";

// Two lanes and no [tracker], as the ticket's checks stage it.
const GLOBAL = `projects_roots = ["~/Code"]
confine = "off"
[lanes.alpha]
harness = "claude"
model = "m-a"
[lanes.beta]
harness = "codex"
model = "m-b"
`;

function cleanup(s: Staged): void {
  rmSync(s.dir, { recursive: true, force: true });
}

function settingsPath(s: Staged): string {
  return join(s.repo, ".postmaster", "settings.toml");
}

function settingsData(s: Staged): Record<string, unknown> {
  return Bun.TOML.parse(readFileSync(settingsPath(s), "utf8"));
}

function tableOf(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function expectOk(r: RunResult | Spawned, what: string): void {
  if (r.code !== 0) {
    throw new Error(`${what}: exit ${r.code}\n--- stdout ---\n${r.out}\n--- stderr ---\n${r.err}`);
  }
}

// C2: every refusal names the missing API origin and says how to give it.
function expectRefusal(r: RunResult): void {
  expect(r.code).toBe(1);
  const out = r.out + r.err;
  expect(out).toContain("API origin");
  expect(out).toContain("plane.url");
}

// Map the interactive questions from a dry run on a scratch repo: dry runs
// ask everything and write nothing, so the map fits the real run on every
// platform, whatever uname-gated blocks appear.
function promptOrder(s: Staged): string[] {
  const probe = setupInteractive(s, "\n".repeat(300), ["--dry-run"]);
  expectOk(probe, "prompt probe");
  return probe.err
    .split("): ")
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

describe("C1: setup refuses a Plane tracker with no API origin", () => {
  test("answers naming plane with a workspace but no origin are refused, writing nothing", () => {
    const s = stage(GLOBAL);
    const r = setupProject(s, "tracker=plane\nplane.workspace=ws1");
    expectRefusal(r);
    expect(existsSync(settingsPath(s))).toBe(false);
    cleanup(s);
  });

  test("a dry run refuses the same answers", () => {
    const s = stage(GLOBAL);
    const r = setupProject(s, "tracker=plane\nplane.workspace=ws1", ["--dry-run"]);
    expectRefusal(r);
    expect(existsSync(settingsPath(s))).toBe(false);
    cleanup(s);
  });

  test("an interactive blank origin is refused, writing nothing", () => {
    const s = stage(GLOBAL);
    const order = promptOrder(s);
    const trackerAt = order.findIndex((p) => p.includes("How are tickets tracked"));
    if (trackerAt < 0) throw new Error(`tracker prompt missing, saw:\n${order.join("\n")}`);
    // The tracker's answer opens the plane branch: the origin question is
    // next and left blank, the workspace after it.
    const lines = Array<string>(order.length + 10).fill("");
    lines[trackerAt] = "plane";
    lines[trackerAt + 2] = "ws1";
    const r = setupInteractive(s, `${lines.join("\n")}\n`);
    expectRefusal(r);
    expect(existsSync(settingsPath(s))).toBe(false);
    cleanup(s);
  });

  test("an unrelated update on settings already naming plane without an origin is refused, file untouched", () => {
    const s = stage(GLOBAL);
    const before = '[tracker]\nkind = "plane"\nworkspace = "ws1"\n';
    writeRepoFile(s.repo, ".postmaster/settings.toml", before);
    const r = setupProject(s, "max_runs=3\noverwrite=yes");
    expectRefusal(r);
    expect(readFileSync(settingsPath(s), "utf8")).toBe(before);
    cleanup(s);
  });

  test("control: the same answers plus plane.url write the tracker with the url", () => {
    const s = stage(GLOBAL);
    const r = setupProject(
      s,
      "tracker=plane\nplane.workspace=ws1\nplane.url=https://plane.example",
    );
    expectOk(r, "control setup");
    const tracker = tableOf(settingsData(s).tracker);
    expect(tracker.kind).toBe("plane");
    expect(tracker.workspace).toBe("ws1");
    expect(tracker.url).toBe("https://plane.example");
    cleanup(s);
  });
});

describe("C3: an origin already held is enough", () => {
  test("an origin held only in the global config writes no url and serves plane projects through it", async () => {
    const { server, url } = startStub("ws1", [
      { id: "p-1", identifier: "PM", name: "Stub project" },
    ]);
    try {
      const s = stage(`${GLOBAL}[tracker]\nkind = "plane"\nurl = "${url}"\nworkspace = "wsg"\n`);
      const r = setupProject(s, "tracker=plane\nplane.workspace=ws1");
      expectOk(r, "setup against a global origin");
      const tracker = tableOf(settingsData(s).tracker);
      expect(tracker.kind).toBe("plane");
      expect(tracker.workspace).toBe("ws1");
      expect("url" in tracker).toBe(false);
      const listed = await planeProjects(s, "stub-key");
      expectOk(listed, "plane projects");
      expect(listed.out).toContain("PM\tp-1\tStub project");
      cleanup(s);
    } finally {
      server.stop();
    }
  });

  test("an origin held in the existing settings survives re-answering the tracker", () => {
    const s = stage(GLOBAL);
    writeRepoFile(
      s.repo,
      ".postmaster/settings.toml",
      '[tracker]\nkind = "plane"\nurl = "https://saved.example"\nworkspace = "ws1"\n',
    );
    const r = setupProject(s, "tracker=plane\noverwrite=yes");
    expectOk(r, "setup over saved settings");
    const tracker = tableOf(settingsData(s).tracker);
    expect(tracker.kind).toBe("plane");
    expect(tracker.workspace).toBe("ws1");
    expect(tracker.url).toBe("https://saved.example");
    cleanup(s);
  });
});
