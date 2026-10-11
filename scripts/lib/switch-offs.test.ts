import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./proc.ts";
import { packageSettingsDiffer, parseSwitchOff, scanComments } from "./switch-offs.ts";

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

function symlink(target: string, path: string): void {
  const full = join(repo, path);
  const parent = full.slice(0, full.lastIndexOf("/"));
  mkdirSync(parent, { recursive: true });
  symlinkSync(target, full);
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
      ["oxlint-line.ts", "const x = 1; // oxlint-disable-line rule-b -- known mismatch"],
      ["eslint-block.ts", "/* eslint-disable -- known file issue */\nconst x = 1;"],
      ["oxlint-block.ts", "/* oxlint-disable rule-c -- known file issue */\nconst x = 1;"],
      ["biome-one.ts", "// biome-ignore format: known formatting exception\nconst x = 1;"],
      ["biome-all.ts", "// biome-ignore-all format: generated file\nconst x = 1;"],
    ];
    for (const [name, text] of forms) write(`scripts/${name}`, `${text}\n`);
    commit("add switch-offs");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out.startsWith("held\n## Switch-offs\n\n")).toBe(true);
    for (const [name] of forms) {
      expect(result.out.split(`scripts/${name}:`).length - 1).toBe(1);
    }
    expect(result.out).toContain("every rule");
    expect(result.out).toContain("-- reason: known mismatch");
    expect(result.out).toContain("-- reason: known file issue");
    expect(result.out).toContain("-- reason: generated file");
    expect(result.out).toContain("scripts/ts-ignore-line.ts:1 ts-ignore every rule");
    expect(result.out).toContain("scripts/biome-one.ts:1 biome-ignore format");
    expect(result.out).toContain("(id comment:");
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
        "export const who = `value ${1} // biome-ignore format: fake-trailing`;",
      ].join("\n"),
    );
    write("docs/switch-offs.md", "// @ts-nocheck this is Markdown\n");
    commit("add directive text inputs");
    const comments = scanComments(
      readFileSync(join(repo, "scripts/text-input.ts"), "utf8"),
      "scripts/text-input.ts",
    );
    expect(comments).toHaveLength(1);
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/text-input.ts");
    expect(result.out).toContain("expression-rule");
    expect(result.out).not.toContain("docs/switch-offs.md");
    expect(result.out).not.toContain("fake");
  });

  test("a Biome start block is listed, and widening it by dropping its end counts as added", () => {
    freshRepo("biome-block");
    write(
      "scripts/styled.ts",
      [
        "// biome-ignore-start format: generated section",
        "const      spaced      =      1;",
        "// biome-ignore-end format: generated section",
        "export const done = true;",
      ].join("\n"),
    );
    commit("add closed Biome block");
    const before = check();
    expect(before.code).toBe(2);
    const idBefore = /\(id (comment:[0-9a-f]{16})\)/u.exec(before.out)?.[1];
    expect(idBefore).toBeDefined();
    write(
      "scripts/styled.ts",
      [
        "// biome-ignore-start format: generated section",
        "const      spaced      =      1;",
        "export const done = true;",
      ].join("\n"),
    );
    commit("drop the Biome end");
    const after = check();
    expect(after.code).toBe(2);
    const idAfter = /\(id (comment:[0-9a-f]{16})\)/u.exec(after.out)?.[1];
    expect(idAfter).toBeDefined();
    expect(idAfter).not.toBe(idBefore);
  });

  test("requires reasons for active TypeScript and linter directives but ignores ineffective Biome comments", () => {
    freshRepo("reasons");
    write("scripts/missing-ts.ts", "// @ts-ignore\nconst x: string = 1;\n");
    write("scripts/missing-eslint.ts", "// eslint-disable-next-line rule-a\nconst x = 1;\n");
    write("scripts/missing-oxlint.ts", "/* oxlint-disable */\nconst x = 1;\n");
    write("scripts/biome-no-colon.ts", "// biome-ignore format\nconst x = 1;\n");
    write("scripts/biome-no-reason.ts", "// biome-ignore format:\nconst x = 1;\n");
    commit("add missing-reason comments");
    const result = check();
    expect(result.code).toBe(3);
    expect(result.out.startsWith("no reason\n")).toBe(true);
    expect((result.out.match(/reason: missing/gu) ?? []).length).toBe(3);
    expect(result.out).not.toContain("biome-no-colon.ts");
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
        `- settings ${path} (${path === "package.json" ? "changed" : "added"})`,
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
    expect(removed.out).toContain("- settings .oxlintrc.json (deleted)");
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
    const idBefore = /\(id (comment:[0-9a-f]{16})\)/u.exec(before.out)?.[1];
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
    const idAfter = /\(id (comment:[0-9a-f]{16})\)/u.exec(after.out)?.[1];
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
    const idBefore = /\(id (comment:[0-9a-f]{16})\)/u.exec(before.out)?.[1];
    write(
      "scripts/moved.ts",
      'const face = "😀";\n\n// @ts-ignore generated typing\nconst value: number = 1;\n',
    );
    commit("move switch-off down a line");
    const after = check();
    const idAfter = /\(id (comment:[0-9a-f]{16})\)/u.exec(after.out)?.[1];
    expect(idAfter).toBe(idBefore);
    expect(after.out).toContain("scripts/moved.ts:3");
  });

  test("lists check-setting changes, including scripts, and ignores dependency-only edits", () => {
    freshRepo("settings");
    write("package.json", '{"scripts":{"check":"bunx oxlint"},"devDependencies":{}}\n');
    write(".oxlintrc.json", '{"rules":{"example":"off"}}\n');
    write("nested/tsconfig.json", '{"compilerOptions":{"strict":false}}\n');
    commit("change check settings");
    let result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("- settings package.json (changed)");
    expect(result.out).toContain("- settings .oxlintrc.json (added)");
    expect(result.out).toContain("- settings nested/tsconfig.json (added)");
    expect(result.out).toContain("bunx oxlint");

    write(
      "package.json",
      '{"scripts":{"check":"bunx oxlint"},"devDependencies":{"example":"1"}}\n',
    );
    commit("add dependency only");
    result = check();
    expect(result.out).toContain("- settings package.json (changed)"); // Earlier script change remains new to the merge base.

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

  test("touching a base file past its comment's block still lists nothing", () => {
    freshRepo("touch-base");
    git(repo, "checkout", "-q", "main");
    write(
      "scripts/so-base.ts",
      "export function f(): void {\n  // oxlint-disable-line no-debugger -- from main\n  debugger;\n}\n",
    );
    commit("base comment on main");
    git(repo, "checkout", "-q", "-B", "ticket", "main");
    write("scripts/plain.ts", "export const x = 1;\n");
    commit("plain work");
    const first = check();
    expect(first.code).toBe(0);
    expect(first.out).toBe("clear\n## Switch-offs\n\nnone");
    write(
      "scripts/so-base.ts",
      "export function f(): void {\n  // oxlint-disable-line no-debugger -- from main\n  debugger;\n}\n\nexport const more = 2;\n",
    );
    commit("touch the base file past the block");
    const second = check();
    expect(second.code).toBe(0);
    expect(second.out).toBe("clear\n## Switch-offs\n\nnone");
  });

  test("touching a base file inside a top-level window lists the comment", () => {
    freshRepo("touch-window");
    git(repo, "checkout", "-q", "main");
    write("scripts/so-base.ts", "// oxlint-disable-line no-debugger -- from main\n;");
    commit("base comment on main");
    git(repo, "checkout", "-q", "-B", "ticket", "main");
    write(
      "scripts/so-base.ts",
      "// oxlint-disable-line no-debugger -- from main\n;\nexport const more = 2;\n",
    );
    commit("touch inside the window");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/so-base.ts:1 oxlint-disable-line no-debugger");
  });

  test("matches approval records from both the run log and project ledger", () => {
    freshRepo("approval");
    write("scripts/approved.ts", "// @ts-nocheck generated source\nexport const value = 1;\n");
    write(".oxlintrc.json", '{"rules":{"example":"off"}}\n');
    commit("add approved switch-off");
    const pending = check();
    const ids = [...pending.out.matchAll(/\(id ((?:comment|settings):[0-9a-f]{16})\)/gu)].map(
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
    expect(approved.out).toContain("(approved)");
  });

  test("a refusal is held and a changed covered line requires a new approval", () => {
    freshRepo("refusal");
    write(
      "scripts/refused.ts",
      "// @ts-expect-error known generated mismatch\nconst value: number = 1;\n",
    );
    commit("add switch-off");
    const first = check();
    const id = /\(id (comment:[0-9a-f]{16})\)/u.exec(first.out)?.[1];
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
    expect(changed.out).toContain("-- reason: known generated mismatch");
    expect(changed.out).not.toContain(`(id ${id})`);
  });

  test("records that are not this run's word are ignored with a warning, never obeyed", () => {
    freshRepo("stale-approvals");
    write("scripts/held.ts", "// @ts-ignore held reason\nconst x: string = 1;\n");
    commit("add switch-off");
    const id = /\(id (comment:[0-9a-f]{16})\)/u.exec(check().out)?.[1];
    expect(id).toBeDefined();
    const dispatch = join(repo, ".postmaster", "runs", "TEST-3");
    mkdirSync(dispatch, { recursive: true });
    const actionsPath = join(dispatch, "actions.jsonl");
    const line = (rec: Record<string, unknown>): string => `${JSON.stringify(rec)}\n`;
    const valid = {
      run: "TEST-3",
      actor: "postmaster",
      action: "switch-off",
      target: id,
      detail: "approved scripts/held.ts:1 ts-ignore -- yes",
    };
    writeFileSync(
      actionsPath,
      "this line is not JSON\n" +
        line({ ...valid, run: "OTHER-9" }) +
        line({ ...valid, actor: "lane:mimo" }) +
        line({ ...valid, detail: "maybe yes" }) +
        line({ ...valid, detail: "approved scripts/held.ts:1" }),
    );
    const ledgerPath = join(repo, ".postmaster", "runs", "ledger.jsonl");
    mkdirSync(join(repo, ".postmaster", "runs"), { recursive: true });
    writeFileSync(
      ledgerPath,
      line({ ...valid, run: "OTHER-9" }) + line({ ...valid, detail: "approved scripts/held.ts:1" }),
    );
    const held = run(
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
    expect(held.code).toBe(2);
    expect(held.err).toContain("ignoring");
    const logged = run(
      SELF,
      ["log-action", dispatch, "postmaster", "switch-off", id!, "approved", "yes, keep it"],
      { env: CLEAN_GIT_ENV },
    );
    expect(logged.code).toBe(0);
    const clear = run(
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
    expect(clear.code).toBe(0);
  });

  test("a biome-ignore window covers its node and the rest of its block", () => {
    freshRepo("biome-node");
    const node = (a: string, after: string): string =>
      [
        "// biome-ignore format: generated table",
        "const table = {",
        `  a: ${a},`,
        "};",
        `const after = ${after};`,
        "",
      ].join("\n");
    const idOf = (out: string): string | undefined =>
      /\(id (comment:[0-9a-f]{16})\)/u.exec(out)?.[1];
    write("scripts/node.ts", node("1", "2"));
    commit("add biome node");
    const first = check();
    expect(first.code).toBe(2);
    const id = idOf(first.out);
    expect(id).toBeDefined();
    write("scripts/node.ts", node("2", "2"));
    commit("edit a later line of the node");
    const edited = idOf(check().out);
    expect(edited).toBeDefined();
    expect(edited).not.toBe(id);
    write("scripts/node.ts", node("2", "3"));
    commit("edit past the node");
    expect(idOf(check().out)).not.toBe(edited);
  });

  test("a partial enable narrows a block instead of ending it", () => {
    freshRepo("partial-enable");
    const idOf = (out: string): string | undefined =>
      /\(id (comment:[0-9a-f]{16})\)/u.exec(out)?.[1];
    write(
      "scripts/partial.ts",
      [
        "/* eslint-disable rule-a, rule-b -- two rules */",
        "const first = 1;",
        "/* eslint-enable rule-a */",
        "const second = 2;",
        "",
      ].join("\n"),
    );
    commit("add narrowed block");
    const id = idOf(check().out);
    expect(id).toBeDefined();
    write(
      "scripts/partial.ts",
      [
        "/* eslint-disable rule-a, rule-b -- two rules */",
        "const first = 1;",
        "/* eslint-enable rule-a */",
        "const second = 2;",
        "const third = 3;",
        "",
      ].join("\n"),
    );
    commit("append code still suppressed by rule-b");
    const grown = idOf(check().out);
    expect(grown).toBeDefined();
    expect(grown).not.toBe(id);
  });

  test("closes match opens across the linter's two spellings", () => {
    freshRepo("cross-spelling");
    const idOf = (out: string): string | undefined =>
      /\(id (comment:[0-9a-f]{16})\)/u.exec(out)?.[1];
    write(
      "scripts/cross.ts",
      [
        "/* eslint-disable rule-a -- one rule */",
        "const first = 1;",
        "/* oxlint-enable rule-a */",
        "const second = 2;",
        "",
      ].join("\n"),
    );
    commit("add cross-spelling block");
    const id = idOf(check().out);
    expect(id).toBeDefined();
    write(
      "scripts/cross.ts",
      [
        "/* eslint-disable rule-a -- one rule */",
        "const first = 1;",
        "/* oxlint-enable rule-a */",
        "const second = 2;",
        "const third = 3;",
        "",
      ].join("\n"),
    );
    commit("append past the close");
    expect(idOf(check().out)).toBe(id);
  });

  test("a bare enable ends bare disables only", () => {
    freshRepo("bare-enable");
    const idFor = (out: string, name: string): string | undefined =>
      new RegExp(`scripts/${name}:[0-9]+ [^(]*\\(id (comment:[0-9a-f]{16})\\)`, "u").exec(out)?.[1];
    write(
      "scripts/named.ts",
      [
        "/* eslint-disable rule-a -- named */",
        "const first = 1;",
        "/* eslint-enable */",
        "const second = 2;",
        "",
      ].join("\n"),
    );
    write(
      "scripts/bare.ts",
      [
        "/* eslint-disable -- all */",
        "const first = 1;",
        "/* eslint-enable */",
        "const second = 2;",
        "",
      ].join("\n"),
    );
    commit("add blocks");
    const first = check();
    expect(first.code).toBe(2);
    const namedId = idFor(first.out, "named.ts");
    const bareId = idFor(first.out, "bare.ts");
    expect(namedId).toBeDefined();
    expect(bareId).toBeDefined();
    write(
      "scripts/named.ts",
      [
        "/* eslint-disable rule-a -- named */",
        "const first = 1;",
        "/* eslint-enable */",
        "const second = 2;",
        "const third = 3;",
        "",
      ].join("\n"),
    );
    write(
      "scripts/bare.ts",
      [
        "/* eslint-disable -- all */",
        "const first = 1;",
        "/* eslint-enable */",
        "const second = 2;",
        "const third = 3;",
        "",
      ].join("\n"),
    );
    commit("append past both closes");
    const second = check().out;
    expect(idFor(second, "named.ts")).not.toBe(namedId);
    expect(idFor(second, "bare.ts")).toBe(bareId);
  });

  test("a refusal stands even when an approval for the same entry is recorded", () => {
    freshRepo("refusal-sticky");
    write("scripts/held.ts", "// @ts-ignore held reason\nconst x: string = 1;\n");
    commit("add switch-off");
    const id = /\(id (comment:[0-9a-f]{16})\)/u.exec(check().out)?.[1];
    expect(id).toBeDefined();
    const record = (dispatch: string, decision: string, words: string): void => {
      const r = run(
        SELF,
        ["log-action", dispatch, "postmaster", "switch-off", id!, decision, words],
        { env: CLEAN_GIT_ENV },
      );
      expect(r.code).toBe(0);
    };
    const statusOf = (dispatch: string): { code: number; out: string } =>
      call("--repo", repo, "--default", "main", "--ticket", "ticket", "--dispatch", dispatch);
    const refusedFirst = join(repo, ".postmaster", "runs", "TEST-4");
    mkdirSync(refusedFirst, { recursive: true });
    record(refusedFirst, "refused", "remove this suppression");
    record(refusedFirst, "approved", "changed my mind");
    const first = statusOf(refusedFirst);
    expect(first.code).toBe(4);
    expect(first.out.startsWith("refused\n")).toBe(true);
    const approvedFirst = join(repo, ".postmaster", "runs", "TEST-4b");
    mkdirSync(approvedFirst, { recursive: true });
    record(approvedFirst, "approved", "looks fine");
    record(approvedFirst, "refused", "on reflection remove it");
    const second = statusOf(approvedFirst);
    expect(second.code).toBe(4);
    expect(second.out.startsWith("refused\n")).toBe(true);
  });

  test("a settings diff shows even under a colon-led directory", () => {
    freshRepo("colon-settings");
    write(":odd/bunfig.toml", "x = 1\n");
    commit("add colon settings");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("- settings :odd/bunfig.toml (added)");
    expect(result.out).toContain("x = 1");
    expect(result.out).not.toContain("(no textual diff)");
  });

  test("an unreadable source blob fails the check instead of reporting clear", () => {
    freshRepo("unreadable");
    write("scripts/real.ts", "export const ok = true;\n");
    git(repo, "add", "-A");
    git(
      repo,
      "update-index",
      "--add",
      "--cacheinfo",
      "160000",
      git(repo, "rev-parse", "HEAD"),
      "scripts/ghost.ts",
    );
    git(repo, "commit", "-qm", "add unreadable source path");
    const result = check();
    expect(result.code).toBe(1);
    expect(result.out).toContain("cannot read scripts/ghost.ts");
  });

  test("triple-slash TypeScript suppressions are listed", () => {
    freshRepo("triple-slash");
    write("scripts/triple.ts", "/// @ts-ignore triple reason\nconst a: number = 1;\n");
    write("scripts/nocheck.ts", "/// @ts-nocheck triple file\nconst b: number = 2;\n");
    commit("add triple-slash suppressions");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/triple.ts:1 ts-ignore");
    expect(result.out).toContain("scripts/nocheck.ts:1 ts-nocheck");
  });

  test("TypeScript reads block directives on the last line only", () => {
    freshRepo("ts-block-line");
    write("scripts/last.ts", "/*\n@ts-ignore last reason */\nconst a: number = 1;\n");
    write("scripts/first.ts", "/* @ts-ignore first reason\nmore text */\nconst b: number = 2;\n");
    write("scripts/star.ts", "// * @ts-ignore star reason\nconst c: number = 3;\n");
    commit("add block placements");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/last.ts:1 ts-ignore");
    expect(result.out).not.toContain("scripts/first.ts");
    expect(result.out).not.toContain("scripts/star.ts");
  });

  test("a TS window holds every line below, skipped or not", () => {
    freshRepo("ts-skip");
    const idFor = (out: string, name: string): string | undefined =>
      new RegExp(`scripts/${name}:[0-9]+ [^(]*\\(id (comment:[0-9a-f]{16})\\)`, "u").exec(out)?.[1];
    write("scripts/blank.ts", "// @ts-ignore blank reason\n\nconst a = 1;\n");
    write("scripts/remark.ts", "// @ts-ignore remark reason\n// a remark\nconst b = 2;\n");
    write("scripts/block.ts", "// @ts-ignore block reason\n/* middle */\nconst c = 3;\n");
    write("scripts/mixed.ts", "// @ts-ignore mixed reason\n// remark /* x */\nconst d = 4;\n");
    commit("add skipped lines");
    const first = check();
    expect(first.code).toBe(2);
    const blank = idFor(first.out, "blank.ts");
    const remark = idFor(first.out, "remark.ts");
    const blocked = idFor(first.out, "block.ts");
    const mixed = idFor(first.out, "mixed.ts");
    expect(blank).toBeDefined();
    expect(remark).toBeDefined();
    expect(blocked).toBeDefined();
    expect(mixed).toBeDefined();
    write("scripts/blank.ts", "// @ts-ignore blank reason\n\nconst a = 10;\n");
    write("scripts/remark.ts", "// @ts-ignore remark reason\n// a remark\nconst b = 20;\n");
    write("scripts/block.ts", "// @ts-ignore block reason\n/* middle */\nconst c = 30;\n");
    write("scripts/mixed.ts", "// @ts-ignore mixed reason\n// remark /* x */\nconst d = 40;\n");
    commit("edit the code below each skip");
    const second = check().out;
    expect(idFor(second, "blank.ts")).not.toBe(blank);
    expect(idFor(second, "remark.ts")).not.toBe(remark);
    expect(idFor(second, "block.ts")).not.toBe(blocked);
    expect(idFor(second, "mixed.ts")).not.toBe(mixed);
  });

  test("linter block rules run across the block's lines", () => {
    freshRepo("lint-multiline");
    write(
      "scripts/multi.ts",
      "/* eslint-disable\nno-debugger -- split rules */\ndebugger;\nvar q = 1;\n",
    );
    commit("add split rules");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("multi.ts:1 eslint-disable no-debugger -- reason: split rules");
  });

  test("linter closes match rules across the block's lines", () => {
    freshRepo("lint-close-lines");
    const idOf = (out: string): string | undefined =>
      /\(id (comment:[0-9a-f]{16})\)/u.exec(out)?.[1];
    write(
      "scripts/closed.ts",
      "/* eslint-disable rule-a -- solo */\nconst a = 1;\n/* eslint-enable\nrule-a */\nconst b = 2;\n",
    );
    commit("add cross-line close");
    const id = idOf(check().out);
    expect(id).toBeDefined();
    write(
      "scripts/closed.ts",
      "/* eslint-disable rule-a -- solo */\nconst a = 1;\n/* eslint-enable\nrule-a */\nconst b = 2;\nconst c = 3;\n",
    );
    commit("append past the close");
    expect(idOf(check().out)).toBe(id);
  });

  test("Biome matches a block directive on any line", () => {
    freshRepo("biome-block-line");
    write(
      "scripts/mid.ts",
      "/* suppress the table\nbiome-ignore format: mid reason\ntrailing note */\nconst   x    =    1;\n",
    );
    commit("add mid-block biome directive");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/mid.ts:1 biome-ignore format -- reason: mid reason");
  });

  test("a directive trailing JSX text is listed", () => {
    freshRepo("jsx-trail");
    write(
      "scripts/el.tsx",
      "const el = <div>see https://docs.example</div>; debugger; // eslint-disable-line no-debugger -- jsx trail\n",
    );
    commit("add jsx trailing directive");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/el.tsx:1 eslint-disable-line no-debugger");
  });

  test("a quote in JSX text hides no trailing directive", () => {
    freshRepo("jsx-quote");
    write(
      "scripts/q.tsx",
      "const el = <div>don't panic</div>; debugger; // eslint-disable-line no-debugger -- jsx quote\n",
    );
    commit("add jsx quote case");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/q.tsx:1 eslint-disable-line no-debugger");
  });

  test("an unclosed quote in JSX text hides no trailing directive", () => {
    freshRepo("jsx-unclosed");
    write(
      "scripts/uq.tsx",
      "<p>Note: 'hello</p>; debugger; // eslint-disable-line no-debugger -- jsx unclosed quote\n",
    );
    commit("add jsx unclosed quote case");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/uq.tsx:1 eslint-disable-line no-debugger");
  });

  test("an unclosed quote before a tag close hides no trailing directive", () => {
    freshRepo("jsx-unclosed-slash");
    write(
      "scripts/us.tsx",
      'const el = <p>Tip: "/</p>; debugger; // eslint-disable-line no-debugger -- rescan slash\n',
    );
    commit("add jsx unclosed slash case");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/us.tsx:1 eslint-disable-line no-debugger");
  });

  test("a Biome window reaches past the node into its block", () => {
    freshRepo("biome-window");
    const idOf = (out: string): string | undefined =>
      /\(id (comment:[0-9a-f]{16})\)/u.exec(out)?.[1];
    write(
      "scripts/w.ts",
      "// biome-ignore lint/suspicious/noExplicitAny: window reason\nconst x: any = make(1);\nconst later = 1;\n",
    );
    commit("add biome window case");
    const before = idOf(check().out);
    expect(before).toBeDefined();
    write(
      "scripts/w.ts",
      "// biome-ignore lint/suspicious/noExplicitAny: window reason\nconst x: any = make(1);\nconst later = 2;\n",
    );
    commit("edit later in the block");
    expect(idOf(check().out)).not.toBe(before);
  });

  test("a TS window reaches past the covered line into its block", () => {
    freshRepo("ts-window");
    const idOf = (out: string): string | undefined =>
      /\(id (comment:[0-9a-f]{16})\)/u.exec(out)?.[1];
    write("scripts/w.ts", "// @ts-ignore window reason\nconst x: string = 1;\nconst later = 1;\n");
    commit("add ts window case");
    const before = idOf(check().out);
    expect(before).toBeDefined();
    write("scripts/w.ts", "// @ts-ignore window reason\nconst x: string = 1;\nconst later = 2;\n");
    commit("edit later in the block");
    expect(idOf(check().out)).not.toBe(before);
  });

  test("a Biome window covers an implicit continuation", () => {
    freshRepo("biome-continuation");
    const idOf = (out: string): string | undefined =>
      /\(id (comment:[0-9a-f]{16})\)/u.exec(out)?.[1];
    write(
      "scripts/w.ts",
      "// biome-ignore lint/suspicious/noExplicitAny: window reason\nconst x: any = foo +\n  bar;\n",
    );
    commit("add biome continuation case");
    const before = idOf(check().out);
    expect(before).toBeDefined();
    write(
      "scripts/w.ts",
      "// biome-ignore lint/suspicious/noExplicitAny: window reason\nconst x: any = foo +\n  baz;\n",
    );
    commit("edit the continuation");
    expect(idOf(check().out)).not.toBe(before);
  });

  test("a block-comment next-line window covers the code after the comment", () => {
    freshRepo("block-next-window");
    const idOf = (out: string): string | undefined =>
      /\(id (comment:[0-9a-f]{16})\)/u.exec(out)?.[1];
    write("scripts/w.js", "/*\neslint-disable-next-line no-debugger -- r\n*/\ndebugger;\n");
    commit("add block next-line case");
    const before = idOf(check().out);
    expect(before).toBeDefined();
    write(
      "scripts/w.js",
      '/*\neslint-disable-next-line no-debugger -- r\n*/\nconsole.log("changed");\n',
    );
    commit("edit the covered code");
    expect(idOf(check().out)).not.toBe(before);
  });

  test("a window ends at its block, not the file", () => {
    freshRepo("window-block");
    const idOf = (out: string): string | undefined =>
      /\(id (comment:[0-9a-f]{16})\)/u.exec(out)?.[1];
    write(
      "scripts/w.ts",
      "export function a(): void {\n  // @ts-ignore window reason\n  const x: string = 1;\n}\n\nexport function b(): void {}\n",
    );
    commit("add window block case");
    const before = idOf(check().out);
    expect(before).toBeDefined();
    write(
      "scripts/w.ts",
      "export function a(): void {\n  // @ts-ignore window reason\n  const x: string = 1;\n}\n\nexport function b(): number {\n  return 2;\n}\n",
    );
    commit("edit past the block");
    expect(idOf(check().out)).toBe(before);
  });

  test("main's launch comments stay silent when a run edits below their blocks", () => {
    freshRepo("launch-control");
    const launch = (tail: string): string =>
      `export function shellQuote(s: string): string {\n  if (s === "") return "''";\n  // eslint-disable-next-line no-control-regex\n  if (/[\\x00-\\x1f]/u.test(s)) return "bad";\n  // eslint-disable-next-line no-control-regex\n  return s.replace(/[\\x00-\\x1f]/gu, "?");\n}\n${tail}`;
    write("scripts/q.ts", launch(""));
    commit("base with main's comments");
    git(repo, "checkout", "-qb", "ticket2");
    write("scripts/q.ts", `${launch("")}\nexport function helper(): number {\n  return 1;\n}\n`);
    commit("edit below the blocks");
    const result = call("--repo", repo, "--default", "ticket", "--ticket", "ticket2");
    expect(result.code).toBe(0);
    expect(result.out).toContain("clear");
  });

  test("identical twins hold distinct approval identities", () => {
    freshRepo("twin-ids");
    write(
      "scripts/t.ts",
      "export function f(): void {\n  // eslint-disable-next-line no-debugger -- same\n  debugger;\n}\nexport function g(): void {\n  // eslint-disable-next-line no-debugger -- same\n  debugger;\n}\n",
    );
    commit("add twins");
    const ids = [...check().out.matchAll(/\(id (comment:[0-9a-f]{16})\)/gu)].map(
      (match) => match[1]!,
    );
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    const dispatch = join(repo, ".postmaster", "runs", "TEST-TWIN");
    mkdirSync(dispatch, { recursive: true });
    const line = (rec: Record<string, unknown>): string => `${JSON.stringify(rec)}\n`;
    const approval = {
      run: "TEST-TWIN",
      actor: "postmaster",
      action: "switch-off",
      target: ids[0],
      detail: "approved scripts/t.ts:2 eslint-disable-line -- yes",
    };
    writeFileSync(join(dispatch, "actions.jsonl"), line(approval));
    writeFileSync(join(repo, ".postmaster", "runs", "ledger.jsonl"), line(approval));
    const held = check("--dispatch", dispatch);
    expect(held.code).toBe(2);
    expect(held.out).toContain(`(id ${ids[1]})`);
    expect(held.out.match(/\(approved\)/gu) ?? []).toHaveLength(1);
  });

  test("main's launch comments are listed when a run edits inside their window", () => {
    freshRepo("launch-window");
    write(
      "scripts/q.ts",
      'export function shellQuote(s: string): string {\n  if (s === "") return "\'\'";\n  // eslint-disable-next-line no-control-regex\n  if (/[\\x00-\\x1f]/u.test(s)) return "bad";\n  return s;\n}\n',
    );
    commit("base with main's comment");
    git(repo, "checkout", "-qb", "ticket2");
    write(
      "scripts/q.ts",
      'export function shellQuote(s: string): string {\n  if (s === "") return "\'\'";\n  // eslint-disable-next-line no-control-regex\n  if (/[\\x20-\\x7e]/u.test(s)) return "bad";\n  return s;\n}\n',
    );
    commit("edit inside the window");
    const result = call("--repo", repo, "--default", "ticket", "--ticket", "ticket2");
    expect(result.code).toBe(3);
    expect(result.out).toContain("no-control-regex");
  });

  for (const [name, content] of [
    [".oxlintrc.jsonc", '{"rules":{}}\n'],
    ["oxlint.config.ts", "export default {};\n"],
    ["oxlint.config.mts", "export default {};\n"],
    [".biome.json", '{"linter":{}}\n'],
    [".biome.jsonc", '{"linter":{}}\n'],
  ] as const) {
    test(`a ${name} change alone is listed`, () => {
      freshRepo(`settings-${name.replace(/[^a-z]+/gu, "-")}`);
      write(name, content);
      commit(`add ${name}`);
      const result = check();
      expect(result.code).toBe(2);
      expect(result.out).toContain(`- settings ${name} (added)`);
    });
  }

  test("a nested oxlint jsonc change is listed", () => {
    freshRepo("settings-nested");
    write("scripts/sub/.oxlintrc.jsonc", '{"rules":{}}\n');
    commit("add nested jsonc");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("- settings scripts/sub/.oxlintrc.jsonc (added)");
  });

  test("a file the parser cannot read fails loud, never clear", () => {
    freshRepo("unparseable");
    write(
      "scripts/broken.ts",
      'const s = "oops;\n// @ts-ignore real reason\nconst x: string = 1;\n',
    );
    commit("add unparseable file");
    const result = check();
    expect(result.code).toBe(1);
    expect(result.out).toContain("refusing to report clear over unparseable input");
  });

  test("a decorated file lists its directives", () => {
    freshRepo("decorated");
    write(
      "scripts/deco.ts",
      "@Component\nexport class A {\n  // @ts-ignore window reason\n  field: string = 1;\n}\n",
    );
    commit("add decorated file");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/deco.ts:3 ts-ignore");
  });

  test("module extensions list their directives", () => {
    freshRepo("extensions");
    write("scripts/m.mts", "// @ts-ignore m reason\nconst x: string = 1;\n");
    write("scripts/c.cts", "// @ts-ignore c reason\nconst y: string = 2;\n");
    write("scripts/e.mjs", "/* eslint-disable -- e reason */\ndebugger;\n");
    write("scripts/j.cjs", "/* eslint-disable -- j reason */\ndebugger;\n");
    commit("add module files");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/m.mts:1 ts-ignore");
    expect(result.out).toContain("scripts/c.cts:1 ts-ignore");
    expect(result.out).toContain("scripts/e.mjs:1 eslint-disable");
    expect(result.out).toContain("scripts/j.cjs:1 eslint-disable");
  });

  test("a divide after a non-null assertion hides no trailing directive", () => {
    freshRepo("nonnull-divide");
    write(
      "scripts/n.ts",
      "export function h(size: number): void {\n  const half = size! / 2; // @ts-ignore the caller narrows it\n  const label: string = half;\n}\n",
    );
    commit("add non-null divide case");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/n.ts:2 ts-ignore");
  });

  test("a glob in a quoted member hides no later directive", () => {
    freshRepo("quoted-glob");
    write(
      "scripts/g.ts",
      'export interface Routes {\n  readonly "/api/*": string;\n}\nexport function f(): number {\n  // @ts-ignore the caller narrows it\n  const x: string = 1;\n  return x.length;\n}\n',
    );
    commit("add quoted glob case");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/g.ts:5 ts-ignore");
  });

  test("a regex after an unclosed quote hides no next-line directive", () => {
    freshRepo("rescan-regex");
    write(
      "scripts/r.tsx",
      "export const tip = <p>'</p>; export const re = /\\/*/g;\n/* eslint-disable -- x */\ndebugger;\n",
    );
    commit("add rescan regex case");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/r.tsx:2 eslint-disable");
  });

  test("a regex after a condition hides no trailing directive", () => {
    freshRepo("regex-paren");
    write(
      "scripts/rx.ts",
      'const ok = true;\nconst s = "x";\nif (ok) /\\//.test(s); // @ts-ignore regex paren\nconst x: number = 1;\n',
    );
    commit("add regex paren case");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/rx.ts:3 ts-ignore");
  });

  test("a divide after plus-plus hides no trailing directive", () => {
    freshRepo("plus-div");
    write("scripts/pd.ts", "let n = 1;\nn++ / 2; // @ts-ignore plus div\nconst y: number = 2;\n");
    commit("add plus div case");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/pd.ts:2 ts-ignore");
  });

  test("U+2028 inside a string hides no later directive", () => {
    freshRepo("u2028-string");
    write("scripts/u.ts", 'const s = "a\u2028b"; // @ts-ignore u-str\nconst x: number = 1;\n');
    commit("add separator string case");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/u.ts:2 ts-ignore");
  });

  test("a control separator misaligns no covered line", () => {
    freshRepo("separator");
    const idOf = (out: string): string | undefined =>
      /\(id (comment:[0-9a-f]{16})\)/u.exec(out)?.[1];
    write("scripts/sep.ts", "const z = 0;\x0b// @ts-ignore sep reason\nconst a: number = 1;\n");
    commit("add separator case");
    const id = idOf(check().out);
    expect(id).toBeDefined();
    write("scripts/sep.ts", "const z = 0;\x0b// @ts-ignore sep reason\nconst a: number = 2;\n");
    commit("edit the covered line");
    expect(idOf(check().out)).not.toBe(id);
  });

  test("a backtick in JSX text hides no trailing directive", () => {
    // Closed r2bug-12/security-11: the miss was pinned for a future fix, and
    // the parser is that fix — the grammar tells JSX text from a template.
    freshRepo("jsx-tick");
    write(
      "scripts/t.tsx",
      "const el = <div>tick ` backtick</div>; debugger; // eslint-disable-line no-debugger -- jsx tick\n",
    );
    commit("add backtick jsx case");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/t.tsx:1 eslint-disable-line no-debugger");
  });

  test("a .ts type assertion hides no later directive", () => {
    // security-18: .ts read with the jsx plugin saw <any>v as a tag.
    freshRepo("ts-assertion");
    write(
      "scripts/assert.ts",
      'declare const v: any;\nconst a = <any>v;\n// @ts-ignore assertion reason\nconst n: number = "not a number";\nexport const b = v < /any>/g;\nexport { a, n };\n',
    );
    commit("add assertion case");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/assert.ts:3 ts-ignore");
  });

  test("a symlinked source file is scanned through the link", () => {
    // security-19: the scanner read the link's text instead of its target.
    freshRepo("symlink");
    write("scripts/evil.txt", '// @ts-ignore link reason\nexport const n: number = "x";\n');
    symlink("evil.txt", "scripts/evil.ts");
    commit("add symlinked source");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/evil.ts:1 ts-ignore");
  });

  test("a dangling source symlink fails loud", () => {
    // security-19: a link the tree cannot resolve is refused, never clear.
    freshRepo("dangling");
    symlink("missing.txt", "scripts/dangle.ts");
    commit("add dangling link");
    const result = check();
    expect(result.code).toBe(1);
    expect(result.out).toContain("cannot resolve symlink scripts/dangle.ts");
  });

  test("a chained source symlink fails loud", () => {
    // security-19: a link to a link is refused, never followed blindly.
    freshRepo("chained");
    write("scripts/real.txt", "export const ok = true;\n");
    symlink("real.txt", "scripts/mid.txt");
    symlink("mid.txt", "scripts/chain.ts");
    commit("add chained link");
    const result = check();
    expect(result.code).toBe(1);
    expect(result.out).toContain("cannot resolve symlink scripts/chain.ts");
  });

  test("a symlink leaving the tree fails loud", () => {
    // security-19: a link escaping the tree is refused, never followed.
    freshRepo("escaping");
    symlink("../outside.ts", "scripts/esc.ts");
    commit("add escaping link");
    const result = check();
    expect(result.code).toBe(1);
    expect(result.out).toContain("cannot resolve symlink scripts/esc.ts");
  });

  test("an Annex B disable comment is listed", () => {
    // security-20: Oxlint reads a script file's <!-- line as a comment.
    freshRepo("annex-b");
    write(
      "tests/foo.test.ts",
      "<!-- eslint-disable postmaster/test-beside-target -- annex reason\nvar z = 1;\n",
    );
    commit("add annex b case");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("tests/foo.test.ts:1 eslint-disable");
  });

  test("an edit to a covered line under a braced block comment asks again", () => {
    // security-22: the window stopped where braces closed on the comment line.
    freshRepo("short-window");
    git(repo, "checkout", "-q", "main");
    write(
      "scripts/own.ts",
      "export const o = { a: 1 /* @ts-ignore own reason */ };\nexport const x: number = 1;\n",
    );
    commit("block comment on main");
    git(repo, "checkout", "-q", "-B", "ticket", "main");
    write(
      "scripts/own.ts",
      'export const o = { a: 1 /* @ts-ignore own reason */ };\nexport const x: number = "now a type error";\n',
    );
    commit("edit covered line");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/own.ts:1 ts-ignore");
  });

  test("a .gitignore change is listed as a settings change", () => {
    // security-23: Oxlint obeys .gitignore when it walks the tree.
    freshRepo("gitignore");
    write(".gitignore", "node_modules/\n");
    commit("add gitignore");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain(".gitignore");
  });

  test("a directive added through an unchanged link's target is listed", () => {
    // Round 6 luna P2: the link is unchanged, so only its target is in the
    // diff, and the target's non-source name is filtered before resolving.
    freshRepo("link-target");
    git(repo, "checkout", "-q", "main");
    write("scripts/shared.txt", "export const n: number = 1;\n");
    symlink("shared.txt", "scripts/example.ts");
    commit("link and clean target on main");
    git(repo, "checkout", "-q", "-B", "ticket", "main");
    write(
      "scripts/shared.txt",
      '// @ts-ignore link target reason\nexport const n: number = "not a number";\n',
    );
    commit("add directive to target only");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/example.ts:1 ts-ignore");
  });

  test("a settings change through an unchanged link's target is listed", () => {
    // Round 6 luna P2, settings side: same root cause through settingsKind.
    freshRepo("link-settings");
    git(repo, "checkout", "-q", "main");
    write("config.txt", '{"rules":{}}\n');
    symlink("config.txt", ".oxlintrc.json");
    commit("linked settings on main");
    git(repo, "checkout", "-q", "-B", "ticket", "main");
    write("config.txt", '{"rules":{"no-debugger":"off"}}\n');
    commit("change target only");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain(".oxlintrc.json");
  });

  test("an edit to same-line code after an inline block disable asks again", () => {
    // Round 6 mimo low: the open window started after the comment's line.
    freshRepo("open-line");
    git(repo, "checkout", "-q", "main");
    write("scripts/inline.ts", "/* eslint-disable no-debugger -- r */ var z = 1;\n");
    commit("inline disable on main");
    git(repo, "checkout", "-q", "-B", "ticket", "main");
    write("scripts/inline.ts", "/* eslint-disable no-debugger -- r */ var z = 2;\n");
    commit("edit same-line trailing code");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/inline.ts:1 eslint-disable");
  });

  test("a symlinked settings change shows the target's diff", () => {
    // Round 7 luna P2: the link path has no diff, so the user approved blind.
    freshRepo("link-diff");
    git(repo, "checkout", "-q", "main");
    write("probe/config.txt", '{"rules":{}}\n');
    symlink("config.txt", "probe/.oxlintrc.json");
    commit("linked settings on main");
    git(repo, "checkout", "-q", "-B", "ticket", "main");
    write("probe/config.txt", '{"rules":{"no-debugger":"off"}}\n');
    commit("change target only");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("no-debugger");
    expect(result.out).not.toContain("(no textual diff)");
  });

  test("an edit to code before an inline close asks again", () => {
    // Round 7 opus lead: the open window stopped before the close's line.
    freshRepo("close-line");
    git(repo, "checkout", "-q", "main");
    write(
      "scripts/close.js",
      "/* eslint-disable no-debugger -- r */\ndebugger; /* eslint-enable no-debugger -- r */\n",
    );
    commit("close on a code line on main");
    git(repo, "checkout", "-q", "-B", "ticket", "main");
    write(
      "scripts/close.js",
      "/* eslint-disable no-debugger -- r */\ndebugger; debugger; /* eslint-enable no-debugger -- r */\n",
    );
    commit("edit before the close");
    const result = check();
    expect(result.code).toBe(2);
    expect(result.out).toContain("scripts/close.js:1 eslint-disable");
  });
});

describe("switch-off units", () => {
  test("the scanner tells comments from strings, templates and regexes", () => {
    const text = [
      'const a = "// @ts-ignore in-string";',
      "const b = `tpl // oxlint-disable-line x -- in-template ${1 /* real */}`;",
      "const c = /eslint-disable in-regex/;",
      "// eslint-disable-next-line no-debugger -- real-reason",
      "debugger;",
    ].join("\n");
    const cs = scanComments(text, "x.ts");
    expect(cs.length).toBe(2);
    expect(cs[0]!.line).toBe(2);
    expect(cs[0]!.raw).toBe("/* real */");
    expect(cs[1]!.line).toBe(4);
    expect(cs[1]!.raw).toBe("// eslint-disable-next-line no-debugger -- real-reason");
  });

  test("an unterminated string fails loud instead of guessing", () => {
    expect(() =>
      scanComments('const a = "oops;\n// @ts-ignore real reason\nconst x: string = 1;\n', "x.ts"),
    ).toThrow("refusing to report clear over unparseable input");
  });

  test("the scanner counts CR, CRLF and U+2028 as line breaks", () => {
    const cr = scanComments(
      "const a = 1;\r// @ts-ignore cr reason\rconst x: string = 1;\r",
      "x.ts",
    );
    expect(cr.length).toBe(1);
    expect(cr[0]!.line).toBe(2);
    expect(cr[0]!.raw).toBe("// @ts-ignore cr reason");
    const crlf = scanComments(
      "const a = 1;\r\n// @ts-ignore crlf reason\r\nconst x: string = 1;\r\n",
      "x.ts",
    );
    expect(crlf.length).toBe(1);
    expect(crlf[0]!.line).toBe(2);
    const u = scanComments(
      "const a = 1;\u2028// @ts-ignore u reason\u2028const x: string = 1;\n",
      "x.ts",
    );
    expect(u.length).toBe(1);
    expect(u[0]!.line).toBe(2);
    const block = scanComments("/* one\r two */\n// @ts-ignore block reason\ncode;\n", "x.ts");
    expect(block.length).toBe(2);
    expect(block[1]!.line).toBe(3);
  });

  test("the scanner tells JSX text and operands from strings", () => {
    const jsx = scanComments("const el = <div>don't</div>; // @ts-ignore r\ncode;\n", "x.tsx");
    expect(jsx.length).toBe(1);
    expect(jsx[0]!.line).toBe(1);
    const paren = scanComments("if (a) /\\//.test(b); // c\ncode;\n", "x.ts");
    expect(paren.length).toBe(1);
    expect(paren[0]!.raw).toBe("// c");
    const plus = scanComments("n++ / 2; // c\ncode;\n", "x.ts");
    expect(plus.length).toBe(1);
    const prop = scanComments("x.if(y) / 2; // c\ncode;\n", "x.ts");
    expect(prop.length).toBe(1);
    const prologue = scanComments("if (a) 'b'; // c\ncode;\n", "x.ts");
    expect(prologue.length).toBe(1);
  });

  test("the scanner keeps U+2028 inside strings and fails a raw one in a regex", () => {
    const ustr = scanComments('const s = "a\u2028b"; // c\ncode;\n', "x.ts");
    expect(ustr.length).toBe(1);
    expect(ustr[0]!.line).toBe(2);
    // A raw U+2028 ends a regex literal by the grammar (Oxlint rejects it),
    // so the file fails loud instead of guessing where the pattern ends.
    expect(() => scanComments("const r = /a\u2028b\\/\\//; // d\ncode;\n", "x.ts")).toThrow(
      "refusing to report clear over unparseable input",
    );
  });

  test("parseSwitchOff reads each form and its reason", () => {
    expect(parseSwitchOff("// @ts-ignore")).toEqual({
      form: "ts-ignore",
      scope: "next",
      tool: "ts",
      rules: "every rule",
      reason: null,
    });
    expect(parseSwitchOff("/** @ts-ignore JSDoc reason */")).toEqual({
      form: "ts-ignore",
      scope: "next",
      tool: "ts",
      rules: "every rule",
      reason: "JSDoc reason",
    });
    expect(parseSwitchOff("// @ts-nocheck")).toEqual({
      form: "ts-nocheck",
      scope: "file",
      tool: "ts",
      rules: "every rule",
      reason: null,
    });
    expect(parseSwitchOff("/* eslint-disable -- a reason */")).toEqual({
      form: "eslint-disable",
      scope: "open",
      tool: "linter",
      rules: "every rule",
      reason: "a reason",
    });
    expect(parseSwitchOff("// eslint-disable-line no-console")).toEqual({
      form: "eslint-disable-line",
      scope: "line",
      tool: "linter",
      rules: "no-console",
      reason: null,
    });
    expect(parseSwitchOff("/* oxlint-enable no-debugger */")).toEqual({
      form: "oxlint-enable",
      scope: "close",
      tool: "linter",
      rules: "no-debugger",
      reason: null,
    });
    expect(parseSwitchOff("// biome-ignore-all lint/suspicious: why")).toEqual({
      form: "biome-ignore-all",
      scope: "file",
      tool: "biome",
      rules: "lint/suspicious",
      reason: "why",
    });
    expect(parseSwitchOff("// biome-ignore format")).toBeNull();
    expect(parseSwitchOff("// biome-ignore format: ")).toBeNull();
    expect(parseSwitchOff("// a plain comment")).toBeNull();
  });

  test("parseSwitchOff honors only a directive that starts the comment", () => {
    expect(parseSwitchOff("/* prefix eslint-disable */")).toBeNull();
    expect(parseSwitchOff("// prefix @ts-ignore")).toBeNull();
    expect(parseSwitchOff("/**\n * eslint-disable-next-line no-debugger\n */")).toBeNull();
    expect(parseSwitchOff("/* a note\neslint-disable-next-line no-debugger\n*/")).toBeNull();
    expect(parseSwitchOff("/** eslint-disable-next-line no-debugger -- r */")).toBeNull();
    expect(parseSwitchOff("/**\n * @ts-ignore r\n */")).toBeNull();
    expect(parseSwitchOff("/*\neslint-disable-next-line no-debugger -- r\n*/")).toEqual({
      form: "eslint-disable-next-line",
      scope: "next",
      tool: "linter",
      rules: "no-debugger",
      reason: "r",
    });
  });

  test("parseSwitchOff reads each tool's line", () => {
    expect(parseSwitchOff("/// @ts-ignore r")).toEqual({
      form: "ts-ignore",
      scope: "next",
      tool: "ts",
      rules: "every rule",
      reason: "r",
    });
    expect(parseSwitchOff("//// @ts-expect-error r")).toEqual({
      form: "ts-expect-error",
      scope: "next",
      tool: "ts",
      rules: "every rule",
      reason: "r",
    });
    expect(parseSwitchOff("// // @ts-ignore r")).toBeNull();
    expect(parseSwitchOff("/// eslint-disable-next-line a -- r")).toBeNull();
    expect(parseSwitchOff("/// biome-ignore format: r")).toBeNull();
    expect(parseSwitchOff("// * @ts-ignore r")).toBeNull();
    expect(parseSwitchOff("/*\n@ts-ignore r */")).toEqual({
      form: "ts-ignore",
      scope: "next",
      tool: "ts",
      rules: "every rule",
      reason: "r",
    });
    expect(parseSwitchOff("/* @ts-ignore r\nmore */")).toBeNull();
    expect(parseSwitchOff("/*\n * @ts-ignore r */")).toEqual({
      form: "ts-ignore",
      scope: "next",
      tool: "ts",
      rules: "every rule",
      reason: "r",
    });
    // tsc skips slash and star runs before @ on a block's last line (probed
    // in round 5), so the superset rule lists this; the old null hid it.
    expect(parseSwitchOff("/* // @ts-ignore r */")).toEqual({
      form: "ts-ignore",
      scope: "next",
      tool: "ts",
      rules: "every rule",
      reason: "r",
    });
    expect(parseSwitchOff("/* eslint-disable\nno-debugger -- r */")).toEqual({
      form: "eslint-disable",
      scope: "open",
      tool: "linter",
      rules: "no-debugger",
      reason: "r",
    });
    expect(parseSwitchOff("/* header\neslint-disable a -- r */")).toBeNull();
    expect(parseSwitchOff("/*\nbiome-ignore format: r\n*/")).toEqual({
      form: "biome-ignore",
      scope: "next",
      tool: "biome",
      rules: "format",
      reason: "r",
    });
    expect(parseSwitchOff("/* biome-ignore\nformat: r */")).toBeNull();
    expect(parseSwitchOff("// * biome-ignore format: r")).toBeNull();
  });

  test("package.json differs only on scripts or a tool's settings block", () => {
    expect(packageSettingsDiffer(null, '{"dependencies":{"x":"1"}}')).toBe(false);
    expect(packageSettingsDiffer('{"scripts":{"check":"a"}}', '{"scripts":{"check":"b"}}')).toBe(
      true,
    );
    expect(
      packageSettingsDiffer(
        '{"scripts":{"check":"a"},"dependencies":{"x":"1"}}',
        '{"scripts":{"check":"a"},"dependencies":{"x":"2"}}',
      ),
    ).toBe(false);
    expect(packageSettingsDiffer(null, '{"scripts":{"check":"a"}}')).toBe(true);
    expect(packageSettingsDiffer("{broken", '{"scripts":{}}')).toBe(true);
    expect(
      packageSettingsDiffer('{"prettier":{"x":1}}', '{"prettier":{"x":2},"scripts":{"c":"a"}}'),
    ).toBe(true);
  });

  test("module extensions read assertions as code, not tags", () => {
    // security-18: without the jsx plugin <any>v is an assertion.
    const text =
      'declare const v: any;\nconst a = <any>v;\n// @ts-ignore module reason\nconst n: number = "x";\n';
    for (const name of ["x.ts", "x.mts", "x.cts"]) {
      expect(scanComments(text, name).length).toBe(1);
    }
  });

  test("a recovered parse fails loud instead of listing nothing", () => {
    // security-20: recovery invents structure that can hide a directive.
    expect(() => scanComments("x <!-- eslint-disable -- r\nvar z = 1;\n", "probe/x.js")).toThrow(
      "refusing to report clear over unparseable input",
    );
  });

  test("a script-only comment reaches the comment list", () => {
    // security-20: x <!--eslint-disable is valid module code with no comment.
    const cs = scanComments("x <!--eslint-disable\nvar z = 1;\n", "probe/x.js");
    expect(cs.length).toBe(1);
    expect(cs[0]!.raw).toBe("<!--eslint-disable");
  });

  test("parseSwitchOff counts any spelling or case of a directive word", () => {
    // security-17/security-21: the tools match loosely, so the check matches looser.
    for (const raw of [
      "// @ts-ignore-next-line -- r",
      "// @ts-ignorefoo -- r",
      "// @TS-IGNORE -- r",
      "/*/ @ts-ignore -- r */",
      "/*// @ts-ignore -- r */",
      "/* // @ts-ignore -- r */",
      "// @ts-expect-errors -- r",
      "/** @TS-EXPECT-ERROR-X r */",
    ]) {
      const off = parseSwitchOff(raw);
      expect(off?.tool).toBe("ts");
      expect(off?.scope).toBe("next");
    }
    expect(parseSwitchOff("// @ts-nocheck_x file reason")).toEqual({
      form: "ts-nocheck",
      scope: "file",
      tool: "ts",
      rules: "every rule",
      reason: "_x file reason",
    });
    expect(parseSwitchOff("// biome-ignoreformat: r")).toEqual({
      form: "biome-ignore",
      scope: "next",
      tool: "biome",
      rules: "format",
      reason: "r",
    });
    expect(parseSwitchOff("// biome-ignore-allformat: r")?.scope).toBe("file");
    expect(parseSwitchOff("// ESLint-Disable-Next-Line no-debugger -- r")).toEqual({
      form: "eslint-disable-next-line",
      scope: "next",
      tool: "linter",
      rules: "no-debugger",
      reason: "r",
    });
    expect(parseSwitchOff("<!-- eslint-disable rule -- r")).toEqual({
      form: "eslint-disable",
      scope: "open",
      tool: "linter",
      rules: "rule",
      reason: "r",
    });
    expect(parseSwitchOff("--> eslint-disable rule -- r")).toEqual({
      form: "eslint-disable",
      scope: "open",
      tool: "linter",
      rules: "rule",
      reason: "r",
    });
    // Position still rules: a mid-line mention names no directive.
    expect(parseSwitchOff("// see @ts-ignore docs")).toBeNull();
    expect(parseSwitchOff("// biome-ignoreX")).toBeNull();
    // Case is ASCII only, like the tools': a Kelvin sign is not a k.
    expect(parseSwitchOff("// @ts-i\u212anore -- r")).toBeNull();
  });
});

describe("switch-off landing instructions", () => {
  const coachman = readFileSync(
    join(import.meta.dir, "../../skills/postmaster/coachman.md"),
    "utf8",
  );
  const postmaster = readFileSync(
    join(import.meta.dir, "../../skills/postmaster/postmaster.md"),
    "utf8",
  );

  test("the coachman lists switch-offs before the gate and pastes the section after the block", () => {
    expect(coachman).toContain("List the branch's switch-offs before anything else here");
    expect(
      coachman.indexOf("List the branch's switch-offs before anything else here"),
    ).toBeLessThan(coachman.indexOf("1. **Verify the final HEAD.**"));
    expect(coachman).toContain(
      "pasted after the block as its own section, never retyped, so the card shows the",
    );
  });

  test("Stage F holds both landing routes on the check and never approves itself", () => {
    const check = "Check switch-offs after the claims and before step 2's landing route";
    expect(postmaster).toContain(check);
    expect(postmaster).toContain("on both routes");
    expect(postmaster.indexOf(check)).toBeLessThan(
      postmaster.indexOf("2. **Follow the landing route in the waybill.**"),
    );
    expect(postmaster).toContain("The merge authority never approves these entries");
    expect(postmaster).toContain("before it opens a\n   pull request or merges");
    expect(postmaster).toContain("with the refused\n   entry as the exact discrepancy");
  });
});
