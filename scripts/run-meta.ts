import { accessSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { atomicWrite, command, scriptDir, writeError, writeOut } from "./lib/core.ts";

function configPath(): string {
  return process.env.POSTMASTER_CONFIG ?? join(homedir(), ".postmaster", "config.toml");
}
function git(where: string, ...args: string[]): string | null {
  const result = command("git", ["-C", where, ...args]);
  return result.code === 0 ? result.stdout.trim() : null;
}
function onPath(program: string): boolean {
  for (const directory of (process.env.PATH ?? "").split(":")) {
    try {
      accessSync(join(directory, program));
      return true;
    } catch {
      /* Continue along PATH. */
    }
  }
  return false;
}
function version(harness: string): string {
  if (!onPath(harness)) return "not on PATH";
  const result = command(harness, ["--version"], { timeout: 15000 });
  const first = (result.stdout || result.stderr).trim().split(/\r?\n/)[0];
  return first || (result.code === 127 ? "no version: OSError" : "no version output");
}
function meta(directory: string, repo: string, quiet = false): number {
  if (!existsSync(directory) || !statDirectory(directory)) {
    if (!quiet) writeError(`run-meta: no such dispatch directory: ${directory}`);
    return 1;
  }
  if (!git(repo, "rev-parse", "--git-dir")) {
    if (!quiet) writeError(`run-meta: not a git repo: ${repo}`);
    return 1;
  }
  const config = configPath();
  if (!existsSync(config)) {
    if (!quiet) writeError(`run-meta: no config at ${config}`);
    return 1;
  }
  const output = join(directory, "run.json");
  if (existsSync(output)) {
    if (!quiet) writeOut(`run-meta: ${output} already written; left alone`);
    return 0;
  }
  try {
    const cfg = Bun.TOML.parse(readFileSync(config, "utf8")) as any;
    const harnesses = new Set<string>();
    for (const lane of Object.values(cfg.lanes ?? {}) as any[]) if (lane?.harness) harnesses.add(lane.harness);
    const team = cfg.team ?? {};
    for (const role of ["coachman", "coachman_fallback", "postmaster"])
      if (team[role]?.harness) harnesses.add(team[role].harness);
    for (const leg of Object.values(team.coachman_legs ?? {}) as any[]) if (leg?.harness) harnesses.add(leg.harness);
    const record = {
      written: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      project: basename(resolve(directory, "..")),
      run: basename(resolve(directory)),
      target: { head: git(repo, "rev-parse", "HEAD"), branch: git(repo, "symbolic-ref", "--short", "-q", "HEAD") },
      postmaster: {
        commit: git(dirname(scriptDir(import.meta.url)), "rev-parse", "HEAD"),
        uncommitted_changes: Boolean(git(dirname(scriptDir(import.meta.url)), "status", "--porcelain")),
      },
      config: cfg,
      harness_versions: Object.fromEntries([...harnesses].sort().map((name) => [name, version(name)])),
    };
    atomicWrite(output, `${JSON.stringify(record, null, 2)}\n`);
    if (!quiet) writeOut(`run-meta: wrote ${output} (postmaster ${(record.postmaster.commit ?? "?").slice(0, 12)})`);
    return 0;
  } catch {
    if (!quiet) writeError(`run-meta: could not write ${output}`);
    return 1;
  }
}
function statDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function selfTest(): number {
  const temp = mkdtempSync(join(tmpdir(), "run-meta-"));
  const directory = join(temp, "project", "RUN-1");
  const repo = join(temp, "target");
  mkdirSync(directory, { recursive: true });
  mkdirSync(repo);
  command("git", ["init", "-q", "-b", "main", repo]);
  command("git", [
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
  const config = join(temp, "config.toml");
  writeFileSync(
    config,
    `[lanes.one]\nharness = "bash"\nmodel = "m1"\nenv_file = "~/somewhere/secret.env"\n[lanes.two]\nharness = "no-such-harness-xyz"\nmodel = "m2"\n[team]\nworkhorses = ["one", "two"]\ncoachman = { harness = "bash", model = "judge" }\n`,
  );
  const previous = process.env.POSTMASTER_CONFIG;
  process.env.POSTMASTER_CONFIG = config;
  let fails = 0;
  const ok = (label: string) => writeOut(`  ok   ${label}`);
  const fail = (label: string) => {
    writeOut(`  FAIL ${label}`);
    fails++;
  };
  const check = (label: string, predicate: (record: any) => boolean) => {
    try {
      predicate(JSON.parse(readFileSync(join(directory, "run.json"), "utf8"))) ? ok(label) : fail(label);
    } catch {
      fail(label);
    }
  };
  try {
    writeOut("positive controls");
    meta(directory, repo, true) === 0 ? ok("run.json is written") : fail("run.json is written");
    check(
      "it names the postmaster commit",
      (r) => r.postmaster.commit === git(dirname(scriptDir(import.meta.url)), "rev-parse", "HEAD"),
    );
    check(
      "it names the target's HEAD and branch",
      (r) => r.target.head === git(repo, "rev-parse", "HEAD") && r.target.branch === "main",
    );
    check(
      "it keeps the config as it was",
      (r) => r.config.lanes.one.model === "m1" && JSON.stringify(r.config.team.workhorses) === '["one","two"]',
    );
    check("it records each harness's version", (r) => r.harness_versions.bash.startsWith("GNU bash"));
    check("a harness not installed says so", (r) => r.harness_versions["no-such-harness-xyz"] === "not on PATH");
    check("an env file is named, never read", (r) => r.config.lanes.one.env_file === "~/somewhere/secret.env");
    writeOut("negative controls");
    const before = readFileSync(join(directory, "run.json"), "utf8");
    meta(directory, repo, true);
    readFileSync(join(directory, "run.json"), "utf8") === before
      ? ok("a second call leaves run.json alone")
      : fail("a second call leaves run.json alone");
    rmSync(join(directory, "run.json"));
    process.env.POSTMASTER_CONFIG = join(temp, "none.toml");
    meta(directory, repo, true) === 1 && !existsSync(join(directory, "run.json"))
      ? ok("no config is refused, and nothing is written")
      : fail("no config is refused, and nothing is written");
    process.env.POSTMASTER_CONFIG = config;
    meta(directory, join(temp, "not-a-repo"), true) === 1
      ? ok("a target that is not a repo is refused")
      : fail("a target that is not a repo is refused");
  } finally {
    if (previous === undefined) delete process.env.POSTMASTER_CONFIG;
    else process.env.POSTMASTER_CONFIG = previous;
    rmSync(temp, { recursive: true, force: true });
  }
  writeOut("");
  writeOut(fails === 0 ? "self-test: all controls behaved" : `self-test: ${fails} control(s) misbehaved`);
  return fails === 0 ? 0 : 1;
}

const args = process.argv.slice(2);
if (args[0] === "--self-test") process.exit(selfTest());
if (args.length !== 2) {
  writeError("usage: run-meta.sh <dispatch> <repo> | --self-test");
  process.exit(1);
}
process.exit(meta(args[0], args[1]));
