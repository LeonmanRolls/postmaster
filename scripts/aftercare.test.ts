// Tests beside scripts/aftercare.ts: a landed run record built fresh in a temp folder, the
// command run against it the way the checks run it, and a control beside every count — a
// refusal that must change nothing, a foreign worktree that must stay, a flag that must not
// fall. Nothing here touches a live Herdr or tmux: herdr and tmux are stubs on PATH and the
// host state lives under the temp folder.
import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";
import { scriptsDir } from "./lib/paths.ts";

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

  const local = join(HERE, "local.sh");
  sh("bash", [local, repo, "store", "init"], T);
  for (let n = 1; n <= 7; n++) {
    const body = join(T, "body.md");
    writeFileSync(body, `body of ticket ${n}\n`);
    const got = sh("bash", [local, repo, "create", `ticket ${n}`, body], T).trim();
    if (got !== String(n)) throw new Error(`ticket number ${got}, wanted ${n}`);
  }
  sh("bash", [local, repo, "state", "7", "done"], T);

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

function aftercare(r: Fixture, args: string[]): { code: number; out: string } {
  const result = run(
    "bun",
    ["--no-env-file", "--config=/dev/null", join(HERE, "aftercare.ts"), r.D, ...args],
    {
      env: {
        PATH: `${join(r.T, "bin")}:${process.env.PATH ?? ""}`,
        POSTMASTER_HOST_STATE: join(r.T, "state"),
        POSTMASTER_HOST_FIXTURE: r.T,
        POSTMASTER_HOST_CLOSE_WAIT: "1",
        POSTMASTER_TOOL_PINS: join(r.T, "pins"),
      },
    },
  );
  return { code: result.code, out: `${result.out}${result.err}` };
}

const WORDS = ["--comment", "closing words", "--run-log", "closing line"];

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
    const r = makeR();
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
    const r = makeR();
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
    const r = makeR();
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
    const r2 = makeR();
    const before2 = snapshot(r2);
    const noWords = aftercare(r2, ["--dry-run"]);
    expect(noWords.code).toBe(1);
    expect(noWords.out).toContain("stop at closing words");
    expect(snapshot(r2)).toBe(before2);
  }, 120_000);

  test("a folder whose work no branch holds is flagged; the same file on a branch's content is not", () => {
    const r = makeR();
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
    const r2 = makeR();
    writeFileSync(join(r2.repo, ".worktrees/7-mimo/src/a.ts"), "export const a = 2;\n");
    const clean = aftercare(r2, WORDS);
    expect(clean.code).toBe(0);
    expect(clean.out).toContain(".worktrees/7-mimo: removed");
    expect(clean.out).not.toContain("flagged");
  }, 120_000);

  test("--json prints one object with the summary shape", () => {
    const r = makeR();
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
    const r2 = makeR();
    const dry = aftercare(r2, ["--dry-run", "--json", ...WORDS]);
    expect(dry.code).toBe(0);
    expect(JSON.parse(dry.out).dry_run).toBe(true);
  }, 120_000);

  test("run again after a done run: exit 0, nothing changed, every step already done", () => {
    const r = makeR();
    expect(aftercare(r, WORDS).code).toBe(0);
    const before = snapshot(r);
    const again = aftercare(r, WORDS);
    expect(again.code).toBe(0);
    expect(snapshot(r)).toBe(before);
    for (const step of ["style-sort", "run-log", "ticket-comment", "stage", "release"])
      expect(again.out).toContain(`step ${step}: already`);
    for (const folder of ["7", "7-sol", "7-mimo", "7-oracle-sol"])
      expect(again.out).toContain(`.worktrees/${folder}: already removed`);
  }, 120_000);
});
