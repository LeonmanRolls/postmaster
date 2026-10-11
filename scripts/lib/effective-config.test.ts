// Acceptance tests for #335: a project's own settings override the global config,
// setting by setting, through the shared loader beside this file. Black-box: every
// case spawns scripts/run as a subprocess and asserts on what it prints and writes;
// nothing here imports the change. Each case builds its own scratch git repository
// and scratch global config: config.example.toml with team.postmaster set to
// { harness = "claude", model = "opus-x" }.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const CLI = join(import.meta.dir, "..", "run");

type Rec = Record<string, unknown>;

interface Run {
  code: number;
  out: string;
  err: string;
}

function runCli(args: string[], env: Record<string, string | undefined>, input?: string): Run {
  const merged: Record<string, string | undefined> = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  const r = spawnSync(CLI, args, {
    encoding: "utf8",
    timeout: 60000,
    env: merged,
    input: input ?? undefined,
  });
  return { code: r.status ?? 1, out: String(r.stdout ?? ""), err: String(r.stderr ?? "") };
}

function git(repo: string, args: string[]): void {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", timeout: 30000 });
  if ((r.status ?? 1) !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

let tmp = "";
let example = "";
let stubBin = "";
let stubHome = "";
let n = 0;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "project-overrides-"));
  example = readFileSync(join(import.meta.dir, "..", "..", "config.example.toml"), "utf8").replace(
    /^postmaster = .*/mu,
    'postmaster = { harness = "claude", model = "opus-x" }',
  );
  stubBin = join(tmp, "bin");
  mkdirSync(stubBin, { recursive: true });
  for (const h of ["codex", "grok", "agy", "claude", "muse", "mimo", "pi"]) {
    const p = join(stubBin, h);
    writeFileSync(p, "");
    chmodSync(p, 0o755);
  }
  stubHome = join(tmp, "home");
  mkdirSync(join(stubHome, ".postmaster", "lanes"), { recursive: true });
  writeFileSync(join(stubHome, ".postmaster", "lanes", "deepseek.env"), "DUMMY=1\n");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function scratch(): { repo: string; config: string } {
  n += 1;
  const repo = join(tmp, `repo-${n}`);
  mkdirSync(join(repo, ".postmaster"), { recursive: true });
  const r = spawnSync("git", ["init", "-q", repo], { encoding: "utf8", timeout: 30000 });
  if ((r.status ?? 1) !== 0) throw new Error(`git init failed: ${r.stderr}`);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "test"]);
  const config = join(tmp, `config-${n}.toml`);
  writeFileSync(config, example);
  return { repo, config };
}

function envFor(config: string, extra?: Record<string, string>): Record<string, string> {
  return {
    POSTMASTER_CONFIG: config,
    HOME: stubHome,
    PATH: `${stubBin}:${process.env.PATH ?? ""}`,
    ...extra,
  };
}

function writeSettings(repo: string, text: string): string {
  const p = join(repo, ".postmaster", "settings.toml");
  writeFileSync(p, text);
  return p;
}

function commitSettings(repo: string): void {
  git(repo, ["add", "-f", ".postmaster/settings.toml"]);
  git(repo, ["commit", "-qm", "settings"]);
}

function commitFile(repo: string, rel: string): void {
  git(repo, ["add", "-f", rel]);
  git(repo, ["commit", "-qm", rel]);
}

/** Shell quoting off: the launch form quotes args with spaces or quotes in them. */
const bare = (s: string): string => s.replace(/["'\\]/gu, "");

/** Leaf paths where a and b differ; tables recurse, lists and values compare whole. */
function diffPaths(a: unknown, b: unknown, path: string[] = []): string[][] {
  const bothRec = (x: unknown): x is Rec =>
    typeof x === "object" && x !== null && !Array.isArray(x);
  if (bothRec(a) && bothRec(b)) {
    const out: string[][] = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!Object.hasOwn(a, k) || !Object.hasOwn(b, k)) {
        out.push([...path, k]);
        continue;
      }
      out.push(...diffPaths(a[k], b[k], [...path, k]));
    }
    return out;
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [path];
}

function c2Settings(): string {
  return [
    "[team]",
    'reviewers = ["mimo"]',
    "[team.postmaster]",
    'harness = "codex"',
    'model = "gpt-p"',
    "[team.clerk]",
    'harness = "claude"',
    'model = "clerk-p"',
    'effort = "high"',
    "[tracker]",
    'kind = "plane"',
    "[postmaster]",
    "poll_seconds = 30",
    "[limits]",
    'memory_max = "64M"',
    "[lanes.luna]",
    'model = "gpt-other"',
    "",
  ].join("\n");
}

describe("C1: project settings override one setting at a time", () => {
  test("a lane model set in the project changes that model in the launch form", () => {
    const { repo, config } = scratch();
    writeSettings(repo, '[lanes.luna]\nmodel = "gpt-other"\n');
    const r = runCli(["launch", "form", "luna", "--project", repo], envFor(config));
    expect(r.code).toBe(0);
    expect(r.out).toContain("gpt-other");
    expect(r.out).not.toContain("gpt-5.6-luna");
    expect(bare(r.out)).toContain("model_reasoning_effort=max");
  }, 30000);

  test("other lanes keep the global model", () => {
    const { repo, config } = scratch();
    writeSettings(repo, '[lanes.luna]\nmodel = "gpt-other"\n');
    const r = runCli(["launch", "form", "deepseek", "--project", repo], envFor(config));
    expect(r.code).toBe(0);
    expect(r.out).toContain("deepseek-v4.1-flash");
  }, 30000);

  test("the effective config differs from the global one in that value alone", () => {
    const { repo, config } = scratch();
    writeSettings(repo, '[lanes.luna]\nmodel = "gpt-other"\n');
    const r = runCli(["project-settings", "effective", repo], envFor(config));
    expect(r.code).toBe(0);
    expect(r.err).toBe("");
    const effective = JSON.parse(r.out) as unknown;
    const global = Bun.TOML.parse(readFileSync(config, "utf8")) as unknown;
    expect(diffPaths(global, effective)).toEqual([["lanes", "luna", "model"]]);
  }, 30000);

  test("a project workhorses list replaces the global one whole", () => {
    const { repo, config } = scratch();
    writeSettings(repo, '[team]\nworkhorses = ["mimo"]\n');
    const r = runCli(["project-settings", "effective", repo], envFor(config));
    expect(r.code).toBe(0);
    expect(((JSON.parse(r.out) as Rec).team as Rec).workhorses).toEqual(["mimo"]);
  }, 30000);

  test("a project env_file makes the launch form look for that file", () => {
    const { repo, config } = scratch();
    const missing = join(tmp, `missing-${n}.env`);
    writeSettings(repo, `[lanes.luna]\nenv_file = "${missing}"\n`);
    const bad = runCli(["launch", "form", "luna", "--project", repo], envFor(config));
    expect(bad.code).toBe(1);
    expect(bad.err).toContain(`env_file for luna not found or not readable: ${missing}`);
    writeFileSync(missing, "DUMMY=1\n");
    const good = runCli(["launch", "form", "luna", "--project", repo], envFor(config));
    expect(good.code).toBe(0);
  }, 30000);

  test("without the settings file every value is the global one", () => {
    const { repo, config } = scratch();
    const r = runCli(["project-settings", "effective", repo], envFor(config));
    expect(r.code).toBe(0);
    const effective = JSON.parse(r.out) as unknown;
    const global = Bun.TOML.parse(readFileSync(config, "utf8")) as unknown;
    expect(diffPaths(global, effective)).toEqual([]);
    const form = runCli(["launch", "form", "luna", "--project", repo], envFor(config));
    expect(form.code).toBe(0);
    expect(form.out).toContain("gpt-5.6-luna");
  }, 30000);

  test("a project group merges setting by setting", () => {
    const { repo, config } = scratch();
    writeSettings(repo, '[team.postmaster]\nmodel = "gpt-p2"\n');
    const r = runCli(["project-settings", "effective", repo], envFor(config));
    expect(r.code).toBe(0);
    expect(((JSON.parse(r.out) as Rec).team as Rec).postmaster).toEqual({
      harness: "claude",
      model: "gpt-p2",
    });
  }, 30000);

  test("legacy roles keep working, and explicit team entries win", () => {
    const first = scratch();
    writeSettings(first.repo, '[roles]\nworkhorses = ["luna", "mimo"]\n');
    const legacy = runCli(["project-settings", "effective", first.repo], envFor(first.config));
    expect(legacy.code).toBe(0);
    expect(((JSON.parse(legacy.out) as Rec).team as Rec).workhorses).toEqual(["luna", "mimo"]);
    const second = scratch();
    writeSettings(second.repo, '[roles]\nworkhorses = ["luna"]\n[team]\nworkhorses = ["mimo"]\n');
    const both = runCli(["project-settings", "effective", second.repo], envFor(second.config));
    expect(both.code).toBe(0);
    expect(((JSON.parse(both.out) as Rec).team as Rec).workhorses).toEqual(["mimo"]);
  }, 30000);
});

describe("C2: every step reads the project settings over the global config", () => {
  test("front-door chooses the project postmaster", () => {
    const { repo, config } = scratch();
    writeSettings(repo, c2Settings());
    const r = runCli(["front-door", "codex", "gpt-p", repo, "yes", repo], envFor(config));
    expect(r.code).toBe(0);
    expect(r.out.startsWith("self")).toBe(true);
  }, 30000);

  test("tracker-kind prints the project kind", () => {
    const { repo, config } = scratch();
    writeSettings(repo, c2Settings());
    const r = runCli(["tracker-kind", repo], envFor(config));
    expect(r.code).toBe(0);
    expect(r.out).toBe("plane\n");
  }, 30000);

  test("the clerk launch shows the project clerk", () => {
    const { repo, config } = scratch();
    writeSettings(repo, c2Settings());
    const r = runCli(
      ["launch", "interactive", "clerk", "--project", repo, "--name", "T, x"],
      envFor(config),
    );
    expect(r.code).toBe(0);
    expect(r.out).toContain("clerk-p");
  }, 30000);

  test("run-meta records the project config", () => {
    const { repo, config } = scratch();
    writeSettings(repo, c2Settings());
    writeFileSync(join(repo, "README.md"), "scratch\n");
    commitFile(repo, "README.md");
    const dispatch = join(repo, ".postmaster", "runs", "T-1");
    mkdirSync(dispatch, { recursive: true });
    const r = runCli(["run-meta", dispatch, repo], envFor(config));
    expect(r.code).toBe(0);
    const recorded = JSON.parse(readFileSync(join(dispatch, "run.json"), "utf8")) as Rec;
    const cfg = recorded.config as Rec;
    expect((cfg.team as Rec).postmaster).toEqual({ harness: "codex", model: "gpt-p" });
    expect((cfg.tracker as Rec).kind).toBe("plane");
    expect((cfg.postmaster as Rec).poll_seconds).toBe(30);
    expect((cfg.limits as Rec).memory_max).toBe("64M");
    expect(((cfg.lanes as Rec).luna as Rec).model).toBe("gpt-other");
  }, 60000);

  test("the watcher reads the project poll interval", () => {
    const { repo, config } = scratch();
    const settings = writeSettings(repo, '[postmaster]\npoll_seconds = "soon"\n');
    const root = join(repo, ".postmaster", "runs");
    mkdirSync(join(root, "postmaster"), { recursive: true });
    const r = runCli(["runs-watch", root, "--timeout", "0"], envFor(config));
    expect(r.err).toContain(settings);
    expect(r.err).toContain("poll_seconds");
  }, 60000);

  test("host limits outside a run show the project value", () => {
    const { repo, config } = scratch();
    writeSettings(repo, c2Settings());
    const r = runCli(["host", "limits", "--role", "lane", "--project", repo], envFor(config));
    expect(r.code).toBe(0);
    expect(r.out).toContain("memory=64M");
    expect(r.out).toContain("tasks=512");
  }, 30000);

  test("reviewers lines show the project reviewers", () => {
    const { repo, config } = scratch();
    writeSettings(repo, c2Settings());
    const r = runCli(["reviewers", "lines", "--project", repo], envFor(config));
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toBe("reviewers: mimo");
  }, 30000);

  test("plane reads the project tracker", async () => {
    const { repo, config } = scratch();
    const keyFile = join(tmp, `plane-${n}.env`);
    writeFileSync(keyFile, "PLANE_API_KEY=dummy\n");
    const server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json({
          results: [{ identifier: "STUB", id: "stub-1", name: "Stub project" }],
          next_page_results: false,
        }),
    });
    try {
      writeSettings(
        repo,
        `[tracker]\nkind = "plane"\nurl = "http://127.0.0.1:${server.port}"\nworkspace = "stub-ws"\nenv_file = "${keyFile}"\n`,
      );
      // Async spawn: a blocking spawn would stall this process's event loop and
      // the stub server would never answer.
      const merged: Record<string, string | undefined> = {
        ...process.env,
        ...envFor(config, { POSTMASTER_PROJECT: repo }),
      };
      const proc = Bun.spawn([CLI, "plane", "projects"], {
        stdout: "pipe",
        stderr: "pipe",
        env: merged,
      });
      const out = await new Response(proc.stdout).text();
      const err = await new Response(proc.stderr).text();
      expect(await proc.exited).toBe(0);
      expect(err).toBe("");
      expect(out).toContain("Stub project");
    } finally {
      server.stop(true);
    }
  }, 60000);

  test("only the shared loader builds the global config path", () => {
    const root = join(import.meta.dir, "..", "..");
    const scripts = join(root, "scripts");
    const part1 = ".postmaster";
    const part2 = "config.toml";
    // ASCII: the pattern holds no \p and no i; u would change nothing.
    const slash = new RegExp(`${part1.replace(/\./gu, "\\.")}/${part2.replace(/\./gu, "\\.")}`);
    const joined = new RegExp(
      // ASCII: join() args in TS source split on ASCII whitespace.
      `"${part1.replace(/\./gu, "\\.")}"\\s*,\\s*"${part2.replace(/\./gu, "\\.")}"`,
    );
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name);
        if (name.isDirectory()) {
          walk(p);
        } else if (name.isFile() && p.endsWith(".ts") && !p.endsWith(".test.ts")) {
          // Tests spell the path to assert on it; the invariant covers shipped code.
          const src = readFileSync(p, "utf8");
          // ASCII: [\s\S] matches every character; the strip cannot miss a closer.
          const noBlocks = src.replace(/\/\*[\s\S]*?\*\//gu, "");
          const code = noBlocks
            .split("\n")
            .filter((l) => !l.trimStart().startsWith("//"))
            .join("\n");
          if (slash.test(code) || joined.test(code)) found.push(p.slice(root.length + 1));
        }
      }
    };
    walk(scripts);
    expect(found.sort()).toEqual(["scripts/lib/effective-config.ts"]);
  }, 30000);
});

describe("C3: complete project settings run with no global config", () => {
  test("front-door decides with the project file as the whole config", () => {
    const { repo } = scratch();
    writeSettings(repo, example);
    const missing = join(tmp, `missing-${n}.toml`);
    const r = runCli(["front-door", "claude", "opus-x", repo, "yes", repo], envFor(missing));
    expect(r.code).toBe(0);
    expect(r.out.startsWith("self")).toBe(true);
  }, 30000);

  test("launch form prints each role form", () => {
    const { repo } = scratch();
    writeSettings(repo, example);
    const missing = join(tmp, `missing-${n}.toml`);
    const env = envFor(missing);
    const lane = runCli(["launch", "form", "luna", "--project", repo], env);
    expect(lane.code).toBe(0);
    expect(lane.out).toContain("gpt-5.6-luna");
    const coachman = runCli(
      ["launch", "form", "coachman", "--leg", "synthesis", "--project", repo],
      env,
    );
    expect(coachman.code).toBe(0);
    expect(coachman.out).toContain("grok-4.6");
    const postmaster = runCli(["launch", "form", "postmaster", "--project", repo], env);
    expect(postmaster.code).toBe(0);
    expect(postmaster.out).toContain("opus-x");
  }, 60000);

  test("run-meta writes the run record", () => {
    const { repo } = scratch();
    writeSettings(repo, example);
    writeFileSync(join(repo, "README.md"), "scratch\n");
    commitFile(repo, "README.md");
    const missing = join(tmp, `missing-${n}.toml`);
    const dispatch = join(repo, ".postmaster", "runs", "T-1");
    mkdirSync(dispatch, { recursive: true });
    const r = runCli(["run-meta", dispatch, repo], envFor(missing));
    expect(r.code).toBe(0);
    const recorded = JSON.parse(readFileSync(join(dispatch, "run.json"), "utf8")) as Rec;
    expect(((recorded.config as Rec).team as Rec).postmaster).toEqual({
      harness: "claude",
      model: "opus-x",
    });
  }, 60000);
});

describe("usable counts the keys that survive the strip (#335)", () => {
  test("legacy-only settings read as no config with no global config", () => {
    const { repo } = scratch();
    writeSettings(
      repo,
      '[project]\nrisk_surfaces = "binds nothing"\n[tracker]\nbinding = "board"\n',
    );
    const missing = join(tmp, `missing-${n}.toml`);
    const env = envFor(missing);
    const effective = runCli(["project-settings", "effective", repo], env);
    expect(effective.code).not.toBe(0);
    expect(effective.err).toContain("no config at");
    const kind = runCli(["tracker-kind", repo], env);
    expect(kind.code).not.toBe(0);
    expect(kind.out).not.toContain("github");
    expect(kind.err).toContain("no config at");
  }, 30000);

  test("a complete project-only config stays usable", () => {
    const { repo } = scratch();
    writeSettings(repo, example);
    const missing = join(tmp, `missing-${n}.toml`);
    const r = runCli(["project-settings", "effective", repo], envFor(missing));
    expect(r.code).toBe(0);
    expect(r.out).toContain("opus-x");
  }, 30000);

  test("a global-only config stays usable", () => {
    const { repo, config } = scratch();
    const r = runCli(["project-settings", "effective", repo], envFor(config));
    expect(r.code).toBe(0);
    expect(r.out).toContain("opus-x");
  }, 30000);

  test("global and project settings still merge", () => {
    const { repo, config } = scratch();
    writeSettings(repo, '[lanes.luna]\nmodel = "gpt-other"\n');
    const r = runCli(["project-settings", "effective", repo], envFor(config));
    expect(r.code).toBe(0);
    expect(r.out).toContain("gpt-other");
    expect(r.out).toContain("opus-x");
  }, 30000);
});

describe("an existing global path that is not a regular file fails loud (#335)", () => {
  test("a dangling symlink fails with the path named, even with complete project settings", () => {
    const { repo } = scratch();
    writeSettings(repo, '[lanes.luna]\nharness = "codex"\nmodel = "probe-model"\n');
    const link = join(tmp, `dangling-${n}.toml`);
    symlinkSync(join(tmp, "no-such-target.toml"), link);
    const r = runCli(["project-settings", "effective", repo], envFor(link));
    expect(r.code).not.toBe(0);
    expect(r.out).toBe("");
    expect(r.err).toContain(link);
    expect(r.err).toContain("is not a regular file");
  }, 30000);

  test("a directory fails with the path named, even with complete project settings", () => {
    const { repo } = scratch();
    writeSettings(repo, '[lanes.luna]\nharness = "codex"\nmodel = "probe-model"\n');
    const dir = join(tmp, `configdir-${n}`);
    mkdirSync(dir, { recursive: true });
    const r = runCli(["project-settings", "effective", repo], envFor(dir));
    expect(r.code).not.toBe(0);
    expect(r.out).toBe("");
    expect(r.err).toContain(dir);
    expect(r.err).toContain("is not a regular file");
  }, 30000);
});

describe("C4: tracked settings wait for acceptance", () => {
  function pending(): { repo: string; config: string; settings: string } {
    const { repo, config } = scratch();
    const settings = writeSettings(repo, '[lanes.luna]\nmodel = "gpt-other"\n');
    commitSettings(repo);
    return { repo, config, settings };
  }

  test("forms, effective and reviewers use the global value and name the file", () => {
    const { repo, config, settings } = pending();
    const env = envFor(config);
    const form = runCli(["launch", "form", "luna", "--project", repo], env);
    expect(form.code).toBe(0);
    expect(form.out).toContain("gpt-5.6-luna");
    expect(form.out).not.toContain("gpt-other");
    expect(form.err).toContain(settings);
    expect(form.err).toContain("waits for acceptance");
    const effective = runCli(["project-settings", "effective", repo], env);
    expect(effective.code).toBe(0);
    expect((((JSON.parse(effective.out) as Rec).lanes as Rec).luna as Rec).model).toBe(
      "gpt-5.6-luna",
    );
    expect(effective.err).toContain(settings);
    const reviewers = runCli(["reviewers", "lines", "--project", repo], env);
    expect(reviewers.code).toBe(0);
    expect(reviewers.out.split("\n")[0]).toBe("reviewers: luna, deepseek");
    expect(reviewers.err).toContain(settings);
  }, 60000);

  test("front-door, tracker-kind and run-meta use the global value and name the file", () => {
    const { repo, config, settings } = pending();
    const env = envFor(config);
    const door = runCli(["front-door", "codex", "gpt-p", repo, "yes", repo], env);
    expect(door.code).toBe(0);
    expect(door.out.startsWith("spawn")).toBe(true);
    expect(door.err).toContain(settings);
    const kind = runCli(["tracker-kind", repo], env);
    expect(kind.code).toBe(0);
    expect(kind.out).toBe("github\n");
    expect(kind.err).toContain(settings);
    const dispatch = join(repo, ".postmaster", "runs", "T-1");
    mkdirSync(dispatch, { recursive: true });
    const meta = runCli(["run-meta", dispatch, repo], env);
    expect(meta.code).toBe(0);
    const recorded = JSON.parse(readFileSync(join(dispatch, "run.json"), "utf8")) as Rec;
    expect((((recorded.config as Rec).lanes as Rec).luna as Rec).model).toBe("gpt-5.6-luna");
    expect(meta.err).toContain(settings);
  }, 60000);

  test("the watcher, host limits and the clerk launch use the global value and name the file", () => {
    const { repo, config, settings } = pending();
    const env = envFor(config);
    const root = join(repo, ".postmaster", "runs");
    mkdirSync(join(root, "postmaster"), { recursive: true });
    const watch = runCli(["runs-watch", root, "--timeout", "0"], env);
    expect(watch.code).toBe(3);
    expect(watch.err).toContain(settings);
    const limits = runCli(["host", "limits", "--role", "lane", "--project", repo], env);
    expect(limits.code).toBe(0);
    expect(limits.out).toContain("memory=8G");
    expect(limits.err).toContain(settings);
    const clerk = runCli(
      ["launch", "interactive", "clerk", "--project", repo, "--name", "T, x"],
      env,
    );
    expect(clerk.code).toBe(0);
    expect(clerk.out).toContain("strongest");
    expect(clerk.err).toContain(settings);
  }, 60000);

  test("after accept the project value is used", () => {
    const { repo, config } = pending();
    const env = envFor(config);
    const accept = runCli(["project-settings", "accept", repo], env);
    expect(accept.code).toBe(0);
    expect(accept.out).toContain("accepted");
    expect(existsSync(join(dirname(config), "accepted-project-settings.json"))).toBe(true);
    const form = runCli(["launch", "form", "luna", "--project", repo], env);
    expect(form.code).toBe(0);
    expect(form.out).toContain("gpt-other");
    expect(form.err).not.toContain("acceptance");
    const effective = runCli(["project-settings", "effective", repo], env);
    expect((((JSON.parse(effective.out) as Rec).lanes as Rec).luna as Rec).model).toBe("gpt-other");
  }, 60000);

  test("an untracked file needs no acceptance", () => {
    const { repo, config } = scratch();
    writeSettings(repo, '[lanes.luna]\nmodel = "gpt-other"\n');
    const form = runCli(["launch", "form", "luna", "--project", repo], envFor(config));
    expect(form.code).toBe(0);
    expect(form.out).toContain("gpt-other");
    expect(form.err).not.toContain("acceptance");
  }, 30000);

  test("a tracked roles file waits, then works after accept", () => {
    const { repo, config } = scratch();
    writeSettings(repo, '[roles]\nworkhorses = ["luna", "mimo"]\n');
    commitSettings(repo);
    const env = envFor(config);
    const before = runCli(["project-settings", "report", repo], env);
    expect(before.code).toBe(0);
    expect(before.out).toContain("project_local=yes");
    expect(before.out).toContain("project_source.roles=machine");
    expect(before.err).toContain("waits for acceptance");
    const effectiveBefore = runCli(["project-settings", "effective", repo], env);
    expect(((JSON.parse(effectiveBefore.out) as Rec).team as Rec).workhorses).toEqual([
      "luna",
      "deepseek",
    ]);
    expect(runCli(["project-settings", "accept", repo], env).code).toBe(0);
    const after = runCli(["project-settings", "report", repo], env);
    expect(after.out).toContain("project_source.roles=local");
    const effectiveAfter = runCli(["project-settings", "effective", repo], env);
    expect(((JSON.parse(effectiveAfter.out) as Rec).team as Rec).workhorses).toEqual([
      "luna",
      "mimo",
    ]);
  }, 60000);

  test("the declared checks file reads as before", () => {
    const { repo, config } = scratch();
    writeFileSync(
      join(repo, ".postmaster", "project.toml"),
      '[checks.x]\ncommand = "true"\nshows = "s"\n',
    );
    commitFile(repo, ".postmaster/project.toml");
    writeSettings(repo, '[lanes.luna]\nmodel = "gpt-other"\n');
    commitSettings(repo);
    const r = runCli(["verify", "checks", repo], envFor(config));
    expect(r.code).toBe(0);
    expect(r.out).toContain("x [declared]");
  }, 30000);
});

describe("C5: changed settings wait again", () => {
  test("a changed file waits again; an unchanged file needs no second accept", () => {
    const { repo, config } = scratch();
    writeSettings(repo, '[lanes.luna]\nmodel = "gpt-other"\n');
    commitSettings(repo);
    const env = envFor(config);
    expect(runCli(["project-settings", "accept", repo], env).code).toBe(0);
    const again = runCli(["project-settings", "accept", repo], env);
    expect(again.code).toBe(0);
    expect(again.out).toContain("already accepted");
    writeSettings(repo, '[lanes.luna]\nmodel = "gpt-next"\n');
    git(repo, ["add", ".postmaster/settings.toml"]);
    git(repo, ["commit", "-qm", "settings again"]);
    const changed = runCli(["launch", "form", "luna", "--project", repo], env);
    expect(changed.code).toBe(0);
    expect(changed.out).toContain("gpt-5.6-luna");
    expect(changed.err).toContain("waits for acceptance");
    expect(runCli(["project-settings", "accept", repo], env).code).toBe(0);
    const accepted = runCli(["launch", "form", "luna", "--project", repo], env);
    expect(accepted.code).toBe(0);
    expect(accepted.out).toContain("gpt-next");
  }, 60000);

  test("tracked and pending with no global config says both", () => {
    const { repo } = scratch();
    const settings = writeSettings(repo, '[lanes.luna]\nmodel = "gpt-other"\n');
    commitSettings(repo);
    const missing = join(tmp, `missing-${n}.toml`);
    const r = runCli(["front-door", "claude", "opus-x", repo, "yes", repo], envFor(missing));
    expect(r.code).toBe(1);
    expect(r.err).toContain(settings);
    expect(r.err).toContain("waits for acceptance");
    expect(r.err).toContain("no config");
  }, 30000);
});

describe("Review round 1 regressions", () => {
  test("reviewers lines serves a complete project file with no global config", () => {
    const { repo } = scratch();
    writeSettings(
      repo,
      '[lanes.b]\nharness = "codex"\nmodel = "m-b"\n[team]\nworkhorses = ["b"]\nreviewers = ["b"]\n',
    );
    const missing = join(tmp, `missing-${n}.toml`);
    const r = runCli(["reviewers", "lines", "--project", repo], envFor(missing));
    expect(r.code).toBe(0);
    expect(r.out).toContain("reviewers: b");
  }, 30000);

  test("write keeps roles that resolve against the local candidate alone", () => {
    const { repo } = scratch();
    const cand = join(tmp, `cand-${n}.toml`);
    writeFileSync(
      cand,
      '[lanes.b]\nharness = "codex"\nmodel = "m-b"\n[roles]\nworkhorses = ["b"]\n',
    );
    const missing = join(tmp, `missing-${n}.toml`);
    const r = runCli(["project-settings", "write", repo, "local", cand], envFor(missing));
    expect(r.code).toBe(0);
    expect(existsSync(join(repo, ".postmaster", "settings.toml"))).toBe(true);
  }, 30000);

  test("accept refuses roles no resolved lane defines, and the file still waits", () => {
    const { repo, config } = scratch();
    writeSettings(
      repo,
      '[lanes.b]\nharness = "codex"\nmodel = "m-b"\n[roles]\nworkhorses = ["ghost"]\n',
    );
    commitSettings(repo);
    const env = envFor(config);
    const accept = runCli(["project-settings", "accept", repo], env);
    expect(accept.code).toBe(1);
    expect(accept.err).toContain("ghost");
    const inspect = runCli(["project-settings", "inspect", repo], env);
    expect(inspect.code).toBe(0);
    expect((JSON.parse(inspect.out) as Rec).local_acceptance).toBe("pending");
  }, 60000);

  test("an explicit machine config under ~ merges instead of dropping the global file", () => {
    const { repo } = scratch();
    writeSettings(repo, '[lanes.luna]\nmodel = "gpt-other"\n');
    writeFileSync(join(stubHome, `m-${n}.toml`), example);
    const env = envFor(join(tmp, `missing-${n}.toml`));
    const r = runCli(["project-settings", "effective", repo, `~/m-${n}.toml`], env);
    expect(r.code).toBe(0);
    const cfg = JSON.parse(r.out) as Rec;
    expect(((cfg.lanes as Rec).luna as Rec).model).toBe("gpt-other");
    expect(((cfg.team as Rec).postmaster as Rec).model).toBe("opus-x");
  }, 30000);

  test("a settings file inside a submodule waits for acceptance", () => {
    const { repo, config } = scratch();
    n += 1;
    const src = join(tmp, `subsrc-${n}`);
    mkdirSync(src, { recursive: true });
    const init = spawnSync("git", ["init", "-q", src], { encoding: "utf8", timeout: 30000 });
    if ((init.status ?? 1) !== 0) throw new Error(`git init failed: ${init.stderr}`);
    git(src, ["config", "user.email", "test@example.com"]);
    git(src, ["config", "user.name", "test"]);
    writeFileSync(join(src, "settings.toml"), '[lanes.luna]\nmodel = "gpt-other"\n');
    git(src, ["add", "settings.toml"]);
    git(src, ["commit", "-qm", "sub"]);
    rmSync(join(repo, ".postmaster"), { recursive: true, force: true });
    git(repo, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", src, ".postmaster"]);
    git(repo, ["commit", "-qm", "outer"]);
    const env = envFor(config);
    const inspect = runCli(["project-settings", "inspect", repo], env);
    expect(inspect.code).toBe(0);
    expect((JSON.parse(inspect.out) as Rec).local_acceptance).toBe("pending");
    expect(inspect.err).toContain("waits for acceptance");
    const effective = runCli(["project-settings", "effective", repo], env);
    expect((((JSON.parse(effective.out) as Rec).lanes as Rec).luna as Rec).model).toBe(
      "gpt-5.6-luna",
    );
  }, 60000);

  test("a repository git cannot read waits instead of reading free", () => {
    const { repo, config } = scratch();
    writeSettings(repo, '[lanes.luna]\nmodel = "gpt-other"\n');
    writeFileSync(join(repo, ".postmaster", "project.toml"), '[tracker]\nbinding = "b"\n');
    git(repo, ["add", "-f", ".postmaster/project.toml"]);
    git(repo, ["commit", "-qm", "project"]);
    const index = join(repo, ".git", "index");
    chmodSync(index, 0o000);
    try {
      const inspect = runCli(["project-settings", "inspect", repo], envFor(config));
      expect(inspect.code).toBe(0);
      expect((JSON.parse(inspect.out) as Rec).local_acceptance).toBe("pending");
      expect(inspect.err).toContain("waits for acceptance");
    } finally {
      chmodSync(index, 0o644);
    }
  }, 60000);
});

describe("Review round 2 regressions", () => {
  test("a confine typo is refused; on and off pass", () => {
    const { repo, config } = scratch();
    const env = envFor(config);
    writeSettings(repo, 'confine = "onn"\n');
    const bad = runCli(["project-settings", "effective", repo], env);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('confine must be "on" or "off"');
    writeSettings(repo, 'confine = "off"\n');
    expect(runCli(["project-settings", "effective", repo], env).code).toBe(0);
    writeSettings(repo, 'confine = "on"\n');
    expect(runCli(["project-settings", "effective", repo], env).code).toBe(0);
  }, 60000);

  test("effective reads a piped machine config from stdin", () => {
    const { repo } = scratch();
    writeSettings(repo, '[lanes.luna]\nmodel = "gpt-other"\n');
    const missing = join(tmp, `missing-${n}.toml`);
    const r = runCli(
      ["project-settings", "effective", repo, "-"],
      envFor(missing),
      '{"lanes": {"a": {"harness": "codex", "model": "m-a"}}}',
    );
    expect(r.code).toBe(0);
    const cfg = JSON.parse(r.out) as Rec;
    expect(((cfg.lanes as Rec).luna as Rec).model).toBe("gpt-other");
    expect(((cfg.lanes as Rec).a as Rec).model).toBe("m-a");
  }, 30000);
});

describe("Review round 4 regressions", () => {
  test("a committed case-variant directory counts as tracked", () => {
    const { repo, config } = scratch();
    // On a case-insensitive filesystem a committed .POSTMASTER/settings.toml
    // lands inside a pre-existing .postmaster/ directory; Linux holds both
    // spellings side by side, so this pins the macOS-correct outcome: the
    // on-disk file waits for acceptance.
    mkdirSync(join(repo, ".POSTMASTER"), { recursive: true });
    writeFileSync(join(repo, ".POSTMASTER", "settings.toml"), '[lanes.luna]\nmodel = "gpt-evil"\n');
    git(repo, ["add", ".POSTMASTER/settings.toml"]);
    git(repo, ["commit", "-qm", "upper"]);
    writeSettings(repo, '[lanes.luna]\nmodel = "gpt-other"\n');
    const env = envFor(config);
    const inspect = runCli(["project-settings", "inspect", repo], env);
    expect(inspect.code).toBe(0);
    expect((JSON.parse(inspect.out) as Rec).local_acceptance).toBe("pending");
    expect(inspect.err).toContain("waits for acceptance");
    const effective = runCli(["project-settings", "effective", repo], env);
    expect((((JSON.parse(effective.out) as Rec).lanes as Rec).luna as Rec).model).toBe(
      "gpt-5.6-luna",
    );
  }, 60000);
});

describe("Review round 9 regressions", () => {
  function committedUnaccepted(): { repo: string; config: string; settings: string } {
    const { repo, config } = scratch();
    const settings = writeSettings(repo, '[lanes.luna]\nmodel = "gpt-other"\n');
    commitSettings(repo);
    return { repo, config, settings };
  }

  /** A git that answers the ownership refusal: ls-files 128, rev-parse 128, --version 0. */
  function refusalStub(): string {
    n += 1;
    const dir = join(tmp, `gitstub-${n}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "git"),
      '#!/bin/sh\nfor a in "$@"; do\n  case "$a" in\n' +
        '    ls-files) echo "fatal: detected dubious ownership in repository" >&2; exit 128;;\n' +
        '    rev-parse) echo "fatal: detected dubious ownership in repository" >&2; exit 128;;\n' +
        '    --version) echo "git version 2.43.0-stub"; exit 0;;\n' +
        '  esac\ndone\necho "stub git: unexpected: $*" >&2; exit 128\n',
    );
    chmodSync(join(dir, "git"), 0o755);
    return dir;
  }

  /** A PATH with only what runs the CLI: no git at all. */
  function noGitDir(): string {
    n += 1;
    const dir = join(tmp, `nogit-${n}`);
    mkdirSync(dir, { recursive: true });
    symlinkSync(process.execPath, join(dir, "bun"));
    for (const tool of ["bash", "dirname"]) {
      const p = existsSync(`/bin/${tool}`) ? `/bin/${tool}` : `/usr/bin/${tool}`;
      symlinkSync(p, join(dir, tool));
    }
    return dir;
  }

  test("committed unaccepted settings read pending with working git", () => {
    const { repo, config, settings } = committedUnaccepted();
    const env = envFor(config);
    const inspect = runCli(["project-settings", "inspect", repo], env);
    expect(inspect.code).toBe(0);
    expect((JSON.parse(inspect.out) as Rec).local_acceptance).toBe("pending");
    expect(inspect.err).toContain(settings);
    expect(inspect.err).toContain("waits for acceptance");
    const effective = runCli(["project-settings", "effective", repo], env);
    expect((((JSON.parse(effective.out) as Rec).lanes as Rec).luna as Rec).model).toBe(
      "gpt-5.6-luna",
    );
  }, 60000);

  test("committed unaccepted settings still read pending when git refuses the repository", () => {
    const { repo, config, settings } = committedUnaccepted();
    const env = envFor(config, { PATH: `${refusalStub()}:${process.env.PATH ?? ""}` });
    const inspect = runCli(["project-settings", "inspect", repo], env);
    expect(inspect.code).toBe(0);
    expect((JSON.parse(inspect.out) as Rec).local_acceptance).toBe("pending");
    expect(inspect.err).toContain(settings);
    expect(inspect.err).toContain("waits for acceptance");
  }, 60000);

  test("a folder with no repository reads untracked and is used", () => {
    n += 1;
    const repo = join(tmp, `norepo-${n}`);
    mkdirSync(join(repo, ".postmaster"), { recursive: true });
    writeSettings(repo, '[lanes.luna]\nmodel = "gpt-other"\n');
    const config = join(tmp, `config-norepo-${n}.toml`);
    writeFileSync(config, example);
    const env = envFor(config);
    const inspect = runCli(["project-settings", "inspect", repo], env);
    expect(inspect.code).toBe(0);
    expect((JSON.parse(inspect.out) as Rec).local_acceptance).toBe("not-needed");
    const effective = runCli(["project-settings", "effective", repo], env);
    expect((((JSON.parse(effective.out) as Rec).lanes as Rec).luna as Rec).model).toBe("gpt-other");
  }, 60000);

  test("missing git with a repository present fails closed and waits for acceptance", () => {
    const { repo, config, settings } = committedUnaccepted();
    const env = envFor(config, { PATH: noGitDir() });
    const inspect = runCli(["project-settings", "inspect", repo], env);
    expect(inspect.code).toBe(0);
    expect((JSON.parse(inspect.out) as Rec).local_acceptance).toBe("pending");
    expect(inspect.err).toContain(settings);
    expect(inspect.err).toContain("waits for acceptance");
  }, 60000);

  test("missing git with no repository reads untracked and is used", () => {
    n += 1;
    const repo = join(tmp, `nogitrepo-${n}`);
    mkdirSync(join(repo, ".postmaster"), { recursive: true });
    writeSettings(repo, '[lanes.luna]\nmodel = "gpt-other"\n');
    const config = join(tmp, `config-nogitrepo-${n}.toml`);
    writeFileSync(config, example);
    const env = envFor(config, { PATH: noGitDir() });
    const inspect = runCli(["project-settings", "inspect", repo], env);
    expect(inspect.code).toBe(0);
    expect((JSON.parse(inspect.out) as Rec).local_acceptance).toBe("not-needed");
    const effective = runCli(["project-settings", "effective", repo], env);
    expect((((JSON.parse(effective.out) as Rec).lanes as Rec).luna as Rec).model).toBe("gpt-other");
  }, 60000);
});
