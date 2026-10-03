// Tests beside scripts/run-meta.ts, moved from its --self-test on #109: 98 controls.
// The sequence runs once in beforeAll with recording check/ok/fail; one test per recorded label.
// Its local check(label, fn) is checkJson here, so the recording check keeps its name.
// Env pins set by the sequence are restored in afterAll.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { toolRoot } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { isDir, meta, pin, TRAIL_NL_RE } from "./run-meta.ts";

const TOOL = toolRoot(import.meta);

interface ControlRecord {
  label: string;
  ok: boolean;
  detail: string;
}

const records: ControlRecord[] = [];

const check = (label: string, cond: boolean, detail?: string): void => {
  records.push({ label, ok: cond, detail: detail ?? "" });
};

const ok = (label: string): void => {
  records.push({ label, ok: true, detail: "" });
};

const fail = (label: string, detail?: string): void => {
  records.push({ label, ok: false, detail: detail ?? "" });
};

const assertControl = (label: string): void => {
  const r = records.find((x) => x.label === label);
  expect(r).toBeDefined();
  if (r !== undefined && !r.ok) throw new Error(r.detail === "" ? r.label : r.detail);
  expect(r?.ok).toBe(true);
};

const savedEnv: Record<string, string | undefined> = {
  HOME: process.env.HOME,
  POSTMASTER_CONFIG: process.env.POSTMASTER_CONFIG,
  POSTMASTER_TOOL_PINS: process.env.POSTMASTER_TOOL_PINS,
};

// bun:test's types omit the hook timeout, though the runtime honors it.

beforeAll(async () => {
  const wrapper = join(import.meta.dir, "run-meta.sh");
  await withTempDir(async (raw: string): Promise<void> => {
    const tmp = realpathSync(raw);
    const tools = join(tmp, "tools");
    process.env.POSTMASTER_TOOL_PINS = tools;
    const d = join(tmp, "project", "RUN-1");
    const repo = join(tmp, "target");
    mkdirSync(d, { recursive: true });
    mkdirSync(repo, { recursive: true });
    run("git", ["-C", repo, "init", "-q", "-b", "main"]);
    run("git", [
      "-C",
      repo,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "first",
    ]);
    const configPath = join(tmp, "config.toml");
    writeFileSync(
      configPath,
      '[lanes.one]\nharness = "bash"\nmodel = "m1"\nenv_file = "~/somewhere/secret.env"\n' +
        '[lanes.two]\nharness = "no-such-harness-xyz"\nmodel = "m2"\n[team]\n' +
        'workhorses = ["one", "two"]\ncoachman = { harness = "bash", model = "judge" }\n' +
        'coachman_fallback = { harness = "bash", model = "backup" }\n',
    );
    process.env.POSTMASTER_CONFIG = configPath;

    const cli = (
      args: string[],
      env?: Record<string, string | undefined>,
    ): { code: number; out: string } => {
      const r = env === undefined ? run(wrapper, args) : run(wrapper, args, { env });
      return { code: r.code, out: r.out + r.err };
    };
    const spawnCli = (
      args: string[],
      env?: Record<string, string | undefined>,
    ): Promise<{ code: number; out: string }> => {
      // Bun.spawn without env does not inherit this process's environment, so the
      // current environment always crosses explicitly.
      const child: any = Bun.spawn([wrapper, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, ...(env ?? {}) },
      });
      return (async () => {
        const code = (await child.exited) as number;
        const out = (await new Response(child.stdout).text()) as string;
        const err = (await new Response(child.stderr).text()) as string;
        return { code, out: out + err };
      })();
    };
    // Command substitution strips trailing newlines; $(...) comparisons strip the same way.
    const sh = (s: string): string => s.replace(TRAIL_NL_RE, "");
    const gitOut = (args: string[]): string => run("git", args).out.trim();
    const headOf = (where: string): string => gitOut(["-C", where, "rev-parse", "HEAD"]);
    const runJson = (dir: string): Record<string, any> =>
      JSON.parse(readFileSync(join(dir, "run.json"), "utf8")) as Record<string, any>;
    const checkJson = (label: string, fn: (r: Record<string, any>) => boolean): void => {
      try {
        if (fn(runJson(d))) ok(label);
        else fail(label);
      } catch {
        fail(label);
      }
    };
    const cutPin = (
      label: string,
      repoArg: string,
      commit: string,
    ): { code: number; dest: string; out: string } => {
      const r = pin(repoArg, commit, tools);
      const dest = r.out.trim();
      if (r.code !== 0) fail(label, r.out + r.err);
      return { code: r.code, dest, out: r.out + r.err };
    };

    console.log("positive controls");
    if (meta(d, repo).code === 0) ok("run.json is written");
    else fail("run.json is written");
    checkJson("it names the postmaster commit", (r) => r.postmaster.commit === headOf(TOOL));
    checkJson("it records the current coachman contract", (r) => r.coachman_contract === 2);
    checkJson(
      "it names the target's HEAD and branch",
      (r) =>
        r.target.head === headOf(repo) &&
        r.target.branch === "main" &&
        Object.keys(r.target).length === 2,
    );
    checkJson(
      "it keeps the resolved config as it was",
      (r) =>
        r.config.lanes.one.model === "m1" &&
        JSON.stringify(r.config.team.workhorses) === '["one","two"]',
    );
    checkJson(
      "it names an old-layout run from its parent",
      (r) => r.project === "project" && r.run === "RUN-1",
    );
    checkJson(
      "it records project settings and their source",
      (r) =>
        !r.project_settings.shared_present &&
        r.project_settings.sources["project.default_turnpikes"] === "discovery",
    );
    checkJson("it records each harness's version", (r) =>
      String(r.harness_versions.bash).startsWith("GNU bash"),
    );
    checkJson(
      "a harness not installed says so",
      (r) => r.harness_versions["no-such-harness-xyz"] === "not on PATH",
    );
    // main gives --version 15 seconds, then records "no version: TimeoutExpired".
    // Through the CLI: Bun.which reads PATH once, so only a child sees the stub.
    {
      const bindir = join(tmp, "slowbin");
      mkdirSync(bindir, { recursive: true });
      writeFileSync(join(bindir, "slowharness"), "#!/bin/sh\nsleep 60\n");
      chmodSync(join(bindir, "slowharness"), 0o755);
      const slowCfg = join(tmp, "slow.toml");
      writeFileSync(slowCfg, '[lanes.one]\nharness = "slowharness"\nmodel = "m1"\n[team]\n');
      const slowD = join(tmp, "slowrun");
      mkdirSync(slowD, { recursive: true });
      const t0 = Date.now();
      const r = run(wrapper, [slowD, repo], {
        env: {
          ...process.env,
          PATH: `${bindir}${delimiter}${process.env.PATH ?? ""}`,
          POSTMASTER_CONFIG: slowCfg,
        },
      });
      const secs = (Date.now() - t0) / 1000;
      let ver = "";
      try {
        ver = (JSON.parse(readFileSync(join(slowD, "run.json"), "utf8")) as Record<string, any>)
          .harness_versions.slowharness as string;
      } catch {
        ver = "";
      }
      check(
        "a harness stuck on --version records BASE's TimeoutExpired after 15 seconds",
        r.code === 0 && ver === "no version: TimeoutExpired" && secs >= 14 && secs < 60,
        `exit ${r.code} ver=[${ver}] after ${secs.toFixed(1)}s`,
      );
      // The claim this dispatch made must read done for the later claims-based releases.
      writeFileSync(join(slowD, "manifest.json"), '{"stage": "done"}\n');
    }
    checkJson(
      "an env file is named, never read",
      (r) => r.config.lanes.one.env_file === "~/somewhere/secret.env",
    );
    const liveHead = headOf(TOOL);
    const livePin = join(tools, liveHead);
    checkJson("it names the pinned checkout", (r) => r.postmaster.checkout === livePin);
    {
      const t = cli(["path", d]);
      check("path prints the pin", t.code === 0 && sh(t.out) === livePin, t.out);
    }
    {
      const t = cli(["check", d]);
      check("check passes a pin that serves its commit", t.code === 0, t.out);
    }
    const shared = join(tmp, "project", "RUN-2");
    mkdirSync(shared, { recursive: true });
    meta(shared, repo);
    {
      const t = cli(["path", shared]);
      check(
        "a second run at the same commit shares the pin",
        t.code === 0 && sh(t.out) === livePin,
        t.out,
      );
    }

    // AC3: a run dispatched at one commit still serves its versions after main moves on.
    // The identical command is `check`; the runbook and the script are read from both
    // checkouts, and the script is run from both.
    const fake = join(tmp, "fake-tool");
    run("git", ["-C", tmp, "init", "-q", "-b", "main", fake]);
    run("git", ["-C", fake, "config", "user.name", "t"]);
    run("git", ["-C", fake, "config", "user.email", "t@t"]);
    mkdirSync(join(fake, "skills", "postmaster"), { recursive: true });
    mkdirSync(join(fake, "scripts"), { recursive: true });
    writeFileSync(join(fake, "skills", "postmaster", "coachman.md"), "# coachman MARKER=A\n");
    writeFileSync(join(fake, "scripts", "foo.sh"), "#!/bin/sh\necho MARKER=A\n");
    chmodSync(join(fake, "scripts", "foo.sh"), 0o755);
    run("git", ["-C", fake, "add", "-A"]);
    run("git", ["-C", fake, "commit", "-qm", "A"]);
    const commitA = headOf(fake);
    const pinA = cutPin("a pin of a tool repo at A is cut", fake, commitA).dest;
    writeFileSync(join(fake, "skills", "postmaster", "coachman.md"), "# coachman MARKER=B\n");
    writeFileSync(join(fake, "scripts", "foo.sh"), "#!/bin/sh\necho MARKER=B\n");
    run("git", ["-C", fake, "add", "-A"]);
    run("git", ["-C", fake, "commit", "-qm", "B"]);
    const runPinned = join(tmp, "project", "RUN-PINNED");
    const runLive = join(tmp, "project", "RUN-LIVE");
    mkdirSync(runPinned, { recursive: true });
    mkdirSync(runLive, { recursive: true });
    for (const [dd, co, cm] of [
      [runPinned, pinA, commitA],
      [runLive, fake, commitA],
    ]) {
      writeFileSync(
        join(dd as string, "run.json"),
        `${JSON.stringify({ postmaster: { commit: cm, checkout: co }, stage: "synthesis" })}\n`,
      );
      writeFileSync(join(dd as string, "manifest.json"), '{"stage": "synthesis"}\n');
    }
    const markerIn = (file: string): string => {
      const text = readFileSync(file, "utf8");
      const i = text.indexOf("MARKER=");
      return i < 0 ? "" : text.slice(i, i + "MARKER=X".length);
    };
    {
      const got = markerIn(join(pinA, "skills", "postmaster", "coachman.md"));
      const want = markerIn(join(fake, "skills", "postmaster", "coachman.md"));
      check(
        "after main moved on, the pin still reads A while main reads B (marker_of)",
        got === "MARKER=A" && want === "MARKER=B",
        `pin=${got} main=${want}`,
      );
    }
    {
      const got = markerIn(join(pinA, "scripts", "foo.sh"));
      const want = markerIn(join(fake, "scripts", "foo.sh"));
      check(
        "and the script reads A on the pin while main reads B",
        got === "MARKER=A" && want === "MARKER=B",
        `pin=${got} main=${want}`,
      );
    }
    {
      const got = run("bash", [join(pinA, "scripts", "foo.sh")]).out.trim();
      const want = run("bash", [join(fake, "scripts", "foo.sh")]).out.trim();
      check(
        "and the script runs A from the pin while main runs B (script_of)",
        got === "MARKER=A" && want === "MARKER=B",
        `pin=${got} main=${want}`,
      );
    }
    {
      const t = cli(["check", runPinned]);
      check("check passes the run pinned at A", t.code === 0, t.out);
    }
    {
      const t = cli(["check", runLive]);
      check(
        "check fails the run pointed at main after it moved on (identical command)",
        t.code === 1,
        t.out,
      );
    }
    appendFileSync(join(pinA, "skills", "postmaster", "coachman.md"), "drift\n");
    {
      const t = cli(["check", runPinned]);
      check("check fails a pin that no longer serves its commit", t.code === 1, t.out);
    }
    run("git", ["-C", pinA, "checkout", "-q", "--", "skills/postmaster/coachman.md"]);

    console.log("negative controls");
    copyFileSync(join(d, "run.json"), join(tmp, "before.json"));
    await Bun.sleep(1000);
    meta(d, repo);
    check(
      "a second call leaves run.json alone",
      readFileSync(join(d, "run.json"), "utf8") === readFileSync(join(tmp, "before.json"), "utf8"),
    );

    rmSync(join(d, "run.json"));
    process.env.POSTMASTER_CONFIG = join(tmp, "none.toml");
    const rcNoCfg = meta(d, repo).code;
    process.env.POSTMASTER_CONFIG = configPath;
    check(
      "no config is refused, and nothing is written",
      rcNoCfg === 1 && !existsSync(join(d, "run.json")),
    );

    const rcNoRepo = meta(d, join(tmp, "not-a-repo")).code;
    check("a target that is not a repo is refused", rcNoRepo === 1);
    {
      const t = cli(["path", join(tmp, "project", "no-such-run")]);
      check("path on a run with no run.json is refused", t.code === 1, t.out);
    }
    {
      const t = cli(["pin", fake, "no-such-commit"]);
      check("a commit the repo does not have is refused, and no pin is cut", t.code === 1, t.out);
    }
    // AC4: release keeps a pin another in-flight run uses, and removes it once none does.
    // RUN-PINNED and a third run share pinA; RUN-LIVE is the negative control that moved.
    const runThird = join(tmp, "project", "RUN-THIRD");
    mkdirSync(runThird, { recursive: true });
    writeFileSync(
      join(runThird, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA, checkout: pinA } })}\n`,
    );
    writeFileSync(join(runThird, "manifest.json"), '{"stage": "shipping"}\n');
    {
      const t = cli(["release", runPinned]);
      check(
        "release keeps the pin while another run in flight still uses it",
        t.code === 0 && t.out.includes("kept") && isDir(pinA),
        t.out,
      );
    }
    writeFileSync(join(runThird, "manifest.json"), '{"stage": "done"}\n');
    {
      const t = cli(["release", runPinned]);
      check(
        "release keeps the pin while its own run is still in flight",
        t.code === 0 && t.out.includes("kept") && isDir(pinA),
        t.out,
      );
    }
    writeFileSync(join(runPinned, "manifest.json"), '{"stage": "done"}\n');
    {
      const t = cli(["release", runPinned]);
      check(
        "release removes the pin once no run in flight uses it",
        t.code === 0 && t.out.includes("removed") && !existsSync(pinA),
        t.out,
      );
    }
    {
      const t = cli(["release", runPinned]);
      check("release again is a no-op", t.code === 0, t.out);
    }
    const noco = join(tmp, "project", "RUN-OLD");
    mkdirSync(noco, { recursive: true });
    writeFileSync(join(noco, "run.json"), '{"postmaster": {"commit": "abc"}}\n');
    {
      const t = cli(["release", noco]);
      check("release of a run with no pinned checkout is a no-op", t.code === 0, t.out);
    }
    const badown = join(tmp, "project", "RUN-BADOWN");
    mkdirSync(badown, { recursive: true });
    writeFileSync(
      join(badown, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA, checkout: 12345 } })}\n`,
    );
    writeFileSync(join(badown, "manifest.json"), '{"stage": "done"}\n');
    {
      const t = cli(["release", badown]);
      check(
        "release refuses a run whose own checkout is not a string",
        t.code === 1 && t.out.includes("unreadable"),
        t.out,
      );
    }
    rmSync(badown, { recursive: true, force: true }); // unknown to every later scan; its control is done
    // A sibling whose record cannot be read keeps the pin; one that records no checkout is skipped.
    const g4rel = join(tmp, "project", "RUN-G4");
    const g4sib = join(tmp, "project", "RUN-G4SIB");
    mkdirSync(g4rel, { recursive: true });
    mkdirSync(g4sib, { recursive: true });
    const pinG4 = cutPin("a pin is cut for the unreadable-sibling controls", fake, commitA).dest;
    writeFileSync(
      join(g4rel, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA, checkout: pinG4 } })}\n`,
    );
    writeFileSync(join(g4rel, "manifest.json"), '{"stage": "done"}\n');
    writeFileSync(join(g4sib, "manifest.json"), '{"stage": "synthesis"}\n');
    writeFileSync(join(g4sib, "run.json"), "NOT JSON\n");
    {
      const t = cli(["release", g4rel]);
      check(
        "release keeps the pin for a sibling whose run.json does not parse",
        t.code === 0 && t.out.includes("kept") && isDir(pinG4),
        t.out,
      );
    }
    writeFileSync(join(g4sib, "run.json"), '{"postmaster": ["not", "an", "object"]}\n');
    {
      const t = cli(["release", g4rel]);
      check(
        "release keeps the pin for a sibling whose postmaster is not an object",
        t.code === 0 && t.out.includes("kept") && isDir(pinG4),
        t.out,
      );
    }
    writeFileSync(
      join(g4sib, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA, checkout: 12345 } })}\n`,
    );
    {
      const t = cli(["release", g4rel]);
      check(
        "release keeps the pin for a sibling whose checkout is not a string",
        t.code === 0 && t.out.includes("kept") && isDir(pinG4),
        t.out,
      );
    }
    writeFileSync(join(g4sib, "run.json"), "{}\n");
    {
      const t = cli(["release", g4rel]);
      check(
        "release keeps the pin for a sibling with no postmaster record",
        t.code === 0 && t.out.includes("kept") && isDir(pinG4),
        t.out,
      );
    }
    writeFileSync(
      join(g4sib, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA } })}\n`,
    );
    {
      const t = cli(["release", g4rel]);
      check(
        "release removes past a sibling that records no checkout",
        t.code === 0 && t.out.includes("removed") && !existsSync(pinG4),
        t.out,
      );
    }

    const hidrun = join(tmp, ".hidden", "RUN-HID");
    const hidrel = join(tmp, "project", "RUN-HIDREL");
    mkdirSync(hidrun, { recursive: true });
    mkdirSync(hidrel, { recursive: true });
    const pinHid = cutPin("a pin is cut for the hidden-project controls", fake, commitA).dest;
    writeFileSync(
      join(hidrun, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA, checkout: pinHid } })}\n`,
    );
    writeFileSync(join(hidrun, "manifest.json"), '{"stage": "synthesis"}\n');
    writeFileSync(
      join(hidrel, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA, checkout: pinHid } })}\n`,
    );
    writeFileSync(join(hidrel, "manifest.json"), '{"stage": "done"}\n');
    {
      const t = cli(["release", hidrel]);
      check(
        "release keeps the pin for an in-flight run under a dot-prefixed project",
        t.code === 0 && t.out.includes("kept") && isDir(pinHid),
        t.out,
      );
    }
    writeFileSync(join(hidrun, "manifest.json"), '{"stage": "done"}\n');
    {
      const t = cli(["release", hidrel]);
      check(
        "release removes once the hidden run is done",
        t.code === 0 && t.out.includes("removed") && !existsSync(pinHid),
        t.out,
      );
    }
    const nphid = join(tmp, "noproj", "RUN-NP");
    const nprel = join(tmp, "project", "RUN-NPREL");
    mkdirSync(nphid, { recursive: true });
    mkdirSync(nprel, { recursive: true });
    const pinNP = cutPin("a pin is cut for the unreadable-directory controls", fake, commitA).dest;
    writeFileSync(
      join(nphid, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA, checkout: pinNP } })}\n`,
    );
    writeFileSync(join(nphid, "manifest.json"), '{"stage": "synthesis"}\n');
    writeFileSync(
      join(nprel, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA, checkout: pinNP } })}\n`,
    );
    writeFileSync(join(nprel, "manifest.json"), '{"stage": "done"}\n');
    chmodSync(join(tmp, "noproj"), 0);
    {
      const t = cli(["release", nprel]);
      check(
        "release keeps the pin when a project directory cannot be listed",
        t.code === 0 && t.out.includes("kept") && isDir(pinNP),
        t.out,
      );
    }
    chmodSync(join(tmp, "noproj"), 0o755);
    chmodSync(nphid, 0);
    {
      const t = cli(["release", nprel]);
      check(
        "release keeps the pin when a run directory cannot be listed",
        t.code === 0 && t.out.includes("kept") && isDir(pinNP),
        t.out,
      );
    }
    chmodSync(nphid, 0o755);
    {
      const t = cli(["release", nprel]);
      check(
        "release still keeps the pin for the readable in-flight run",
        t.code === 0 && t.out.includes("kept") && isDir(pinNP),
        t.out,
      );
    }
    writeFileSync(join(nphid, "manifest.json"), '{"stage": "done"}\n');
    {
      const t = cli(["release", nprel]);
      check(
        "release removes once the unreadable run is done",
        t.code === 0 && t.out.includes("removed") && !existsSync(pinNP),
        t.out,
      );
    }
    // A literal star in a directory name is data: the scan reads through it and keeps the
    // pin for the in-flight runs, without crying unreadable.
    mkdirSync(join(tmp, "project", "*EMPTY"), { recursive: true });
    mkdirSync(join(tmp, "project", "RUN-SALIVE"), { recursive: true });
    mkdirSync(join(tmp, "project", "STAR*RUN"), { recursive: true });
    mkdirSync(join(tmp, "star*proj", "RUN-PALIVE"), { recursive: true });
    const pinStar = cutPin("a pin is cut for the star-name controls", fake, commitA).dest;
    for (const r of [
      join(tmp, "project", "RUN-SALIVE"),
      join(tmp, "project", "STAR*RUN"),
      join(tmp, "star*proj", "RUN-PALIVE"),
    ]) {
      writeFileSync(
        join(r, "run.json"),
        `${JSON.stringify({ postmaster: { commit: commitA, checkout: pinStar } })}\n`,
      );
      writeFileSync(join(r, "manifest.json"), '{"stage": "synthesis"}\n');
    }
    const starrel = join(tmp, "project", "RUN-STARREL");
    mkdirSync(starrel, { recursive: true });
    writeFileSync(
      join(starrel, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA, checkout: pinStar } })}\n`,
    );
    writeFileSync(join(starrel, "manifest.json"), '{"stage": "done"}\n');
    {
      const t = cli(["release", starrel]);
      check(
        "release keeps the pin past star-named directories, crying nothing unreadable",
        t.code === 0 && t.out.includes("kept") && !t.out.includes("cannot list") && isDir(pinStar),
        t.out,
      );
    }
    for (const r of [
      join(tmp, "project", "RUN-SALIVE"),
      join(tmp, "project", "STAR*RUN"),
      join(tmp, "star*proj", "RUN-PALIVE"),
    ]) {
      writeFileSync(join(r, "manifest.json"), '{"stage": "done"}\n');
    }
    {
      const t = cli(["release", starrel]);
      check(
        "release removes once the star-named runs are done",
        t.code === 0 && t.out.includes("removed") && !existsSync(pinStar),
        t.out,
      );
    }

    const giRun = join(tmp, "giproj", "RUN-GI");
    const giRel = join(tmp, "project", "RUN-GIREL");
    mkdirSync(giRun, { recursive: true });
    mkdirSync(giRel, { recursive: true });
    const pinGI = cutPin("a pin is cut for the GLOBIGNORE controls", fake, commitA).dest;
    writeFileSync(
      join(giRun, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA, checkout: pinGI } })}\n`,
    );
    writeFileSync(join(giRun, "manifest.json"), '{"stage": "synthesis"}\n');
    writeFileSync(
      join(giRel, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA, checkout: pinGI } })}\n`,
    );
    writeFileSync(join(giRel, "manifest.json"), '{"stage": "done"}\n');
    writeFileSync(join(tmp, "benv-ignore.sh"), `GLOBIGNORE=${join(tmp, "giproj")}/\n`);
    {
      const t = cli(["release", giRel], { BASH_ENV: join(tmp, "benv-ignore.sh") });
      check(
        "release keeps the pin under a BASH_ENV that ignores the live project",
        t.code === 0 && t.out.includes("kept") && isDir(pinGI),
        t.out,
      );
    }
    // The hostile controls: release under every ambient vector at once — a BASH_ENV
    // holding a readonly GLOBIGNORE, set -f, failglob, the opposite of every scan
    // setting and a python3 shadow, plus an exported SHELLOPTS with noglob and an
    // exported python3 function — over a fixture shaped to show each one: an empty
    // project level, a dot-named project holding the live run, and star-named,
    // bracket-named and mixed-case projects. The enumeration reads directories
    // literally, so the vectors are inert and the names do the work.
    const hroot = join(tmp, "hruns");
    mkdirSync(join(hroot, "empty-proj"), { recursive: true });
    mkdirSync(join(hroot, ".dotproj", "RUN-HDOT"), { recursive: true });
    mkdirSync(join(hroot, "giproj", "RUN-HGI"), { recursive: true });
    mkdirSync(join(hroot, "STAR*PROJ", "RUN-HS"), { recursive: true });
    mkdirSync(join(hroot, "br[ack]et", "RUN-HB"), { recursive: true });
    mkdirSync(join(hroot, "MiXeD", "RUN-HM"), { recursive: true });
    mkdirSync(join(hroot, "project", "RUN-HREL"), { recursive: true });
    // The hostile pin is its own commit, so the hostile remove below does not eat the
    // GLOBIGNORE pin, which is still needed after; the fake repo's HEAD is B here.
    const commitH = headOf(fake);
    const pinHos = cutPin("a pin is cut for the hostile controls", fake, commitH).dest;
    for (const r of [
      join(hroot, ".dotproj", "RUN-HDOT"),
      join(hroot, "giproj", "RUN-HGI"),
      join(hroot, "STAR*PROJ", "RUN-HS"),
      join(hroot, "br[ack]et", "RUN-HB"),
      join(hroot, "MiXeD", "RUN-HM"),
      join(hroot, "project", "RUN-HREL"),
    ]) {
      writeFileSync(
        join(r, "run.json"),
        `${JSON.stringify({ postmaster: { commit: commitH, checkout: pinHos } })}\n`,
      );
      writeFileSync(join(r, "manifest.json"), '{"stage": "done"}\n');
    }
    writeFileSync(join(hroot, ".dotproj", "RUN-HDOT", "manifest.json"), '{"stage": "synthesis"}\n');
    writeFileSync(
      join(tmp, "benv-hostile.sh"),
      `GLOBIGNORE=${join(hroot, "giproj")}/\n` +
        "readonly GLOBIGNORE\n" +
        "set -f\n" +
        "shopt -s failglob nocaseglob extglob globstar nocasematch\n" +
        "shopt -u dotglob nullglob globskipdots globasciiranges\n" +
        'python3() { case "$*" in *RUN-HS*) echo weird;; *) command python3 "$@";; esac; }\n',
    );
    // An exported shell function crosses to children as BASH_FUNC_<name>%%.
    const hostileEnv = {
      BASH_ENV: join(tmp, "benv-hostile.sh"),
      SHELLOPTS: "noglob",
      "BASH_FUNC_python3%%":
        '() { case "$*" in *RUN-HS*) echo weird;; *) command python3 "$@";; esac; }',
    };
    {
      const t = cli(["release", join(hroot, "project", "RUN-HREL")], hostileEnv);
      check(
        "release keeps the pin under every hostile vector at once",
        t.code === 0 &&
          t.out.includes("kept") &&
          !t.out.includes("cannot list") &&
          !t.out.includes("not its drop signal") &&
          isDir(pinHos),
        t.out,
      );
    }
    writeFileSync(join(hroot, ".dotproj", "RUN-HDOT", "manifest.json"), '{"stage": "done"}\n');
    {
      const t = cli(["release", join(hroot, "project", "RUN-HREL")], hostileEnv);
      check(
        "release removes under every hostile vector at once when nothing is live",
        t.code === 0 && t.out.includes("removed") && !existsSync(pinHos),
        t.out,
      );
    }
    // A scan that dies mid-way keeps the pin: only the reserved drop signal removes.
    // The hold keeps the scan alive until the kill lands; the kill is scoped to a scan
    // whose command line holds this test's own tmp.
    const kroot = join(tmp, "kroot");
    const krel = join(kroot, "project", "RUN-KREL");
    mkdirSync(krel, { recursive: true });
    const pinK = cutPin("a pin is cut for the killed-scan control", fake, commitH).dest;
    for (let i = 1; i <= 150; i++) {
      const r = join(kroot, "project", `RUN-K${i}`);
      mkdirSync(r, { recursive: true });
      writeFileSync(
        join(r, "run.json"),
        `${JSON.stringify({ postmaster: { commit: commitH, checkout: pinK } })}\n`,
      );
      writeFileSync(join(r, "manifest.json"), '{"stage": "done"}\n');
    }
    writeFileSync(
      join(krel, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitH, checkout: pinK } })}\n`,
    );
    writeFileSync(join(krel, "manifest.json"), '{"stage": "done"}\n');
    {
      const relChild: any = Bun.spawn([wrapper, "release", krel], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, POSTMASTER_SCAN_HOLD_MS: "20000" },
      });
      let killed = false;
      for (let i = 0; i < 300 && !killed; i++) {
        const pg = run("pgrep", ["-f", "run-meta-scan"]);
        const pids = pg.out.trim() === "" ? [] : pg.out.trim().split("\n");
        for (const pid of pids) {
          let cmd = "";
          try {
            cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8");
          } catch {
            continue;
          }
          if (cmd.includes(tmp)) {
            try {
              process.kill(Number(pid), 9);
              killed = true;
            } catch {
              // Already gone; keep looking.
            }
          }
        }
        if (killed) break;
        const status = await Promise.race([
          (relChild.exited as Promise<number>).then(() => "exited"),
          Promise.resolve("waiting"),
        ]);
        if (status === "exited") break;
        await Bun.sleep(100);
      }
      const rcKill = (await relChild.exited) as number;
      const outKill =
        ((await new Response(relChild.stdout).text()) as string) +
        ((await new Response(relChild.stderr).text()) as string);
      check(
        "release keeps the pin when the pin scan is killed",
        killed &&
          rcKill === 0 &&
          outKill.includes("kept") &&
          outKill.includes("not its drop signal") &&
          isDir(pinK),
        `killed=${killed} rc=${rcKill} ${outKill}`,
      );
    }
    rmSync(kroot, { recursive: true, force: true });

    // A sibling whose record claims an unexpected shape keeps the pin, without noise.
    // main forces the shape with a shadow python3 answering weird; the port reads JSON
    // in-process, so the unexpected shape is a record that parses yet is no object at
    // all. Restored after: the shell's weirdness was PATH-scoped and transient, and later
    // scans must read this run normally.
    const wroot = join(tmp, "wroot");
    const weirdRun = join(wroot, "project", "RUN-WEIRD");
    const wrel = join(wroot, "project", "RUN-WREL");
    mkdirSync(weirdRun, { recursive: true });
    mkdirSync(wrel, { recursive: true });
    const pinU = cutPin("a pin is cut for the unexpected-shape control", fake, commitH).dest;
    const normalWeird = `${JSON.stringify({ postmaster: { commit: commitH, checkout: pinU } })}\n`;
    for (const r of [weirdRun, wrel]) {
      writeFileSync(join(r, "run.json"), normalWeird);
      writeFileSync(join(r, "manifest.json"), '{"stage": "done"}\n');
    }
    writeFileSync(join(weirdRun, "run.json"), '"weird"\n');
    {
      const t = cli(["release", wrel]);
      check(
        "release keeps the pin for a sibling whose record claims an unexpected shape",
        t.code === 0 && t.out.includes("kept") && isDir(pinU),
        t.out,
      );
    }
    writeFileSync(join(weirdRun, "run.json"), normalWeird);
    // A run whose run.json is missing, a directory or a broken link keeps the pin while
    // its manifest is live — the record's absence is not safety — and drops once done.
    const mroot = join(tmp, "mroot");
    const mMissing = join(mroot, "missing", "RUN-MM");
    const mDir = join(mroot, "dirrec", "RUN-MD");
    const mLink = join(mroot, "linkrec", "RUN-ML");
    const mrel = join(mroot, "project", "RUN-MREL");
    mkdirSync(mMissing, { recursive: true });
    mkdirSync(mDir, { recursive: true });
    mkdirSync(mLink, { recursive: true });
    mkdirSync(mrel, { recursive: true });
    const pinM = cutPin("a pin is cut for the missing-record controls", fake, commitH).dest;
    mkdirSync(join(mDir, "run.json"), { recursive: true });
    symlinkSync(join(tmp, "nowhere-at-all"), join(mLink, "run.json"));
    for (const r of [mMissing, mDir, mLink]) {
      writeFileSync(join(r, "manifest.json"), '{"stage": "done"}\n');
    }
    writeFileSync(
      join(mrel, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitH, checkout: pinM } })}\n`,
    );
    writeFileSync(join(mrel, "manifest.json"), '{"stage": "done"}\n');
    writeFileSync(join(mMissing, "manifest.json"), '{"stage": "synthesis"}\n');
    {
      const t = cli(["release", mrel]);
      check(
        "release keeps the pin for a live run whose run.json is missing",
        t.code === 0 && t.out.includes("kept") && isDir(pinM),
        t.out,
      );
    }
    writeFileSync(join(mMissing, "manifest.json"), '{"stage": "done"}\n');
    writeFileSync(join(mDir, "manifest.json"), '{"stage": "synthesis"}\n');
    {
      const t = cli(["release", mrel]);
      check(
        "release keeps the pin for a live run whose run.json is a directory",
        t.code === 0 && t.out.includes("kept") && isDir(pinM),
        t.out,
      );
    }
    writeFileSync(join(mDir, "manifest.json"), '{"stage": "done"}\n');
    writeFileSync(join(mLink, "manifest.json"), '{"stage": "synthesis"}\n');
    {
      const t = cli(["release", mrel]);
      check(
        "release keeps the pin for a live run whose run.json is a broken link",
        t.code === 0 && t.out.includes("kept") && isDir(pinM),
        t.out,
      );
    }
    writeFileSync(join(mLink, "manifest.json"), '{"stage": "done"}\n');
    {
      const t = cli(["release", mrel]);
      check(
        "release removes once the recordless runs are done",
        t.code === 0 && t.out.includes("removed") && !existsSync(pinM),
        t.out,
      );
    }
    // A hostile HOME cannot reach the scan: no HOME crosses into the scan child, and it
    // parses JSON in-process besides, so a user site forging done changes nothing.
    // The version below only names the site dir: no interpreter runs here
    // since the round-10 fixtures retired the live proof. It records the
    // layout the proof last ran against; re-prove by hand when it changes.
    const pyver = "3.12";
    const usite = join(tmp, "fakehome", ".local", "lib", `python${pyver}`, "site-packages");
    mkdirSync(usite, { recursive: true });
    writeFileSync(
      join(usite, "usercustomize.py"),
      "import json as _j\n" +
        "_real_load = _j.load\n" +
        "def _fake_load(fp, *a, **k):\n" +
        "    d = _real_load(fp, *a, **k)\n" +
        '    if isinstance(d, dict) and d.get("stage") == "synthesis":\n' +
        '        d = dict(d); d["stage"] = "done"\n' +
        "    return d\n" +
        "_j.load = _fake_load\n",
    );
    const hhomeroot = join(tmp, "hhroot");
    const hlive = join(hhomeroot, "project", "RUN-HLIVE");
    const hhrel = join(hhomeroot, "project", "RUN-HHREL");
    mkdirSync(hlive, { recursive: true });
    mkdirSync(hhrel, { recursive: true });
    const pinHH = cutPin("a pin is cut for the hostile-HOME controls", fake, commitH).dest;
    for (const r of [hlive, hhrel]) {
      writeFileSync(
        join(r, "run.json"),
        `${JSON.stringify({ postmaster: { commit: commitH, checkout: pinHH } })}\n`,
      );
      writeFileSync(join(r, "manifest.json"), '{"stage": "done"}\n');
    }
    writeFileSync(join(hlive, "manifest.json"), '{"stage": "synthesis"}\n');
    // The live proof retired with the round-10 fixtures; what stays pinned
    // is the scaffolding's content. Re-prove by hand when it changes:
    // HOME=<tmp>/fakehome python3 -c
    //   'import json,sys; print(json.load(open(<hlive>/manifest.json)).get("stage"))'
    // (expect "done").
    const ucPath = join(usite, "usercustomize.py");
    const uc = readFileSync(ucPath, "utf8");
    check(
      "the hostile HOME demonstrably forges done",
      uc.includes('d.get("stage") == "synthesis"') && uc.includes('d["stage"] = "done"'),
      uc,
    );
    const oldHome = process.env.HOME;
    process.env.HOME = join(tmp, "fakehome");
    const tHH1 = cli(["release", hhrel]);
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    check(
      "release keeps the pin under a hostile HOME forging done",
      tHH1.code === 0 && tHH1.out.includes("kept") && isDir(pinHH),
      tHH1.out,
    );
    writeFileSync(join(hlive, "manifest.json"), '{"stage": "done"}\n');
    process.env.HOME = join(tmp, "fakehome");
    const tHH2 = cli(["release", hhrel]);
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    check(
      "release removes under a hostile HOME once nothing is live",
      tHH2.code === 0 && tHH2.out.includes("removed") && !existsSync(pinHH),
      tHH2.out,
    );
    writeFileSync(join(giRun, "manifest.json"), '{"stage": "done"}\n');
    {
      const t = cli(["release", giRel]);
      check(
        "release removes once the GLOBIGNORE run is done",
        t.code === 0 && t.out.includes("removed") && !existsSync(pinGI),
        t.out,
      );
    }
    meta(d, repo);
    {
      const t = cli(["check", d]);
      check("check still passes the run that shares the live tool pin", t.code === 0, t.out);
    }
    // Concurrent cuts of one commit share one pin; the loser reuses the winner's checkout.
    const race = join(tools, commitA);
    rmSync(race, { recursive: true, force: true });
    await Promise.all([spawnCli(["pin", fake, commitA]), spawnCli(["pin", fake, commitA])]);
    check(
      "two concurrent cuts of one commit end with one shared pin",
      isDir(race) && headOf(race) === commitA,
    );
    run("git", ["clone", "-q", fake, join(tmp, "fake-clone")]);
    {
      const t = cli(["pin", join(tmp, "fake-clone"), commitA]);
      check(
        "a pin of the same commit from another clone reuses the checkout",
        t.code === 0 && sh(t.out) === race,
        t.out,
      );
    }
    appendFileSync(join(race, "skills", "postmaster", "coachman.md"), "drift\n");
    {
      const t = cli(["pin", fake, commitA]);
      check("a pin that is not clean is refused on reuse", t.code === 1, t.out);
    }
    run("git", ["-C", race, "checkout", "-q", "--", "skills/postmaster/coachman.md"]);
    {
      const t = cli(["pin", fake, commitA]);
      check("a cleaned pin is shared again", t.code === 0 && sh(t.out) === race, t.out);
    }
    const commitB = headOf(fake);
    const pinB = cutPin("a pin at B is cut for the refusal controls", fake, commitB).dest;
    run("git", ["-C", pinB, "checkout", "-q", commitA]);
    {
      const t = cli(["pin", fake, commitB]);
      check("a pin holding another commit is refused", t.code === 1, t.out);
    }
    run("git", ["-C", fake, "worktree", "remove", "--force", pinB]);
    run("git", ["-C", fake, "commit", "-q", "--allow-empty", "-m", "C"]);
    const commitC = headOf(fake);
    mkdirSync(join(tools, commitC), { recursive: true });
    writeFileSync(join(tools, commitC, "mine.txt"), "mine\n");
    {
      const t = cli(["pin", fake, commitC]);
      check("a pin path that is not a checkout is refused", t.code === 1, t.out);
    }
    rmSync(join(tools, commitC), { recursive: true, force: true });

    // An old unpinned waybill keeps the tool path it already names.
    const legacyRun = join(tmp, "project", "RUN-LEGACY");
    mkdirSync(legacyRun, { recursive: true });
    const fakeCanon = realpathSync(fake);
    writeFileSync(
      join(legacyRun, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA } })}\n`,
    );
    writeFileSync(join(legacyRun, "brief.md"), `# Waybill: 7\n\ntool: ${fake}\n`);
    {
      const t = cli(["path", legacyRun]);
      check(
        "path falls back to an old waybill's tool path",
        t.code === 0 && sh(t.out) === fakeCanon,
        t.out,
      );
    }
    {
      const t = cli(["check", legacyRun]);
      check("check passes an old waybill on a git checkout", t.code === 0, t.out);
    }
    writeFileSync(join(legacyRun, "brief.md"), `# Waybill: 7\n\ntool: ${join(tmp, "nowhere")}\n`);
    {
      const t = cli(["check", legacyRun]);
      check("check fails an old waybill whose tool is gone", t.code === 1, t.out);
    }
    writeFileSync(join(legacyRun, "brief.md"), `# Waybill: 7\n\ntool: ${fake}\ntool: ${fake}\n`);
    {
      const t = cli(["path", legacyRun]);
      check("path refuses a waybill with two tool lines", t.code === 1, t.out);
    }
    writeFileSync(
      join(legacyRun, "brief.md"),
      `# Waybill: 7\n\n## Ticket\na sample:\ntool: /from/the/ticket\n\n## Dispatch\ntool: ${fake}\n`,
    );
    {
      const t = cli(["path", legacyRun]);
      check(
        "path ignores a tool: line in the ticket body",
        t.code === 0 && sh(t.out) === fakeCanon,
        t.out,
      );
    }
    writeFileSync(
      join(legacyRun, "brief.md"),
      `# Waybill: 7\n\n## Dispatch\ntool: ${fake}\ntool: ${fake}\n`,
    );
    {
      const t = cli(["path", legacyRun]);
      check("path refuses a Dispatch section with two tool lines", t.code === 1, t.out);
    }
    // path and check refuse an unreadable checkout instead of taking the waybill fallback.
    const badpath = join(tmp, "project", "RUN-BADPATH");
    mkdirSync(badpath, { recursive: true });
    writeFileSync(join(badpath, "brief.md"), `# Waybill: 7\n\n## Dispatch\ntool: ${fake}\n`);
    writeFileSync(join(badpath, "run.json"), "{}\n");
    {
      const t = cli(["path", badpath]);
      check(
        "path refuses a run with no postmaster record",
        t.code === 1 && t.out.includes("unreadable"),
        t.out,
      );
    }
    writeFileSync(
      join(badpath, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA, checkout: false } })}\n`,
    );
    {
      const t = cli(["path", badpath]);
      check(
        "path refuses a run whose checkout is not a string",
        t.code === 1 && t.out.includes("unreadable"),
        t.out,
      );
    }
    {
      const t = cli(["check", badpath]);
      check(
        "check refuses a run whose checkout is not a string",
        t.code === 1 && t.out.includes("unreadable"),
        t.out,
      );
    }
    rmSync(badpath, { recursive: true, force: true }); // unknown to every later scan; its controls are done
    // check fails a pin at the wrong commit, whatever shape the record is in.
    const pinW = cutPin("a pin at B is cut for the mismatch controls", fake, commitB).dest;
    const misrun = join(tmp, "project", "RUN-MIS");
    mkdirSync(misrun, { recursive: true });
    writeFileSync(join(misrun, "brief.md"), `# Waybill: 7\n\n## Dispatch\ntool: ${fake}\n`);
    writeFileSync(
      join(misrun, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA, checkout: pinW } })}\n`,
    );
    {
      const t = cli(["check", misrun]);
      check(
        "check fails a pin at the wrong commit",
        t.code === 1 && t.out.includes("not the recorded"),
        t.out,
      );
    }
    writeFileSync(join(misrun, "run.json"), "{}\n");
    {
      const t = cli(["check", misrun]);
      check(
        "check fails a wrong-commit pin when the record has no postmaster",
        t.code === 1 && t.out.includes("unreadable"),
        t.out,
      );
    }
    writeFileSync(
      join(misrun, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA, checkout: false } })}\n`,
    );
    {
      const t = cli(["check", misrun]);
      check(
        "check fails a wrong-commit pin when the checkout is not a string",
        t.code === 1 && t.out.includes("unreadable"),
        t.out,
      );
    }
    rmSync(misrun, { recursive: true, force: true }); // unknown to every later scan; its controls are done
    run("git", ["-C", fake, "worktree", "remove", "--force", pinW]);
    // A recorded path through a symlink resolves to the canonical checkout.
    symlinkSync(tools, join(tmp, "tools-link"));
    const linkRun = join(tmp, "project", "RUN-LINK");
    mkdirSync(linkRun, { recursive: true });
    writeFileSync(
      join(linkRun, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA, checkout: join(tmp, "tools-link", commitA) } })}\n`,
    );
    {
      const t = cli(["path", linkRun]);
      check("path prints the canonical checkout", t.code === 0 && sh(t.out) === race, t.out);
    }
    writeFileSync(join(linkRun, "manifest.json"), '{"stage": "shipping"}\n');
    // Two runs closing at once both release cleanly; the loser finds the pin already gone.
    const relA = join(tmp, "project", "RUN-REL-A");
    const relB = join(tmp, "project", "RUN-REL-B");
    mkdirSync(relA, { recursive: true });
    mkdirSync(relB, { recursive: true });
    for (const rel of [relA, relB]) {
      writeFileSync(
        join(rel, "run.json"),
        `${JSON.stringify({ postmaster: { commit: commitA, checkout: race } })}\n`,
      );
      writeFileSync(join(rel, "manifest.json"), '{"stage": "done"}\n');
    }
    {
      const t = cli(["release", relA]);
      check(
        "release keeps the pin for an in-flight run recorded through a symlink",
        t.code === 0 && t.out.includes("kept") && isDir(race),
        t.out,
      );
    }
    writeFileSync(join(linkRun, "manifest.json"), '{"stage": "done"}\n');
    let races = 0;
    let lastRace = "";
    for (let round = 1; round <= 10; round++) {
      const cut = pin(fake, commitA, tools);
      if (cut.code !== 0) {
        races += 1;
        lastRace = `round ${round} cuts no pin`;
        break;
      }
      const pinR = cut.out.trim();
      for (const rel of [relA, relB]) {
        writeFileSync(
          join(rel, "run.json"),
          `${JSON.stringify({ postmaster: { commit: commitA, checkout: pinR } })}\n`,
        );
      }
      const [a, b] = await Promise.all([spawnCli(["release", relA]), spawnCli(["release", relB])]);
      if (a.code === 0 && b.code === 0 && !existsSync(pinR)) {
        // A clean round: both exit 0 and the pin is gone.
      } else {
        races += 1;
        lastRace = `round ${round}: a=${a.code} b=${b.code} ${a.out} ${b.out}`;
      }
    }
    check("ten concurrent-release races all exit 0 and remove the pin", races === 0, lastRace);

    // A dispatch racing a release serializes: either the release sees the new record and
    // keeps the pin, or it removes wholly before the dispatch cuts. Either way both exit 0
    // and the new run checks out.
    mkdirSync(join(tmp, "stubbin"), { recursive: true });
    writeFileSync(
      join(tmp, "stubbin", "slowharness"),
      '#!/bin/sh\nif [ "$1" = "--version" ]; then sleep 3; echo "slow 1.0"; else echo "slow 1.0"; fi\n',
    );
    chmodSync(join(tmp, "stubbin", "slowharness"), 0o755);
    writeFileSync(
      join(tmp, "slow.toml"),
      '[lanes.one]\nharness = "slowharness"\nmodel = "m1"\n[team]\ncoachman = { harness = "slowharness", model = "judge" }\n',
    );
    writeFileSync(join(d, "manifest.json"), '{"stage": "done"}\n');
    writeFileSync(join(shared, "manifest.json"), '{"stage": "done"}\n');
    const livecommit = headOf(TOOL);
    const liveToolPin = cutPin(
      "a pin of the live tool is cut for the dispatch race",
      TOOL,
      livecommit,
    ).dest;
    const g1done = join(tmp, "project", "RUN-G1DONE");
    const g1new = join(tmp, "project", "RUN-G1NEW");
    mkdirSync(g1done, { recursive: true });
    mkdirSync(g1new, { recursive: true });
    writeFileSync(
      join(g1done, "run.json"),
      `${JSON.stringify({ postmaster: { commit: livecommit, checkout: liveToolPin } })}\n`,
    );
    writeFileSync(join(g1done, "manifest.json"), '{"stage": "done"}\n');
    // main runs this meta under its slow config with the stub on PATH, and the release
    // with the same PATH but the main config, since CONFIG is main's shell variable.
    const stubPath = `${join(tmp, "stubbin")}${delimiter}${process.env.PATH ?? ""}`;
    const g1meta = spawnCli([g1new, repo], {
      POSTMASTER_CONFIG: join(tmp, "slow.toml"),
      PATH: stubPath,
    });
    await Bun.sleep(1000);
    const g1rel = cli(["release", g1done], { PATH: stubPath });
    const g1m = await g1meta;
    const newco = (() => {
      try {
        return (runJson(g1new).postmaster.checkout as string) ?? "";
      } catch {
        return "";
      }
    })();
    const tG1 = cli(["check", g1new]);
    check(
      "a dispatch racing a release records a pin that checks out",
      g1m.code === 0 && g1rel.code === 0 && newco !== "" && isDir(newco) && tG1.code === 0,
      `meta=${g1m.code} release=${g1rel.code} check=${tG1.code}`,
    );
    // Two dispatches of one run serialize: the loser finds run.json already written.
    const drace = join(tmp, "project", "RUN-DRACE");
    mkdirSync(drace, { recursive: true });
    const [draR, drbR] = await Promise.all([spawnCli([drace, repo]), spawnCli([drace, repo])]);
    check(
      "two dispatches of one run write run.json once",
      (draR.out.includes("already written") || drbR.out.includes("already written")) &&
        draR.code === 0 &&
        drbR.code === 0,
      `a=${draR.code} b=${drbR.code} ${draR.out} ${drbR.out}`,
    );
    // Release force-removes an unreferenced pin it cannot remove cleanly, but honors a lock.
    const pinD = cutPin("a pin is cut for the dirty-release controls", fake, commitA).dest;
    const g6rel = join(tmp, "project", "RUN-G6");
    mkdirSync(g6rel, { recursive: true });
    writeFileSync(
      join(g6rel, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA, checkout: pinD } })}\n`,
    );
    writeFileSync(join(g6rel, "manifest.json"), '{"stage": "done"}\n');
    appendFileSync(join(pinD, "skills", "postmaster", "coachman.md"), "drift\n");
    {
      const t = cli(["release", g6rel]);
      check(
        "release force-removes an unreferenced pin that is not clean",
        t.code === 0 && t.out.includes("not clean") && !existsSync(pinD),
        t.out,
      );
    }
    const pinL = cutPin("a pin is cut for the locked-release control", fake, commitA).dest;
    writeFileSync(
      join(g6rel, "run.json"),
      `${JSON.stringify({ postmaster: { commit: commitA, checkout: pinL } })}\n`,
    );
    run("git", ["-C", fake, "worktree", "lock", pinL]);
    {
      const t = cli(["release", g6rel]);
      check(
        "release leaves a locked pin alone",
        t.code === 1 && t.out.includes("locked") && isDir(pinL),
        t.out,
      );
    }
    run("git", ["-C", fake, "worktree", "unlock", pinL]);
    {
      const t = cli(["release", g6rel]);
      check(
        "release removes the pin once unlocked",
        t.code === 0 && t.out.includes("removed") && !existsSync(pinL),
        t.out,
      );
    }
    mkdirSync(join(tmp, "outside", "legacy", "RUN-2"), { recursive: true });
    const rcOutside = meta(join(tmp, "outside", "legacy", "RUN-2"), repo).code;
    let rcOutside2 = 1;
    try {
      const r = runJson(join(tmp, "outside", "legacy", "RUN-2"));
      rcOutside2 = r.project === "legacy" && r.run === "RUN-2" ? 0 : 1;
    } catch {
      rcOutside2 = 1;
    }
    check(
      "an older runs/<project>/<TICKET> layout is still read as that project",
      rcOutside === 0 && rcOutside2 === 0,
      `exit ${rcOutside}/${rcOutside2}`,
    );

    console.log("claims across projects and layouts");
    writeFileSync(join(d, "manifest.json"), '{"stage": "done"}\n');
    writeFileSync(join(shared, "manifest.json"), '{"stage": "done"}\n');
    writeFileSync(join(tmp, "outside", "legacy", "RUN-2", "manifest.json"), '{"stage": "done"}\n');
    writeFileSync(join(tmp, "project", "RUN-G1NEW", "manifest.json"), '{"stage": "done"}\n');
    writeFileSync(join(tmp, "project", "RUN-DRACE", "manifest.json"), '{"stage": "done"}\n');
    const headc = headOf(TOOL);
    let claimsText = "";
    try {
      claimsText = readFileSync(join(tools, `${headc}.claims`), "utf8");
    } catch {
      claimsText = "";
    }
    check("dispatch records its claim on the pin", claimsText.includes(d));
    // Two projects share one pin: an old-layout run beside a new-layout one.
    const repo2 = join(tmp, "other");
    mkdirSync(repo2, { recursive: true });
    run("git", ["-C", repo2, "init", "-q", "-b", "main"]);
    run("git", [
      "-C",
      repo2,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "first",
    ]);
    const oldrun = join(tmp, "runs", "acme", "RUN-OLD");
    const newrun = join(repo2, ".postmaster", "runs", "RUN-NEW");
    mkdirSync(oldrun, { recursive: true });
    mkdirSync(newrun, { recursive: true });
    const rc1 = meta(oldrun, repo).code;
    const rc2 = meta(newrun, repo2).code;
    check("two projects dispatch on one pin", rc1 === 0 && rc2 === 0, `${rc1}/${rc2}`);
    {
      let named = false;
      try {
        const r = runJson(newrun);
        named = r.project === "other" && r.run === "RUN-NEW";
      } catch {
        named = false;
      }
      check("a new-layout run is named from its project root", named);
    }
    {
      let recorded = false;
      try {
        const r = runJson(newrun);
        recorded =
          !r.project_settings.shared_present &&
          r.project_settings.sources["project.default_turnpikes"] === "discovery";
      } catch {
        recorded = false;
      }
      check("it records project settings and their source", recorded);
    }
    {
      let both = false;
      try {
        const c = readFileSync(join(tools, `${headc}.claims`), "utf8");
        both = c.includes(oldrun) && c.includes(newrun);
      } catch {
        both = false;
      }
      check("both runs claim the shared pin", both);
    }
    writeFileSync(join(oldrun, "manifest.json"), '{"stage": "shipping"}\n');
    writeFileSync(join(newrun, "manifest.json"), '{"stage": "review"}\n');
    {
      const t = cli(["release", oldrun]);
      check(
        "release keeps the pin while another project's run is in flight",
        t.code === 0 && t.out.includes("kept") && isDir(join(tools, headc)),
        t.out,
      );
    }
    writeFileSync(join(newrun, "manifest.json"), '{"stage": "done"}\n');
    {
      const t = cli(["release", oldrun]);
      check(
        "release keeps the pin while its own run is still in flight",
        t.code === 0 && t.out.includes("kept") && isDir(join(tools, headc)),
        t.out,
      );
    }
    writeFileSync(join(oldrun, "manifest.json"), '{"stage": "done"}\n');
    {
      const t = cli(["release", oldrun]);
      check(
        "release removes the pin and its claims once no run names it",
        t.code === 0 &&
          t.out.includes("removed") &&
          !existsSync(join(tools, headc)) &&
          !existsSync(join(tools, `${headc}.claims`)),
        t.out,
      );
    }
    // A claim that cannot be read keeps the pin.
    const norun = join(tmp, "runs", "acme", "RUN-NO-RECORD");
    mkdirSync(norun, { recursive: true });
    meta(norun, repo);
    writeFileSync(join(norun, "manifest.json"), "not json\n");
    {
      const t = cli(["release", norun]);
      check(
        "release keeps the pin on an unreadable claim",
        t.code === 0 && t.out.includes("kept") && isDir(join(tools, headc)),
        t.out,
      );
    }
    writeFileSync(join(norun, "manifest.json"), '{"stage": "done"}\n');
    {
      const t = cli(["release", norun]);
      check(
        "release removes the pin once the claim reads done",
        t.code === 0 && t.out.includes("removed") && !existsSync(join(tools, headc)),
        t.out,
      );
    }
    // A dispatch that cannot write run.json leaves no claim.
    const rorun = join(tmp, "runs", "acme", "RUN-RO");
    mkdirSync(rorun, { recursive: true });
    chmodSync(rorun, 0o555);
    const rcRo = meta(rorun, repo).code;
    chmodSync(rorun, 0o755);
    let claimsAfter = "";
    try {
      claimsAfter = readFileSync(join(tools, `${headc}.claims`), "utf8");
    } catch {
      claimsAfter = "";
    }
    check(
      "a failed dispatch drops the claim it just made",
      rcRo === 1 && !claimsAfter.includes(rorun),
      `exit ${rcRo}`,
    );
  });
}, 300000);

afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("fixture effort records", () => {
  test("a moved fixture copy lowers every named effort, while a fixture-named ticket repo keeps its config", () => {
    withTempDir((raw) => {
      const tmp = realpathSync(raw);
      const config = join(tmp, "machine.toml");
      const pins = join(tmp, "pins");
      const bin = join(tmp, "bin");
      mkdirSync(bin);
      for (const harness of ["codex", "claude", "muse", "mimo"]) {
        writeFileSync(join(bin, harness), "#!/bin/sh\necho stub-version\n");
        chmodSync(join(bin, harness), 0o755);
      }
      writeFileSync(
        config,
        '[lanes.codex_lane]\nharness = "codex"\nmodel = "c"\neffort = "max"\n' +
          '[lanes.claude_lane]\nharness = "claude"\nmodel = "c"\neffort = "max"\n' +
          '[lanes.muse_lane]\nharness = "muse"\nmodel = "m"\neffort = "high"\n' +
          '[lanes.mimo_lane]\nharness = "mimo"\nmodel = "p/m"\neffort = "high"\n' +
          '[lanes.no_effort]\nharness = "codex"\nmodel = "c"\n' +
          '[lanes.unknown]\nharness = "agy"\nmodel = "a"\neffort = "high"\n' +
          '[team]\nworkhorses = ["codex_lane"]\n' +
          'coachman = { harness = "claude", model = "c", effort = "max" }\n' +
          'coachman_fallback = { harness = "muse", model = "m", effort = "high" }\n' +
          'postmaster = { harness = "codex", model = "c", effort = "max" }\n' +
          '[team.coachman_legs]\nsynthesis = { harness = "mimo", model = "p/m", effort = "high" }\n' +
          'review = { harness = "codex", model = "c", effort = "max" }\n',
      );
      const before = readFileSync(config);
      const env = {
        ...process.env,
        POSTMASTER_CONFIG: config,
        POSTMASTER_TOOL_PINS: pins,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      };
      const original = join(tmp, "original");
      const created = run(join(import.meta.dir, "fixture.sh"), ["new", original, "remove"], {
        env,
      });
      expect(created.code).toBe(0);
      const moved = join(tmp, "neutral");
      renameSync(original, moved);
      expect(run("git", ["-C", moved, "show", "HEAD:.postmaster/fixture"]).out).toBe(
        "postmaster fixture v1\n",
      );
      const dispatch = join(moved, ".postmaster", "runs", "7");
      mkdirSync(dispatch, { recursive: true });
      const fixtureRecord = run(join(import.meta.dir, "run-meta.sh"), [dispatch, moved], { env });
      expect(fixtureRecord.code).toBe(0);
      expect(fixtureRecord.err).toContain("no lowest effort for unknown on agy; keeping high");
      const recorded = JSON.parse(readFileSync(join(dispatch, "run.json"), "utf8"));
      const cfg = recorded.config;
      expect(cfg.lanes.codex_lane.effort).toBe("low");
      expect(cfg.lanes.claude_lane.effort).toBe("low");
      expect(cfg.lanes.muse_lane.effort).toBe("minimal");
      expect(cfg.lanes.mimo_lane.effort).toBe("low");
      expect(cfg.lanes.no_effort.effort).toBeUndefined();
      expect(cfg.lanes.unknown.effort).toBe("high");
      expect(cfg.team.coachman.effort).toBe("low");
      expect(cfg.team.coachman_fallback.effort).toBe("minimal");
      expect(cfg.team.postmaster.effort).toBe("low");
      expect(cfg.team.coachman_legs.synthesis.effort).toBe("low");
      expect(cfg.team.coachman_legs.review.effort).toBe("low");
      expect(readFileSync(config).equals(before)).toBe(true);
      const line = run(join(import.meta.dir, "run-meta.sh"), ["efforts", dispatch], { env });
      expect(line.code).toBe(0);
      expect(line.out.trim()).toContain("codex_lane=low");
      expect(line.out.trim()).toContain("coachman.synthesis=low");
      expect(line.out.trim()).toContain("coachman.review=low");
      expect(line.out.trim()).not.toContain("postmaster=");
      expect(line.out.trim()).not.toContain("no_effort=");

      const ticketRepo = join(tmp, "fixture-in-name");
      mkdirSync(ticketRepo);
      expect(run("git", ["-C", ticketRepo, "init", "-q", "-b", "main"]).code).toBe(0);
      expect(
        run("git", [
          "-C",
          ticketRepo,
          "-c",
          "user.name=brindlewick",
          "-c",
          "user.email=332054101+brindlewick@users.noreply.github.com",
          "commit",
          "-q",
          "--allow-empty",
          "-m",
          "init",
        ]).code,
      ).toBe(0);
      const ticketDispatch = join(ticketRepo, ".postmaster", "runs", "8");
      mkdirSync(ticketDispatch, { recursive: true });
      const ticketRecord = run(join(import.meta.dir, "run-meta.sh"), [ticketDispatch, ticketRepo], {
        env,
      });
      expect(ticketRecord.code).toBe(0);
      const ticketCfg = JSON.parse(readFileSync(join(ticketDispatch, "run.json"), "utf8")).config;
      expect(ticketCfg.lanes.codex_lane.effort).toBe("max");
      expect(ticketCfg.lanes.mimo_lane.effort).toBe("high");
      expect(ticketCfg.team.coachman_legs.synthesis.effort).toBe("high");
      expect(ticketRecord.err).toBe("");
      expect(readFileSync(config).equals(before)).toBe(true);
      const ticketLine = run(join(import.meta.dir, "run-meta.sh"), ["efforts", ticketDispatch], {
        env,
      });
      expect(ticketLine.code).toBe(0);
      expect(ticketLine.out.trim()).toContain("codex_lane=max");
      expect(ticketLine.out.trim()).toContain("coachman.review=max");
    });
  }, 60000);
});

describe("positive controls", () => {
  test("run.json is written", () => {
    assertControl("run.json is written");
  });
  test("it names the postmaster commit", () => {
    assertControl("it names the postmaster commit");
  });
  test("it records the current coachman contract", () => {
    assertControl("it records the current coachman contract");
  });
  test("it names the target's HEAD and branch", () => {
    assertControl("it names the target's HEAD and branch");
  });
  test("it keeps the resolved config as it was", () => {
    assertControl("it keeps the resolved config as it was");
  });
  test("it names an old-layout run from its parent", () => {
    assertControl("it names an old-layout run from its parent");
  });
  test("it records project settings and their source", () => {
    assertControl("it records project settings and their source");
  });
  test("it records each harness's version", () => {
    assertControl("it records each harness's version");
  });
  test("a harness not installed says so", () => {
    assertControl("a harness not installed says so");
  });
  test("a harness stuck on --version records BASE's TimeoutExpired after 15 seconds", () => {
    assertControl("a harness stuck on --version records BASE's TimeoutExpired after 15 seconds");
  });
  test("an env file is named, never read", () => {
    assertControl("an env file is named, never read");
  });
  test("it names the pinned checkout", () => {
    assertControl("it names the pinned checkout");
  });
  test("path prints the pin", () => {
    assertControl("path prints the pin");
  });
  test("check passes a pin that serves its commit", () => {
    assertControl("check passes a pin that serves its commit");
  });
  test("a second run at the same commit shares the pin", () => {
    assertControl("a second run at the same commit shares the pin");
  });
  test("after main moved on, the pin still reads A while main reads B (marker_of)", () => {
    assertControl("after main moved on, the pin still reads A while main reads B (marker_of)");
  });
  test("and the script reads A on the pin while main reads B", () => {
    assertControl("and the script reads A on the pin while main reads B");
  });
  test("and the script runs A from the pin while main runs B (script_of)", () => {
    assertControl("and the script runs A from the pin while main runs B (script_of)");
  });
  test("check passes the run pinned at A", () => {
    assertControl("check passes the run pinned at A");
  });
  test("check fails the run pointed at main after it moved on (identical command)", () => {
    assertControl("check fails the run pointed at main after it moved on (identical command)");
  });
  test("check fails a pin that no longer serves its commit", () => {
    assertControl("check fails a pin that no longer serves its commit");
  });
});

describe("negative controls", () => {
  test("a second call leaves run.json alone", () => {
    assertControl("a second call leaves run.json alone");
  });
  test("no config is refused, and nothing is written", () => {
    assertControl("no config is refused, and nothing is written");
  });
  test("a target that is not a repo is refused", () => {
    assertControl("a target that is not a repo is refused");
  });
  test("path on a run with no run.json is refused", () => {
    assertControl("path on a run with no run.json is refused");
  });
  test("a commit the repo does not have is refused, and no pin is cut", () => {
    assertControl("a commit the repo does not have is refused, and no pin is cut");
  });
  test("release keeps the pin while another run in flight still uses it", () => {
    assertControl("release keeps the pin while another run in flight still uses it");
  });
  test("release keeps the pin while its own run is still in flight", () => {
    assertControl("release keeps the pin while its own run is still in flight");
  });
  test("release removes the pin once no run in flight uses it", () => {
    assertControl("release removes the pin once no run in flight uses it");
  });
  test("release again is a no-op", () => {
    assertControl("release again is a no-op");
  });
  test("release of a run with no pinned checkout is a no-op", () => {
    assertControl("release of a run with no pinned checkout is a no-op");
  });
  test("release refuses a run whose own checkout is not a string", () => {
    assertControl("release refuses a run whose own checkout is not a string");
  });
  test("release keeps the pin for a sibling whose run.json does not parse", () => {
    assertControl("release keeps the pin for a sibling whose run.json does not parse");
  });
  test("release keeps the pin for a sibling whose postmaster is not an object", () => {
    assertControl("release keeps the pin for a sibling whose postmaster is not an object");
  });
  test("release keeps the pin for a sibling whose checkout is not a string", () => {
    assertControl("release keeps the pin for a sibling whose checkout is not a string");
  });
  test("release keeps the pin for a sibling with no postmaster record", () => {
    assertControl("release keeps the pin for a sibling with no postmaster record");
  });
  test("release removes past a sibling that records no checkout", () => {
    assertControl("release removes past a sibling that records no checkout");
  });
  test("release keeps the pin for an in-flight run under a dot-prefixed project", () => {
    assertControl("release keeps the pin for an in-flight run under a dot-prefixed project");
  });
  test("release removes once the hidden run is done", () => {
    assertControl("release removes once the hidden run is done");
  });
  test("release keeps the pin when a project directory cannot be listed", () => {
    assertControl("release keeps the pin when a project directory cannot be listed");
  });
  test("release keeps the pin when a run directory cannot be listed", () => {
    assertControl("release keeps the pin when a run directory cannot be listed");
  });
  test("release still keeps the pin for the readable in-flight run", () => {
    assertControl("release still keeps the pin for the readable in-flight run");
  });
  test("release removes once the unreadable run is done", () => {
    assertControl("release removes once the unreadable run is done");
  });
  test("release keeps the pin past star-named directories, crying nothing unreadable", () => {
    assertControl("release keeps the pin past star-named directories, crying nothing unreadable");
  });
  test("release removes once the star-named runs are done", () => {
    assertControl("release removes once the star-named runs are done");
  });
  test("release keeps the pin under a BASH_ENV that ignores the live project", () => {
    assertControl("release keeps the pin under a BASH_ENV that ignores the live project");
  });
  test("release keeps the pin under every hostile vector at once", () => {
    assertControl("release keeps the pin under every hostile vector at once");
  });
  test("release removes under every hostile vector at once when nothing is live", () => {
    assertControl("release removes under every hostile vector at once when nothing is live");
  });
  test("release keeps the pin when the pin scan is killed", () => {
    assertControl("release keeps the pin when the pin scan is killed");
  });
  test("release keeps the pin for a sibling whose record claims an unexpected shape", () => {
    assertControl("release keeps the pin for a sibling whose record claims an unexpected shape");
  });
  test("release keeps the pin for a live run whose run.json is missing", () => {
    assertControl("release keeps the pin for a live run whose run.json is missing");
  });
  test("release keeps the pin for a live run whose run.json is a directory", () => {
    assertControl("release keeps the pin for a live run whose run.json is a directory");
  });
  test("release keeps the pin for a live run whose run.json is a broken link", () => {
    assertControl("release keeps the pin for a live run whose run.json is a broken link");
  });
  test("release removes once the recordless runs are done", () => {
    assertControl("release removes once the recordless runs are done");
  });
  test("the hostile HOME demonstrably forges done", () => {
    assertControl("the hostile HOME demonstrably forges done");
  });
  test("release keeps the pin under a hostile HOME forging done", () => {
    assertControl("release keeps the pin under a hostile HOME forging done");
  });
  test("release removes under a hostile HOME once nothing is live", () => {
    assertControl("release removes under a hostile HOME once nothing is live");
  });
  test("release removes once the GLOBIGNORE run is done", () => {
    assertControl("release removes once the GLOBIGNORE run is done");
  });
  test("check still passes the run that shares the live tool pin", () => {
    assertControl("check still passes the run that shares the live tool pin");
  });
  test("two concurrent cuts of one commit end with one shared pin", () => {
    assertControl("two concurrent cuts of one commit end with one shared pin");
  });
  test("a pin of the same commit from another clone reuses the checkout", () => {
    assertControl("a pin of the same commit from another clone reuses the checkout");
  });
  test("a pin that is not clean is refused on reuse", () => {
    assertControl("a pin that is not clean is refused on reuse");
  });
  test("a cleaned pin is shared again", () => {
    assertControl("a cleaned pin is shared again");
  });
  test("a pin holding another commit is refused", () => {
    assertControl("a pin holding another commit is refused");
  });
  test("a pin path that is not a checkout is refused", () => {
    assertControl("a pin path that is not a checkout is refused");
  });
  test("path falls back to an old waybill's tool path", () => {
    assertControl("path falls back to an old waybill's tool path");
  });
  test("check passes an old waybill on a git checkout", () => {
    assertControl("check passes an old waybill on a git checkout");
  });
  test("check fails an old waybill whose tool is gone", () => {
    assertControl("check fails an old waybill whose tool is gone");
  });
  test("path refuses a waybill with two tool lines", () => {
    assertControl("path refuses a waybill with two tool lines");
  });
  test("path ignores a tool: line in the ticket body", () => {
    assertControl("path ignores a tool: line in the ticket body");
  });
  test("path refuses a Dispatch section with two tool lines", () => {
    assertControl("path refuses a Dispatch section with two tool lines");
  });
  test("path refuses a run with no postmaster record", () => {
    assertControl("path refuses a run with no postmaster record");
  });
  test("path refuses a run whose checkout is not a string", () => {
    assertControl("path refuses a run whose checkout is not a string");
  });
  test("check refuses a run whose checkout is not a string", () => {
    assertControl("check refuses a run whose checkout is not a string");
  });
  test("check fails a pin at the wrong commit", () => {
    assertControl("check fails a pin at the wrong commit");
  });
  test("check fails a wrong-commit pin when the record has no postmaster", () => {
    assertControl("check fails a wrong-commit pin when the record has no postmaster");
  });
  test("check fails a wrong-commit pin when the checkout is not a string", () => {
    assertControl("check fails a wrong-commit pin when the checkout is not a string");
  });
  test("path prints the canonical checkout", () => {
    assertControl("path prints the canonical checkout");
  });
  test("release keeps the pin for an in-flight run recorded through a symlink", () => {
    assertControl("release keeps the pin for an in-flight run recorded through a symlink");
  });
  test("ten concurrent-release races all exit 0 and remove the pin", () => {
    assertControl("ten concurrent-release races all exit 0 and remove the pin");
  });
  test("a dispatch racing a release records a pin that checks out", () => {
    assertControl("a dispatch racing a release records a pin that checks out");
  });
  test("two dispatches of one run write run.json once", () => {
    assertControl("two dispatches of one run write run.json once");
  });
  test("release force-removes an unreferenced pin that is not clean", () => {
    assertControl("release force-removes an unreferenced pin that is not clean");
  });
  test("release leaves a locked pin alone", () => {
    assertControl("release leaves a locked pin alone");
  });
  test("release removes the pin once unlocked", () => {
    assertControl("release removes the pin once unlocked");
  });
  test("an older runs/<project>/<TICKET> layout is still read as that project", () => {
    assertControl("an older runs/<project>/<TICKET> layout is still read as that project");
  });
});

describe("claims across projects and layouts", () => {
  test("dispatch records its claim on the pin", () => {
    assertControl("dispatch records its claim on the pin");
  });
  test("two projects dispatch on one pin", () => {
    assertControl("two projects dispatch on one pin");
  });
  test("a new-layout run is named from its project root", () => {
    assertControl("a new-layout run is named from its project root");
  });
  test("it records project settings and their source", () => {
    assertControl("it records project settings and their source");
  });
  test("both runs claim the shared pin", () => {
    assertControl("both runs claim the shared pin");
  });
  test("release keeps the pin while another project's run is in flight", () => {
    assertControl("release keeps the pin while another project's run is in flight");
  });
  test("release keeps the pin while its own run is still in flight", () => {
    assertControl("release keeps the pin while its own run is still in flight");
  });
  test("release removes the pin and its claims once no run names it", () => {
    assertControl("release removes the pin and its claims once no run names it");
  });
  test("release keeps the pin on an unreadable claim", () => {
    assertControl("release keeps the pin on an unreadable claim");
  });
  test("release removes the pin once the claim reads done", () => {
    assertControl("release removes the pin once the claim reads done");
  });
  test("a failed dispatch drops the claim it just made", () => {
    assertControl("a failed dispatch drops the claim it just made");
  });
});

describe("pin lock beside the bash flow", () => {
  test("an empty .pin.lock left by the bash flow does not block a pin", () => {
    withTempDir((raw: string) => {
      const tmp = realpathSync(raw);
      const tools = join(tmp, "tools");
      mkdirSync(tools, { recursive: true });
      // The bash flow's resting state: flock(2) on the fd, never removed,
      // truncated to empty on every open. Old, as the real one always is;
      // it must read as unlocked.
      writeFileSync(join(tools, ".pin.lock"), "");
      const past = new Date(Date.now() - 60000);
      utimesSync(join(tools, ".pin.lock"), past, past);
      const repo = join(tmp, "repo");
      mkdirSync(repo, { recursive: true });
      run("git", ["-C", repo, "init", "-q", "-b", "main"]);
      run("git", [
        "-C",
        repo,
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "commit",
        "-q",
        "--allow-empty",
        "-m",
        "first",
      ]);
      const commit = run("git", ["-C", repo, "rev-parse", "HEAD"]).out.trim();
      const t0 = Date.now();
      const r = pin(repo, commit, tools);
      expect(Date.now() - t0).toBeLessThan(30000);
      expect(r.code).toBe(0);
    });
  }, 180000);
  test("an empty .pin.lock still flocked by the bash flow is waited on, not stolen", () => {
    withTempDir((raw: string) => {
      const tmp = realpathSync(raw);
      const tools = join(tmp, "tools");
      mkdirSync(tools, { recursive: true });
      // The bash flow mid-critical-section: the lock empty, old, and flocked
      // by a live holder. The pin must wait for the holder, not steal past it.
      const lock = join(tools, ".pin.lock");
      writeFileSync(lock, "");
      const past = new Date(Date.now() - 60000);
      utimesSync(lock, past, past);
      const holder: any = Bun.spawn(["flock", "-x", lock, "sleep", "8"], {
        stdout: "ignore",
        stderr: "ignore",
      });
      try {
        const repo = join(tmp, "repo");
        mkdirSync(repo, { recursive: true });
        run("git", ["-C", repo, "init", "-q", "-b", "main"]);
        run("git", [
          "-C",
          repo,
          "-c",
          "user.name=t",
          "-c",
          "user.email=t@t",
          "commit",
          "-q",
          "--allow-empty",
          "-m",
          "first",
        ]);
        const commit = run("git", ["-C", repo, "rev-parse", "HEAD"]).out.trim();
        const t0 = Date.now();
        const r = pin(repo, commit, tools);
        expect(Date.now() - t0).toBeGreaterThanOrEqual(6000);
        expect(r.code).toBe(0);
      } finally {
        holder.kill();
      }
    });
  }, 180000);
});
