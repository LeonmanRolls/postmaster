// Tests beside scripts/setup.ts, moved from its --self-test on #109: 27 controls.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tryTomlFile } from "./lib/data.ts";
import { run } from "./lib/proc.ts";

const SELF = join(import.meta.dir, "run");

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
  // The capping controls below force Linux either way (linuxSystemPath),
  // since launch caps are probed from uname and a Mac cannot cap.
  answers("capped");
  runSetup("capped", { PATH: linuxSystemPath() });
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// expectOk asserts a setup run exited 0, attaching its output on failure so
// a red run says why instead of showing only the code.
function expectOk(r: { code: number; out: string; err: string }, what: string): void {
  if (r.code !== 0) {
    throw new Error(`${what}: exit ${r.code}\n--- stdout ---\n${r.out}\n--- stderr ---\n${r.err}`);
  }
}

// promptOrder runs an interactive setup command with seed input and returns
// the prompts it asked, in order, split from stderr. Project prompts always
// end "): " (their hint is parenthesized); a global prompt ends ": " with
// the next prompt starting uppercase or indented, while a mid-prompt ": "
// is always followed by a lowercase letter. Answering by the returned order
// keeps a test independent of the question count: uname-gated blocks like
// the launch limits are asked on Linux only. The seed must drive the run to
// completion, and values placed by key must not open a conditional branch
// the seed run skipped.
function promptOrder(
  args: string[],
  env: Record<string, string | undefined>,
  seed: string,
  mode: "project" | "global",
): string[] {
  const probe = run(SELF, args, { env, input: seed });
  expectOk(probe, `prompt probe ${args.join(" ")}`);
  const parts = mode === "project" ? probe.err.split("): ") : probe.err.split(/: (?=[A-Z \t\n])/u);
  return parts.map((s) => s.trim()).filter((s) => s !== "");
}

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
    "clerk.harness=claude",
    "clerk.model=clerk-model",
  ];
  if (extra) lines.push(extra);
  writeFileSync(join(tmp, `${name}.answers`), `${lines.join("\n")}\n`, "utf8");
}

function runSetup(name: string, extraEnv: Record<string, string> = {}): number {
  const r = run(
    SELF,
    ["setup", "--answers", join(tmp, `${name}.answers`), "--config", join(tmp, `${name}.toml`)],
    {
      env: {
        ...(process.env as Record<string, string>),
        PATH: `${join(tmp, "bin")}:${process.env.PATH}`,
        ...extraEnv,
      },
    },
  );
  writeFileSync(join(tmp, `${name}.out`), r.out + r.err, "utf8");
  return r.code;
}

// A stand-in uname names another system: setup decides capping by uname -s,
// so the controls take the Mac path and the Linux path on either machine.
function systemPath(system: string): string {
  const bin = join(tmp, `system-${system}`);
  mkdirSync(bin, { recursive: true });
  const uname = join(bin, "uname");
  writeFileSync(uname, `#!/bin/sh\nif [ "$1" = "-s" ]; then echo ${system}; else exit 1; fi\n`);
  chmodSync(uname, 0o755);
  return `${bin}:${join(tmp, "bin")}:${process.env.PATH}`;
}
function linuxSystemPath(): string {
  return systemPath("Linux");
}

function confineEnv(bwrapExit: number): Record<string, string> {
  const bin = join(tmp, `confine-${bwrapExit}`);
  mkdirSync(bin, { recursive: true });
  for (const tool of ["bwrap", "socat", "rg"]) {
    const path = join(bin, tool);
    writeFileSync(path, `#!/bin/sh\nexit ${tool === "bwrap" ? bwrapExit : 0}\n`, "utf8");
    chmodSync(path, 0o755);
  }
  return {
    PATH: `${bin}:${join(tmp, "bin")}:${process.env.PATH}`,
    POSTMASTER_PROBE_PLATFORM: "linux",
    POSTMASTER_PROBE_SYSCTL: bwrapExit === 0 ? "0" : "1",
    POSTMASTER_PROBE_OS_RELEASE: 'ID=ubuntu\nVERSION_ID="24.04"\n',
    POSTMASTER_PROBE_APPARMOR_PROFILE: "0",
    POSTMASTER_PROBE_BWRAP_SECURE: "1",
  };
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
  test("setup lists confine, asks once after the probe, and defaults it to off", () => {
    const keys = run(SELF, ["setup", "--keys"]);
    const out = readFileSync(join(tmp, "plain.out"), "utf8");
    const cfg = tryTomlFile(join(tmp, "plain.toml"));
    expect(keys.code).toBe(0);
    expect(keys.out).toContain("confine                    off");
    expect(keys.out).toContain("clerk.harness");
    expect(keys.out).toContain("clerk.model");
    expect(keys.out).toContain("clerk.effort?");
    expect(keys.out).toContain("clerk.env_file?");
    expect(plainRc).toBe(0);
    expect(cfg?.confine).toBe("off");
    expect((cfg?.team as Record<string, unknown> | undefined)?.mode).toBe("synthesis");
    expect(out).toContain("lane confinement:");
    expect(out.match(/Run lanes confined \(on\/off\)/gu)?.length).toBe(1);
  });

  test("setup lists the mode key with its three values and default, and writes each", () => {
    const keys = run(SELF, ["setup", "--keys"]);
    expect(keys.code).toBe(0);
    expect(keys.out).toContain("dispatch mode: synthesis, single-thread or alternate");
    expect(keys.out).toMatch(/mode +synthesis +dispatch mode:/u);
    for (const mode of ["synthesis", "single-thread", "alternate"]) {
      answers(`mode-${mode}`, `mode=${mode}`);
      expect(runSetup(`mode-${mode}`)).toBe(0);
      const cfg = tryTomlFile(join(tmp, `mode-${mode}.toml`));
      expect((cfg?.team as Record<string, unknown> | undefined)?.mode).toBe(mode);
    }
  }, 120000);

  test("setup lists the ticket_notes key with its two values and default, and writes each", () => {
    const keys = run(SELF, ["setup", "--keys"]);
    expect(keys.code).toBe(0);
    expect(keys.out).toContain("ticket notes for lanes: given or held-back");
    expect(keys.out).toMatch(/ticket_notes +given +ticket notes for lanes:/u);
    for (const value of ["given", "held-back"]) {
      answers(`notes-${value}`, `ticket_notes=${value}`);
      expect(runSetup(`notes-${value}`)).toBe(0);
      const cfg = tryTomlFile(join(tmp, `notes-${value}.toml`));
      expect((cfg?.team as Record<string, unknown> | undefined)?.ticket_notes).toBe(value);
    }
    const cfg = tryTomlFile(join(tmp, "plain.toml"));
    expect((cfg?.team as Record<string, unknown> | undefined)?.ticket_notes).toBe("given");
  }, 120000);

  test("the adding verb inserts clerk in [team] and preserves the other config lines", () => {
    const before = `[team]\nworkhorses = ["alpha", "beta"]\npostmaster = { harness = "claude", model = "pm" }\n\n[postmaster]\npoll_seconds = 9\n`;
    writeFileSync(join(tmp, "legacy.toml"), before);
    answers("legacy", "clerk.harness=claude");
    const r = run(
      "bash",
      [
        SELF,
        "setup",
        "--add-clerk",
        "--answers",
        join(tmp, "legacy.answers"),
        "--config",
        join(tmp, "legacy.toml"),
      ],
      {
        env: { ...process.env, PATH: `${join(tmp, "bin")}:${process.env.PATH}` },
      },
    );
    expect(r.code).toBe(0);
    const after = readFileSync(join(tmp, "legacy.toml"), "utf8");
    expect(after.replace('clerk = { harness = "claude", model = "clerk-model" }\n', "")).toBe(
      before,
    );
    const team = tryTomlFile(join(tmp, "legacy.toml"))?.team as Record<string, unknown>;
    expect(team.clerk).toBeDefined();
    expect((team.clerk as Record<string, unknown>).harness).toBe("claude");
    expect((team.clerk as Record<string, unknown>).model).toBe("clerk-model");
  });

  test("the adding verb names a missing clerk harness or model", () => {
    writeFileSync(join(tmp, "missing-clerk.toml"), `[team]\nworkhorses = ["alpha", "beta"]\n`);
    writeFileSync(join(tmp, "missing-harness.answers"), "clerk.model=clerk-model\n");
    const noHarness = run(
      "bash",
      [
        SELF,
        "setup",
        "--add-clerk",
        "--answers",
        join(tmp, "missing-harness.answers"),
        "--config",
        join(tmp, "missing-clerk.toml"),
      ],
      {
        env: { ...process.env, PATH: `${join(tmp, "bin")}:${process.env.PATH}` },
      },
    );
    expect(noHarness.code).toBe(1);
    expect(noHarness.err).toContain("clerk.harness");
    writeFileSync(join(tmp, "missing-model.answers"), "clerk.harness=claude\n");
    const noModel = run(
      "bash",
      [
        SELF,
        "setup",
        "--add-clerk",
        "--answers",
        join(tmp, "missing-model.answers"),
        "--config",
        join(tmp, "missing-clerk.toml"),
      ],
      {
        env: { ...process.env, PATH: `${join(tmp, "bin")}:${process.env.PATH}` },
      },
    );
    expect(noModel.code).toBe(1);
    expect(noModel.err).toContain("clerk.model");
  });

  test("confine=on is written when Bubblewrap starts", () => {
    answers("confine-ready", "confine=on");
    const rc = runSetup("confine-ready", confineEnv(0));
    const cfg = tryTomlFile(join(tmp, "confine-ready.toml"));
    expect(rc).toBe(0);
    expect(cfg?.confine).toBe("on");
  });

  test("confine=on is written for a partial AppArmor result", () => {
    answers("confine-partial", "confine=on");
    const rc = runSetup("confine-partial", confineEnv(1));
    const cfg = tryTomlFile(join(tmp, "confine-partial.toml"));
    const out = readFileSync(join(tmp, "confine-partial.out"), "utf8");
    expect(rc).toBe(0);
    expect(cfg?.confine).toBe("on");
    expect(out).toContain("lane confinement: partial");
  });

  test("confine=off is written even when the probe is unavailable", () => {
    answers("confine-off", "confine=off");
    const rc = runSetup("confine-off", { POSTMASTER_PROBE_PLATFORM: "unknown" });
    const cfg = tryTomlFile(join(tmp, "confine-off.toml"));
    expect(rc).toBe(0);
    expect(cfg?.confine).toBe("off");
  });

  test("a lens given its own lanes is written to [team.lens_reviewers]", () => {
    answers("lens", "reviewers.security=alpha, beta, sentinel");
    const lensRc = runSetup("lens");
    const cfg = tryTomlFile(join(tmp, "lens.toml"));
    expect(lensRc).toBe(0);
    expect(cfg).not.toBeNull();
    expect(JSON.stringify((cfg?.team as Record<string, unknown> | undefined)?.lens_reviewers)).toBe(
      '{"security":["alpha","beta","sentinel"]}',
    );
  });

  test("the written config resolves: the reviewers default to the workhorses, and security has its own", () => {
    const r = run(join(import.meta.dir, "run"), [
      "reviewers",
      "lines",
      "--config",
      join(tmp, "lens.toml"),
    ]);
    expect(r.out.trim()).toBe(
      "reviewers: alpha, beta\nbug reviewers: \nsecurity reviewers: alpha, beta, sentinel",
    );
  });

  test("without lens answers there is no table, as before", () => {
    const cfg = tryTomlFile(join(tmp, "plain.toml"));
    expect(plainRc).toBe(0);
    expect(cfg).not.toBeNull();
    expect((cfg?.team as Record<string, unknown> | undefined)?.lens_reviewers).toBeUndefined();
    expect(JSON.stringify((cfg?.team as Record<string, unknown> | undefined)?.reviewers)).toBe(
      '["alpha","beta"]',
    );
  });

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
  });

  test("a role with no env file answer gets no env_file key", () => {
    const cfg = tryTomlFile(join(tmp, "plain.toml"));
    const t = cfg?.team as Record<string, unknown> | undefined;
    expect(JSON.stringify(t?.coachman)).toBe('{"harness":"bash","model":"judge"}');
  });

  test("a planning link defaults to empty under [planning]", () => {
    expect(planningLink("plain")).toBe("");
  });

  test("the planning link template is stored under [planning]", () => {
    answers("planlink", "planning.review_link=https://code.example/open?file={path}");
    const planlinkRc = runSetup("planlink");
    expect(planlinkRc).toBe(0);
    expect(planningLink("planlink")).toBe("https://code.example/open?file={path}");
  });

  test("launch memory and process caps default to 8G and 512", () => {
    expect(capLimit("capped", "default", "memory_max")).toBe("8G");
    expect(capLimit("capped", "default", "tasks_max")).toBe("512");
  });

  test("a role can override either cap and inherit the other", () => {
    answers(
      "caps",
      "limits.memory_max=8G\nlimits.tasks_max=384\nlimits.lane.memory_max=2G\nlimits.reviewer.tasks_max=96",
    );
    const capsRc = runSetup("caps", { PATH: linuxSystemPath() });
    expect(capsRc).toBe(0);
    expect(capLimit("caps", "default", "memory_max")).toBe("8G");
    expect(capLimit("caps", "default", "tasks_max")).toBe("384");
    expect(capLimit("caps", "lane", "memory_max")).toBe("2G");
    expect(capLimit("caps", "lane", "tasks_max")).toBe("384");
    expect(capLimit("caps", "reviewer", "memory_max")).toBe("8G");
    expect(capLimit("caps", "reviewer", "tasks_max")).toBe("96");
  });

  test("a malformed default memory cap is refused, and nothing is written", () => {
    answers("badmemory", "limits.memory_max=4.5G");
    const badmemoryRc = runSetup("badmemory", { PATH: linuxSystemPath() });
    const out = readFileSync(join(tmp, "badmemory.out"), "utf8");
    expect(badmemoryRc).toBe(1);
    expect(existsSync(join(tmp, "badmemory.toml"))).toBe(false);
    expect(out).toContain("memory_max must be");
  });

  test("a zero role process cap is refused, and nothing is written", () => {
    answers("badtasks", "limits.reviewer.tasks_max=0");
    const badtasksRc = runSetup("badtasks", { PATH: linuxSystemPath() });
    const out = readFileSync(join(tmp, "badtasks.out"), "utf8");
    expect(badtasksRc).toBe(1);
    expect(existsSync(join(tmp, "badtasks.toml"))).toBe(false);
    expect(out).toContain("reviewer.tasks_max must be");
  });

  test("a review round's time limit defaults to 2400 seconds, under [review]", () => {
    expect(limit("plain")).toBe("2400");
  });

  test("an answer sets it, up to 86400", () => {
    answers("limit", "round_timeout_seconds=86400");
    const limitRc = runSetup("limit");
    expect(limitRc).toBe(0);
    expect(limit("limit")).toBe("86400");
  });

  test("setup names unsupported bug reviewers and warns when none has a review form", () => {
    answers("no-bug", "reviewers.bug=alpha, beta");
    const noBugRc = runSetup("no-bug");
    const out = readFileSync(join(tmp, "no-bug.out"), "utf8");
    expect(noBugRc).toBe(0);
    expect(out).toContain("bug reviewer 'alpha' uses bash, which has no code-review form");
    expect(out).toContain("bug reviewer 'beta' uses bash, which has no code-review form");
    expect(out).toContain("warning: no configured bug reviewer has a code-review form");
  });

  test("setup warns for the ineligible lane and resolves the eligible bug reviewer", () => {
    answers("mixed-bug", "reviewers.bug=alpha, beta");
    const ap = join(tmp, "mixed-bug.answers");
    const swapped = readFileSync(ap, "utf8")
      .replace(/^lane\.alpha\.harness=bash$/mu, "lane.alpha.harness=claude")
      .replace(/^lane\.beta\.harness=bash$/mu, "lane.beta.harness=pi");
    writeFileSync(ap, swapped, "utf8");
    const mixedBugRc = runSetup("mixed-bug");
    const out = readFileSync(join(tmp, "mixed-bug.out"), "utf8");
    const er = run(join(import.meta.dir, "run"), [
      "reviewers",
      "eligible",
      "bug",
      "--config",
      join(tmp, "mixed-bug.toml"),
    ]);
    expect(mixedBugRc).toBe(0);
    expect(out).toContain("bug reviewer 'beta' uses pi, which has no code-review form");
    expect(er.out.trim()).toBe("alpha");
  });

  // A stand-in uname names another system: setup decides by the test
  // systemdCapability() uses, so this takes the same path a Mac takes.
  const otherSystemPath = (): string => systemPath("Darwin");

  test("where no launch can be capped, the keys list carries no limits and no limits line", () => {
    const keys = run(SELF, ["setup", "--keys"], { env: { PATH: otherSystemPath() } });
    expect(keys.code).toBe(0);
    expect(keys.out).not.toContain("limits.");
    expect(keys.out.match(/^limits\./gmu)).toBeNull();
    const linuxKeys = run(SELF, ["setup", "--keys"], { env: { PATH: linuxSystemPath() } });
    expect(linuxKeys.out).toContain("limits.memory_max");
  });

  test("where no launch can be capped, setup asks no limit question, says so once, and writes no limits table", () => {
    answers("no-cap", "limits.memory_max=bogus");
    const rc = runSetup("no-cap", { PATH: otherSystemPath() });
    const out = readFileSync(join(tmp, "no-cap.out"), "utf8");
    expect(rc).toBe(0);
    expect(out.match(/without memory or process limits/gu)?.length).toBe(1);
    expect(out).not.toContain("default memory cap");
    expect(out).not.toContain("[limits]");
    const cfg = tryTomlFile(join(tmp, "no-cap.toml"));
    expect(cfg).not.toBeNull();
    expect(cfg?.limits).toBeUndefined();
  });

  test("where launches can be capped, setup never says they run without limits", () => {
    const out = readFileSync(join(tmp, "capped.out"), "utf8");
    expect(out).not.toContain("without memory or process limits");
    expect(out).toContain("default memory cap");
  });

  test("interactive setup where no launch can be capped reports uncapped launches once", () => {
    const env = { PATH: otherSystemPath() };
    const args = ["setup", "--dry-run"];
    // Bootstrap input that completes the probe run everywhere today; the
    // probe maps the real prompt order and the values below land by key.
    const bootstrap = [
      "",
      "",
      "bash",
      "lane-alpha",
      "",
      "",
      "bash",
      "lane-beta",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "bash",
      "coachman",
      "",
      "",
      "bash",
      "fallback",
      "",
      "",
      "bash",
      "postmaster",
      "",
      "",
      "bash",
      "clerk",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ].join("\n");
    const order = promptOrder(args, env, `${bootstrap}\n`, "global");
    const answers = Array<string>(order.length + 10).fill("");
    for (const [i, p] of order.entries()) {
      if (/harness( \(|$)/u.test(p)) answers[i] = "bash";
      else if (p.includes("model id")) {
        const who = /^[ \t]*([a-z]+): model id/u.exec(p)?.[1] ?? "";
        answers[i] = who === "alpha" ? "lane-alpha" : who === "beta" ? "lane-beta" : who;
      }
    }
    const placed = answers.filter((a) => a !== "");
    expect(placed.filter((a) => a === "bash")).toHaveLength(6);
    for (const name of ["lane-alpha", "lane-beta", "coachman", "fallback", "postmaster", "clerk"]) {
      expect(placed).toContain(name);
    }
    const interactive = run(SELF, args, { env, input: `${answers.join("\n")}\n` });
    expectOk(interactive, "interactive setup");
    expect(interactive.out).not.toContain("Launch limits:");
    expect(interactive.out).not.toContain("[limits]");
    expect(interactive.out.match(/without memory or process limits/gu)?.length).toBe(1);
  });
});

describe("negative controls", () => {
  test("confine=on is refused when the probe says unavailable", () => {
    answers("confine-unavailable", "confine=on");
    const rc = runSetup("confine-unavailable", { POSTMASTER_PROBE_PLATFORM: "unknown" });
    const out = readFileSync(join(tmp, "confine-unavailable.out"), "utf8");
    expect(rc).toBe(1);
    expect(out).toContain("confine=on is unavailable");
    expect(existsSync(join(tmp, "confine-unavailable.toml"))).toBe(false);
  });

  test("a value other than on or off is refused", () => {
    answers("confine-invalid", "confine=maybe");
    const rc = runSetup("confine-invalid");
    const out = readFileSync(join(tmp, "confine-invalid.out"), "utf8");
    expect(rc).toBe(1);
    expect(out).toContain("confine must be on or off");
    expect(existsSync(join(tmp, "confine-invalid.toml"))).toBe(false);
  });

  test("a mode other than synthesis, single-thread or alternate is refused, naming the three", () => {
    answers("mode-invalid", "mode=two-lanes");
    const rc = runSetup("mode-invalid");
    const out = readFileSync(join(tmp, "mode-invalid.out"), "utf8");
    expect(rc).toBe(1);
    expect(out).toContain("mode must be synthesis, single-thread or alternate");
    expect(existsSync(join(tmp, "mode-invalid.toml"))).toBe(false);
  });

  test("a ticket_notes other than given or held-back is refused, naming the two", () => {
    answers("notes-invalid", "ticket_notes=sometimes");
    const rc = runSetup("notes-invalid");
    const out = readFileSync(join(tmp, "notes-invalid.out"), "utf8");
    expect(rc).toBe(1);
    expect(out).toContain("ticket_notes must be given or held-back");
    expect(existsSync(join(tmp, "notes-invalid.toml"))).toBe(false);
  });

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
    });
  }

  test("a lens reviewer that is not a lane is refused, and nothing is written", () => {
    answers("ghost", "reviewers.security=alpha, ghost");
    const ghostRc = runSetup("ghost");
    const out = readFileSync(join(tmp, "ghost.out"), "utf8");
    expect(ghostRc).toBe(1);
    expect(existsSync(join(tmp, "ghost.toml"))).toBe(false);
    expect(out).toContain("security reviewer 'ghost' is not one of the lanes");
  });

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
  });

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
  });

  test("a non-empty planning link without {path} is refused", () => {
    answers("badlink", "planning.review_link=https://code.example/open");
    const badlinkRc = runSetup("badlink");
    const out = readFileSync(join(tmp, "badlink.out"), "utf8");
    expect(badlinkRc).toBe(1);
    expect(existsSync(join(tmp, "badlink.toml"))).toBe(false);
    expect(out).toContain("planning.review_link must contain {path}");
  });
});

describe("project mode", () => {
  const GLOBAL = `projects_roots = ["~/Code"]
confine = "off"
[lanes.alpha]
harness = "claude"
model = "m-a"
[lanes.beta]
harness = "codex"
model = "m-b"
[team]
workhorses = ["alpha", "beta"]
reviewers = ["alpha", "beta"]
coachman = { harness = "muse", model = "m-c" }
coachman_fallback = { harness = "muse", model = "m-f" }
postmaster = { harness = "claude", model = "m-p" }
clerk = { harness = "claude", model = "m-k" }
max_runs = 2
mode = "synthesis"
[postmaster]
poll_seconds = 120
[tracker]
kind = "local"
postmaster_may_create = false
[review]
round_timeout_seconds = 2400
[ship]
merge_authority = "user"
checkpoint_mode = "autonomous"
review_link = ""
`;

  let projCounter = 0;

  function stageProject(): { repo: string; config: string } {
    projCounter += 1;
    const dir = join(tmp, `proj-${projCounter}`);
    const repo = join(dir, "repo");
    mkdirSync(repo, { recursive: true });
    run("git", ["init", "-q", repo]);
    const config = join(dir, "config.toml");
    writeFileSync(config, GLOBAL, "utf8");
    return { repo, config };
  }

  function runProject(
    repo: string,
    config: string,
    answersText: string,
    extra: string[] = [],
  ): { code: number; out: string } {
    const answersPath = join(tmp, `proj-${projCounter}.answers`);
    writeFileSync(answersPath, `${answersText}\n`, "utf8");
    const r = run(SELF, ["setup", "--project", repo, "--answers", answersPath, ...extra], {
      env: {
        ...(process.env as Record<string, string>),
        PATH: `${join(tmp, "bin")}:${process.env.PATH}`,
        POSTMASTER_CONFIG: config,
      },
    });
    return { code: r.code, out: r.out + r.err };
  }

  function settingsOf(repo: string): string {
    return readFileSync(join(repo, ".postmaster", "settings.toml"), "utf8");
  }

  // The merge is judged on the parsed result: key order, table form and
  // comments are the emitter's, not the test's.
  function settingsData(repo: string): Record<string, unknown> {
    return Bun.TOML.parse(settingsOf(repo));
  }

  function tableOf(v: unknown): Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : {};
  }

  test("blank answers-file values are left unset, like blank interactive answers", () => {
    const s = stageProject();
    const r = runProject(s.repo, s.config, "lanes=\ntracker=local");
    expect(r.code).toBe(0);
    const data = settingsData(s.repo);
    expect(tableOf(data.tracker).kind).toBe("local");
    expect(Object.hasOwn(data, "lanes")).toBe(false);
  });

  test("a second run merges: earlier settings stay, new answers land", () => {
    const s = stageProject();
    const first = runProject(s.repo, s.config, "workhorses=alpha, beta\nreviewers=alpha, beta");
    expect(first.code).toBe(0);
    const second = runProject(s.repo, s.config, "tracker=local\noverwrite=yes");
    expect(second.code).toBe(0);
    const data = settingsData(s.repo);
    expect(tableOf(data.team).workhorses).toEqual(["alpha", "beta"]);
    expect(tableOf(data.team).reviewers).toEqual(["alpha", "beta"]);
    expect(tableOf(data.tracker).kind).toBe("local");
    expect(Object.keys(data).sort()).toEqual(["team", "tracker"]);
  });

  test("merging keeps role keys and unknown sections as data, and drops comments", () => {
    const s = stageProject();
    const dir = join(s.repo, ".postmaster");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "settings.toml"),
      '# hand note\n[team]\ncoachman = { harness = "claude" }\n[roles]\nworkhorses = ["alpha"]\n',
      "utf8",
    );
    const r = runProject(s.repo, s.config, "coachman.model=m-x\noverwrite=yes");
    expect(r.code).toBe(0);
    const data = settingsData(s.repo);
    expect(tableOf(tableOf(data.team).coachman)).toEqual({ harness: "claude", model: "m-x" });
    expect(tableOf(data.roles).workhorses).toEqual(["alpha"]);
    expect(settingsOf(s.repo)).not.toContain("# hand note");
  });

  test("a lane with no harness is refused before anything is written", () => {
    const s = stageProject();
    const r = runProject(s.repo, s.config, "lanes=gamma\nlane.gamma.model=model-g");
    expect(r.code).toBe(1);
    expect(r.out).toContain("lane 'gamma' names no harness");
    expect(existsSync(join(s.repo, ".postmaster", "settings.toml"))).toBe(false);
  });

  test("a symlinked settings file is refused and its target is untouched", () => {
    const s = stageProject();
    const dir = join(s.repo, ".postmaster");
    mkdirSync(dir, { recursive: true });
    const victim = join(tmp, `proj-${projCounter}.victim`);
    writeFileSync(victim, "untouched\n", "utf8");
    const link = join(dir, "settings.toml");
    symlinkSync(victim, link);
    const r = runProject(s.repo, s.config, "tracker=local");
    expect(r.code).toBe(1);
    expect(r.out).toContain("must not be a symlink");
    expect(readFileSync(victim, "utf8")).toBe("untouched\n");
  });

  test("the ignored report follows git when an older rule lingers after a no", () => {
    const s = stageProject();
    const dir = join(s.repo, ".postmaster");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".gitignore"), "# old\n*\n", "utf8");
    const r = runProject(s.repo, s.config, "tracker=local\nignore_settings=no");
    expect(r.code).toBe(0);
    expect(r.out).toContain("settings ignored: yes");
    expect(r.out).toContain("existing ignore rule");
  });

  test("a yes appends the rule where a wildcard negation fooled the matcher", () => {
    const s = stageProject();
    const dir = join(s.repo, ".postmaster");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".gitignore"), "*\n!settings.*\n", "utf8");
    const r = runProject(s.repo, s.config, "tracker=local\nignore_settings=yes");
    expect(r.code).toBe(0);
    expect(r.out).toContain("settings ignored: yes");
    const ignored = run("git", ["-C", s.repo, "check-ignore", "-q", ".postmaster/settings.toml"]);
    expect(ignored.code).toBe(0);
  });

  test("a top-level answer on a second run replaces the old value", () => {
    const s = stageProject();
    const first = runProject(s.repo, s.config, "tracker=local\nconfine=off");
    expect(first.code).toBe(0);
    expect(settingsData(s.repo).confine).toBe("off");
    const second = runProject(s.repo, s.config, "confine=on\noverwrite=yes");
    expect(second.code).toBe(0);
    const data = settingsData(s.repo);
    expect(data.confine).toBe("on");
    expect(tableOf(data.tracker).kind).toBe("local");
  });

  test("a second run answers team lists against the existing file's lanes", () => {
    const s = stageProject();
    const dir = join(s.repo, ".postmaster");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "settings.toml"),
      '[lanes.alpha]\nharness = "claude"\nmodel = "m-a"\n[lanes.beta]\nharness = "codex"\nmodel = "m-b"\n',
      "utf8",
    );
    const missing = join(tmp, `proj-${projCounter}.missing.toml`);
    const r = runProject(s.repo, missing, "workhorses=alpha, beta\noverwrite=yes");
    expect(r.code).toBe(0);
    const data = settingsData(s.repo);
    expect(tableOf(data.team).workhorses).toEqual(["alpha", "beta"]);
    expect(Object.keys(tableOf(data.lanes)).sort()).toEqual(["alpha", "beta"]);
  });

  test("re-answering tracker=plane keeps the saved workspace", () => {
    const lanesOnly = join(tmp, `proj-${projCounter}.lanes.toml`);
    writeFileSync(
      lanesOnly,
      'projects_roots = ["~/Code"]\nconfine = "off"\n[lanes.alpha]\nharness = "claude"\nmodel = "m-a"\n[lanes.beta]\nharness = "codex"\nmodel = "m-b"\n',
      "utf8",
    );
    const s = stageProject();
    const dir = join(s.repo, ".postmaster");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "settings.toml"),
      '[tracker]\nkind = "plane"\nworkspace = "ws"\n',
      "utf8",
    );
    const r = runProject(s.repo, lanesOnly, "tracker=plane\noverwrite=yes");
    expect(r.code).toBe(0);
    const tracker = tableOf(settingsData(s.repo).tracker);
    expect(tracker.kind).toBe("plane");
    expect(tracker.workspace).toBe("ws");
  });

  test("an unrelated update succeeds when the project overrides a plane global with local", () => {
    const planeNoWs = join(tmp, `proj-${projCounter}.planenows.toml`);
    writeFileSync(
      planeNoWs,
      'projects_roots = ["~/Code"]\nconfine = "off"\n[lanes.alpha]\nharness = "claude"\nmodel = "m-a"\n[lanes.beta]\nharness = "codex"\nmodel = "m-b"\n[tracker]\nkind = "plane"\n',
      "utf8",
    );
    const s = stageProject();
    const dir = join(s.repo, ".postmaster");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "settings.toml"), '[tracker]\nkind = "local"\n', "utf8");
    const r = runProject(s.repo, planeNoWs, "confine=on\noverwrite=yes");
    expect(r.code).toBe(0);
    const data = settingsData(s.repo);
    expect(data.confine).toBe("on");
    expect(tableOf(data.tracker).kind).toBe("local");
  });

  test("a merged plane kind with no workspace anywhere still dies", () => {
    const planeNoWs = join(tmp, `proj-${projCounter}.planenows.toml`);
    writeFileSync(
      planeNoWs,
      'projects_roots = ["~/Code"]\nconfine = "off"\n[lanes.alpha]\nharness = "claude"\nmodel = "m-a"\n[lanes.beta]\nharness = "codex"\nmodel = "m-b"\n[tracker]\nkind = "plane"\n',
      "utf8",
    );
    const s = stageProject();
    const dir = join(s.repo, ".postmaster");
    mkdirSync(dir, { recursive: true });
    const before = "[team]\nmax_runs = 5\n";
    writeFileSync(join(dir, "settings.toml"), before, "utf8");
    const r = runProject(s.repo, planeNoWs, "confine=on\noverwrite=yes");
    expect(r.code).toBe(1);
    expect(r.out).toContain("workspace slug is needed");
    expect(settingsOf(s.repo)).toBe(before);
    expect(existsSync(join(dir, ".gitignore"))).toBe(false);
  });

  test("a dry run with only ignore_settings=yes writes nothing", () => {
    const s = stageProject();
    const first = runProject(s.repo, s.config, "tracker=local");
    expect(first.code).toBe(0);
    const ignore = join(s.repo, ".postmaster", ".gitignore");
    const before = readFileSync(ignore, "utf8");
    const r = runProject(s.repo, s.config, "ignore_settings=yes", ["--dry-run"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("settings ignored: yes");
    expect(readFileSync(ignore, "utf8")).toBe(before);
  });

  test("an ignore failure leaves no new settings behind", () => {
    const s = stageProject();
    const dir = join(s.repo, ".postmaster");
    mkdirSync(dir, { recursive: true });
    symlinkSync(join(tmp, `proj-${projCounter}.nowhere`), join(dir, ".gitignore"));
    const r = runProject(s.repo, s.config, "tracker=local");
    expect(r.code).toBe(1);
    expect(r.out).toContain("cannot set the ignore rules");
    expect(existsSync(join(dir, "settings.toml"))).toBe(false);
  });

  test("a multiline list is replaced whole, not line by line", () => {
    const s = stageProject();
    const dir = join(s.repo, ".postmaster");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "settings.toml"),
      '[team]\nreviewers = [\n  "alpha",\n  "beta",\n]\n',
      "utf8",
    );
    const r = runProject(s.repo, s.config, "reviewers=alpha\noverwrite=yes");
    expect(r.code).toBe(0);
    const data = settingsData(s.repo);
    expect(tableOf(data.team).reviewers).toEqual(["alpha"]);
    expect(JSON.stringify(data)).not.toContain("beta");
  });

  test("a half-answered postmaster is refused before anything is written", () => {
    const lanesOnly = join(tmp, `proj-${projCounter}.lanes.toml`);
    writeFileSync(
      lanesOnly,
      'projects_roots = ["~/Code"]\nconfine = "off"\n[lanes.alpha]\nharness = "claude"\nmodel = "m-a"\n[lanes.beta]\nharness = "codex"\nmodel = "m-b"\n',
      "utf8",
    );
    const s = stageProject();
    const r = runProject(s.repo, lanesOnly, "postmaster.harness=claude");
    expect(r.code).toBe(1);
    expect(r.out).toContain("team.postmaster needs a harness and a model");
    expect(existsSync(join(s.repo, ".postmaster", "settings.toml"))).toBe(false);
  });

  test("a fully answered postmaster writes against a lanes-only base", () => {
    const lanesOnly = join(tmp, `proj-${projCounter}.lanes.toml`);
    writeFileSync(
      lanesOnly,
      'projects_roots = ["~/Code"]\nconfine = "off"\n[lanes.alpha]\nharness = "claude"\nmodel = "m-a"\n[lanes.beta]\nharness = "codex"\nmodel = "m-b"\n',
      "utf8",
    );
    const s = stageProject();
    const r = runProject(s.repo, lanesOnly, "postmaster.harness=claude\npostmaster.model=m-p");
    expect(r.code).toBe(0);
    expect(tableOf(tableOf(settingsData(s.repo).team).postmaster)).toEqual({
      harness: "claude",
      model: "m-p",
    });
  });

  test("a comment with brackets and a multiline list merge as data, comments gone", () => {
    const s = stageProject();
    const dir = join(s.repo, ".postmaster");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "settings.toml"),
      '[team]\nworkhorses = [\n  "alpha", # [see notes\n  "beta",\n]\nmax_runs = 7\nmode = "synthesis"\n',
      "utf8",
    );
    const r = runProject(s.repo, s.config, "workhorses=alpha,beta\noverwrite=yes");
    expect(r.code).toBe(0);
    const team = tableOf(settingsData(s.repo).team);
    expect(team.workhorses).toEqual(["alpha", "beta"]);
    expect(team.max_runs).toBe(7);
    expect(team.mode).toBe("synthesis");
    expect(settingsOf(s.repo)).not.toContain("see notes");
  });

  test("an answered role merges into an existing child table", () => {
    const s = stageProject();
    const dir = join(s.repo, ".postmaster");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "settings.toml"),
      '[team.coachman]\nharness = "claude"\nmodel = "m-old"\n',
      "utf8",
    );
    const r = runProject(s.repo, s.config, "coachman.model=m-new\noverwrite=yes");
    expect(r.code).toBe(0);
    const data = settingsData(s.repo);
    expect(tableOf(tableOf(data.team).coachman)).toEqual({ harness: "claude", model: "m-new" });
    expect(settingsOf(s.repo)).not.toContain("m-old");
  });

  test("a blank link answer clears the inherited link", () => {
    const s = stageProject();
    const r = runProject(s.repo, s.config, "tracker=local\nreview_link=");
    expect(r.code).toBe(0);
    expect(r.out).toContain("(cleared)");
    expect(tableOf(settingsData(s.repo).ship).review_link).toBe("");
  });

  test("a multiline string survives a merge as data", () => {
    const s = stageProject();
    const dir = join(s.repo, ".postmaster");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "settings.toml"),
      '[tracker]\nname = """\nkind = "not-a-key"\n"""\n',
      "utf8",
    );
    const r = runProject(s.repo, s.config, "tracker=local\noverwrite=yes");
    expect(r.code).toBe(0);
    const tracker = tableOf(settingsData(s.repo).tracker);
    expect(tracker.kind).toBe("local");
    expect(tracker.name).toBe('kind = "not-a-key"\n');
  });

  test("an interactive blank link answer clears it too", () => {
    const s = stageProject();
    const env = {
      ...(process.env as Record<string, string>),
      PATH: `${join(tmp, "bin")}:${process.env.PATH}`,
      POSTMASTER_CONFIG: s.config,
    };
    // Map the questions from a dry run on this same repo: dry runs ask
    // everything and write nothing, so the map fits the real run exactly
    // on every platform, whatever uname-gated blocks appear.
    const order = promptOrder(
      ["setup", "--project", s.repo, "--dry-run"],
      env,
      "\n".repeat(300),
      "project",
    );
    const trackerAt = order.findIndex((p) => p.includes("How are tickets tracked"));
    if (trackerAt < 0) throw new Error(`tracker prompt missing, saw:\n${order.join("\n")}`);
    const lines = Array<string>(order.length + 10).fill("");
    lines[trackerAt] = "local";
    const r = run(SELF, ["setup", "--project", s.repo], { env, input: `${lines.join("\n")}\n` });
    expectOk(r, "interactive setup");
    const data = settingsData(s.repo);
    expect(tableOf(data.tracker).kind).toBe("local");
    expect(tableOf(data.ship).review_link).toBe("");
  });

  test("a dry run prints the merged settings and writes nothing", () => {
    const s = stageProject();
    const dir = join(s.repo, ".postmaster");
    mkdirSync(dir, { recursive: true });
    const before = "[team]\nmax_runs = 5\n";
    writeFileSync(join(dir, "settings.toml"), before, "utf8");
    const r = runProject(s.repo, s.config, "lane.alpha.model=model-x", ["--dry-run"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("model-x");
    expect(r.out).toContain("max_runs");
    expect(settingsOf(s.repo)).toBe(before);
    expect(existsSync(join(dir, ".gitignore"))).toBe(false);
  });

  test("a failed reviewer check restores the previous file", () => {
    const s = stageProject();
    const dir = join(s.repo, ".postmaster");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "settings.toml"), '[team]\nreviewers = ["gamma"]\n', "utf8");
    const r = runProject(s.repo, s.config, "workhorses=alpha,beta\noverwrite=yes");
    expect(r.code).toBe(1);
    expect(r.out).toContain("do not resolve");
    expect(settingsData(s.repo)).toEqual({ team: { reviewers: ["gamma"] } });
  });

  test("a __proto__ key in a hand-edited lane entry stays data", () => {
    const s = stageProject();
    const dir = join(s.repo, ".postmaster");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "settings.toml"), '[lanes.alpha]\n"__proto__" = 1\n', "utf8");
    const r = runProject(s.repo, s.config, "lane.alpha.model=model-x\noverwrite=yes");
    expect(r.code).toBe(0);
    const alpha = tableOf(tableOf(settingsData(s.repo).lanes).alpha);
    expect(Object.hasOwn(alpha, "__proto__")).toBe(true);
    expect(alpha["__proto__"]).toBe(1);
    expect(alpha.model).toBe("model-x");
  });
});
