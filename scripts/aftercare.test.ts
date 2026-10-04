import { afterAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";
import { toolRoot } from "./lib/paths.ts";

const TOOL = toolRoot(import.meta);
const SCRIPT = join(TOOL, "scripts/aftercare.ts");
const VERIFY = join(TOOL, ".postmaster/verify");
const WORDS = ["--comment", "closing words", "--run-log", "closing line"];
const roots: string[] = [];

type Fixture = {
  root: string;
  repo: string;
  dispatch: string;
  bin: string;
  pin: string;
  pinCommit: string;
  base: string;
};
type Result = { code: number; out: string; err: string };

function git(repo: string, ...args: string[]): string {
  const result = run("git", ["-C", repo, ...args]);
  if (result.code !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.err || result.out}`);
  return result.out.trim();
}

function commit(repo: string, message: string, files: string[]): void {
  git(repo, "add", ...files);
  git(repo, "commit", "-m", message);
}

function writeTicket(repo: string, number: number, state: string): void {
  const store = join(repo, ".git/postmaster/tickets");
  mkdirSync(store, { recursive: true });
  writeFileSync(join(store, `${number}.md`), `# Ticket ${number}\n`);
  writeFileSync(
    join(store, `${number}.json`),
    `${JSON.stringify({ title: `Ticket ${number}`, state, labels: [], created: "2026-10-03T00:00:00Z", log: [] }, null, 2)}\n`,
  );
}

function action(action: string, target: string, detail = ""): string {
  return JSON.stringify({
    ts: "2026-10-03T10:00:00Z",
    project: "repo",
    run: "7",
    actor: "postmaster",
    action,
    target,
    detail,
  });
}

function fixture(
  options: { ticketState?: string; finding?: boolean; extraStyle?: boolean } = {},
): Fixture {
  const root = mkdtempSync(join(tmpdir(), "postmaster-aftercare-"));
  roots.push(root);
  const repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "brindlewick");
  git(repo, "config", "user.email", "332054101+brindlewick@users.noreply.github.com");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, ".gitignore"), ".worktrees/\n.postmaster/\nnode_modules/\n");
  writeFileSync(join(repo, "src/a.ts"), "export const a = 0;\n");
  commit(repo, "base", [".gitignore", "src/a.ts"]);
  const base = git(repo, "rev-parse", "HEAD");

  git(repo, "switch", "-q", "-c", "7");
  mkdirSync(join(repo, "test"), { recursive: true });
  writeFileSync(join(repo, "test/oracle-7.test.ts"), "oracle v1\n");
  commit(repo, "oracle", ["test/oracle-7.test.ts"]);
  writeFileSync(join(repo, "test/oracle-7.test.ts"), "oracle v2\n");
  writeFileSync(join(repo, "src/a.ts"), "export const a = 2;\n");
  commit(repo, "synthesis", ["test/oracle-7.test.ts", "src/a.ts"]);
  git(repo, "switch", "-q", "main");
  git(repo, "merge", "--no-ff", "-q", "7", "-m", "merge 7");
  git(repo, "branch", "70-x", "main");
  mkdirSync(join(repo, ".worktrees"), { recursive: true });
  writeTicket(repo, 7, options.ticketState ?? "done");
  for (let number = 1; number < 7; number++) writeTicket(repo, number, "todo");

  const sol = join(repo, ".worktrees/7-sol");
  git(repo, "worktree", "add", "-q", "-b", "wb/7-sol", sol, base);
  writeFileSync(join(sol, "src/sol.ts"), "export const sol = true;\n");
  commit(sol, "sol lane", ["src/sol.ts"]);
  mkdirSync(join(sol, "scripts/.host-self-test-abc"), { recursive: true });
  for (let i = 1; i <= 3; i++)
    writeFileSync(join(sol, `scripts/.host-self-test-abc/file-${i}.txt`), `self test ${i}\n`);

  const mimo = join(repo, ".worktrees/7-mimo");
  git(repo, "worktree", "add", "-q", "-b", "wb/7-mimo", mimo, base);
  writeFileSync(join(mimo, "src/mimo.ts"), "export const mimo = true;\n");
  commit(mimo, "mimo lane", ["src/mimo.ts"]);
  mkdirSync(join(mimo, "node_modules/p"), { recursive: true });
  writeFileSync(join(mimo, "node_modules/p/i.js"), "ignored package\n");

  const synthesis = join(repo, ".worktrees/7");
  git(repo, "worktree", "add", "-q", synthesis, "7");
  const oracle = join(repo, ".worktrees/7-oracle-sol");
  git(repo, "worktree", "add", "-q", "--detach", oracle, "wb/7-sol");
  mkdirSync(join(oracle, "test"), { recursive: true });
  writeFileSync(join(oracle, "test/oracle-7.test.ts"), "oracle v1\n");
  git(oracle, "add", "test/oracle-7.test.ts");

  const unrelated = join(repo, ".worktrees/70-x");
  git(repo, "worktree", "add", "-q", unrelated, "70-x");
  const baseWorktree = join(repo, ".worktrees/ticket-7-base");
  git(repo, "worktree", "add", "-q", "--detach", baseWorktree, "main");

  const dispatch = join(repo, ".postmaster/runs/7");
  mkdirSync(join(dispatch, "logs"), { recursive: true });
  mkdirSync(join(repo, ".postmaster/runs"), { recursive: true });
  writeFileSync(
    join(dispatch, "brief.md"),
    `# Run 7\n\n## Dispatch\nsynthesis worktree: ${synthesis}\n`,
  );
  writeFileSync(
    join(dispatch, "manifest.json"),
    `${JSON.stringify({ stage: "shipped", leg: 2, base, lanes: { sol: {}, mimo: {} } }, null, 2)}\n`,
  );

  const pinSource = join(root, "pin-source");
  mkdirSync(pinSource);
  git(pinSource, "init", "-q", "-b", "main");
  git(pinSource, "config", "user.name", "brindlewick");
  git(pinSource, "config", "user.email", "332054101+brindlewick@users.noreply.github.com");
  writeFileSync(join(pinSource, "tool.txt"), "pinned tool\n");
  commit(pinSource, "pin", ["tool.txt"]);
  const pinCommit = git(pinSource, "rev-parse", "HEAD");
  const pinRoot = join(root, "pins");
  mkdirSync(pinRoot);
  const pin = join(pinRoot, pinCommit);
  git(pinSource, "worktree", "add", "-q", "--detach", pin, pinCommit);
  const claims = `${dispatch}\n`;
  writeFileSync(`${pin}.claims`, claims);

  writeFileSync(
    join(dispatch, "run.json"),
    `${JSON.stringify(
      {
        coachman_contract: 2,
        postmaster: { checkout: pin },
        config: { team: { workhorses: ["sol", "mimo"] } },
      },
      null,
      2,
    )}\n`,
  );
  const actions = [
    action("dispatch", "7"),
    action("stage", "bootstrapped"),
    action("stage", "planning"),
    action("stage", "workhorses-running"),
    action("stage", "shipping"),
    action("merge", "7"),
    action("stage", "shipped"),
  ];
  if (options.finding)
    actions.push(action("finding", "src/a.ts:1", "style P3 r1 style mimo, verified by reading"));
  writeFileSync(join(dispatch, "actions.jsonl"), `${actions.join("\n")}\n`);
  writeFileSync(join(repo, ".postmaster/runs/ledger.jsonl"), "");
  writeFileSync(join(dispatch, "run-log.md"), "- 10:00:00Z fixture run\n");
  writeFileSync(join(dispatch, ".leg-1-done"), "");
  writeFileSync(join(dispatch, ".leg-1-exited"), "");
  writeFileSync(join(dispatch, ".leg-2-done"), "");
  writeFileSync(join(dispatch, ".leg-2-exited"), "");
  writeFileSync(join(dispatch, "logs/review-r1.json"), '{"reviewers":[["bug","mimo"]]}\n');
  writeFileSync(
    join(dispatch, "logs/review-r1-bug-mimo-findings.json"),
    '[{"finding":"example"}]\n',
  );

  const bin = join(root, "bin");
  mkdirSync(bin);
  for (const name of ["herdr", "tmux"]) {
    const stub = join(bin, name);
    writeFileSync(stub, "#!/bin/sh\nexit 1\n");
    chmodSync(stub, 0o755);
  }
  return { root, repo, dispatch, bin, pin, pinCommit, base };
}

function envFor(f: Fixture): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    PATH: `${f.bin}:${process.env.PATH ?? ""}`,
    POSTMASTER_HOST: "none",
    POSTMASTER_HOST_STATE: join(f.root, "state"),
    POSTMASTER_HOST_FIXTURE: f.root,
    POSTMASTER_HOST_CLOSE_WAIT: "1",
    POSTMASTER_TOOL_PINS: join(f.root, "pins"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
  };
}

function runAfter(f: Fixture, args: string[], extraEnv: Record<string, string> = {}): Result {
  const result = spawnSync(
    "bun",
    ["--no-env-file", "--config=/dev/null", SCRIPT, f.dispatch, ...args],
    {
      cwd: TOOL,
      env: { ...envFor(f), ...extraEnv },
      encoding: "utf8",
      timeout: 30000,
    },
  );
  return { code: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? "" };
}

function runTool(f: Fixture, name: string, args: string[]): Result {
  const result = spawnSync("bash", [join(TOOL, `scripts/${name}.sh`), ...args], {
    cwd: TOOL,
    env: envFor(f),
    encoding: "utf8",
    timeout: 30000,
  });
  return { code: result.status ?? -1, out: result.stdout ?? "", err: result.stderr ?? "" };
}

function transcript(name: string, command: string, result: Result, extra = ""): void {
  mkdirSync(VERIFY, { recursive: true });
  writeFileSync(
    join(VERIFY, `aftercare-${name}.txt`),
    `${command}\n${result.out}${result.err}exit ${result.code}\n${extra}`,
  );
}

function actionRows(f: Fixture): Record<string, unknown>[] {
  return readFileSync(join(f.dispatch, "actions.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function worktrees(f: Fixture): string[] {
  return git(f.repo, "worktree", "list", "--porcelain")
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice(9));
}

function unchangedState(f: Fixture): string {
  return JSON.stringify({
    worktrees: worktrees(f),
    folders: readdirSync(join(f.repo, ".worktrees")).sort(),
    actions: readFileSync(join(f.dispatch, "actions.jsonl"), "utf8"),
    runLog: readFileSync(join(f.dispatch, "run-log.md"), "utf8"),
    manifest: readFileSync(join(f.dispatch, "manifest.json"), "utf8"),
    ledger: readFileSync(join(f.repo, ".postmaster/runs/ledger.jsonl"), "utf8"),
    ticket: readFileSync(join(f.repo, ".git/postmaster/tickets/7.json"), "utf8"),
    stray: existsSync(join(f.dispatch, "stray")),
    pin: existsSync(f.pin),
    claims: readFileSync(`${f.pin}.claims`, "utf8"),
  });
}

function inspectLaunchesFor(f: Fixture, path: string): string[] {
  const hostModule = join(TOOL, "scripts/host.ts");
  const code = `import { inspectLaunches } from ${JSON.stringify(hostModule)}; process.stdout.write(JSON.stringify(inspectLaunches(${JSON.stringify(path)})));`;
  const result = run("bun", ["--no-env-file", "--config=/dev/null", "-e", code], {
    cwd: TOOL,
    env: envFor(f),
  });
  if (result.code !== 0)
    throw new Error(`inspect host launches failed: ${result.err || result.out}`);
  return JSON.parse(result.out) as string[];
}

function ticket(f: Fixture): Record<string, unknown> {
  return JSON.parse(readFileSync(join(f.repo, ".git/postmaster/tickets/7.json"), "utf8"));
}

function cleanup(f: Fixture): void {
  rmSync(f.root, { recursive: true, force: true });
}

function acceptance(name: string, fn: () => unknown): void {
  test(name, fn, 30000);
}

afterAll(() => {
  for (const root of roots) if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

describe("aftercare acceptance", () => {
  acceptance("C1, C9-C11, C13-C14 and C17: finishes a realistic shipped run once", () => {
    const f = fixture();
    try {
      const result = runAfter(f, WORDS);
      const rows = actionRows(f);
      const checks = [
        `worktrees: ${worktrees(f).join(", ")}\n`,
        `ticket: ${runTool(f, "local", [f.repo, "read", "7"]).out.match(/^state: .*$/mu)?.[0]}\n`,
        `pin exists: ${existsSync(f.pin)}\n`,
      ].join("");
      transcript(
        "C1-C14-C17",
        `bun --no-env-file --config=/dev/null scripts/aftercare.ts ${f.dispatch} ${WORDS.join(" ")}\n`,
        result,
        checks,
      );
      expect(result.code).toBe(0);
      expect(
        worktrees(f)
          .map((path) => path.slice(f.repo.length + 1))
          .sort(),
      ).toEqual(["", ".worktrees/70-x", ".worktrees/ticket-7-base"].sort());
      expect(readdirSync(join(f.repo, ".worktrees")).sort()).toEqual(
        ["70-x", "ticket-7-base"].sort(),
      );
      expect(JSON.parse(readFileSync(join(f.dispatch, "manifest.json"), "utf8")).stage).toBe(
        "done",
      );
      expect(ticket(f).state).toBe("done");
      expect(existsSync(f.pin)).toBe(false);
      expect(existsSync(`${f.pin}.claims`)).toBe(false);
      expect(
        rows.some(
          (item) =>
            item.action === "teardown" &&
            item.target === f.pin &&
            String(item.detail).includes("removed"),
        ),
      ).toBe(true);
      expect(git(f.repo, "branch", "--list", "7").trim()).toBe("7");
      expect(git(f.repo, "branch", "--list", "wb/7-sol").trim()).toBe("wb/7-sol");
      expect(git(f.repo, "branch", "--list", "wb/7-mimo").trim()).toBe("wb/7-mimo");
      expect(
        readFileSync(join(f.dispatch, "run-log.md"), "utf8").split("closing line").length - 1,
      ).toBe(1);
      expect(
        (ticket(f).log as string[]).filter((line) => line.includes("postmaster: closing words"))
          .length,
      ).toBe(1);
      expect(rows.filter((item) => item.action === "ticket-comment").length).toBe(1);
      expect(
        rows.filter((item) => item.action === "teardown" && String(item.detail).includes("7-sol"))
          .length,
      ).toBe(1);
      expect(
        rows.some((item) => item.action === "note" && item.target === "style-sort check"),
      ).toBe(true);
      expect(rows.some((item) => item.action === "note" && item.target === "run-log")).toBe(true);
      const ledger = readFileSync(join(f.repo, ".postmaster/runs/ledger.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(ledger.map((line) => line.action)).toEqual(rows.slice(7).map((line) => line.action));

      const after = readFileSync(join(f.dispatch, "actions.jsonl"), "utf8");
      const again = runAfter(f, ["--json", ...WORDS]);
      const repeated = JSON.parse(again.out);
      expect(again.code).toBe(0);
      expect(readFileSync(join(f.dispatch, "actions.jsonl"), "utf8")).toBe(after);
      expect(
        repeated.steps.every((step: { status: string }) => step.status === "already done"),
      ).toBe(true);
      expect(repeated.folders.map((folder: { result: string }) => folder.result)).toEqual([
        "already gone",
        "already gone",
        "already gone",
        "already gone",
      ]);
      transcript(
        "C14-rerun",
        `bun --no-env-file --config=/dev/null scripts/aftercare.ts ${f.dispatch} --json ${WORDS.join(" ")}\n`,
        again,
      );
    } finally {
      cleanup(f);
    }
  });

  acceptance("C1: moves in-progress to done and leaves cancelled unchanged", () => {
    for (const state of ["in-progress", "cancelled"]) {
      const f = fixture({ ticketState: state });
      try {
        const result = runAfter(f, WORDS);
        const stateRows = actionRows(f).filter((item) => item.action === "ticket-state");
        expect(result.code).toBe(0);
        expect(ticket(f).state).toBe(state === "cancelled" ? "cancelled" : "done");
        expect(stateRows.length).toBe(state === "cancelled" ? 0 : 1);
        if (state === "cancelled") expect(result.out).toContain("cancelled; left so");
        transcript(
          `C1-${state}`,
          `bun --no-env-file --config=/dev/null scripts/aftercare.ts ${f.dispatch} ${WORDS.join(" ")}\n`,
          result,
        );
      } finally {
        cleanup(f);
      }
    }
  });

  acceptance(
    "C2 and C12: refuses before writes when stage, last leg or style sort is not ready",
    () => {
      for (const change of ["shipping", "no-exit", "style-unsorted"]) {
        const f = fixture({ finding: change === "style-unsorted" });
        try {
          const manifest = JSON.parse(readFileSync(join(f.dispatch, "manifest.json"), "utf8"));
          if (change === "shipping") {
            manifest.stage = "shipping";
            writeFileSync(join(f.dispatch, "manifest.json"), `${JSON.stringify(manifest)}\n`);
          }
          if (change === "no-exit") rmSync(join(f.dispatch, ".leg-2-exited"));
          const before = unchangedState(f);
          const result = runAfter(f, WORDS);
          expect(result.code).toBe(2);
          expect(result.out + result.err).toContain("next:");
          expect(result.out + result.err).toMatch(
            change === "shipping"
              ? /stage is 'shipping'/u
              : change === "no-exit"
                ? /no \.leg-2-exited marker/u
                : /style findings are not sorted|style-sort\.md/u,
          );
          expect(unchangedState(f)).toBe(before);
          transcript(
            `C2-${change}`,
            `bun --no-env-file --config=/dev/null scripts/aftercare.ts ${f.dispatch} ${WORDS.join(" ")}\n`,
            result,
          );
          expect(readdirSync(join(f.repo, ".worktrees")).sort()).toEqual(
            ["7", "7-mimo", "7-oracle-sol", "7-sol", "70-x", "ticket-7-base"].sort(),
          );
        } finally {
          cleanup(f);
        }
      }
    },
  );

  acceptance(
    "C3 and C15: dry run prints ordered JSON and changes nothing; missing words is a call fault",
    () => {
      const f = fixture();
      try {
        const before = unchangedState(f);
        const dry = runAfter(f, ["--dry-run", "--json", ...WORDS]);
        const record = JSON.parse(dry.out);
        expect(dry.code).toBe(0);
        expect(record.run).toBe("7");
        expect(record.dry_run).toBe(true);
        expect(typeof record.outcome).toBe("string");
        expect(Array.isArray(record.steps)).toBe(true);
        expect(Array.isArray(record.folders)).toBe(true);
        expect(typeof record.next).toBe("string");
        expect(
          record.folders.map((folder: { path: string }) => folder.path.split("/").at(-1)),
        ).toEqual(["7", "7-mimo", "7-oracle-sol", "7-sol"]);
        const steps = record.steps.map((step: { name: string }) => step.name);
        expect(steps.indexOf("close run windows")).toBeLessThan(steps.indexOf("remove 7"));
        expect(
          record.folders.every((folder: { saves: string[] }) => Array.isArray(folder.saves)),
        ).toBe(true);
        const solFolder = record.folders.find((folder: { path: string }) =>
          folder.path.endsWith("7-sol"),
        );
        const oracleFolder = record.folders.find((folder: { path: string }) =>
          folder.path.endsWith("7-oracle-sol"),
        );
        expect(solFolder!.saves.some((name: string) => name.endsWith("untracked.tar"))).toBe(true);
        expect(oracleFolder!.saves.some((name: string) => name.endsWith("index.diff"))).toBe(true);
        expect(
          record.folders.every(
            (folder: { path: string }) =>
              !folder.path.endsWith("70-x") && !folder.path.endsWith("ticket-7-base"),
          ),
        ).toBe(true);
        expect(unchangedState(f)).toBe(before);
        expect(existsSync(join(f.dispatch, "stray"))).toBe(false);
        const missing = runAfter(f, []);
        expect(missing.code).toBe(1);
        expect(unchangedState(f)).toBe(before);
        transcript(
          "C3-C15",
          `bun --no-env-file --config=/dev/null scripts/aftercare.ts ${f.dispatch} --dry-run --json ${WORDS.join(" ")}\n`,
          dry,
        );
        transcript(
          "C3-missing-words",
          `bun --no-env-file --config=/dev/null scripts/aftercare.ts ${f.dispatch}\n`,
          missing,
        );
      } finally {
        cleanup(f);
      }
    },
  );

  acceptance(
    "C4-C5: removes all ticket folders after saving staged and untracked work, and leaves unrelated folders",
    () => {
      const f = fixture();
      try {
        const scratch = join(f.repo, ".worktrees/7-rev-security-sol");
        const solCommit = git(f.repo, "rev-parse", "wb/7-sol");
        const cut = runTool(f, "cut-scratch", [
          f.repo,
          join(f.repo, ".worktrees/7"),
          scratch,
          solCommit,
          "--clone",
          f.base,
        ]);
        if (cut.code !== 0) throw new Error(`cut-scratch exited ${cut.code}: ${cut.out}${cut.err}`);
        const result = runAfter(f, WORDS);
        expect(result.code).toBe(0);
        expect(readdirSync(join(f.repo, ".worktrees")).sort()).toEqual(
          ["70-x", "ticket-7-base"].sort(),
        );
        const actionRowsNow = actionRows(f);
        for (const name of ["7", "7-sol", "7-mimo", "7-oracle-sol", "7-rev-security-sol"])
          expect(
            actionRowsNow.filter(
              (item) =>
                item.action === "teardown" && item.target === join(f.repo, ".worktrees", name),
            ).length,
          ).toBe(1);
        const stray = join(f.dispatch, "stray");
        expect(existsSync(join(stray, "7-oracle-sol-"))).toBe(false);
        const saved = readdirSync(stray);
        const indexPatch = saved.find(
          (name) => name.startsWith("7-oracle-sol-") && name.endsWith("index.diff"),
        );
        const archive = saved.find(
          (name) => name.startsWith("7-sol-") && name.endsWith("untracked.tar"),
        );
        expect(indexPatch).toBeDefined();
        expect(archive).toBeDefined();
        const patch = readFileSync(join(stray, indexPatch!), "utf8");
        expect(patch).toContain("oracle v1");
        const listing = run("tar", ["-tf", join(stray, archive!)]);
        expect(listing.out.split(/\r?\n/u).filter(Boolean)).toEqual([
          "scripts/.host-self-test-abc/file-1.txt",
          "scripts/.host-self-test-abc/file-2.txt",
          "scripts/.host-self-test-abc/file-3.txt",
        ]);
        expect(
          saved.some(
            (name) =>
              name.endsWith("status") &&
              readFileSync(join(stray, name), "utf8").includes("node_modules"),
          ),
        ).toBe(false);
        expect(saved.every((name) => statSync(join(stray, name)).size > 0)).toBe(true);
        expect(listing.out).not.toContain("node_modules");
        const fresh = join(f.root, "index-check");
        git(f.repo, "worktree", "add", "-q", "--detach", fresh, "wb/7-sol");
        const patchCheck = run("git", [
          "-C",
          fresh,
          "apply",
          "--cached",
          "--check",
          join(stray, indexPatch!),
        ]);
        expect(patchCheck.code).toBe(0);
        transcript(
          "C4-C5",
          `cut-scratch.sh ${f.repo} ${join(f.repo, ".worktrees/7")} ${scratch} ${solCommit} --clone ${f.base}\nbun --no-env-file --config=/dev/null scripts/aftercare.ts ${f.dispatch} ${WORDS.join(" ")}\ngit -C ${fresh} apply --cached --check ${join(stray, indexPatch!)}\n`,
          result,
          `saved: ${saved.join(", ")}\ntar listing:\n${listing.out}patch-check exit ${patchCheck.code}\n`,
        );

        const plain = fixture();
        try {
          mkdirSync(join(plain.repo, ".worktrees/7-by-hand"));
          const stopped = runAfter(plain, WORDS);
          expect(stopped.code).toBe(3);
          expect(stopped.out + stopped.err).toContain("7-by-hand");
          expect(stopped.err).toContain("step folder teardown");
          expect(stopped.err).toContain("next:");
          expect(existsSync(join(plain.repo, ".worktrees/7-by-hand"))).toBe(true);
          transcript(
            "C4-plain-folder",
            `bun --no-env-file --config=/dev/null scripts/aftercare.ts ${plain.dispatch} ${WORDS.join(" ")}\n`,
            stopped,
          );
        } finally {
          cleanup(plain);
        }
      } finally {
        cleanup(f);
      }
    },
  );

  acceptance("C6 and C15: flags only tracked blob content absent from all project branches", () => {
    for (const value of [
      "export const a = 9;\n",
      "export const a = 2;\n",
      "export const a = 0;\n",
      "deleted",
      "moved",
    ]) {
      const f = fixture();
      try {
        const mimo = join(f.repo, ".worktrees/7-mimo/src/a.ts");
        if (value === "deleted") rmSync(mimo);
        else if (value === "moved")
          git(join(f.repo, ".worktrees/7-mimo"), "mv", "src/a.ts", "src/b.ts");
        else writeFileSync(mimo, value);
        const diffBefore = run("git", [
          "-C",
          join(f.repo, ".worktrees/7-mimo"),
          "diff",
          "--raw",
          "--no-abbrev",
          "-z",
        ]);
        const blobBefore = run("git", [
          "-C",
          join(f.repo, ".worktrees/7-mimo"),
          "hash-object",
          "src/a.ts",
        ]);
        const objectsBefore = run("git", ["-C", f.repo, "rev-list", "--branches", "--objects"]);
        const result = runAfter(f, ["--json", ...WORDS]);
        const summary = JSON.parse(result.out);
        const entry = summary.folders.find((folder: { path: string }) =>
          folder.path.endsWith("7-mimo"),
        );
        expect(result.code).toBe(0);
        if (entry.flagged !== (value === "export const a = 9;\n")) {
          throw new Error(
            `flag mismatch for ${value}: ${result.out}${result.err}\nraw=${JSON.stringify(diffBefore.out)}\nblob=${blobBefore.out.trim()} held=${objectsBefore.out.includes(blobBefore.out.trim())}`,
          );
        }
        if (entry.flagged) expect(entry.why.join(" ")).toContain("src/a.ts");
        expect(
          summary.folders
            .filter((folder: { flagged: boolean }) => folder.flagged)
            .map((folder: { path: string }) => folder.path.split("/").at(-1)),
        ).toEqual(value === "export const a = 9;\n" ? ["7-mimo"] : []);
        const label = value.includes("9")
          ? "novel"
          : value.includes("2")
            ? "held"
            : value === "deleted"
              ? "deleted"
              : value === "moved"
                ? "moved"
                : "base";
        transcript(
          `C6-${label}`,
          `bun --no-env-file --config=/dev/null scripts/aftercare.ts ${f.dispatch} --json ${WORDS.join(" ")}\n`,
          result,
        );
      } finally {
        cleanup(f);
      }
    }
  });

  acceptance(
    "C7 and C14: leaves a folder with a live launch, cleans the rest, then resumes",
    () => {
      const f = fixture();
      try {
        const sol = join(f.repo, ".worktrees/7-sol");
        const started = runTool(f, "host", [
          "run",
          "probe",
          sol,
          "--out",
          join(f.root, "o"),
          "--err",
          join(f.root, "e"),
          "--",
          "sleep",
          "300",
        ]);
        expect(started.code).toBe(0);
        const closeRunProbe = runTool(f, "host", ["close-run", f.dispatch]);
        if (closeRunProbe.code === 0)
          throw new Error(
            `close-run unexpectedly succeeded: ${closeRunProbe.out}${closeRunProbe.err}`,
          );
        const unchanged = unchangedState(f);
        const dry = runAfter(f, ["--dry-run", "--json", ...WORDS]);
        const drySummary = JSON.parse(dry.out);
        expect(dry.code).toBe(3);
        expect(drySummary.outcome).toContain("probe");
        expect(drySummary.next).toContain("rerun");
        expect(unchangedState(f)).toBe(unchanged);
        transcript(
          "C7-dry-run",
          `host.sh run probe ${sol} --out ${join(f.root, "o")} --err ${join(f.root, "e")} -- sleep 300\nbun --no-env-file --config=/dev/null scripts/aftercare.ts ${f.dispatch} --dry-run --json ${WORDS.join(" ")}\n`,
          dry,
        );
        const stopped = runAfter(f, ["--json", ...WORDS]);
        const stoppedSummary = JSON.parse(stopped.out);
        expect(stopped.code).toBe(3);
        expect(stoppedSummary.outcome).toContain("probe");
        expect(stoppedSummary.next).toContain("rerun");
        expect(stopped.err).toContain("step folder teardown");
        expect(stopped.err).toContain("next:");
        expect(existsSync(sol)).toBe(true);
        expect(inspectLaunchesFor(f, sol)).toContain("probe");
        const leftovers = readdirSync(join(f.repo, ".worktrees")).sort();
        if (JSON.stringify(leftovers) !== JSON.stringify(["7-sol", "70-x", "ticket-7-base"].sort()))
          throw new Error(
            `unexpected worktrees: ${leftovers.join(", ")}\n${stopped.out}${stopped.err}`,
          );
        const stop = runTool(f, "host", ["stop", sol]);
        expect(stop.code).toBe(0);
        const rowsBeforeResume = actionRows(f).length;
        const again = runAfter(f, WORDS);
        expect(again.code).toBe(0);
        expect(existsSync(sol)).toBe(false);
        const resumedActions = actionRows(f).slice(rowsBeforeResume);
        expect(
          resumedActions
            .filter(
              (item) => item.action === "teardown" && String(item.target).includes("/.worktrees/"),
            )
            .map((item) => item.target),
        ).toEqual([sol]);
        transcript(
          "C7-C14-resume",
          `host.sh run probe ${sol} --out ${join(f.root, "o")} --err ${join(f.root, "e")} -- sleep 300\nbun --no-env-file --config=/dev/null scripts/aftercare.ts ${f.dispatch} --json ${WORDS.join(" ")}\n`,
          stopped,
          `host.sh stop ${sol}: ${stop.out}${stop.err}exit ${stop.code}\nrerun: ${again.out}${again.err}exit ${again.code}\n`,
        );
      } finally {
        cleanup(f);
      }
    },
  );

  acceptance("C8: stops only the registered preview process group", () => {
    const f = fixture();
    try {
      const synthesis = join(f.repo, ".worktrees/7");
      mkdirSync(join(f.dispatch, "render"), { recursive: true });
      const pidfile = join(f.dispatch, "render/preview.pid");
      const started = runTool(f, "host", [
        "run",
        "preview server",
        synthesis,
        "--under",
        f.dispatch,
        "--role",
        "coachman",
        "--run",
        f.dispatch,
        "--pidfile",
        pidfile,
        "--out",
        join(f.root, "p"),
        "--err",
        join(f.root, "pe"),
        "--",
        "sleep",
        "300",
      ]);
      expect(started.code).toBe(0);
      const pid = Number(readFileSync(pidfile, "utf8").trim());
      const result = runAfter(f, WORDS);
      expect(result.code).toBe(0);
      let live = true;
      try {
        process.kill(-pid, 0);
      } catch {
        live = false;
      }
      expect(live).toBe(false);
      expect(existsSync(synthesis)).toBe(false);
      transcript(
        "C8-preview",
        `host.sh run "preview server" ${synthesis} --under ${f.dispatch} --role coachman --run ${f.dispatch} --pidfile ${pidfile} --out ${join(f.root, "p")} --err ${join(f.root, "pe")} -- sleep 300\nbun --no-env-file --config=/dev/null scripts/aftercare.ts ${f.dispatch} ${WORDS.join(" ")}\n`,
        result,
        `preview pid: ${pid}\nprocess group live: ${live}\n`,
      );
    } finally {
      cleanup(f);
    }
  });

  acceptance("C8: skips a missing preview and leaves an unregistered pid alone", () => {
    const f = fixture();
    let outsider: ReturnType<typeof spawn> | undefined;
    try {
      const noPid = runAfter(f, WORDS);
      expect(noPid.code).toBe(0);
      expect(noPid.out).not.toContain("preview server");
      transcript(
        "C8-no-preview",
        `bun --no-env-file --config=/dev/null scripts/aftercare.ts ${f.dispatch} ${WORDS.join(" ")}\n`,
        noPid,
      );
    } finally {
      cleanup(f);
    }

    const g = fixture();
    try {
      outsider = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
      outsider.unref();
      const pidfile = join(g.dispatch, "render/preview.pid");
      mkdirSync(join(g.dispatch, "render"), { recursive: true });
      writeFileSync(pidfile, `${outsider.pid}\n`);
      const result = runAfter(g, WORDS);
      expect(result.code).toBe(0);
      expect(result.out).toContain("has no matching preview launch record; left running");
      expect(() => process.kill(outsider!.pid!, 0)).not.toThrow();
      transcript(
        "C8-unregistered-preview",
        `bun --no-env-file --config=/dev/null scripts/aftercare.ts ${g.dispatch} ${WORDS.join(" ")}\n`,
        result,
        `unregistered process pid: ${outsider.pid}\n`,
      );
    } finally {
      if (outsider?.pid) {
        try {
          process.kill(-outsider.pid, "SIGKILL");
        } catch {}
      }
      cleanup(g);
    }
  });

  acceptance("C10-C11: waits on a busy folder and keeps a pin claimed by another live run", () => {
    const f = fixture();
    try {
      const second = join(f.repo, ".postmaster/runs/another");
      mkdirSync(second, { recursive: true });
      writeFileSync(join(second, "manifest.json"), '{"stage":"review"}\n');
      writeFileSync(
        join(second, "run.json"),
        `${JSON.stringify({ postmaster: { checkout: f.pin } })}\n`,
      );
      writeFileSync(`${f.pin}.claims`, `${f.dispatch}\n${second}\n`);
      const result = runAfter(f, WORDS);
      expect(result.code).toBe(0);
      expect(existsSync(f.pin)).toBe(true);
      expect(result.out).toContain("another run");
      expect(
        actionRows(f).some((item) => item.action === "teardown" && item.target === f.pin),
      ).toBe(false);
      transcript(
        "C11-pin-in-use",
        `bun --no-env-file --config=/dev/null scripts/aftercare.ts ${f.dispatch} ${WORDS.join(" ")}\n`,
        result,
      );
    } finally {
      cleanup(f);
    }
  });

  acceptance("C12: missing contract and abandoned runs are call faults without writes", () => {
    for (const invalid of ["contract", "abandoned"]) {
      const f = fixture();
      try {
        if (invalid === "contract")
          writeFileSync(
            join(f.dispatch, "run.json"),
            '{"postmaster":{"checkout":"/absent"},"config":{"team":{"workhorses":["sol","mimo"]}}}\n',
          );
        else {
          const manifest = JSON.parse(readFileSync(join(f.dispatch, "manifest.json"), "utf8"));
          manifest.stage = "abandoned";
          writeFileSync(join(f.dispatch, "manifest.json"), `${JSON.stringify(manifest)}\n`);
        }
        const before = readFileSync(join(f.dispatch, "actions.jsonl"), "utf8");
        const result = runAfter(f, WORDS);
        expect(result.code).toBe(1);
        expect(result.out + result.err).toContain("next:");
        expect(readFileSync(join(f.dispatch, "actions.jsonl"), "utf8")).toBe(before);
        expect(readdirSync(join(f.repo, ".worktrees")).length).toBe(6);
        transcript(
          `C12-${invalid}`,
          `bun --no-env-file --config=/dev/null scripts/aftercare.ts ${f.dispatch} ${WORDS.join(" ")}\n`,
          result,
        );
      } finally {
        cleanup(f);
      }
    }
  });

  acceptance(
    "C12: ticket read faults happen after teardown, and silent close-run faults name the step",
    () => {
      const unreadable = fixture();
      try {
        const file = join(unreadable.repo, ".git/postmaster/tickets/7.json");
        chmodSync(file, 0);
        const result = runAfter(unreadable, WORDS);
        expect(result.code).toBe(3);
        expect(result.err).toContain("step ticket state");
        expect(result.err).toContain("next:");
        expect(readdirSync(join(unreadable.repo, ".worktrees")).sort()).toEqual(
          ["70-x", "ticket-7-base"].sort(),
        );
        expect(
          JSON.parse(readFileSync(join(unreadable.dispatch, "manifest.json"), "utf8")).stage,
        ).toBe("shipped");
        chmodSync(file, 0o600);
        transcript(
          "C12-unreadable-ticket",
          `chmod 000 ${file}\nbun --no-env-file --config=/dev/null scripts/aftercare.ts ${unreadable.dispatch} ${WORDS.join(" ")}\n`,
          result,
        );
      } finally {
        cleanup(unreadable);
      }

      const placement = fixture();
      try {
        const state = join(placement.root, "state/placements");
        mkdirSync(state, { recursive: true });
        const ownerPath = join(placement.repo, ".worktrees/7-rev-bug-mimo");
        writeFileSync(
          join(state, "x.json"),
          `${JSON.stringify({ run: placement.dispatch, workspace: "w1", tab: "w1:t1", pane: "w1:p1", cwd: ownerPath })}\n`,
        );
        const herdr = join(placement.bin, "herdr");
        writeFileSync(
          herdr,
          '#!/bin/sh\nif [ "$1 $2" = "workspace list" ]; then printf \'{\\"result\\":{\\"workspaces\\":[]}}\\n\'; exit 0; fi\nif [ "$1 $2" = "workspace get" ]; then printf \'{\\"result\\":{\\"workspace\\":{}}}\\n\'; exit 0; fi\nexit 1\n',
        );
        chmodSync(herdr, 0o755);
        const result = runAfter(placement, WORDS, { POSTMASTER_HOST: "herdr" });
        expect(result.code).toBe(3);
        expect(result.err).toContain("step close run windows");
        expect(result.err).toContain("next:");
        transcript(
          "C12-silent-close-run",
          `bun --no-env-file --config=/dev/null scripts/aftercare.ts ${placement.dispatch} ${WORDS.join(" ")}\n`,
          result,
        );
      } finally {
        cleanup(placement);
      }
    },
  );

  acceptance("C5: saves an unbranched detached commit as an applicable patch", () => {
    const f = fixture();
    try {
      const oracle = join(f.repo, ".worktrees/7-oracle-sol");
      git(oracle, "commit", "-m", "detached oracle work", "--", "test/oracle-7.test.ts");
      const commitId = git(oracle, "rev-parse", "HEAD");
      const result = runAfter(f, WORDS);
      expect(result.code).toBe(0);
      const patchName = readdirSync(join(f.dispatch, "stray")).find(
        (name) =>
          name.startsWith("7-oracle-sol-") &&
          name.endsWith(`commit-${commitId.slice(0, 12)}.patch`),
      );
      expect(patchName).toBeDefined();
      const patch = join(f.dispatch, "stray", patchName!);
      const fresh = join(f.root, "patch-check");
      git(f.repo, "worktree", "add", "-q", "--detach", fresh, "wb/7-sol");
      const applied = run("git", ["-C", fresh, "am", patch]);
      expect(applied.code).toBe(0);
      expect(readFileSync(join(fresh, "test/oracle-7.test.ts"), "utf8")).toBe("oracle v1\n");
      transcript(
        "C5-detached-commit",
        `git -C ${oracle} commit -m 'detached oracle work' -- test/oracle-7.test.ts\nbun --no-env-file --config=/dev/null scripts/aftercare.ts ${f.dispatch} ${WORDS.join(" ")}\ngit -C ${fresh} am ${patch}\n`,
        result,
        `saved patch: ${patchName}\ngit am output: ${applied.out}${applied.err}git am exit ${applied.code}\n`,
      );
    } finally {
      cleanup(f);
    }
  });

  acceptance("C13: writes the same action lines to the run and project ledger", () => {
    const f = fixture();
    try {
      const result = runAfter(f, WORDS);
      const runLines = readFileSync(join(f.dispatch, "actions.jsonl"), "utf8")
        .trim()
        .split("\n")
        .slice(7);
      const ledgerLines = readFileSync(join(f.repo, ".postmaster/runs/ledger.jsonl"), "utf8")
        .trim()
        .split("\n");
      expect(result.code).toBe(0);
      expect(ledgerLines).toEqual(runLines);
      expect(
        runLines.map((line) => JSON.parse(line).actor).every((actor) => actor === "postmaster"),
      ).toBe(true);
      const rows = runLines.map((line) => JSON.parse(line));
      const lastFolder = Math.max(
        ...rows.map((row, index) =>
          row.action === "teardown" && String(row.target).includes("/.worktrees/") ? index : -1,
        ),
      );
      const runLog = rows.findIndex((row) => row.detail?.startsWith("aftercare closing run-log:"));
      const ticketState = rows.findIndex((row) => row.action === "ticket-state");
      const ticketComment = rows.findIndex((row) => row.action === "ticket-comment");
      const stageDone = rows.findIndex((row) => row.action === "stage" && row.target === "done");
      expect(runLog).toBeGreaterThan(lastFolder);
      expect(ticketState).toBeGreaterThan(runLog);
      expect(ticketComment).toBeGreaterThan(ticketState);
      expect(stageDone).toBeGreaterThan(ticketComment);
      transcript(
        "C13-ledger",
        `bun --no-env-file --config=/dev/null scripts/aftercare.ts ${f.dispatch} ${WORDS.join(" ")}\n`,
        result,
        `run/ledger new lines: ${runLines.length}\n`,
      );
    } finally {
      cleanup(f);
    }
  });

  acceptance(
    "C16: runbook paths resolve, after-merge hand steps are replaced and contract detector sees the command",
    () => {
      const refs = run("bash", [join(TOOL, "scripts/skill-refs.sh")]);
      const contract = run("bash", [join(TOOL, "scripts/coachman-contract.sh"), "--self-test"]);
      const postmaster = readFileSync(join(TOOL, "skills/postmaster/postmaster.md"), "utf8");
      const stageG =
        postmaster
          .split("## Stage G (contract 2): after merge\n")[1]
          ?.split("\n## Legacy Stage F")[0] ?? "";
      const controls = readFileSync(join(TOOL, "skills/postmaster/controls.md"), "utf8");
      expect(refs.code).toBe(0);
      expect(contract.code).toBe(0);
      expect(postmaster).toContain("aftercare.ts <dispatch> --dry-run");
      expect(postmaster).toContain("do the next step it prints and run aftercare again");
      expect(stageG).not.toContain("host.sh close-run");
      expect(stageG).not.toContain("git worktree remove");
      expect(stageG).not.toContain("stage.sh <dispatch> done");
      expect(stageG).not.toContain("Confirm the default branch");
      expect(controls).toContain("scripts/aftercare.ts");
      const coachman = readFileSync(join(TOOL, "skills/postmaster/coachman.md"), "utf8");
      expect(coachman).toContain("<repo>/.worktrees/<TICKET>-oracle-<lane>");
      const result = {
        code: 0,
        out: `skill-refs exit ${refs.code}\ncoachman-contract --self-test exit ${contract.code}\npostmaster aftercare step: present\ncontrols aftercare row: present\n`,
        err: "",
      };
      transcript(
        "C16",
        "scripts/skill-refs.sh\nscripts/coachman-contract.sh --self-test\n",
        result,
      );
    },
  );
});
