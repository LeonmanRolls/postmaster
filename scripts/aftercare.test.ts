// Tests beside scripts/aftercare.ts: a landed run record built in a temp folder and put back
// byte for byte before each test, the
// command run against it the way the checks run it, and a control beside every count — a
// refusal that must change nothing, a foreign worktree that must stay, a flag that must not
// fall. Nothing here touches a live Herdr or tmux: herdr and tmux are stubs on PATH and the
// host state lives under the temp folder.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { trackerArgv } from "./aftercare.ts";
import { FIXTURE_MARKER } from "./fixture.ts";
import { processes } from "./host.ts";
import { run } from "./lib/proc.ts";
import { scriptsDir } from "./lib/paths.ts";
import { bootId, processIsLive } from "./lib/processes.ts";

const HERE = scriptsDir(import.meta);

interface Fixture {
  T: string;
  repo: string;
  D: string;
  BASE: string;
  C: string;
  pin: string;
}

function sh(cmd: string, args: string[], cwd?: string, env?: Record<string, string>): string {
  const r = run(cmd, args, {
    ...(cwd !== undefined ? { cwd } : {}),
    ...(env !== undefined ? { env } : {}),
  });
  if (r.code !== 0)
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.code}): ${r.out}${r.err}`);
  return r.out;
}

/** A landed run record: repo, lane branches, four run folders, the dispatch, the pin. */
function makeR(): Fixture {
  const T = mkdtempSync(join(tmpdir(), "aftercare-test-"));
  const repo = join(T, "repo");
  mkdirSync(repo);
  sh("git", ["init", "-q", "-b", "main", repo]);
  sh("git", ["config", "user.name", "aftercare-test"], repo);
  sh("git", ["config", "user.email", "test@example.invalid"], repo);
  writeFileSync(join(repo, ".gitignore"), ".worktrees/\n.postmaster/\nnode_modules/\n");
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "README.md"), "readme\n");
  sh("git", ["add", ".gitignore", "README.md"], repo);
  sh("git", ["commit", "-qm", "BASE"], repo);
  const BASE = sh("git", ["rev-parse", "HEAD"], repo).trim();

  const rung = join(HERE, "run");
  sh(rung, ["local", repo, "store", "init"], T);
  for (let n = 1; n <= 7; n++) {
    const body = join(T, "body.md");
    writeFileSync(body, `body of ticket ${n}\n`);
    const got = sh(rung, ["local", repo, "create", `ticket ${n}`, body], T).trim();
    if (got !== String(n)) throw new Error(`ticket number ${got}, wanted ${n}`);
  }
  sh(rung, ["local", repo, "state", "7", "done"], T);

  sh("git", ["checkout", "-q", "-b", "7"], repo);
  mkdirSync(join(repo, "test"));
  writeFileSync(join(repo, "test/oracle-7.test.ts"), "oracle v1\n");
  sh("git", ["add", "test/oracle-7.test.ts"], repo);
  sh("git", ["commit", "-qm", "blind acceptance tests"], repo);
  writeFileSync(join(repo, "test/oracle-7.test.ts"), "oracle v2\n");
  writeFileSync(join(repo, "src/a.ts"), "export const a = 2;\n");
  sh("git", ["add", "test/oracle-7.test.ts", "src/a.ts"], repo);
  sh("git", ["commit", "-qm", "oracle v2 and a"], repo);
  sh("git", ["checkout", "-q", "main"], repo);
  sh("git", ["merge", "-q", "--no-ff", "7", "-m", "merge 7"], repo);

  sh("git", ["checkout", "-q", "-b", "wb/7-sol", BASE], repo);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src/sol.ts"), "export const sol = 1;\n");
  sh("git", ["add", "src/sol.ts"], repo);
  sh("git", ["commit", "-qm", "sol lane work"], repo);
  sh("git", ["checkout", "-q", "-b", "wb/7-mimo", BASE], repo);
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src/mimo.ts"), "export const mimo = 1;\n");
  writeFileSync(join(repo, "src/a.ts"), "export const a = 1;\n");
  sh("git", ["add", "src/mimo.ts", "src/a.ts"], repo);
  sh("git", ["commit", "-qm", "mimo lane work"], repo);
  sh("git", ["branch", "-q", "70-x", BASE], repo);
  sh("git", ["checkout", "-q", "main"], repo);

  const wt = join(repo, ".worktrees");
  mkdirSync(wt);
  sh("git", ["worktree", "add", "-q", join(wt, "7"), "7"], repo);
  sh("git", ["worktree", "add", "-q", join(wt, "7-sol"), "wb/7-sol"], repo);
  mkdirSync(join(wt, "7-sol/scripts/.host-self-test-abc"), { recursive: true });
  for (const name of ["one.txt", "two.txt", "three.txt"])
    writeFileSync(join(wt, "7-sol/scripts/.host-self-test-abc", name), "x\n");
  sh("git", ["worktree", "add", "-q", join(wt, "7-mimo"), "wb/7-mimo"], repo);
  mkdirSync(join(wt, "7-mimo/node_modules/p"), { recursive: true });
  writeFileSync(join(wt, "7-mimo/node_modules/p/i.js"), "ignored\n");
  sh("git", ["worktree", "add", "-q", "--detach", join(wt, "7-oracle-sol"), "wb/7-sol"], repo);
  const oracle = sh("git", ["rev-parse", "HEAD~1"], join(wt, "7")).trim();
  sh("git", ["checkout", "-q", oracle, "--", "test/oracle-7.test.ts"], join(wt, "7-oracle-sol"));
  sh("git", ["worktree", "add", "-q", join(wt, "70-x"), "70-x"], repo);
  sh("git", ["worktree", "add", "-q", "--detach", join(wt, "ticket-7-base"), "main"], repo);

  const D = join(repo, ".postmaster/runs/7");
  mkdirSync(join(D, "logs"), { recursive: true });
  mkdirSync(join(D, "render"));
  writeFileSync(
    join(D, "brief.md"),
    `# Ticket 7: fixture\n\n## Ticket\n\nA fixture run.\n\n## Dispatch\n\nname: #7 fixture\nsynthesis worktree: ${join(wt, "7")}\n`,
  );
  writeFileSync(
    join(D, "manifest.json"),
    `${JSON.stringify({ stage: "shipped", leg: 2, base: BASE, lanes: { sol: {}, mimo: {} } }, null, 2)}\n`,
  );

  const pinRepo = join(T, "pinrepo");
  mkdirSync(pinRepo);
  sh("git", ["init", "-q", "-b", "main", pinRepo]);
  sh("git", ["config", "user.name", "aftercare-test"], pinRepo);
  sh("git", ["config", "user.email", "test@example.invalid"], pinRepo);
  writeFileSync(join(pinRepo, "pin.txt"), "pin\n");
  sh("git", ["add", "pin.txt"], pinRepo);
  sh("git", ["commit", "-qm", "pin base"], pinRepo);
  const C = sh("git", ["rev-parse", "HEAD"], pinRepo).trim();
  const pin = join(T, "pins", C);
  mkdirSync(join(T, "pins"));
  sh("git", ["worktree", "add", "-q", "--detach", pin, C], pinRepo);
  writeFileSync(join(T, "pins", `${C}.claims`), `${D}\n`);
  writeFileSync(
    join(D, "run.json"),
    `${JSON.stringify({
      coachman_contract: 2,
      postmaster: { checkout: pin },
      config: { team: { workhorses: ["sol", "mimo"] } },
    })}\n`,
  );

  const actions: string[] = [
    { action: "dispatch", target: "7", detail: "synthesis leg 1" },
    { action: "stage", target: "bootstrapped", detail: "from none" },
    { action: "stage", target: "planning", detail: "from bootstrapped" },
    { action: "stage", target: "workhorses-running", detail: "from planning" },
    { action: "stage", target: "synthesis", detail: "from workhorses-running" },
    { action: "stage", target: "checkpoint-1", detail: "from synthesis" },
    { action: "stage", target: "review", detail: "from checkpoint-1" },
    { action: "stage", target: "shipping", detail: "from review" },
    { action: "merge", target: "7", detail: "merged to main" },
    { action: "stage", target: "shipped", detail: "from shipping" },
  ].map((e) =>
    JSON.stringify({
      ts: "2026-10-01T00:01:00Z",
      project: "repo",
      run: "7",
      actor: e.action === "stage" && e.target !== "shipped" ? "coachman" : "postmaster",
      ...e,
    }),
  );
  writeFileSync(join(D, "actions.jsonl"), `${actions.join("\n")}\n`);
  for (const marker of [".leg-1-done", ".leg-1-exited", ".leg-2-done", ".leg-2-exited"])
    writeFileSync(join(D, marker), "");
  writeFileSync(
    join(D, "run-log.md"),
    "# Run 7\n\n## Dispatch (2026-10-01 00:00:00 UTC)\n\nfixture\n",
  );
  writeFileSync(
    join(D, "logs/review-r1.json"),
    `${JSON.stringify({ round: 1, reviewers: [["bug", "mimo"]] })}\n`,
  );
  writeFileSync(
    join(D, "logs/review-r1-bug-mimo-findings.json"),
    `${JSON.stringify([{ id: "B1", severity: "P1", target: "src/a.ts:1" }])}\n`,
  );

  mkdirSync(join(T, "bin"));
  writeFileSync(join(T, "bin/herdr"), "#!/usr/bin/env bash\nexit 1\n");
  writeFileSync(join(T, "bin/tmux"), "#!/usr/bin/env bash\nexit 1\n");
  chmodSync(join(T, "bin/herdr"), 0o755);
  chmodSync(join(T, "bin/tmux"), 0o755);
  return { T, repo, D, BASE, C, pin };
}

let pristine: { fx: Fixture; tar: string } | null = null;

/** The world makeR builds, built the first time and put back byte for byte, in the same folder, for
 * every test that asks. Building it costs about 65 programs, 1.25 s; putting it back costs one
 * tar. The worktrees, the pin and the records keep absolute paths, so the folder must be the same
 * one: a test must not use a world after asking for the next. Nothing a test leaves behind (a
 * state folder, a lock, a pin gone) reaches the next test. */
function restoredR(): Fixture {
  if (pristine === null) {
    const fx = makeR();
    const tar = `${fx.T}.world.tar`;
    sh("tar", ["-C", fx.T, "-cpf", tar, "."]);
    pristine = { fx, tar };
    return fx;
  }
  const { fx, tar } = pristine;
  mkdirSync(fx.T, { recursive: true });
  const empty = (): void => {
    for (const name of readdirSync(fx.T))
      rmSync(join(fx.T, name), { recursive: true, force: true });
  };
  try {
    empty();
  } catch {
    // a test that failed half way can leave a folder it made unreadable
    sh("chmod", ["-R", "u+rwX", fx.T]);
    empty();
  }
  sh("tar", ["-C", fx.T, "-xpf", tar]);
  return fx;
}

afterAll(() => {
  if (pristine === null) return;
  try {
    sh("chmod", ["-R", "u+rwX", pristine.fx.T]);
  } catch {
    // already gone
  }
  rmSync(pristine.fx.T, { recursive: true, force: true });
  rmSync(pristine.tar, { force: true });
  pristine = null;
});

function fixtureEnv(
  r: Fixture,
  extra?: Record<string, string>,
): Record<string, string | undefined> {
  return {
    PATH: `${join(r.T, "bin")}:${process.env.PATH ?? ""}`,
    POSTMASTER_HOST_STATE: join(r.T, "state"),
    POSTMASTER_HOST_FIXTURE: r.T,
    POSTMASTER_HOST_CLOSE_WAIT: "1",
    POSTMASTER_TOOL_PINS: join(r.T, "pins"),
    ...extra,
  };
}

function aftercare(
  r: Fixture,
  args: string[],
  extraEnv?: Record<string, string>,
): { code: number; out: string } {
  const result = run(
    "bun",
    ["--no-env-file", "--config=/dev/null", join(HERE, "aftercare.ts"), r.D, ...args],
    { env: fixtureEnv(r, extraEnv) },
  );
  return { code: result.code, out: `${result.out}${result.err}` };
}

/** run host under the same fixture env, for starting a launch the command must stop. */
function hostSh(r: Fixture, args: string[]): { code: number; out: string } {
  const result = run(join(HERE, "run"), ["host", ...args], { env: fixtureEnv(r) });
  return { code: result.code, out: `${result.out}${result.err}` };
}

const WORDS = ["--comment", "closing words", "--run-log", "closing line"];

/** A background sleeper stands in for a foreign process: its pid, liveness by signal 0. */
function backgroundSleep(): number {
  const out = sh("sh", ["-c", "sleep 300 </dev/null >/dev/null 2>&1 & echo $!"]).trim();
  const pid = Number(out);
  if (!Number.isInteger(pid) || pid <= 0)
    throw new Error(`no sleeper pid in ${JSON.stringify(out)}`);
  return pid;
}

function killQuiet(pid: number): void {
  try {
    process.kill(pid);
  } catch {
    /* already gone */
  }
}

function snapshot(r: Fixture): string {
  const parts: string[] = [];
  parts.push(run("git", ["-C", r.repo, "worktree", "list"]).out);
  for (const file of ["actions.jsonl", "run-log.md", "manifest.json"]) {
    try {
      parts.push(readFileSync(join(r.D, file), "utf8"));
    } catch {
      parts.push(`missing ${file}`);
    }
  }
  try {
    parts.push(readFileSync(join(r.repo, ".git/postmaster/tickets/7.json"), "utf8"));
  } catch {
    parts.push("missing ticket 7");
  }
  try {
    parts.push(readFileSync(join(r.repo, ".postmaster/runs/ledger.jsonl"), "utf8"));
  } catch {
    parts.push("missing ledger");
  }
  parts.push(existsSync(join(r.D, "stray")) ? "stray present" : "no stray");
  parts.push(existsSync(r.pin) ? "pin present" : "pin gone");
  return parts.join("\n---\n");
}

function changedFolders(r: Fixture): string[] {
  return run("git", ["-C", r.repo, "worktree", "list", "--porcelain"])
    .out.split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length))
    .filter((path) => path.includes("/.worktrees/"));
}

describe("aftercare on a landed run record", () => {
  test("a full run: exit 0, the four run folders gone and nothing else, the run done, eleven lines logged", () => {
    const r = restoredR();
    const run1 = aftercare(r, WORDS);
    expect(run1.code).toBe(0);
    // the folders the run made are gone; control: the worktrees that are not the run's stay
    const left = changedFolders(r)
      .map((path) => path.split("/").pop())
      .sort();
    expect(left).toEqual(["70-x", "ticket-7-base"]);
    // the run is done, the ticket done, the pin released, the branches kept
    expect(JSON.parse(readFileSync(join(r.D, "manifest.json"), "utf8")).stage).toBe("done");
    const ticket = readFileSync(join(r.repo, ".git/postmaster/tickets/7.json"), "utf8");
    expect(JSON.parse(ticket).state).toBe("done");
    expect(existsSync(r.pin)).toBe(false);
    expect(existsSync(`${r.pin}.claims`)).toBe(false);
    for (const branch of ["7", "wb/7-sol", "wb/7-mimo"])
      expect(run("git", ["-C", r.repo, "rev-parse", "--verify", "-q", branch]).code).toBe(0);
    // exactly eleven new lines: style note, two save notes, four teardowns, run-log note,
    // ticket-comment, stage done, pin teardown — the same lines in the ledger
    const actions = readFileSync(join(r.D, "actions.jsonl"), "utf8").trim().split("\n");
    const ledger = readFileSync(join(r.repo, ".postmaster/runs/ledger.jsonl"), "utf8")
      .trim()
      .split("\n");
    expect(actions.length).toBe(10 + 11);
    expect(ledger.length).toBe(11);
    expect(actions.slice(10)).toEqual(ledger);
    expect(actions.slice(10).every((line) => JSON.parse(line).actor === "postmaster")).toBe(true);
    expect(run1.out).toContain("outcome: done");
  }, 120_000);

  test("a run not ready: exit 2 and nothing changed (control: the same run at shipped closes)", () => {
    const r = restoredR();
    const manifest = JSON.parse(readFileSync(join(r.D, "manifest.json"), "utf8"));
    manifest.stage = "shipping";
    writeFileSync(join(r.D, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const before = snapshot(r);
    const refused = aftercare(r, WORDS);
    expect(refused.code).toBe(2);
    expect(refused.out).toContain("not shipped");
    expect(snapshot(r)).toBe(before);
    expect(existsSync(join(r.D, ".aftercare.lock"))).toBe(false);
  }, 120_000);

  test("the dry run: exit 0, the plan names the four folders, nothing changed, no foreign folder", () => {
    const r = restoredR();
    const before = snapshot(r);
    const dry = aftercare(r, ["--dry-run", ...WORDS]);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("(dry run)");
    for (const folder of ["7", "7-sol", "7-mimo", "7-oracle-sol"])
      expect(dry.out).toContain(`.worktrees/${folder}:`);
    expect(dry.out).not.toContain("70-x:");
    expect(dry.out).not.toContain("ticket-7-base:");
    expect(snapshot(r)).toBe(before);
    // control: without the closing words the same call is a fault in the call, still unchanged
    const r2 = restoredR();
    const before2 = snapshot(r2);
    const noWords = aftercare(r2, ["--dry-run"]);
    expect(noWords.code).toBe(1);
    expect(noWords.out).toContain("stop at closing words");
    expect(snapshot(r2)).toBe(before2);
  }, 120_000);

  test("the dry run says plainly the real run may still stop; the real run says no such thing", () => {
    const r = restoredR();
    const dry = aftercare(r, ["--dry-run", ...WORDS]);
    expect(dry.code).toBe(0);
    expect(dry.out).toContain("the real run may still stop where the dry run could not tell");
    // control: the real run carries no such caveat
    const r2 = restoredR();
    const real = aftercare(r2, WORDS);
    expect(real.code).toBe(0);
    expect(real.out).not.toContain("may still stop");
  }, 120_000);

  test("a folder whose work no branch holds is flagged; the same file on a branch's content is not", () => {
    const r = restoredR();
    writeFileSync(join(r.repo, ".worktrees/7-mimo/src/a.ts"), "export const a = 9;\n");
    const flagged = aftercare(r, WORDS);
    expect(flagged.code).toBe(0);
    expect(flagged.out).toContain("flagged: src/a.ts");
    const teardown = readFileSync(join(r.D, "actions.jsonl"), "utf8")
      .split("\n")
      .map((line) => (line ? JSON.parse(line) : null))
      .find((e) => e && e.action === "teardown" && e.target.endsWith("/7-mimo"));
    expect(teardown!.detail).toContain("flagged: src/a.ts");
    expect(flagged.out.split("flagged folder:").length - 1).toBe(1);
    // control: content branch 7 commits never flags
    const r2 = restoredR();
    writeFileSync(join(r2.repo, ".worktrees/7-mimo/src/a.ts"), "export const a = 2;\n");
    const clean = aftercare(r2, WORDS);
    expect(clean.code).toBe(0);
    expect(clean.out).toContain(".worktrees/7-mimo: removed");
    expect(clean.out).not.toContain("flagged");
  }, 120_000);

  test("--json prints one object with the summary shape", () => {
    const r = restoredR();
    const result = aftercare(r, ["--json", ...WORDS]);
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.out);
    expect(typeof parsed.run).toBe("string");
    expect(parsed.dry_run).toBe(false);
    expect(parsed.outcome).toBe("done");
    expect(Array.isArray(parsed.steps)).toBe(true);
    expect(parsed.folders.length).toBe(4);
    for (const folder of parsed.folders) {
      expect(typeof folder.path).toBe("string");
      expect(Array.isArray(folder.saves)).toBe(true);
      expect(typeof folder.result).toBe("string");
      expect(typeof folder.flagged).toBe("boolean");
    }
    expect(parsed.next).toBeNull();
    // control: the dry run's record says so
    const r2 = restoredR();
    const dry = aftercare(r2, ["--dry-run", "--json", ...WORDS]);
    expect(dry.code).toBe(0);
    expect(JSON.parse(dry.out).dry_run).toBe(true);
  }, 120_000);

  test("a pid file naming a live process no record names: exit 0, the process left alone, the folder gone", () => {
    const r = restoredR();
    const pid = backgroundSleep();
    try {
      writeFileSync(join(r.D, "render/preview.pid"), `${pid}\n`);
      const result = aftercare(r, WORDS);
      expect(result.code).toBe(0);
      expect(result.out).toContain("step preview: noted");
      expect(result.out).toContain(`live pid ${pid}`);
      expect(processIsLive(pid)).toBe(true);
      expect(existsSync(join(r.repo, ".worktrees/7"))).toBe(false);
    } finally {
      killQuiet(pid);
    }
    // control: with no pid file at all there is no preview step
    const r2 = restoredR();
    expect(aftercare(r2, WORDS).out).not.toContain("step preview:");
  }, 120_000);

  test("a registry record matching nothing running: exit 0, the reused pid never signalled", () => {
    const r = restoredR();
    const pid = backgroundSleep();
    try {
      mkdirSync(join(r.T, "state/launches"), { recursive: true });
      writeFileSync(
        join(r.T, "state/launches", String(pid)),
        `${join(r.repo, ".worktrees/7")}\npreview server\nstart 0\nboot \n`,
      );
      writeFileSync(join(r.D, "render/preview.pid"), `${pid}\n`);
      const result = aftercare(r, WORDS);
      expect(result.code).toBe(0);
      expect(result.out).toContain("step preview: noted");
      expect(result.out).toContain("reused pid");
      expect(processIsLive(pid)).toBe(true);
      expect(existsSync(join(r.repo, ".worktrees/7"))).toBe(false);
    } finally {
      killQuiet(pid);
    }
  }, 120_000);

  test("run again after a done run: exit 0, nothing changed, every step already done", () => {
    const r = restoredR();
    expect(aftercare(r, WORDS).code).toBe(0);
    const before = snapshot(r);
    const again = aftercare(r, WORDS);
    expect(again.code).toBe(0);
    expect(snapshot(r)).toBe(before);
    for (const step of ["style-sort", "run-log", "ticket-comment", "stage", "release"])
      expect(again.out).toContain(`step ${step}: already done`);
    for (const folder of ["7", "7-sol", "7-mimo", "7-oracle-sol"])
      expect(again.out).toContain(`.worktrees/${folder}: already removed`);
    // control: the JSON record keeps the short status
    const againJson = aftercare(r, ["--json", ...WORDS]);
    expect(againJson.code).toBe(0);
    const statuses = JSON.parse(againJson.out).steps.map((s: { status: string }) => s.status);
    expect(statuses).toContain("already");
    expect(statuses).not.toContain("already done");
  }, 120_000);

  test("non-UTF8 saves are byte-identical: the untracked archive extracts and the diff matches git's own bytes", () => {
    const r = restoredR();
    const blob = randomBytes(1024);
    blob[0] = 0xff;
    blob[1] = 0xfe;
    writeFileSync(join(r.repo, ".worktrees/7-sol/blob.bin"), blob);
    const latin = Buffer.concat([
      Buffer.from("export const a = '", "utf8"),
      new Uint8Array([0xe9, 0xe8]),
      Buffer.from("';\n", "utf8"),
    ]);
    writeFileSync(join(r.repo, ".worktrees/7-mimo/src/a.ts"), latin);
    const wantDiff = Buffer.from(
      spawnSync("git", ["-C", join(r.repo, ".worktrees/7-mimo"), "diff", "--binary"])
        .stdout as Uint8Array,
    );
    const result = aftercare(r, WORDS);
    expect(result.code).toBe(0);
    // the archive lists the binary beside the text files and extracts it exactly
    const listed = sh("tar", ["-tf", join(r.D, "stray/7-sol.untracked.tar")]);
    for (const name of ["blob.bin", "one.txt", "two.txt", "three.txt"])
      expect(listed).toContain(name);
    const out = join(r.T, "extracted");
    mkdirSync(out);
    sh("tar", ["-xf", join(r.D, "stray/7-sol.untracked.tar"), "-C", out]);
    expect(readFileSync(join(out, "blob.bin"))).toEqual(blob);
    // the diff part holds git's own bytes, U+FFFD nowhere
    expect(readFileSync(join(r.D, "stray/7-mimo.diff"))).toEqual(wantDiff);
    // control: the saved folders are gone all the same
    expect(existsSync(join(r.repo, ".worktrees/7-sol"))).toBe(false);
    expect(existsSync(join(r.repo, ".worktrees/7-mimo"))).toBe(false);
  }, 120_000);

  test("a live preview is stopped: exit 0, its group dead, the synthesis folder gone", () => {
    const r = restoredR();
    const started = hostSh(r, [
      "run",
      "preview server",
      join(r.repo, ".worktrees/7"),
      "--under",
      r.D,
      "--role",
      "coachman",
      "--run",
      r.D,
      "--pidfile",
      join(r.D, "render/preview.pid"),
      "--out",
      join(r.T, "p.out"),
      "--err",
      join(r.T, "p.err"),
      "--",
      "sleep",
      "300",
    ]);
    expect(started.code).toBe(0);
    const pid = Number(
      (readFileSync(join(r.D, "render/preview.pid"), "utf8").trim().split("\n")[0] ?? "").trim(),
    );
    expect(processIsLive(pid)).toBe(true);
    try {
      const result = aftercare(r, WORDS);
      expect(result.code).toBe(0);
      expect(result.out).toContain("step preview: stopped");
      expect(processIsLive(pid)).toBe(false);
      expect(existsSync(join(r.repo, ".worktrees/7"))).toBe(false);
    } finally {
      killQuiet(pid);
    }
  }, 120_000);

  test("a record naming another folder is never signalled: exit 0, the process left alone", () => {
    const r = restoredR();
    const pid = backgroundSleep();
    try {
      const start = processes().get(pid)?.start ?? "";
      expect(start).not.toBe("");
      mkdirSync(join(r.T, "state/launches"), { recursive: true });
      writeFileSync(
        join(r.T, "state/launches", String(pid)),
        `${r.T}\npreview server\nstart ${start}\nboot ${bootId()}\n`,
      );
      writeFileSync(join(r.D, "render/preview.pid"), `${pid}\n`);
      const result = aftercare(r, WORDS);
      expect(result.code).toBe(0);
      expect(result.out).toContain("step preview: noted");
      expect(result.out).toContain("not this run's synthesis folder");
      expect(processIsLive(pid)).toBe(true);
      // control: with the start check passing, only the folder check stands between — and
      // the synthesis folder still went, since nothing runs in it
      expect(existsSync(join(r.repo, ".worktrees/7"))).toBe(false);
    } finally {
      killQuiet(pid);
    }
  }, 120_000);

  test("on a fixture copy the root launches stop before the close", () => {
    const r = restoredR();
    writeFileSync(join(r.repo, ".postmaster", "fixture"), FIXTURE_MARKER);
    sh("git", ["config", "--local", "postmaster.fixture", "7"], r.repo);
    const started = hostSh(r, [
      "run",
      "watch · repo",
      r.repo,
      "--out",
      join(r.T, "w.out"),
      "--err",
      join(r.T, "w.err"),
      "--pidfile",
      join(r.T, "watch.pid"),
      "--",
      "sleep",
      "300",
    ]);
    expect(started.code).toBe(0);
    const pid = Number(
      (readFileSync(join(r.T, "watch.pid"), "utf8").trim().split("\n")[0] ?? "").trim(),
    );
    expect(processIsLive(pid)).toBe(true);
    try {
      const dry = aftercare(r, ["--dry-run", ...WORDS]);
      expect(dry.code).toBe(0);
      expect(dry.out).toContain("step stop-run: would");
      expect(processIsLive(pid)).toBe(true);
      const result = aftercare(r, WORDS);
      expect(result.code).toBe(0);
      expect(result.out).toContain("step stop-run: done");
      expect(result.out).toContain("step close-run: done");
      expect(processIsLive(pid)).toBe(false);
      expect(existsSync(join(r.repo, ".worktrees/7"))).toBe(false);
    } finally {
      killQuiet(pid);
    }
  }, 120_000);

  test("control: without the fixture mark the root launches are left alone", () => {
    const r = restoredR();
    const started = hostSh(r, [
      "run",
      "watch · repo",
      r.repo,
      "--out",
      join(r.T, "w.out"),
      "--err",
      join(r.T, "w.err"),
      "--pidfile",
      join(r.T, "watch.pid"),
      "--",
      "sleep",
      "300",
    ]);
    expect(started.code).toBe(0);
    const pid = Number(
      (readFileSync(join(r.T, "watch.pid"), "utf8").trim().split("\n")[0] ?? "").trim(),
    );
    expect(processIsLive(pid)).toBe(true);
    try {
      const result = aftercare(r, WORDS);
      expect(result.code).toBe(0);
      expect(result.out).not.toContain("stop-run");
      expect(processIsLive(pid)).toBe(true);
      expect(existsSync(join(r.repo, ".worktrees/7"))).toBe(false);
    } finally {
      killQuiet(pid);
    }
  }, 120_000);

  test("a staged rename never flags; the same rename with new content does", () => {
    const r = restoredR();
    const mimo = join(r.repo, ".worktrees/7-mimo");
    writeFileSync(join(mimo, "Updated.md"), "export const a = 2;\n");
    sh("git", ["add", "Updated.md"], mimo);
    sh("git", ["commit", "-qm", "a note"], mimo);
    sh("git", ["mv", "Updated.md", "Zed.md"], mimo);
    const result = aftercare(r, WORDS);
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("flagged");
    // control: new content under the new name still flags with the new path
    const r2 = restoredR();
    const mimo2 = join(r2.repo, ".worktrees/7-mimo");
    writeFileSync(join(mimo2, "Updated.md"), "export const a = 2;\n");
    sh("git", ["add", "Updated.md"], mimo2);
    sh("git", ["commit", "-qm", "a note"], mimo2);
    sh("git", ["mv", "Updated.md", "Zed.md"], mimo2);
    writeFileSync(join(mimo2, "Zed.md"), "export const a = 9;\n");
    const flagged = aftercare(r2, WORDS);
    expect(flagged.code).toBe(0);
    expect(flagged.out).toContain("flagged: Zed.md");
  }, 180_000);

  test("a torn lock never refuses the dry run; a live holder still does", () => {
    const r = restoredR();
    writeFileSync(join(r.D, ".aftercare.lock"), "");
    const before = snapshot(r);
    const dry = aftercare(r, ["--dry-run", ...WORDS]);
    expect(dry.code).toBe(0);
    expect(dry.out).not.toContain("already running");
    expect(snapshot(r)).toBe(before);
    // control: a lock naming a live process refuses, in the same mode
    const r2 = restoredR();
    const pid = backgroundSleep();
    try {
      writeFileSync(join(r2.D, ".aftercare.lock"), `${pid}\n`);
      const refused = aftercare(r2, ["--dry-run", ...WORDS]);
      expect(refused.code).toBe(1);
      expect(refused.out).toContain(`already running on this run (pid ${pid})`);
    } finally {
      killQuiet(pid);
    }
  }, 120_000);

  test("run again with no words after a done run: exit 0 and nothing changed", () => {
    const r = restoredR();
    expect(aftercare(r, WORDS).code).toBe(0);
    const before = snapshot(r);
    const again = aftercare(r, []);
    expect(again.code).toBe(0);
    expect(again.out).toContain("outcome: done");
    expect(again.out).toContain("step run-log: already done");
    expect(snapshot(r)).toBe(before);
    // control: the same call on an open run still faults for its words
    const r2 = restoredR();
    const open = aftercare(r2, []);
    expect(open.code).toBe(1);
    expect(open.out).toContain("stop at closing words");
  }, 120_000);

  test("a posted comment whose log line never landed is reconciled, never reposted", () => {
    const r = restoredR();
    expect(aftercare(r, WORDS).code).toBe(0);
    const kept = readFileSync(join(r.D, "actions.jsonl"), "utf8")
      .split("\n")
      .filter((line) => line === "" || JSON.parse(line).action !== "ticket-comment");
    writeFileSync(join(r.D, "actions.jsonl"), kept.join("\n"));
    const again = aftercare(r, WORDS);
    expect(again.code).toBe(0);
    expect(again.out).toContain("reconciled");
    const logged = readFileSync(join(r.repo, ".git/postmaster/tickets/7.json"), "utf8");
    expect(logged.split("postmaster: closing words").length - 1).toBe(1);
    // control: the marker path still shows already done and posts nothing either
    const r2 = restoredR();
    expect(aftercare(r2, WORDS).code).toBe(0);
    const marked = aftercare(r2, WORDS);
    expect(marked.out).toContain("step ticket-comment: already done");
  }, 120_000);

  test("a ticket-dash symlink to a file, and a dangling one, are named left like a dir link", () => {
    const r = restoredR();
    const fileLink = join(r.repo, ".worktrees/7-filelink");
    const dangling = join(r.repo, ".worktrees/7-dangling");
    sh("ln", ["-s", join(r.repo, "README.md"), fileLink]);
    sh("ln", ["-s", join(r.T, "no-such-file"), dangling]);
    const result = aftercare(r, WORDS);
    expect(result.code).toBe(3);
    for (const link of [fileLink, dangling]) {
      expect(result.out).toContain(link);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
    }
    expect(result.out).toContain("symbolic link");
    // control: the run's other folders still went
    expect(existsSync(join(r.repo, ".worktrees/7"))).toBe(false);
  }, 120_000);

  test("an unreadable .worktrees stops exit 1 with the step and the next step; readable again it closes", () => {
    const r = restoredR();
    chmodSync(join(r.repo, ".worktrees"), 0o000);
    try {
      const stopped = aftercare(r, WORDS);
      expect(stopped.code).toBe(1);
      expect(stopped.out).toContain("stop at folder");
      expect(stopped.out).toContain("aftercare: next:");
      expect(changedFolders(r).length).toBe(6);
      expect(JSON.parse(readFileSync(join(r.D, "manifest.json"), "utf8")).stage).toBe("shipped");
    } finally {
      chmodSync(join(r.repo, ".worktrees"), 0o755);
    }
    // control: the same run closes once the folder lists again
    expect(aftercare(r, WORDS).code).toBe(0);
  }, 120_000);

  test("a tracker kind that cannot be told stops the dry run as it stops the real run", () => {
    const r = restoredR();
    sh("rm", ["-rf", join(r.repo, ".git/postmaster")]);
    const env = { POSTMASTER_CONFIG: join(r.T, "no-config.toml") };
    const dry = aftercare(r, ["--dry-run", ...WORDS], env);
    expect(dry.code).toBe(3);
    expect(dry.out).toContain("step ticket-state: failed");
    expect(dry.out).toContain("step ticket-comment: waiting");
    expect(dry.out).toContain("step release: waiting");
    // control: the real run stops at the same step, its folders already gone
    const real = aftercare(r, WORDS, env);
    expect(real.code).toBe(3);
    expect(real.out).toContain("step ticket-state: failed");
    expect(real.out).toContain("step release: waiting");
    expect(existsSync(join(r.repo, ".worktrees/7"))).toBe(false);
    expect(JSON.parse(readFileSync(join(r.D, "manifest.json"), "utf8")).stage).toBe("shipped");
  }, 180_000);

  test("an unknown ticket state fails its step and leaves the later steps waiting", () => {
    const r = restoredR();
    const ticketPath = join(r.repo, ".git/postmaster/tickets/7.json");
    const ticket = JSON.parse(readFileSync(ticketPath, "utf8"));
    ticket.state = "weird";
    writeFileSync(ticketPath, `${JSON.stringify(ticket)}\n`);
    const result = aftercare(r, WORDS);
    expect(result.code).toBe(3);
    expect(result.out).toContain("step ticket-state: failed");
    expect(result.out).toContain("which this command does not move");
    for (const step of ["ticket-comment", "stage", "release"])
      expect(result.out).toContain(`step ${step}: waiting`);
    // control: the run-log line before it still went, the folders too
    expect(result.out).toContain("step run-log: done");
    expect(existsSync(join(r.repo, ".worktrees/7"))).toBe(false);
  }, 120_000);

  test("a folder with dirty submodule contents is left and named; a clean one goes", () => {
    const sub = (r: Fixture): string => {
      const mimo = join(r.repo, ".worktrees/7-mimo");
      const src = join(r.T, "subsrc");
      mkdirSync(src);
      sh("git", ["init", "-q", "-b", "main", src]);
      sh("git", ["config", "user.name", "aftercare-test"], src);
      sh("git", ["config", "user.email", "test@example.invalid"], src);
      writeFileSync(join(src, "s.txt"), "s\n");
      sh("git", ["add", "s.txt"], src);
      sh("git", ["commit", "-qm", "sub"], src);
      sh("git", ["-c", "protocol.file.allow=always", "submodule", "add", src, "sm"], mimo);
      sh("git", ["commit", "-qm", "add submodule"], mimo);
      return mimo;
    };
    const r = restoredR();
    const mimo = sub(r);
    writeFileSync(join(mimo, "sm/untracked.txt"), "dirty\n");
    const result = aftercare(r, WORDS);
    expect(result.code).toBe(3);
    expect(result.out).toContain(".worktrees/7-mimo: left");
    expect(result.out).toContain("submodule sm has local changes");
    expect(existsSync(join(mimo, "sm/untracked.txt"))).toBe(true);
    // control: the run's other folders still went
    expect(existsSync(join(r.repo, ".worktrees/7"))).toBe(false);
    // control: a clean submodule never holds its folder
    const r2 = restoredR();
    sub(r2);
    const clean = aftercare(r2, WORDS);
    expect(clean.code).toBe(0);
    expect(existsSync(join(r2.repo, ".worktrees/7-mimo"))).toBe(false);
  }, 180_000);

  test("a folder with an unbranched merge is left and named; a linear commit is saved", () => {
    const r = restoredR();
    const scratch = join(r.repo, ".worktrees/7-mergetest");
    sh("git", ["worktree", "add", "-q", "--detach", scratch, r.BASE], r.repo);
    sh("git", ["checkout", "-q", "-b", "mg1"], scratch);
    writeFileSync(join(scratch, "mg1.txt"), "a\n");
    sh("git", ["add", "mg1.txt"], scratch);
    sh("git", ["commit", "-qm", "mg1"], scratch);
    sh("git", ["checkout", "-q", "-b", "mg2", r.BASE], scratch);
    writeFileSync(join(scratch, "mg2.txt"), "b\n");
    sh("git", ["add", "mg2.txt"], scratch);
    sh("git", ["commit", "-qm", "mg2"], scratch);
    sh("git", ["checkout", "-q", "--detach", r.BASE], scratch);
    sh("git", ["merge", "-q", "--no-ff", "mg1", "mg2", "-m", "octomerge"], scratch);
    const result = aftercare(r, WORDS);
    expect(result.code).toBe(3);
    expect(result.out).toContain(".worktrees/7-mergetest: left");
    expect(result.out).toContain("unbranched merge");
    expect(existsSync(scratch)).toBe(true);
    // control: the run's other folders still went
    expect(existsSync(join(r.repo, ".worktrees/7"))).toBe(false);
    // control: a linear unbranched commit is saved as a patch and the folder goes
    const r2 = restoredR();
    const scratch2 = join(r2.repo, ".worktrees/7-lineartest");
    sh("git", ["worktree", "add", "-q", "--detach", scratch2, r2.BASE], r2.repo);
    writeFileSync(join(scratch2, "note.txt"), "note\n");
    sh("git", ["add", "note.txt"], scratch2);
    sh("git", ["commit", "-qm", "linear"], scratch2);
    const linear = aftercare(r2, WORDS);
    expect(linear.code).toBe(0);
    expect(existsSync(join(r2.D, "stray/7-lineartest.commits.patch"))).toBe(true);
    expect(existsSync(scratch2)).toBe(false);
  }, 180_000);

  test("a locked worktree: the dry run predicts the refusal, the real run meets it, unlocked it goes", () => {
    const r = restoredR();
    const mimo = join(r.repo, ".worktrees/7-mimo");
    sh("git", ["-C", r.repo, "worktree", "lock", "--reason", "held for inspection", mimo]);
    const dry = aftercare(r, ["--dry-run", ...WORDS]);
    expect(dry.code).toBe(3);
    expect(dry.out).toContain(".worktrees/7-mimo: left");
    expect(dry.out).toContain("locked: held for inspection");
    const real = aftercare(r, WORDS);
    expect(real.code).toBe(3);
    expect(real.out).toContain(".worktrees/7-mimo: left");
    expect(existsSync(mimo)).toBe(true);
    // control: unlocked, the rerun carries on and closes
    sh("git", ["-C", r.repo, "worktree", "unlock", mimo]);
    expect(aftercare(r, WORDS).code).toBe(0);
    expect(existsSync(mimo)).toBe(false);
  }, 180_000);

  test("a longer comment on the ticket never reconciles a shorter closing comment", () => {
    const r = restoredR();
    sh(
      join(HERE, "run"),
      ["local", r.repo, "comment", "7", "postmaster", "closing words extended"],
      r.T,
    );
    const result = aftercare(r, WORDS);
    expect(result.code).toBe(0);
    expect(result.out).not.toContain("reconciled");
    const meta = JSON.parse(readFileSync(join(r.repo, ".git/postmaster/tickets/7.json"), "utf8"));
    expect(meta.log.some((e: string) => e.endsWith("postmaster: closing words extended"))).toBe(
      true,
    );
    expect(meta.log.filter((e: string) => e.endsWith("postmaster: closing words")).length).toBe(1);
    // control: an exact duplicate still reconciles (the posted-comment test above)
  }, 120_000);

  test("a live preview never holds the dry run; another live launch still does", () => {
    const r = restoredR();
    const started = hostSh(r, [
      "run",
      "preview server",
      join(r.repo, ".worktrees/7"),
      "--under",
      r.D,
      "--role",
      "coachman",
      "--run",
      r.D,
      "--pidfile",
      join(r.D, "render/preview.pid"),
      "--out",
      join(r.T, "p.out"),
      "--err",
      join(r.T, "p.err"),
      "--",
      "sleep",
      "300",
    ]);
    expect(started.code).toBe(0);
    const pid = Number(
      (readFileSync(join(r.D, "render/preview.pid"), "utf8").trim().split("\n")[0] ?? "").trim(),
    );
    try {
      const dry = aftercare(r, ["--dry-run", ...WORDS]);
      expect(dry.code).toBe(0);
      expect(dry.out).toContain("would stop the preview process group");
      expect(dry.out).toContain(".worktrees/7: would remove");
      // control: the real run then stops it and closes, as the stop test shows
      expect(aftercare(r, WORDS).code).toBe(0);
    } finally {
      killQuiet(pid);
    }
    // control: a live launch that is not the preview still holds its folder in a dry run
    const r2 = restoredR();
    const other = hostSh(r2, [
      "run",
      "probe",
      join(r2.repo, ".worktrees/7"),
      "--out",
      join(r2.T, "o.out"),
      "--err",
      join(r2.T, "o.err"),
      "--",
      "sleep",
      "300",
    ]);
    expect(other.code).toBe(0);
    try {
      const dry = aftercare(r2, ["--dry-run", ...WORDS]);
      expect(dry.code).toBe(3);
      expect(dry.out).toContain(".worktrees/7: left");
      expect(dry.out).toContain("probe");
    } finally {
      hostSh(r2, ["stop", join(r2.repo, ".worktrees/7")]);
    }
  }, 180_000);

  test("inherited git location overrides never redirect a scan: the dirty folder is saved", () => {
    const r = restoredR();
    const seven = join(r.repo, ".worktrees/7");
    const gitdir = sh("git", ["-C", seven, "rev-parse", "--absolute-git-dir"], r.T);
    writeFileSync(join(r.repo, ".worktrees/7-mimo/src/a.ts"), "export const a = 9;\n");
    const result = aftercare(r, WORDS, { GIT_DIR: gitdir, GIT_WORK_TREE: seven });
    expect(result.code).toBe(0);
    // the save holds 7-mimo's own uncommitted work, not the clean checkout's nothing
    const diff = readFileSync(join(r.D, "stray/7-mimo.diff"), "utf8");
    expect(diff).toContain("export const a = 9;");
    expect(existsSync(join(r.repo, ".worktrees/7-mimo"))).toBe(false);
    // control: the same run without overrides saves the same part
    const r2 = restoredR();
    writeFileSync(join(r2.repo, ".worktrees/7-mimo/src/a.ts"), "export const a = 9;\n");
    expect(aftercare(r2, WORDS).code).toBe(0);
    expect(readFileSync(join(r2.D, "stray/7-mimo.diff"), "utf8")).toContain("export const a = 9;");
  }, 120_000);

  test("a locked pin: the dry run predicts the stop, the real run meets it, unlocked it releases", () => {
    const r = restoredR();
    const record = JSON.parse(readFileSync(join(r.D, "run.json"), "utf8"));
    const pin = record.postmaster.checkout as string;
    sh("git", ["worktree", "lock", pin], join(r.T, "pinrepo"));
    const dry = aftercare(r, ["--dry-run", ...WORDS]);
    expect(dry.code).toBe(3);
    expect(dry.out).toContain("step release: failed");
    expect(dry.out).toContain("is locked");
    const real = aftercare(r, WORDS);
    expect(real.code).toBe(3);
    expect(real.out).toContain("stop at release");
    expect(real.out).toContain("unlock the pin, then run again");
    expect(existsSync(pin)).toBe(true);
    // control: unlocked, the rerun releases the pin and closes
    sh("git", ["worktree", "unlock", pin], join(r.T, "pinrepo"));
    expect(aftercare(r, WORDS).code).toBe(0);
    expect(existsSync(pin)).toBe(false);
  }, 180_000);

  test("an unlanded edit under a non-ASCII name flags with its true spelling", () => {
    const r = restoredR();
    const mimo = join(r.repo, ".worktrees/7-mimo");
    const name = "café.txt";
    writeFileSync(join(mimo, name), "export const a = 2;\n");
    sh("git", ["add", name], mimo);
    sh("git", ["commit", "-qm", "note with a name"], mimo);
    writeFileSync(join(mimo, name), "export const a = 9;\n");
    const result = aftercare(r, WORDS);
    expect(result.code).toBe(0);
    expect(result.out).toContain(`flagged: ${name}`);
    // control: the quoted octal spelling never appears as a path
    expect(result.out).not.toContain("\\303\\251");
  }, 120_000);

  test("tracker invocations: plane takes no repo, local and github keep it", () => {
    expect(trackerArgv("plane", "/repo", "read", "PROJ-1")).toEqual([
      join(HERE, "run"),
      "plane",
      "read",
      "PROJ-1",
    ]);
    expect(trackerArgv("local", "/repo", "read", "7")).toEqual([
      join(HERE, "run"),
      "local",
      "/repo",
      "read",
      "7",
    ]);
    expect(trackerArgv("github", "/repo", "comment", "7")).toEqual([
      join(HERE, "run"),
      "github",
      "/repo",
      "comment",
      "7",
    ]);
  });

  test("a ticket-dash symlink is left in place with a note naming why", () => {
    const r = restoredR();
    const link = join(r.repo, ".worktrees/7-link");
    sh("ln", ["-s", join(r.repo, ".worktrees/70-x"), link]);
    const result = aftercare(r, WORDS);
    expect(result.code).toBe(3);
    expect(result.out).toContain(".worktrees/7-link");
    expect(result.out).toContain("symbolic link");
    // Aftercare logs folder paths physical, so the want is too: under a
    // symlinked TMPDIR the as-given spelling never equals the logged one.
    // The link itself is not resolved, only the directory holding it.
    const want = join(realpathSync(dirname(link)), basename(link));
    const noted = readFileSync(join(r.D, "actions.jsonl"), "utf8")
      .split("\n")
      .map((line) => (line ? JSON.parse(line) : null))
      .some(
        (e) => e && e.action === "note" && e.target === want && e.detail.includes("symbolic link"),
      );
    expect(noted).toBe(true);
    expect(existsSync(link)).toBe(true);
    // control: the run's other folders still went
    expect(existsSync(join(r.repo, ".worktrees/7"))).toBe(false);
  }, 120_000);
});
