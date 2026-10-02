// Tests beside scripts/setup.ts, moved from its --self-test on #109: 27 controls.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tryTomlFile } from "./lib/data.ts";
import { run } from "./lib/proc.ts";

const SELF = join(import.meta.dir, "setup.sh");

let tmp = "";
let plainRc = -1;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmaster-"));
  mkdirSync(join(tmp, "bin"), { recursive: true });
  for (const h of ["claude", "codex", "grok", "agy", "muse", "mimo", "pi"]) {
    const p = join(tmp, "bin", h);
    writeFileSync(p, "#!/bin/sh\nexit 0\n", "utf8");
    chmodSync(p, 0o755);
  }
  answers("plain");
  plainRc = runSetup("plain");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function answers(name: string, extra?: string): void {
  const lines = [
    "lanes=alpha, beta, sentinel",
    "lane.alpha.harness=bash",
    "lane.alpha.model=m1",
    "lane.beta.harness=bash",
    "lane.beta.model=m2",
    "lane.sentinel.harness=bash",
    "lane.sentinel.model=m3",
    "workhorses=alpha, beta",
    "coachman.harness=bash",
    "coachman.model=judge",
    "fallback.harness=bash",
    "fallback.model=spare",
    "postmaster.harness=bash",
    "postmaster.model=pm",
  ];
  if (extra) lines.push(extra);
  writeFileSync(join(tmp, `${name}.answers`), `${lines.join("\n")}\n`, "utf8");
}

function runSetup(name: string): number {
  const r = run(
    "bash",
    [SELF, "--answers", join(tmp, `${name}.answers`), "--config", join(tmp, `${name}.toml`)],
    {
      env: {
        ...(process.env as Record<string, string>),
        PATH: `${join(tmp, "bin")}:${process.env.PATH}`,
      },
    },
  );
  writeFileSync(join(tmp, `${name}.out`), r.out + r.err, "utf8");
  return r.code;
}

function limit(name: string): string {
  const cfg = tryTomlFile(join(tmp, `${name}.toml`));
  if (!cfg) return "error";
  const r = cfg.review as Record<string, unknown> | undefined;
  return String(r?.round_timeout_seconds ?? "error");
}

function capLimit(name: string, role: string, key: string): string {
  const cfg = tryTomlFile(join(tmp, `${name}.toml`));
  if (!cfg) return "";
  const c = (cfg.limits as Record<string, unknown> | undefined) ?? {};
  const r = (c[role] as Record<string, unknown> | undefined) ?? {};
  return String(r[key] ?? c[key] ?? "");
}

function planningLink(name: string): string {
  const cfg = tryTomlFile(join(tmp, `${name}.toml`));
  if (!cfg) return "";
  const p = cfg.planning as Record<string, unknown> | undefined;
  return String(p?.review_link ?? "");
}

describe("positive controls", () => {
  test("a lens given its own lanes is written to [team.lens_reviewers]", () => {
    answers("lens", "reviewers.security=alpha, beta, sentinel");
    const lensRc = runSetup("lens");
    const cfg = tryTomlFile(join(tmp, "lens.toml"));
    expect(lensRc).toBe(0);
    expect(cfg).not.toBeNull();
    expect(JSON.stringify((cfg?.team as Record<string, unknown> | undefined)?.lens_reviewers)).toBe(
      '{"security":["alpha","beta","sentinel"]}',
    );
  }, 30000);

  test("the written config resolves: the reviewers default to the workhorses, and security has its own", () => {
    const r = run("bash", [
      join(import.meta.dir, "reviewers.sh"),
      "lines",
      "--config",
      join(tmp, "lens.toml"),
    ]);
    expect(r.out.trim()).toBe(
      "reviewers: alpha, beta\nbug reviewers: \nsecurity reviewers: alpha, beta, sentinel",
    );
  }, 30000);

  test("without lens answers there is no table, as before", () => {
    const cfg = tryTomlFile(join(tmp, "plain.toml"));
    expect(plainRc).toBe(0);
    expect(cfg).not.toBeNull();
    expect((cfg?.team as Record<string, unknown> | undefined)?.lens_reviewers).toBeUndefined();
    expect(JSON.stringify((cfg?.team as Record<string, unknown> | undefined)?.reviewers)).toBe(
      '["alpha","beta"]',
    );
  }, 30000);

  test("the coachman, the fallback and the postmaster each get their env file, with or without an effort", () => {
    answers(
      "roles",
      "coachman.effort=max\ncoachman.env_file=~/.postmaster/lanes/judge.env\nfallback.env_file=spare.env\npostmaster.env_file=~/.postmaster/lanes/pm.env",
    );
    const rolesRc = runSetup("roles");
    const cfg = tryTomlFile(join(tmp, "roles.toml"));
    const t = cfg?.team as Record<string, unknown> | undefined;
    expect(rolesRc).toBe(0);
    expect(cfg).not.toBeNull();
    expect(JSON.stringify(t?.coachman)).toBe(
      '{"harness":"bash","model":"judge","effort":"max","env_file":"~/.postmaster/lanes/judge.env"}',
    );
    expect(JSON.stringify(t?.coachman_fallback)).toBe(
      '{"harness":"bash","model":"spare","env_file":"spare.env"}',
    );
    expect(JSON.stringify(t?.postmaster)).toBe(
      '{"harness":"bash","model":"pm","env_file":"~/.postmaster/lanes/pm.env"}',
    );
  }, 30000);

  test("a role with no env file answer gets no env_file key", () => {
    const cfg = tryTomlFile(join(tmp, "plain.toml"));
    const t = cfg?.team as Record<string, unknown> | undefined;
    expect(JSON.stringify(t?.coachman)).toBe('{"harness":"bash","model":"judge"}');
  }, 30000);

  test("a planning link defaults to empty under [planning]", () => {
    expect(planningLink("plain")).toBe("");
  }, 30000);

  test("the planning link template is stored under [planning]", () => {
    answers("planlink", "planning.review_link=https://code.example/open?file={path}");
    const planlinkRc = runSetup("planlink");
    expect(planlinkRc).toBe(0);
    expect(planningLink("planlink")).toBe("https://code.example/open?file={path}");
  }, 30000);

  test("launch memory and process caps default to 8G and 512", () => {
    expect(capLimit("plain", "default", "memory_max")).toBe("8G");
    expect(capLimit("plain", "default", "tasks_max")).toBe("512");
  }, 30000);

  test("a role can override either cap and inherit the other", () => {
    answers(
      "caps",
      "limits.memory_max=8G\nlimits.tasks_max=384\nlimits.lane.memory_max=2G\nlimits.reviewer.tasks_max=96",
    );
    const capsRc = runSetup("caps");
    expect(capsRc).toBe(0);
    expect(capLimit("caps", "default", "memory_max")).toBe("8G");
    expect(capLimit("caps", "default", "tasks_max")).toBe("384");
    expect(capLimit("caps", "lane", "memory_max")).toBe("2G");
    expect(capLimit("caps", "lane", "tasks_max")).toBe("384");
    expect(capLimit("caps", "reviewer", "memory_max")).toBe("8G");
    expect(capLimit("caps", "reviewer", "tasks_max")).toBe("96");
  }, 30000);

  test("a malformed default memory cap is refused, and nothing is written", () => {
    answers("badmemory", "limits.memory_max=4.5G");
    const badmemoryRc = runSetup("badmemory");
    const out = readFileSync(join(tmp, "badmemory.out"), "utf8");
    expect(badmemoryRc).toBe(1);
    expect(existsSync(join(tmp, "badmemory.toml"))).toBe(false);
    expect(out).toContain("memory_max must be");
  }, 30000);

  test("a zero role process cap is refused, and nothing is written", () => {
    answers("badtasks", "limits.reviewer.tasks_max=0");
    const badtasksRc = runSetup("badtasks");
    const out = readFileSync(join(tmp, "badtasks.out"), "utf8");
    expect(badtasksRc).toBe(1);
    expect(existsSync(join(tmp, "badtasks.toml"))).toBe(false);
    expect(out).toContain("reviewer.tasks_max must be");
  }, 30000);

  test("a review round's time limit defaults to 2400 seconds, under [review]", () => {
    expect(limit("plain")).toBe("2400");
  }, 30000);

  test("an answer sets it, up to 86400", () => {
    answers("limit", "round_timeout_seconds=86400");
    const limitRc = runSetup("limit");
    expect(limitRc).toBe(0);
    expect(limit("limit")).toBe("86400");
  }, 30000);

  test("setup names unsupported bug reviewers and warns when none has a review form", () => {
    answers("no-bug", "reviewers.bug=alpha, beta");
    const noBugRc = runSetup("no-bug");
    const out = readFileSync(join(tmp, "no-bug.out"), "utf8");
    expect(noBugRc).toBe(0);
    expect(out).toContain("bug reviewer 'alpha' uses bash, which has no code-review form");
    expect(out).toContain("bug reviewer 'beta' uses bash, which has no code-review form");
    expect(out).toContain("warning: no configured bug reviewer has a code-review form");
  }, 30000);

  test("setup warns for the ineligible lane and resolves the eligible bug reviewer", () => {
    answers("mixed-bug", "reviewers.bug=alpha, beta");
    const ap = join(tmp, "mixed-bug.answers");
    const swapped = readFileSync(ap, "utf8")
      .replace(/^lane\.alpha\.harness=bash$/mu, "lane.alpha.harness=claude")
      .replace(/^lane\.beta\.harness=bash$/mu, "lane.beta.harness=pi");
    writeFileSync(ap, swapped, "utf8");
    const mixedBugRc = runSetup("mixed-bug");
    const out = readFileSync(join(tmp, "mixed-bug.out"), "utf8");
    const er = run("bash", [
      join(import.meta.dir, "reviewers.sh"),
      "eligible",
      "bug",
      "--config",
      join(tmp, "mixed-bug.toml"),
    ]);
    expect(mixedBugRc).toBe(0);
    expect(out).toContain("bug reviewer 'beta' uses pi, which has no code-review form");
    expect(er.out.trim()).toBe("alpha");
  }, 30000);
});

describe("negative controls", () => {
  const badLimits = [
    "0",
    "-60",
    "abc",
    "1.5",
    "0600",
    "40 minutes",
    "86401",
    "9999999999999999999",
  ];
  for (let n = 0; n < badLimits.length; n++) {
    const v = badLimits[n] ?? "";
    const name = `limit${n + 1}`;
    test(`a round time limit of '${v}' is refused, and nothing is written`, () => {
      answers(name, `round_timeout_seconds=${v}`);
      const rc = runSetup(name);
      const out = readFileSync(join(tmp, `${name}.out`), "utf8");
      expect(rc).toBe(1);
      expect(existsSync(join(tmp, `${name}.toml`))).toBe(false);
      expect(out).toContain("round_timeout_seconds must be");
    }, 30000);
  }

  test("a lens reviewer that is not a lane is refused, and nothing is written", () => {
    answers("ghost", "reviewers.security=alpha, ghost");
    const ghostRc = runSetup("ghost");
    const out = readFileSync(join(tmp, "ghost.out"), "utf8");
    expect(ghostRc).toBe(1);
    expect(existsSync(join(tmp, "ghost.toml"))).toBe(false);
    expect(out).toContain("security reviewer 'ghost' is not one of the lanes");
  }, 30000);

  test("a coachman on a lane's model is refused", () => {
    answers("shared", "coachman.model=m1");
    const f = join(tmp, "shared.answers");
    const text = readFileSync(f, "utf8").replace(/^coachman\.model=judge$\n?/mu, "");
    writeFileSync(f, text, "utf8");
    const sharedRc = runSetup("shared");
    const out = readFileSync(join(tmp, "shared.out"), "utf8");
    expect(sharedRc).toBe(1);
    expect(existsSync(join(tmp, "shared.toml"))).toBe(false);
    expect(out).toContain("cannot run on a lane's model");
  }, 30000);

  test("a missing answer is refused, naming it", () => {
    answers("missing");
    const f = join(tmp, "missing.answers");
    const text = readFileSync(f, "utf8").replace(/^fallback\.model=.*$\n?/mu, "");
    writeFileSync(f, text, "utf8");
    const missingRc = runSetup("missing");
    const out = readFileSync(join(tmp, "missing.out"), "utf8");
    expect(missingRc).toBe(1);
    expect(existsSync(join(tmp, "missing.toml"))).toBe(false);
    expect(out).toContain("no answer for fallback.model");
  }, 30000);

  test("a non-empty planning link without {path} is refused", () => {
    answers("badlink", "planning.review_link=https://code.example/open");
    const badlinkRc = runSetup("badlink");
    const out = readFileSync(join(tmp, "badlink.out"), "utf8");
    expect(badlinkRc).toBe(1);
    expect(existsSync(join(tmp, "badlink.toml"))).toBe(false);
    expect(out).toContain("planning.review_link must contain {path}");
  }, 30000);
});
