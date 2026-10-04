import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./proc.ts";
import { scanComments } from "./switch-offs.ts";

const SELF = join(import.meta.dir, "../run");
const CLEAN_GIT_ENV = {
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_COMMON_DIR: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_OBJECT_DIRECTORY: undefined,
  GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
  GIT_NAMESPACE: undefined,
};

let root = "";
let repo = "";

function freshRepo(name: string): string {
  const path = join(root, name);
  mkdirSync(path);
  const initialized = run("git", ["init", "-q", "-b", "main", path], { env: CLEAN_GIT_ENV });
  if (initialized.code !== 0) throw new Error(`git init: ${initialized.err}`);
  repo = path;
  git(repo, "config", "user.email", "332054101+brindlewick@users.noreply.github.com");
  git(repo, "config", "user.name", "brindlewick");
  git(repo, "config", "commit.gpgsign", "false");
  write("scripts/base.ts", "export const base = true;\n");
  write("package.json", '{"scripts":{"check":"tsc --noEmit"},"devDependencies":{}}\n');
  commit("base");
  git(repo, "checkout", "-qb", "ticket");
  return repo;
}

function git(where: string, ...args: string[]): string {
  const r = run("git", ["-C", where, ...args], { env: CLEAN_GIT_ENV });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.err}${r.out}`);
  return r.out.trim();
}

function write(path: string, text: string): void {
  const full = join(repo, path);
  const parent = full.slice(0, full.lastIndexOf("/"));
  mkdirSync(parent, { recursive: true });
  writeFileSync(full, text);
}

function commit(message: string): string {
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", message);
  return git(repo, "rev-parse", "HEAD");
}

function call(...args: string[]): { code: number; out: string } {
  const result = run(SELF, ["landing", "switch-offs", ...args], { env: CLEAN_GIT_ENV });
  return { code: result.code, out: `${result.out}${result.err}`.replace(/\n+$/u, "") };
}

function check(...args: string[]): { code: number; out: string } {
  return call("--repo", repo, "--default", "main", "--ticket", "ticket", ...args);
}

beforeAll(() => {
  const scratch = join(import.meta.dir, "../../.postmaster/verify/tmp");
  mkdirSync(scratch, { recursive: true });
  root = mkdtempSync(join(scratch, "postmaster-switch-offs-"));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("switch-off detection", () => {
  test("recognizes each supported form once and reports reason and scope", () => {
    freshRepo("forms");
    const forms: [string, string][] = [
      ["ts-ignore-line.ts", "// @ts-ignore -- known mismatch\nconst x: string = 1;"],
      ["ts-ignore-block.ts", "/* @ts-ignore -- known mismatch */\nconst x: string = 1;"],
      ["ts-expect.ts", "// @ts-expect-error: known mismatch\nconst x: string = 1;"],
      ["ts-nocheck.ts", "// @ts-nocheck known generated file\nconst x = 1;"],
      ["eslint-next.ts", "// eslint-disable-next-line rule-a -- known mismatch\nconst x = 1;"],
      ["oxlint-line.ts", "// oxlint-disable-line rule-b -- known mismatch\nconst x = 1;"],
      ["eslint-block.ts", "/* eslint-disable -- known file issue */\nconst x = 1;"],
      ["oxlint-block.ts", "/* oxlint-disable rule-c -- known file issue */\nconst x = 1;"],
      ["biome-one.ts", "// biome-ignore format: known formatting exception\nconst x = 1;"],
      ["biome-all.ts", "// biome-ignore-all format: generated file\nconst x = 1;"],
    ];
    for (const [name, text] of forms) write(`scripts/${name}`, `${text}\n`);
    commit("add switch-offs");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out.startsWith("held\n## Comments\n")).toBe(true);
    expect((result.out.match(/^- `scripts\//gmu) ?? []).length).toBe(10);
    expect(result.out).toContain("every rule");
    expect(result.out).toContain('reason: "known mismatch"');
    expect(result.out).toContain('reason: "known file issue"');
    expect(result.out).toContain('reason: "generated file"');
  });

  test("ignores directive text in strings, regexps, template text, written text and Markdown", () => {
    freshRepo("lexing");
    write(
      "scripts/text-input.ts",
      [
        'const double = "// eslint-disable-next-line fake -- nope";',
        "const single = '// @ts-ignore nope';",
        "const plain = `// oxlint-disable fake -- nope`;",
        "const expression = `text ${1 /* eslint-disable expression-rule -- real reason */}`;",
        "const re = /\\/\\/ biome-ignore format: nope/;",
        'writeFile("x.ts", "/* oxlint-disable fake */");',
      ].join("\n"),
    );
    write("docs/switch-offs.md", "// @ts-nocheck this is Markdown\n");
    commit("add directive text inputs");
    const comments = scanComments(readFileSync(join(repo, "scripts/text-input.ts"), "utf8"));
    expect(comments).toHaveLength(1);
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/text-input.ts");
    expect(result.out).toContain("expression-rule");
    expect(result.out).not.toContain("docs/switch-offs.md");
    expect(result.out).not.toContain("fake");
  });

  test("requires reasons for active TypeScript and linter directives but ignores ineffective Biome comments", () => {
    freshRepo("reasons");
    write("scripts/missing-ts.ts", "// @ts-ignore\nconst x: string = 1;\n");
    write("scripts/missing-eslint.ts", "// eslint-disable-next-line rule-a\nconst x = 1;\n");
    write("scripts/missing-oxlint.ts", "/* oxlint-disable */\nconst x = 1;\n");
    write("scripts/biome-no-reason.ts", "// biome-ignore format:\nconst x = 1;\n");
    commit("add missing-reason comments");
    const result = check();
    expect(result.code).toBe(3);
    expect(result.out.startsWith("reason-required\n")).toBe(true);
    expect((result.out.match(/reason: missing/gu) ?? []).length).toBe(3);
    expect(result.out).not.toContain("biome-no-reason.ts");
  });

  test("recognizes each specified settings path and a removed linter settings file", () => {
    const cases: [string, string, string][] = [
      ["oxlintrc", ".oxlintrc.json", '{"rules":{"rule-a":"off"}}\n'],
      ["strict", "tsconfig.json", '{"compilerOptions":{"strict":false}}\n'],
      ["biome", "biome.json", '{"overrides":[{"include":["scripts/**"],"format":false}]}\n'],
      ["gate-script", "package.json", '{"scripts":{"check":"bunx biome format"}}\n'],
      ["bunfig", "bunfig.toml", '[test]\nroot = "scripts"\n'],
      ["nested-tsconfig", "scripts/tsconfig.json", '{"compilerOptions":{"strict":false}}\n'],
    ];
    for (const [name, path, content] of cases) {
      freshRepo(`setting-${name}`);
      write(path, content);
      commit(`add ${path}`);
      const result = check();
      expect(result.code).toBe(2);
      expect(result.out).toContain(
        `\`${path}\` (${path === "package.json" ? "changed" : "added"})`,
      );
    }

    freshRepo("setting-delete");
    git(repo, "checkout", "main");
    write(".oxlintrc.json", '{"rules":{"rule-a":"off"}}\n');
    commit("base linter setting");
    git(repo, "checkout", "-q", "-B", "ticket", "main");
    git(repo, "rm", "-q", ".oxlintrc.json");
    commit("delete linter setting");
    const removed = check();
    expect(removed.code).toBe(2);
    expect(removed.out).toContain("`.oxlintrc.json` (deleted)");
  });

  test("a block disable becomes new when its matching enable is removed", () => {
    freshRepo("block-end");
    write(
      "scripts/block.ts",
      [
        "/* eslint-disable rule-a -- generated code */",
        "const first = 1;",
        "/* eslint-enable rule-a */",
        "const second = 2;",
      ].join("\n"),
    );
    commit("add closed block");
    const before = check();
    expect(before.code).toBe(2);
    const idBefore = /id: `(comment:[0-9a-f]+)`/u.exec(before.out)?.[1];
    write(
      "scripts/block.ts",
      [
        "/* eslint-disable rule-a -- generated code */",
        "const first = 1;",
        "const second = 2;",
      ].join("\n"),
    );
    commit("widen block");
    const after = check();
    const idAfter = /id: `(comment:[0-9a-f]+)`/u.exec(after.out)?.[1];
    expect(after.code).toBe(2);
    expect(idAfter).toBeDefined();
    expect(idAfter).not.toBe(idBefore);
  });

  test("a line move keeps the same identity when its covered code is unchanged", () => {
    freshRepo("line-move");
    write(
      "scripts/moved.ts",
      'const face = "😀";\n// @ts-ignore generated typing\nconst value: number = 1;\n',
    );
    commit("add switch-off");
    const before = check();
    const idBefore = /id: `(comment:[0-9a-f]+)`/u.exec(before.out)?.[1];
    write(
      "scripts/moved.ts",
      'const face = "😀";\n\n// @ts-ignore generated typing\nconst value: number = 1;\n',
    );
    commit("move switch-off down a line");
    const after = check();
    const idAfter = /id: `(comment:[0-9a-f]+)`/u.exec(after.out)?.[1];
    expect(idAfter).toBe(idBefore);
    expect(after.out).toContain("`scripts/moved.ts:3`");
  });

  test("lists check-setting changes, including scripts, and ignores dependency-only edits", () => {
    freshRepo("settings");
    write("package.json", '{"scripts":{"check":"bunx oxlint"},"devDependencies":{}}\n');
    write(".oxlintrc.json", '{"rules":{"example":"off"}}\n');
    write("nested/tsconfig.json", '{"compilerOptions":{"strict":false}}\n');
    commit("change check settings");
    let result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("`package.json` (changed)");
    expect(result.out).toContain("`.oxlintrc.json` (added)");
    expect(result.out).toContain("`nested/tsconfig.json` (added)");
    expect(result.out).toContain("bunx oxlint");

    write(
      "package.json",
      '{"scripts":{"check":"bunx oxlint"},"devDependencies":{"example":"1"}}\n',
    );
    commit("add dependency only");
    result = check();
    expect(result.out).toContain("`package.json` (changed)"); // Earlier script change remains new to the merge base.

    git(repo, "checkout", "-q", "main");
    git(repo, "checkout", "-q", "-B", "ticket-clean");
    write(
      "package.json",
      '{"scripts":{"check":"tsc --noEmit"},"devDependencies":{"example":"1"}}\n',
    );
    commit("dependency only from base");
    const clean = run(
      SELF,
      ["landing", "switch-offs", "--repo", repo, "--default", "main", "--ticket", "ticket-clean"],
      { env: CLEAN_GIT_ENV },
    );
    expect(clean.code).toBe(0);
    expect(clean.out).not.toContain("package.json");
    git(repo, "checkout", "-q", "ticket");
  });

  test("subtracts comments already on the merge base after the default branch is merged", () => {
    freshRepo("merge-base");
    git(repo, "checkout", "-q", "main");
    write(
      "scripts/base-one.ts",
      "// eslint-disable-next-line inherited -- first base comment\nconst x = 1;\n",
    );
    write("scripts/base-two.ts", "// @ts-ignore second base comment\nconst x: string = 1;\n");
    commit("add base switch-off comments");
    git(repo, "checkout", "-q", "-B", "ticket", "main");
    git(repo, "checkout", "-q", "main");
    write(
      "scripts/main-switch.ts",
      "// eslint-disable-next-line inherited -- main reason\nconst x = 1;\n",
    );
    commit("add main switch-off");
    git(repo, "checkout", "-q", "ticket");
    git(repo, "merge", "-q", "--no-edit", "main");
    const inherited = check();
    expect(inherited.code).toBe(0);
    expect(inherited.out).not.toContain("scripts/base-one.ts");
    expect(inherited.out).not.toContain("scripts/base-two.ts");
    expect(inherited.out).not.toContain("scripts/main-switch.ts");
    write("scripts/ticket-switch.ts", "// @ts-ignore ticket reason\nconst x: string = 1;\n");
    commit("add ticket switch-off");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/ticket-switch.ts");
    expect(result.out).not.toContain("scripts/main-switch.ts");
  });

  test("matches approval records from both the run log and project ledger", () => {
    freshRepo("approval");
    write("scripts/approved.ts", "// @ts-nocheck generated source\nexport const value = 1;\n");
    write(".oxlintrc.json", '{"rules":{"example":"off"}}\n');
    commit("add approved switch-off");
    const pending = check();
    const ids = [...pending.out.matchAll(/id: `((?:comment|setting):[0-9a-f]+)`/gu)].map(
      (match) => match[1]!,
    );
    expect(ids).toHaveLength(2);
    git(repo, "update-ref", "refs/remotes/origin/main", git(repo, "rev-parse", "main"));
    git(repo, "update-ref", "refs/remotes/origin/ticket", git(repo, "rev-parse", "ticket"));
    const pullRequestRoute = run(
      SELF,
      [
        "landing",
        "switch-offs",
        "--repo",
        repo,
        "--default",
        "origin/main",
        "--ticket",
        "origin/ticket",
      ],
      { env: CLEAN_GIT_ENV },
    );
    expect(pullRequestRoute.code).toBe(2);
    expect(pullRequestRoute.out).toContain("scripts/approved.ts");
    const dispatch = join(repo, ".postmaster", "runs", "TEST-1");
    mkdirSync(dispatch, { recursive: true });
    const words = [
      "I approve the generated-file exception because the generator owns this output.",
      "I approve the linter setting because this ticket is testing the rule configuration.",
    ];
    for (const [index, id] of ids.entries()) {
      const logged = run(
        SELF,
        ["log-action", dispatch, "postmaster", "switch-off", id, "approved", words[index]!],
        { env: CLEAN_GIT_ENV },
      );
      expect(logged.code).toBe(0);
      if (index === 0) {
        const stillHeld = run(
          SELF,
          [
            "landing",
            "switch-offs",
            "--repo",
            repo,
            "--default",
            "main",
            "--ticket",
            "ticket",
            "--dispatch",
            dispatch,
          ],
          { env: CLEAN_GIT_ENV },
        );
        expect(stillHeld.code).toBe(2);
      }
    }
    const ledger = readFileSync(join(repo, ".postmaster", "runs", "ledger.jsonl"), "utf8");
    expect(ledger.split("\n").filter(Boolean)).toHaveLength(2);
    expect(ledger).toContain(words[0]!);
    expect(ledger).toContain(words[1]!);
    for (const id of ids) expect(ledger).toContain(`"target":"${id}"`);
    const approved = run(
      SELF,
      [
        "landing",
        "switch-offs",
        "--repo",
        repo,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--dispatch",
        dispatch,
      ],
      { env: CLEAN_GIT_ENV },
    );
    expect(approved.code).toBe(0);
    expect(approved.out.startsWith("clear\n")).toBe(true);
  });

  test("a refusal is held and a changed covered line requires a new approval", () => {
    freshRepo("refusal");
    write(
      "scripts/refused.ts",
      "// @ts-expect-error known generated mismatch\nconst value: number = 1;\n",
    );
    commit("add switch-off");
    const first = check();
    const id = /id: `(comment:[0-9a-f]+)`/u.exec(first.out)?.[1];
    expect(id).toBeDefined();
    const dispatch = join(repo, ".postmaster", "runs", "TEST-2");
    mkdirSync(dispatch, { recursive: true });
    const refusal = run(
      SELF,
      [
        "log-action",
        dispatch,
        "postmaster",
        "switch-off",
        id!,
        "refused",
        "I do not approve this suppression because the type error needs a fix.",
      ],
      { env: CLEAN_GIT_ENV },
    );
    expect(refusal.code).toBe(0);
    const refused = run(
      SELF,
      [
        "landing",
        "switch-offs",
        "--repo",
        repo,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--dispatch",
        dispatch,
      ],
      { env: CLEAN_GIT_ENV },
    );
    expect(refused.code).toBe(4);
    expect(refused.out.startsWith("refused\n")).toBe(true);

    write(
      "scripts/refused.ts",
      "// @ts-expect-error known generated mismatch\nconst value: number = 2;\n",
    );
    commit("change covered code");
    const changed = run(
      SELF,
      [
        "landing",
        "switch-offs",
        "--repo",
        repo,
        "--default",
        "main",
        "--ticket",
        "ticket",
        "--dispatch",
        dispatch,
      ],
      { env: CLEAN_GIT_ENV },
    );
    expect(changed.code).toBe(2); // The changed code creates a new, unapproved identity.
    expect(changed.out).toContain('reason: "known generated mismatch"');
    expect(changed.out).not.toContain(`id: \`${id}\``);
  });
});

describe("landing instructions", () => {
  test("the coachman records the final list outside the backward-compatible checked block", () => {
    const coachman = readFileSync(
      join(import.meta.dir, "../../skills/postmaster/coachman.md"),
      "utf8",
    );
    const stage = coachman.slice(coachman.indexOf("## Stage 3 (last leg of contract 2)"));
    const inspect = stage.indexOf("landing switch-offs");
    const card = stage.indexOf("Write `card.md`");
    expect(inspect).toBeGreaterThanOrEqual(0);
    expect(card).toBeGreaterThan(inspect);
    expect(stage).toContain("## Check switch-offs");
    expect(stage).toContain("outside `card-block`");
    expect(stage).toContain("`card-results` and `card-findings`");
  });

  test("both Stage F routes wait for the user's approval before opening or merging", () => {
    const postmaster = readFileSync(
      join(import.meta.dir, "../../skills/postmaster/postmaster.md"),
      "utf8",
    );
    const current = postmaster.slice(
      postmaster.indexOf("## Stage F (contract 2)"),
      postmaster.indexOf("## Stage G (contract 2)"),
    );
    const checkAt = current.indexOf("Check switch-offs before following the landing route");
    const routeAt = current.indexOf("Follow the landing route in the waybill");
    expect(checkAt).toBeGreaterThanOrEqual(0);
    expect(routeAt).toBeGreaterThan(checkAt);
    expect(current).toContain("landing: pull-request");
    expect(current).toContain("landing: local");
    expect(current).toContain("stop before opening a pull request or merging");
    expect(current).toContain("authority never approves these entries");
    const legacy = postmaster.slice(
      postmaster.indexOf("## Legacy Stage F"),
      postmaster.indexOf("## Legacy Stage G"),
    );
    expect(legacy).toContain("landing switch-offs");
    expect(legacy).toContain("do not grant or merge");
  });
});
