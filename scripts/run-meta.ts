// Write a run's fixed facts to <dispatch>/run.json, once, at dispatch. Written once and never
// edited: the manifest is the run's current state, this is what the run started from.
//
//   run-meta.sh <dispatch> <repo>   <repo> is the target project's checkout
//   run-meta.sh --self-test
//
// Records when it was written; the run and project; the target repo's HEAD and branch; the
// postmaster commit that dispatched it, and whether that checkout had uncommitted changes,
// since a run keeps the runbooks it started with; the config in force, as it was; and the
// version each harness named in that config reports. Env files are named by the config, never
// read. A run.json that already exists is left alone.
//
//   exit 0  written, or already there
//   exit 1  usage, no such dispatch directory or repo, no config, or the file could not be written
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { tryTomlFile } from "./lib/data.ts";
import { toolRoot } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { SelfTest } from "./lib/selftest.ts";

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function git(where: string, ...args: string[]): string | null {
  const r = run("git", ["-C", where, ...args]);
  return r.code === 0 ? r.out.trim() : null;
}

function version(harness: string): string {
  if (Bun.which(harness) === null) return "not on PATH";
  try {
    const r = spawnSync(harness, ["--version"], { encoding: "utf8", timeout: 15000 });
    const out = (r.stdout || r.stderr || "").trim().split("\n");
    return out.length > 0 && out[0] !== "" ? (out[0] as string) : "no version output";
  } catch (e) {
    const name = e instanceof Error ? e.constructor.name : "Error";
    return `no version: ${name}`;
  }
}

function meta(d: string, repo: string): number {
  const TOOL = toolRoot(import.meta);
  const CONFIG = process.env.POSTMASTER_CONFIG ?? join(homedir(), ".postmaster/config.toml");

  if (!isDir(d)) {
    console.error(`run-meta: no such dispatch directory: ${d}`);
    return 1;
  }
  if (git(repo, "rev-parse", "--git-dir") === null) {
    console.error(`run-meta: not a git repo: ${repo}`);
    return 1;
  }
  if (!existsSync(CONFIG)) {
    console.error(`run-meta: no config at ${CONFIG}`);
    return 1;
  }
  if (existsSync(join(d, "run.json"))) {
    console.error(`run-meta: ${d}/run.json already written; left alone`);
    return 0;
  }

  const cfg = tryTomlFile(CONFIG);
  if (cfg === null) {
    console.error(`run-meta: could not write ${d}/run.json`);
    return 1;
  }

  const harnesses = new Set<string>();
  const lanes = (cfg.lanes ?? {}) as Record<string, Record<string, unknown>>;
  for (const lane of Object.values(lanes)) {
    if (lane && typeof lane === "object" && lane.harness) harnesses.add(String(lane.harness));
  }
  const team = (cfg.team ?? {}) as Record<string, unknown>;
  for (const role of ["coachman", "coachman_fallback", "postmaster"]) {
    const v = team[role];
    if (v && typeof v === "object" && (v as Record<string, unknown>).harness) {
      harnesses.add(String((v as Record<string, unknown>).harness));
    }
  }
  const legs = (team.coachman_legs ?? {}) as Record<string, Record<string, unknown>>;
  for (const leg of Object.values(legs)) {
    if (leg && typeof leg === "object" && leg.harness) harnesses.add(String(leg.harness));
  }

  const record = {
    written: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    project: basename(dirname(resolve(d))),
    run: basename(resolve(d)),
    target: {
      head: git(repo, "rev-parse", "HEAD"),
      branch: git(repo, "symbolic-ref", "--short", "-q", "HEAD"),
    },
    postmaster: {
      commit: git(TOOL, "rev-parse", "HEAD"),
      uncommitted_changes: (git(TOOL, "status", "--porcelain") ?? "") !== "",
    },
    config: cfg,
    harness_versions: Object.fromEntries([...harnesses].sort().map((h) => [h, version(h)])),
  };

  const tmp = join(d, `.run.json.tmp.${process.pid}`);
  try {
    writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`);
    renameSync(tmp, join(d, "run.json"));
  } catch {
    try {
      rmSync(tmp);
    } catch {
      /* ignore */
    }
    console.error(`run-meta: could not write ${d}/run.json`);
    return 1;
  }
  console.log(
    `run-meta: wrote ${join(d, "run.json")} (postmaster ${(record.postmaster.commit ?? "?").slice(0, 12)})`,
  );
  return 0;
}

// --- entry ------------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv[0] !== "--self-test") {
  if (argv.length !== 2) {
    console.error("usage: run-meta.sh <dispatch> <repo> | --self-test");
    process.exit(1);
  }
  process.exit(meta(argv[0] as string, argv[1] as string));
}

// --- self-test ----------------------------------------------------------------------------
const TOOL = toolRoot(import.meta);
withTempDir((tmp) => {
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
    `[lanes.one]
harness = "bash"
model = "m1"
env_file = "~/somewhere/secret.env"
[lanes.two]
harness = "no-such-harness-xyz"
model = "m2"
[team]
workhorses = ["one", "two"]
coachman = { harness = "bash", model = "judge" }
`,
  );
  process.env.POSTMASTER_CONFIG = configPath;

  const st = new SelfTest();
  const runJson = (): Record<string, any> => JSON.parse(readFileSync(join(d, "run.json"), "utf8"));
  const check = (label: string, fn: (r: Record<string, any>) => boolean): void => {
    try {
      if (fn(runJson())) st.ok(label);
      else st.fail(label);
    } catch {
      st.fail(label);
    }
  };

  console.log("positive controls");
  if (meta(d, repo) === 0) st.ok("run.json is written");
  else st.fail("run.json is written");

  check(
    "it names the postmaster commit",
    (r) => r.postmaster.commit === git(TOOL, "rev-parse", "HEAD"),
  );
  check(
    "it names the target's HEAD and branch",
    (r) => r.target.head === git(repo, "rev-parse", "HEAD") && r.target.branch === "main",
  );
  check(
    "it keeps the config as it was",
    (r) =>
      r.config.lanes.one.model === "m1" &&
      JSON.stringify(r.config.team.workhorses) === '["one","two"]',
  );
  check("it records each harness's version", (r) =>
    String(r.harness_versions.bash).startsWith("GNU bash"),
  );
  check(
    "a harness not installed says so",
    (r) => r.harness_versions["no-such-harness-xyz"] === "not on PATH",
  );
  check(
    "an env file is named, never read",
    (r) => r.config.lanes.one.env_file === "~/somewhere/secret.env",
  );

  console.log("negative controls");
  const before = readFileSync(join(d, "run.json"), "utf8");
  meta(d, repo);
  st.check(
    "a second call leaves run.json alone",
    readFileSync(join(d, "run.json"), "utf8") === before,
  );

  rmSync(join(d, "run.json"));
  process.env.POSTMASTER_CONFIG = join(tmp, "none.toml");
  const rc = meta(d, repo);
  process.env.POSTMASTER_CONFIG = configPath;
  st.check(
    "no config is refused, and nothing is written",
    rc === 1 && !existsSync(join(d, "run.json")),
  );

  const rc2 = meta(d, join(tmp, "not-a-repo"));
  st.check("a target that is not a repo is refused", rc2 === 1);

  st.finish();
});
