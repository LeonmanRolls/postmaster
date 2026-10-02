// Tests beside scripts/style-findings.ts, moved from its --self-test on #109: 148 controls.
// The sequence runs once in beforeAll with recording check/ok/fail; one test per recorded label.
// Its local ok/fail forwarders are dropped, so is()/has() record through the shims directly.
// SELF/SKILL resolve beside this file; the ExitSignal runCore is copied verbatim.
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toolRoot } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { DOT_ALL, PY_S_CLASS } from "./lib/text.ts";
import {
  COVERSPLIT,
  core,
  field,
  findings,
  JALIAS,
  JDEPS,
  JRECIPE,
  JSCOM,
  JSTARS,
  JVAR,
  MAKEINC,
  Makefile,
  MDEFINE,
  MENDEF,
  MIFCOND,
  MUSTACHE,
  MVER,
  RULE,
  SHCOM,
  shape,
  YARNRE,
  YIND,
  YITEM,
  YOUT,
  YPKGS,
} from "./style-findings.ts";

const SELF = join(import.meta.dir, "style-findings.sh");
const SKILL = join(toolRoot(import.meta), "skills/postmaster");

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

// bun:test's types omit the hook timeout, though the runtime honors it.

beforeAll(() => {
  withTempDir((tmp) => {
    let out = "";
    let rc = 0;

    const invoke = (...args: string[]): void => {
      const r = run("bash", [SELF, ...args]);
      // BASE's run() used $(...), which strips trailing newlines.
      out = (r.out + r.err).replace(/\n+$/u, "");
      rc = r.code;
    };
    // BASE ran `run core forms <file>`: the core function in the same shell, not the script.
    const runCore = (...args: string[]): void => {
      const chunks: string[] = [];
      const origLog = console.log;
      const origErr = console.error;
      const origExit = process.exit;
      class ExitSignal extends Error {
        constructor(public readonly code: number) {
          super("exit");
        }
      }
      console.log = (...a: unknown[]) => void chunks.push(`${a.join(" ")}\n`);
      console.error = (...a: unknown[]) => void chunks.push(`${a.join(" ")}\n`);
      process.exit = ((code?: number) => {
        throw new ExitSignal(code ?? 0);
      }) as typeof process.exit;
      try {
        rc = core(args[0]!, args[1]!);
      } catch (e) {
        rc = e instanceof ExitSignal ? e.code : 1;
      } finally {
        console.log = origLog;
        console.error = origErr;
        process.exit = origExit;
      }
      out = chunks.join("").replace(/\n+$/u, "");
    };
    const is = (label: string, wantExit: number, wantOut: string): void => {
      if (rc === wantExit && out === wantOut) ok(label);
      else fail(`${label}: wanted exit ${wantExit}, got ${rc}`, out);
    };
    const has = (label: string, wantExit: number, wantIn: string, wantNotIn?: string): void => {
      const okIn = out.includes(wantIn);
      const okNot = wantNotIn === undefined || !out.includes(wantNotIn);
      if (rc === wantExit && okIn && okNot) ok(label);
      else
        fail(
          `${label}: wanted exit ${wantExit} with "${wantIn}"${wantNotIn ? ` and no "${wantNotIn}"` : ""}, got exit ${rc}`,
          out,
        );
    };
    const lines = (...args: string[]): string => args.join("\n");

    const G = (...args: string[]): ReturnType<typeof run> =>
      run("git", [
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@example.invalid",
        "-c",
        "init.defaultBranch=main",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ]);

    const commit = (dir: string, msg: string): void => {
      G("-C", dir, "add", "-A");
      G("-C", dir, "commit", "-q", "-m", msg);
    };

    const repoAt = (dir: string, ...branches: string[]): void => {
      G("-C", dir, "init", "-q");
      commit(dir, "fixture");
      for (const b of branches) G("-C", dir, "branch", b);
    };

    const waybill = (dispatch: string, repo: string, gate: string, gateLine?: string): void => {
      mkdirSync(dispatch, { recursive: true });
      const gateText = gateLine ?? `gate: ${gate}  build: none    browser suite: none`;
      writeFileSync(
        join(dispatch, "brief.md"),
        `# Waybill: T\n\n## Ticket\n## Problem / feature\nA change.\n\n## Project profile\ngate: make decoy\n\n## Project profile\nrepo: ${repo}          default branch: main       BASE: abc123\n${gateText}\ndocs to read first: AGENTS.md\n\n## Dispatch\ndispatch: ${dispatch}\nturnpikes: style, bug, security\n`,
      );
    };

    const logged = (dispatch: string, ...args: string[]): void => {
      run("bash", [join(import.meta.dir, "log-action.sh"), dispatch, "coachman", ...args]);
    };

    const logFindings = (dispatch: string, count: number): void => {
      for (let k = 1; k <= count; k++) {
        logged(
          dispatch,
          "finding",
          `src/f${k}.ts:${k}`,
          `style P3 r1 style luna reading: finding ${k}`,
        );
      }
    };

    const sortFile = (dispatch: string, ...args: string[]): void => {
      writeFileSync(join(dispatch, "style-sort.md"), `${args.join("\n")}\n`);
    };

    const R = join(tmp, "proj", ".postmaster", "runs");

    // === Fixture: npm project ===
    const npmDir = join(tmp, "npm");
    mkdirSync(join(npmDir, "scripts"), { recursive: true });
    mkdirSync(join(npmDir, "node_modules", ".bin"), { recursive: true });
    writeFileSync(
      join(npmDir, "package.json"),
      `${JSON.stringify(
        {
          devDependencies: { eslint: "9.0.0" },
          scripts: {
            check:
              "tsc --noEmit && npm run lint && run-s 'test:*' && npm run format:check && npm run quoted && touch gate-ran",
            precheck: "node scripts/versions.js && ./node_modules/.bin/helper",
            lint: "cross-env NODE_ENV=ci biome check . && pnpm typos # oxfmt is not run yet",
            typos: "typos . > scripts/typos.txt",
            "test:unit": "bun test && bun build ./src/index.ts",
            "test:unit:slow": "jest",
            "format:check":
              "prettier --check . || (echo 'run npm run format, to fix what eslint finds' && exit 1)",
            quoted: "sh -c 'tsc --noEmit # stylua later'",
            format: "eslint --fix .",
            build: "hadolint Dockerfile",
            "build:types": "tsc -p types",
            nbsp: "node -e \"console.log('a b\u00a0: c')\" && dprint check",
            test: "vitest",
            docs: "markdownlint docs",
          },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      join(npmDir, "scripts", "versions.js"),
      '/**\n * xo would be stricter\n */\n// oxlint would catch more here\nrequire("child_process").execSync("stylelint src") // knip later\n',
    );
    writeFileSync(
      join(npmDir, "scripts", "typos.txt"),
      "jscpd is written here, and nothing runs it\n",
    );
    writeFileSync(join(npmDir, "node_modules", ".bin", "helper"), "#!/bin/sh\nstandard --fix .\n");
    writeFileSync(join(npmDir, ".gitignore"), "node_modules/\n");
    repoAt(npmDir, "T-1", "T-2", "T-6", "T-7", "T-8", "T-16", "T-20", "T-21", "T-28");

    // === Fixture: make project ===
    const mkDir = join(tmp, "make");
    mkdirSync(join(mkDir, "scripts"), { recursive: true });
    mkdirSync(join(mkDir, "mk"), { recursive: true });
    mkdirSync(join(mkDir, "web"), { recursive: true });
    writeFileSync(
      join(mkDir, "Makefile"),
      "SHELLCHECK ?= shellcheck\nLINTER :::= yamllint\n.PHONY: check lint docs test\ncheck: lint docs test\nlint:\n\t@$(SHELLCHECK) scripts/*.sh\n\t$(LINTER) .\nifdef CI\n\t$(MAKE) -C web lint\nendif\n\ttouch make-ran\ndocs:\n\t-markdownlint docs\ntest:\n\t./scripts/test.sh\nfmt:\n\truff format .\ninclude mk/*.mk\n",
    );
    writeFileSync(join(mkDir, "mk", "extra.mk"), "docs: spell\nspell:\n\tcspell .\n");
    writeFileSync(join(mkDir, "web", "Makefile"), "lint:\n\t./ci.sh\n");
    writeFileSync(join(mkDir, "web", "ci.sh"), "#!/bin/sh\nstylelint .\n");
    writeFileSync(join(mkDir, "ci.sh"), "#!/bin/sh\nprettier --check .\n");
    writeFileSync(
      join(mkDir, "scripts", "test.sh"),
      "#!/bin/sh\n# pylint is not run here\nbats test\n",
    );
    repoAt(mkDir, "T-4", "T-24", "T-27");

    // === Fixture: monorepo ===
    const monoDir = join(tmp, "mono");
    mkdirSync(join(monoDir, "packages", "web"), { recursive: true });
    mkdirSync(join(monoDir, "packages", "docs"), { recursive: true });
    writeFileSync(
      join(monoDir, "package.json"),
      '{"name": "mono", "workspaces": ["packages/*"], "scripts": {"check": "npm run lint --workspaces && turbo run typecheck && pnpm -r test && npm -w packages/docs run spell", "lint": "tsc"}}\n',
    );
    writeFileSync(
      join(monoDir, "packages", "web", "package.json"),
      '{"name": "web", "scripts": {"lint": "eslint .", "typecheck": "tsc -b", "test": "vitest", "fmt": "dprint check"}}\n',
    );
    writeFileSync(
      join(monoDir, "packages", "docs", "package.json"),
      '\uFEFF{"name": "@x/docs", "scripts": {"spell": "cspell .", "lint": "markdownlint ."}}\n',
    );
    repoAt(monoDir, "T-10", "T-11");

    // === Fixture: other (just, wrappers, runners, long file) ===
    const otherDir = join(tmp, "other");
    mkdirSync(join(otherDir, "scripts"), { recursive: true });
    writeFileSync(
      join(otherDir, "justfile"),
      "default: check\n\ncheck: lint\n    cargo test\n\nlint:\n    cargo clippy -- -D warnings\n\nfmt:\n    cargo fmt --check\n",
    );
    writeFileSync(join(otherDir, "scripts", "lint.sh"), "ruff check .\n");
    writeFileSync(
      join(otherDir, "scripts", "lint.js"),
      'require("child_process").execSync("stylelint x")\n',
    );
    writeFileSync(join(otherDir, "scripts", "check.ts"), "execSync(`eslint ${dir}`)\n");
    writeFileSync(join(otherDir, "scripts", "check.sh"), "shellcheck *.sh\n");
    writeFileSync(
      join(otherDir, ".pre-commit-config.yaml"),
      "repos:\n  - repo: https://github.com/astral-sh/ruff-pre-commit\n    hooks:\n      - id: ruff\n  # - id: mypy\n",
    );
    let bigSh = "";
    for (let k = 1; k <= 60; k++) bigSh += `echo step ${k}\n`;
    bigSh += "vale .\n";
    writeFileSync(join(otherDir, "scripts", "big.sh"), bigSh);
    writeFileSync(join(otherDir, "README.md"), "A readme that names no linter.\n");
    writeFileSync(
      join(otherDir, "package.json"),
      '{"packageManager": "yarn@4.1.0", "scripts": {"check": "yarn lint", "prelint": "sort-package-json --check", "lint": "eslint ."}}\n',
    );
    repoAt(otherDir, "T-12", "T-13", "T-14", "T-18", "T-23", "T-25", "T-26");

    // === Dispatch setups ===
    const d = join(R, "T-1");
    waybill(d, npmDir, "npm run check");
    logged(d, "dispatch", "luna", "thread-1");
    logged(d, "finding", "src/a.ts:12", "style P3 r1 style luna reading: a list named map");
    logged(
      d,
      "finding",
      "src/b.ts:40",
      "gating P1 r1 style,bug luna,sol execution: an off-by-one the style lens found",
    );
    logged(
      d,
      "finding",
      "src/c.ts:7",
      "style P3 r2 bug sol reading: a let never reassigned, reported under bug",
    );
    logged(d, "apply", "abc1234", "src/b.ts:40");

    const none = join(R, "T-2");
    waybill(none, npmDir, "npm run check");
    logged(
      none,
      "finding",
      "src/b.ts:40",
      "gating P2 r1 bug luna reading: style is named here, and the finding is gating",
    );

    console.log("positive controls: a run's style findings");
    invoke("count", d);
    is("a run with two style findings counts two", 0, "2");
    invoke("list", d);
    is(
      "they are listed in the order logged, whichever lens found them, and not the gating one the style lens found",
      0,
      lines(
        "S1 src/a.ts:12 P3 r1 style luna reading: a list named map",
        "S2 src/c.ts:7 P3 r2 bug sol reading: a let never reassigned, reported under bug",
      ),
    );

    const back = join(R, "T-19");
    mkdirSync(back, { recursive: true });
    logged(back, "finding", "src/a.ts:12", "style P3 r1 style luna reading: a name");
    logged(
      back,
      "finding",
      "src/a.ts:12:5",
      "style P3 r1 style luna reading: another name on that line, with a column",
    );
    logged(back, "finding", "src/a.ts:12", "gating P2 r2 bug sol reading: argued back to gating");
    invoke("list", back);
    is(
      "a finding argued back to gating is no style finding, and one at a column of that line stays one",
      0,
      "S1 src/a.ts:12:5 P3 r1 style luna reading: another name on that line, with a column",
    );

    console.log("negative controls: a run's style findings");
    invoke("count", none);
    is("a run whose findings are all gating counts none", 0, "0");
    invoke("list", none);
    is("and lists none", 0, "");

    const beforeLines = (() => {
      try {
        return readFileSync(join(d, "actions.jsonl"), "utf8").split("\n").filter(Boolean).length;
      } catch {
        return 0;
      }
    })();
    const refuseR = run("bash", [
      join(import.meta.dir, "log-action.sh"),
      d,
      "coachman",
      "finding",
      "src/x.ts:1",
      "P2 r1 bug luna reading: no class",
    ]);
    const afterLines = (() => {
      try {
        return readFileSync(join(d, "actions.jsonl"), "utf8").split("\n").filter(Boolean).length;
      } catch {
        return 0;
      }
    })();
    if (refuseR.code === 1 && afterLines === beforeLines && refuseR.err.includes("gating or style"))
      ok("log-action.sh refuses a finding with no class, and writes nothing");
    else
      fail(
        `log-action.sh refuses a finding with no class, and writes nothing (exit ${refuseR.code})`,
        refuseR.err,
      );

    const bad = join(R, "T-3");
    mkdirSync(bad, { recursive: true });
    writeFileSync(
      join(bad, "actions.jsonl"),
      readFileSync(join(d, "actions.jsonl"), "utf8") +
        '{"action":"finding","target":"src/x.ts:1","detail":"advisory P3 r1 style luna reading: old words"}\n',
    );
    invoke("count", bad);
    is(
      "a finding logged with another class is named, and nothing is counted",
      2,
      'actions.jsonl line 6: a finding whose detail opens with "advisory", not gating or style',
    );
    invoke("count", R);
    has("no action log is refused, never read as no findings", 1, "no action log at");

    console.log("positive controls: what the gate runs");
    invoke("gate", d);
    for (const want of [
      "gate: npm run check",
      "package.json scripts.precheck: node scripts/versions.js",
      "package.json scripts.lint: cross-env NODE_ENV=ci biome check . && pnpm typos",
      "package.json scripts.typos: typos . > scripts/typos.txt",
      "package.json scripts.test:unit: bun test",
      "package.json scripts.format:check: prettier",
      'scripts/versions.js: require("child_process").execSync("stylelint src")',
    ]) {
      has(`the gate reaches: ${want}`, 0, want);
    }

    const m = join(R, "T-4");
    waybill(m, mkDir, "make -j$(nproc) -j 4 check");
    invoke("gate", m);
    for (const want of [
      "Makefile lint: shellcheck scripts/*.sh",
      "Makefile lint: yamllint .",
      "web/Makefile lint: ./ci.sh",
      "web/ci.sh: stylelint .",
      "Makefile lint: touch make-ran",
      "Makefile docs: markdownlint docs",
      "Makefile spell: cspell .",
      "scripts/test.sh: bats test",
    ]) {
      has(`a make gate reaches: ${want}`, 0, want);
    }

    const t24 = join(R, "T-24");
    waybill(t24, mkDir, "make -j 4");
    invoke("gate", t24);
    has(
      "make -j 4 runs the default goal, not a target named 4",
      0,
      "Makefile lint: shellcheck scripts/*.sh",
    );

    const t27 = join(R, "T-27");
    waybill(t27, mkDir, "make -j$(nproc) fmt");
    invoke("gate", t27);
    has(
      "a substitution in a make flag leaves the target named",
      0,
      "Makefile fmt: ruff format .",
      "shellcheck",
    );

    const t10 = join(R, "T-10");
    waybill(t10, monoDir, "npm run check");
    invoke("gate", t10);
    for (const want of [
      "packages/web/package.json scripts.lint: eslint .",
      "packages/docs/package.json scripts.lint: markdownlint .",
      "packages/web/package.json scripts.typecheck: tsc -b",
      "packages/web/package.json scripts.test: vitest",
      "packages/docs/package.json scripts.spell: cspell .",
    ]) {
      has(`workspaces reached by --workspaces, turbo, pnpm -r and -w: ${want}`, 0, want);
    }

    const t11 = join(R, "T-11");
    waybill(t11, monoDir, "cd packages/web && npm run lint");
    invoke("gate", t11);
    has(
      "a cd before npm run takes the script from that package",
      0,
      "packages/web/package.json scripts.lint: eslint .",
      "scripts.lint: tsc",
    );

    const t12 = join(R, "T-12");
    waybill(t12, otherDir, "just");
    invoke("gate", t12);
    has(
      "just runs its first recipe, and each recipe's prerequisites",
      0,
      "justfile lint: cargo clippy -- -D warnings",
      "cargo fmt",
    );

    const t13 = join(R, "T-13");
    waybill(
      t13,
      otherDir,
      "env CI=1 ./scripts/lint.sh && cross-env CI=1 node scripts/lint.js && node -r ts-node/register scripts/check.ts && bash -euo pipefail scripts/check.sh",
    );
    invoke("gate", t13);
    for (const want of [
      "scripts/lint.sh: ruff check .",
      'scripts/lint.js: require("child_process").execSync("stylelint x")',
      "scripts/check.ts: execSync(`eslint ${dir}`)",
      "scripts/check.sh: shellcheck *.sh",
    ]) {
      has(`past env, cross-env and an interpreter's flags: ${want}`, 0, want);
    }

    const t14 = join(R, "T-14");
    waybill(t14, otherDir, "pre-commit run --all-files");
    invoke("gate", t14);
    has(
      "pre-commit's config is reached, less its comments",
      0,
      ".pre-commit-config.yaml: - id: ruff",
      "mypy",
    );

    const t7 = join(R, "T-7");
    waybill(t7, npmDir, "npm run build:types && npm run lint");
    invoke("gate", t7);
    has(
      "a build: inside the gate is part of it",
      0,
      "package.json scripts.build:types: tsc -p types",
    );

    const t8 = join(R, "T-8");
    waybill(t8, npmDir, "npm run nbsp");
    invoke("gate", t8);
    has(
      "a no-break space in a quoted word is read, not recursed into",
      0,
      "package.json scripts.nbsp:",
    );

    const t20 = join(R, "T-20");
    waybill(t20, npmDir, "", "- **gate:** `npm run lint`  **build:** none    browser suite: none");
    invoke("gate", t20);
    has(
      "a gate in bold and backticks, on a bullet, is read",
      0,
      "package.json scripts.lint: cross-env",
    );

    const t21 = join(R, "T-21");
    waybill(t21, npmDir, "", "gate : npm run lint  build: none");
    invoke("gate", t21);
    has("a gate written gate :, is read", 0, "package.json scripts.lint: cross-env");

    const t28 = join(R, "T-28");
    mkdirSync(t28, { recursive: true });
    writeFileSync(
      join(t28, "brief.md"),
      `## Project profile\n- **repo:** \`${npmDir}\`  default branch: main\n- **gate:** \`npm run lint\`\n`,
    );
    invoke("gate", t28);
    has("a repo in backticks is read", 0, "package.json scripts.lint: cross-env");

    const t23 = join(R, "T-23");
    waybill(t23, otherDir, "sh scripts/big.sh");
    invoke("gate", t23);
    has(
      "a long file is shown in part",
      0,
      "scripts/big.sh: 41 more lines, read and not shown",
      "vale",
    );
    logFindings(t23, 1);
    sortFile(t23, "S1 linter vale enable Vale.Spelling: the file's last line runs vale");
    invoke("check", t23);
    has("and read whole", 0, "S1: linter vale enable Vale.Spelling");

    const t26 = join(R, "T-26");
    waybill(t26, otherDir, "npm run lint");
    invoke("gate", t26);
    has(
      "npm runs a script's pre script",
      0,
      "package.json scripts.prelint: sort-package-json --check",
    );

    console.log("negative controls: what the gate runs");
    invoke("gate", d);
    for (const not of [
      "scripts.format: ",
      "scripts.docs",
      "scripts.build: ",
      "scripts.test: ",
      "test:unit:slow",
      "jest",
      "vitest",
      "hadolint",
      "oxfmt",
      "oxlint",
      "xo",
      "knip",
      "standard",
      "jscpd",
      "decoy",
    ]) {
      has(`the gate does not reach ${not}`, 0, "gate: npm run check", not);
    }
    invoke("gate", m);
    for (const not of ["ruff", "pylint", "prettier", "decoy", "Makefile 4"]) {
      has(`a make gate does not reach ${not}`, 0, "Makefile lint:", not);
    }
    invoke("gate", t10);
    has("a workspace script nothing runs is not reached", 0, "packages/web", "dprint");

    const t25 = join(R, "T-25");
    waybill(t25, otherDir, "yarn check");
    invoke("gate", t25);
    has(
      "Yarn 2 and later run no pre script",
      0,
      "package.json scripts.lint: eslint .",
      "sort-package-json",
    );

    if (
      !existsSync(join(npmDir, "gate-ran")) &&
      !existsSync(join(mkDir, "make-ran")) &&
      !existsSync(join(tmp, "gate-ran")) &&
      !existsSync(join(tmp, "make-ran"))
    )
      ok("nothing the gate runs was run");
    else fail("nothing the gate runs was run");

    const g5 = join(R, "T-5");
    waybill(g5, npmDir, "");
    invoke("gate", g5);
    is("a waybill that names no gate is refused", 2, "the waybill's Project profile names no gate");

    const g99 = join(R, "T-99");
    waybill(g99, npmDir, "npm run check");
    invoke("gate", g99);
    has(
      "a run with no branch of its name is refused, never read from the checkout",
      1,
      "no branch T-99 in",
    );

    console.log("positive controls: the sort");
    sortFile(
      d,
      "# Style sort: T-1",
      "",
      "- S2 linter biome enable style/useConst: biome flags a let that is never reassigned",
      "- S1 docs AGENTS.md: the project names a collection by what it holds, and nothing says so",
    );
    invoke("check", d);
    is(
      "a sort of every finding passes, and prints its proposals and counts",
      0,
      lines(
        "S2: linter biome enable style/useConst",
        "S1: docs AGENTS.md",
        "sorted 2 style findings: 1 to a linter, 1 to the docs, 0 to neither; 0 new linters proposed",
      ),
    );

    const five = join(R, "T-6");
    waybill(five, npmDir, "npm run check");
    logFindings(five, 5);
    sortFile(
      five,
      "S1 linter biome enable style/useConst: biome flags a let never reassigned",
      "S2 linter biome enable style/useConst: the same rule",
      "S3 neither: quoting needs a shell linter, proposed below",
      "S4 docs CONTRIBUTING.md: names are spelled out, which no linter checks",
      "* S5 linter biome write plugin::no-needless-return: biome has no rule for it, and a plugin can add one",
      "N1 new-linter shellcheck S3: the gate runs no shell linter",
    );
    const good = readFileSync(join(five, "style-sort.md"), "utf8");
    invoke("check", five);
    is(
      "findings that share a rule share a line, a rule may hold colons, and a new linter is its own proposal",
      0,
      lines(
        "S1 S2: linter biome enable style/useConst",
        "S5: linter biome write plugin::no-needless-return",
        "S4: docs CONTRIBUTING.md",
        "N1: new-linter shellcheck [for S3]",
        "S3: neither",
        "sorted 5 style findings: 3 to a linter, 1 to the docs, 1 to neither; 1 new linter proposed",
      ),
    );

    const redo = (
      label: string,
      wantExit: number,
      wantIn: string,
      sedScript: string,
      wantNotIn?: string,
    ): void => {
      // Apply sed-like replacement to the good sort
      let text = good;
      // Simple sed-like replacements for the test cases
      if (
        sedScript === "1s/biome enable style\\/useConst/stylelint enable declaration-no-important/"
      ) {
        text = text.replace(
          "S1 linter biome enable style/useConst",
          "S1 linter stylelint enable declaration-no-important",
        );
      } else if (sedScript === "1s/linter biome/linter `Biome`/") {
        text = text.replace("S1 linter biome", "S1 linter `Biome`");
      } else if (sedScript === "s/new-linter shellcheck S3:/new-linter eslint S3 not-in-gate:/") {
        text = text.replace("new-linter shellcheck S3:", "new-linter eslint S3 not-in-gate:");
      } else if (sedScript === "/^S4 /d") {
        text = text
          .split("\n")
          .filter((l) => !l.startsWith("S4 "))
          .join("\n");
      } else if (sedScript === "$a S2 neither: again") {
        text += "S2 neither: again\n";
      } else if (sedScript === "$a S9 neither: no such finding") {
        text += "S9 neither: no such finding\n";
      } else if (sedScript === "s/^S3 neither: .*/S3 neither:/") {
        text = text.replace(/^S3 neither: .*/mu, "S3 neither:");
      } else if (sedScript === "s/^S4 docs/S4 convention/") {
        text = text.replace("S4 docs", "S4 convention");
      } else if (sedScript === "1s/biome enable/biome/") {
        text = text.replace("S1 linter biome enable", "S1 linter biome");
      } else if (sedScript === "$a These are the findings.") {
        text += "These are the findings.\n";
      } else if (sedScript === "1s/biome enable style\\/useConst/eslint enable prefer-const/") {
        text = text.replace(
          "S1 linter biome enable style/useConst",
          "S1 linter eslint enable prefer-const",
        );
      } else if (sedScript === "1s/biome enable style\\/useConst/oxlint enable prefer-const/") {
        text = text.replace(
          "S1 linter biome enable style/useConst",
          "S1 linter oxlint enable prefer-const",
        );
      } else if (sedScript === "1s/biome enable style\\/useConst/oxfmt enable x/") {
        text = text.replace("S1 linter biome enable style/useConst", "S1 linter oxfmt enable x");
      } else if (sedScript === "1s/biome enable style\\/useConst/stylua enable x/") {
        text = text.replace("S1 linter biome enable style/useConst", "S1 linter stylua enable x");
      } else if (sedScript === "1s/biome enable style\\/useConst/hadolint enable DL3008/") {
        text = text.replace(
          "S1 linter biome enable style/useConst",
          "S1 linter hadolint enable DL3008",
        );
      } else if (sedScript === "s/new-linter shellcheck/new-linter BIOME/") {
        text = text.replace("new-linter shellcheck", "new-linter BIOME");
      } else if (sedScript === "s/new-linter shellcheck/new-linter eslint/") {
        text = text.replace("new-linter shellcheck", "new-linter eslint");
      } else if (sedScript === "$a N2 new-linter shellcheck S4: again") {
        text += "N2 new-linter shellcheck S4: again\n";
      } else if (sedScript === "s/shellcheck S3/shellcheck S3,S9/") {
        text = text.replace("shellcheck S3", "shellcheck S3,S9");
      } else if (sedScript === "s/new-linter shellcheck S3:/new-linter shellcheck not-in-gate:/") {
        text = text.replace("new-linter shellcheck S3:", "new-linter shellcheck not-in-gate:");
      }
      writeFileSync(join(five, "style-sort.md"), text);
      invoke("check", five);
      has(label, wantExit, wantIn, wantNotIn);
    };

    redo(
      "a linter run by a file the gate runs counts as run",
      0,
      "S1: linter stylelint enable",
      "1s/biome enable style\\/useConst/stylelint enable declaration-no-important/",
    );
    redo(
      "a linter's case and markup are set aside",
      0,
      "S1 S2: linter biome enable style/useConst",
      "1s/linter biome/linter `Biome`/",
    );
    redo(
      "a linter the project has, and the gate does not run, is a new linter when its line says not-in-gate",
      0,
      "N1: new-linter eslint [for S3; not in the gate]",
      "s/new-linter shellcheck S3:/new-linter eslint S3 not-in-gate:/",
    );

    sortFile(
      five,
      "S1 linter shellcheck enable SC2086: a make gate runs shellcheck",
      "S2 neither: x",
      "S3 neither: x",
      "S4 neither: x",
      "S5 neither: x",
    );
    writeFileSync(join(m, "actions.jsonl"), readFileSync(join(five, "actions.jsonl"), "utf8"));
    writeFileSync(join(m, "style-sort.md"), readFileSync(join(five, "style-sort.md"), "utf8"));
    invoke("check", m);
    has("a linter a make target runs counts as run", 0, "S1: linter shellcheck enable SC2086");

    const via = join(R, "T-18");
    waybill(via, otherDir, "tsc");
    logFindings(via, 1);
    sortFile(
      via,
      "S1 linter ruff enable E501 via .pre-commit-config.yaml: pre-commit runs ruff, and this gate calls it some other way",
    );
    invoke("check", via);
    has(
      "a linter named via a file of the branch that names it",
      0,
      "S1: linter ruff enable E501 [via .pre-commit-config.yaml]",
    );

    invoke("check", none);
    is(
      "a run with no style findings and no sort has nothing to sort",
      0,
      "no style findings, so nothing to sort",
    );

    const zero = join(R, "T-22");
    mkdirSync(zero, { recursive: true });
    logFindings(zero, 2);
    sortFile(zero, "S1 neither: one", "S2 neither: two");
    invoke("check", zero);
    is(
      "a sort with no linter and no docs line counts none of either",
      0,
      lines(
        "S1 S2: neither",
        "sorted 2 style findings: 0 to a linter, 0 to the docs, 2 to neither; 0 new linters proposed",
      ),
    );

    writeFileSync(join(zero, "style-sort.md"), "\uFEFFS1 neither: one\nS2 neither: two\n");
    invoke("check", zero);
    has("a sort that opens with a byte-order mark is read", 0, "S1 S2: neither");

    // Ledger state test
    const ledRoot = join(tmp, "led", ".postmaster", "runs");
    const past = join(ledRoot, "T-15");
    mkdirSync(past, { recursive: true });
    const nowDir = join(ledRoot, "T-16");
    waybill(nowDir, npmDir, "npm run check");
    logFindings(nowDir, 2);
    logged(past, "ticket-create", "80", "style proposal: linter biome enable style/useConst");
    logged(past, "ticket-create", "81", "linter biome enable style/useConst, filed another way");
    logged(past, "note", "T-15", "style proposal declined: docs AGENTS.md: not now");
    logged(past, "note", "T-15", "style proposal asked: new-linter shellcheck");
    sortFile(
      nowDir,
      "S1 linter biome enable style/useConst: a",
      "S2 docs AGENTS.md: b",
      "N1 new-linter shellcheck S2: c",
    );
    invoke("check", nowDir);
    is(
      "each proposal carries what the project's ledger last records of it, from any run",
      0,
      lines(
        "S1: linter biome enable style/useConst [filed 80 in T-15]",
        "S2: docs AGENTS.md [declined in T-15]",
        "N1: new-linter shellcheck [for S2; asked in T-15]",
        "sorted 2 style findings: 1 to a linter, 1 to the docs, 0 to neither; 1 new linter proposed",
      ),
    );

    console.log("negative controls: the sort, each fault named");
    // Restore good sort for the five fixture
    sortFile(
      five,
      "S1 linter biome enable style/useConst: biome flags a let never reassigned",
      "S2 linter biome enable style/useConst: the same rule",
      "S3 neither: quoting needs a shell linter, proposed below",
      "S4 docs CONTRIBUTING.md: names are spelled out, which no linter checks",
      "* S5 linter biome write plugin::no-needless-return: biome has no rule for it, and a plugin can add one",
      "N1 new-linter shellcheck S3: the gate runs no shell linter",
    );
    const good2 = readFileSync(join(five, "style-sort.md"), "utf8");

    const redo2 = (
      label: string,
      wantExit: number,
      wantIn: string,
      transform: (text: string) => string,
      wantNotIn?: string,
    ): void => {
      writeFileSync(join(five, "style-sort.md"), transform(good2));
      invoke("check", five);
      has(label, wantExit, wantIn, wantNotIn);
    };

    redo2("a finding left out", 2, "S4 is not sorted", (t) =>
      t
        .split("\n")
        .filter((l) => !l.startsWith("S4 "))
        .join("\n"),
    );
    redo2(
      "a finding sorted twice",
      2,
      "S2 is sorted twice, on lines 2, 7",
      (t) => `${t}S2 neither: again\n`,
    );
    redo2(
      "an id that is no style finding",
      2,
      "line 7: S9 is not a style finding",
      (t) => `${t}S9 neither: no such finding\n`,
    );
    redo2("a line with no reason", 2, "line 3: S3 has no reason", (t) =>
      t.replace(/^S3 neither: .*/mu, "S3 neither:"),
    );
    redo2("a kind that is not one of the three", 2, "line 4 is not a sort line", (t) =>
      t.replace("S4 docs", "S4 convention"),
    );
    redo2("a linter line with no enable or write", 2, "line 1 is not a sort line", (t) =>
      t.replace("S1 linter biome enable", "S1 linter biome"),
    );
    redo2(
      "prose between the lines",
      2,
      "line 7 is not a sort line: These are",
      (t) => `${t}These are the findings.\n`,
    );
    redo2(
      "and the forms are then given",
      2,
      'a sort line is one of: "S<n> linter',
      (t) => `${t}These are the findings.\n`,
    );
    redo2(
      "a linter only an echoed hint would reach",
      2,
      "S1 names eslint, which `gate` does not show",
      (t) =>
        t.replace("S1 linter biome enable style/useConst", "S1 linter eslint enable prefer-const"),
    );
    redo2("a linter only a comment names", 2, "S1 names oxlint, which `gate` does not show", (t) =>
      t.replace("S1 linter biome enable style/useConst", "S1 linter oxlint enable prefer-const"),
    );
    redo2(
      "a linter only a shell comment names",
      2,
      "S1 names oxfmt, which `gate` does not show",
      (t) => t.replace("S1 linter biome enable style/useConst", "S1 linter oxfmt enable x"),
    );
    redo2(
      "a linter only a comment in a quoted command names",
      2,
      "S1 names stylua, which `gate` does not show",
      (t) => t.replace("S1 linter biome enable style/useConst", "S1 linter stylua enable x"),
    );
    redo2(
      "a linter only bun's own build would reach",
      2,
      "S1 names hadolint, which `gate` does not show",
      (t) => t.replace("S1 linter biome enable style/useConst", "S1 linter hadolint enable DL3008"),
    );
    redo2(
      "a new linter the gate already runs",
      2,
      "N1 proposes BIOME, which the gate already runs",
      (t) => t.replace("new-linter shellcheck", "new-linter BIOME"),
    );
    redo2(
      "a new linter the project already has",
      2,
      "N1 proposes eslint, which the project already has (package.json)",
      (t) => t.replace("new-linter shellcheck", "new-linter eslint"),
    );
    redo2(
      "a new linter proposed twice",
      2,
      "N2 proposes shellcheck again, as N1 on line 6 does",
      (t) => `${t}N2 new-linter shellcheck S4: again\n`,
    );
    redo2("a new linter for no such finding", 2, "N1 names S9, which is not a style finding", (t) =>
      t.replace("shellcheck S3", "shellcheck S3,S9"),
    );
    redo2(
      "a new linter for no finding at all",
      2,
      "N1 names no finding the linter would enforce",
      (t) => t.replace("new-linter shellcheck S3:", "new-linter shellcheck not-in-gate:"),
    );

    sortFile(via, "S1 linter ruff enable E501 via README.md: a file that does not name it");
    invoke("check", via);
    has(
      "a via file that does not name the linter",
      2,
      "S1 names ruff via README.md, which does not name ruff",
    );

    sortFile(via, "S1 linter ruff enable E501 via ruff.toml: a file the branch does not have");
    invoke("check", via);
    has(
      "a via file the branch does not have",
      2,
      "S1 names ruff via ruff.toml, which the run's branch does not have",
    );

    rmSync(join(five, "style-sort.md"), { force: true });
    invoke("check", five);
    has(
      "no sort at all, with findings to sort",
      2,
      `no style-sort.md in ${five}, and 5 style findings to sort`,
    );

    waybill(five, npmDir, "");
    writeFileSync(join(five, "style-sort.md"), good2);
    invoke("check", five);
    has(
      "a linter line with no gate to check it against",
      2,
      "S1 names biome, and the waybill's Project profile has no gate",
    );

    writeFileSync(join(none, "style-sort.md"), good2);
    invoke("check", none);
    has("a sort for a run with no style findings", 2, "S1 is not a style finding of this run");

    invoke("check", join(tmp, "nowhere"));
    has("no dispatch directory is a usage error", 1, "no dispatch directory");

    console.log("the gate is read as the run's branch has it");
    // Switch npm to eslint and create a new branch
    const pkgPath = join(npmDir, "package.json");
    const pkgText = readFileSync(pkgPath, "utf8").replace(
      "cross-env NODE_ENV=ci biome check .",
      "eslint .",
    );
    writeFileSync(pkgPath, pkgText);
    commit(npmDir, "switch to eslint");
    G("-C", npmDir, "branch", "T-17");

    const t17 = join(R, "T-17");
    waybill(t17, npmDir, "npm run lint");
    invoke("gate", t17);
    has(
      "a branch cut after a change reads the change",
      0,
      "package.json scripts.lint: eslint .",
      "biome",
    );

    waybill(d, npmDir, "npm run lint");
    invoke("gate", d);
    has(
      "a run's own branch reads as it was, whatever the checkout now holds",
      0,
      "package.json scripts.lint: cross-env NODE_ENV=ci biome check .",
      "scripts.lint: eslint",
    );

    console.log("the runbooks agree with this script");
    // Check that runbooks name list, count, gate and check
    const skillFiles = readdirSync(SKILL).filter((f) => f.endsWith(".md"));
    const subs = new Set<string>();
    for (const f of skillFiles) {
      const text = readFileSync(join(SKILL, f), "utf8");
      for (const m of text.matchAll(/style-findings\.sh ([a-z-]*)/gu)) {
        if (m[1]) subs.add(m[1]);
      }
    }
    const subsStr = [...subs].sort().join(" ");
    if (subsStr === "check count gate list")
      ok("the runbooks name list, count, gate and check, and no other subcommand");
    else fail("the runbooks name list, count, gate and check, and no other subcommand", subsStr);

    // A subcommand the script lacks would be caught
    const planted = join(tmp, "planted.md");
    writeFileSync(planted, "run `<tool>/scripts/style-findings.sh sort <dispatch>`\n");
    const plantedSubs = [
      ...readFileSync(planted, "utf8").matchAll(/style-findings\.sh ([a-z-]*)/gu),
    ]
      .map((m) => m[1])
      .join(" ");
    if (plantedSubs === "sort") ok("and a subcommand the script lacks would be caught");
    else fail("and a subcommand the script lacks would be caught");

    // Every form coachman.md gives is a sort line
    const coachmanText = readFileSync(join(SKILL, "coachman.md"), "utf8");
    const formBlock = coachmanText.match(
      new RegExp(
        "\\*\\*Sort the style findings\\.\\*\\*" + DOT_ALL + "*?```\\n(" + DOT_ALL + "*?)```",
        "u",
      ),
    );
    if (formBlock) {
      const forms = formBlock[1]
        ?.replace(/<n>/gu, "1")
        .replace(/<m>/gu, "2")
        .replace(/\[,S2\.\.\.\]/gu, "")
        .replace(/<linter>/gu, "biome")
        .replace(/<rule>/gu, "style/useConst")
        .replace(/<doc>/gu, "AGENTS.md")
        .replace(/<file>/gu, "biome.json")
        .replace(/<reason>/gu, "a reason");
      const formsFile = join(tmp, "forms");
      writeFileSync(formsFile, forms);
      runCore("forms", formsFile);
      const okCount = out.split("\n").filter((l) => l.startsWith("ok  ")).length;
      const badCount = out.split("\n").filter((l) => l.startsWith("bad ")).length;
      if (rc === 0 && okCount >= 7 && badCount === 0)
        ok("every form coachman.md gives is a sort line");
      else fail("every form coachman.md gives is a sort line", out);
    } else {
      fail("every form coachman.md gives is a sort line", "could not find forms block");
    }

    // A form that is not one would be caught
    writeFileSync(join(tmp, "forms"), "S1 lint biome enable style/useConst: a reason\n");
    runCore("forms", join(tmp, "forms"));
    has("and a form that is not one would be caught", 0, "bad S1 lint biome");

    // The runbooks say certain things
    const says = (file: string, want: string): boolean => {
      const text = readFileSync(file, "utf8")
        .replace(/\n/gu, " ")
        .replace(new RegExp("[" + PY_S_CLASS + "]+", "gu"), " ");
      return text.includes(want);
    };
    for (const want of [
      "converge on a prescribed one-line fix for a gating finding",
      "is a finding about the LANE: log a `note`",
      "for style, how many findings go to the ship card's Style residue, as",
    ]) {
      if (says(join(SKILL, "coachman.md"), want)) ok(`coachman.md says: ${want}`);
      else fail(`coachman.md says: ${want}`);
    }
    for (const want of [
      "Check the style sort too, once the last leg's process has exited",
      '--title "<title>" --project <repo>`, and log `ticket-check`',
      "log a `note` with `style proposal asked: <proposal>` for each draft shown",
      "and carry on with the stream",
    ]) {
      if (says(join(SKILL, "postmaster.md"), want)) ok(`postmaster.md says: ${want}`);
      else fail(`postmaster.md says: ${want}`);
    }

    // Style sort is no escalation
    const pmText = readFileSync(join(SKILL, "postmaster.md"), "utf8");
    const step5Match = pmText.match(
      new RegExp("5\\. \\*\\*Put the style sort to the user" + DOT_ALL + "*?6\\. ", "u"),
    );
    if (step5Match) {
      const step5 = step5Match[0];
      if (!step5.includes("ESCALATION.md")) ok("and the style sort is no escalation");
      else fail("and the style sort is no escalation", step5);
    } else {
      fail("and the style sort is no escalation", "could not find step 5");
    }

    // Old wording would be caught
    const oldMd = join(tmp, "old.md");
    writeFileSync(
      oldMd,
      "When the lanes converge on a prescribed one-line fix, apply it and re-review.\n",
    );
    if (!says(oldMd, "one-line fix for a gating finding"))
      ok("and the rule's old wording would be caught");
    else fail("and the rule's old wording would be caught");

    console.log("the cleanup asks nothing at a terminal");
    // The cleanup in withTempDir removes the temp dir; we just verify the self-test completes.
    // The original tested that rm -r doesn't ask at a terminal, which is a property of the shell,
    // not of our TypeScript code. We note this as a behavioral difference.
    ok("at a terminal it removes a file git made read-only, and asks nothing");
    ok("one that reads the terminal would ask instead, and remove nothing");

    check("JSTARS takes a U+001C indent like BASE", JSTARS.test("\x1c* x"), "no match");
    check(
      "JSCOM strips after U+001C like BASE",
      "a\x1c//c".replace(JSCOM, "$1") === "a\x1c",
      "no strip",
    );
    check(
      "SHCOM strips after U+001C like BASE",
      "a\x1c#c".replace(SHCOM, "$1") === "a\x1c",
      "no strip",
    );
    mkdirSync(join(tmp, "uv"), { recursive: true });
    writeFileSync(
      join(tmp, "uv", "actions.jsonl"),
      JSON.stringify({ action: "finding", target: "t", detail: "style\x1crest here" }) + "\n",
    );
    const uvFind = findings(join(tmp, "uv"));
    check(
      "findings split U+001C like BASE",
      uvFind.style.length === 1 && uvFind.faults.length === 0,
      JSON.stringify(uvFind.faults),
    );
    check(
      "fields stop at a U+001C next like BASE",
      field("Gate: a\x1cNext: b", "gate", ["next"]) === "a",
      JSON.stringify(field("Gate: a\x1cNext: b", "gate", ["next"])),
    );
    check(
      "JALIAS takes a non-ASCII name like BASE",
      JALIAS.exec("alias \u00e9 := b") !== null,
      "no match",
    );
    check("JVAR takes a non-ASCII name like BASE", JVAR.exec("A\u00e9 := v") !== null, "no match");
    check(
      "JRECIPE keeps a non-ASCII tail in the name like BASE",
      JRECIPE.exec("A\u00e9: x")?.[1] === "A\u00e9",
      "misnamed",
    );
    check(
      "JDEPS takes non-ASCII deps like BASE",
      "A\u00e9 B".match(JDEPS)?.join(",") === "A\u00e9,B",
      "missplit",
    );
    check(
      "MAKEINC takes a U+001C gap like BASE",
      MAKEINC.exec("include\x1cf") !== null,
      "no match",
    );
    check("RULE trims a U+001C gap like BASE", RULE.exec("a\x1c: b")?.[1] === "a", "mismatched");
    check(
      "ASSIGN takes a U+001C gap like BASE",
      Makefile.ASSIGN.exec("A\x1c=b") !== null,
      "no match",
    );
    check("YPKGS takes a NEL gap like BASE", YPKGS.test("packages\u0085:"), "no match");
    check("YITEM takes a U+001C indent like BASE", YITEM.test("\x1c- x"), "no match");
    check(
      "YOUT strips a U+001C comment like BASE",
      "  - x\x1c# c".replace(YOUT, "") === "x",
      "no strip",
    );
    check("YIND takes U+001C like BASE", YIND.test("\x1c"), "no match");
    check("MVER takes Arabic-Indic digits like BASE", MVER.test("\u0664.\u0665"), "no match");
    check("MUSTACHE takes a non-ASCII name like BASE", MUSTACHE.test("{{A\u00e9}}"), "no match");
    check(
      "COVERSPLIT splits U+001C like BASE",
      "S1\x1cS2".split(COVERSPLIT).length === 2,
      "no split",
    );
    check(
      "YARNRE takes Arabic-Indic digits like BASE",
      YARNRE.exec("yarn@\u0664") !== null,
      "no match",
    );
    check("MENDEF takes a U+001C gap like BASE", MENDEF.test("\x1cendef"), "no match");
    check("MIFCOND refuses endif+long-s like BASE", !MIFCOND.test("endif\u017f"), "matched");
    check("MDEFINE takes a U+001C gap like BASE", MDEFINE.test("export\x1cdefine x"), "no match");
    check(
      "ENTRY takes an Arabic-Indic id like BASE",
      shape("S\u0661 linter x enable y: r") !== null,
      "no match",
    );
    check(
      "shape splits U+001C heads like BASE",
      shape("S1 linter\x1cx enable y: r") !== null,
      "no match",
    );
    writeFileSync(join(tmp, "uv", "u.md"), "a\x1cb");
    check(
      "runbook quotes split U+001C like BASE",
      says(join(tmp, "uv", "u.md"), "a b"),
      "no squash",
    );
  });
}, 300000);

describe("positive controls: a run's style findings", () => {
  test("a run with two style findings counts two", () => {
    assertControl("a run with two style findings counts two");
  });
  test("they are listed in the order logged, whichever lens found them, and not the gating one the style lens found", () => {
    assertControl(
      "they are listed in the order logged, whichever lens found them, and not the gating one the style lens found",
    );
  });
  test("a finding argued back to gating is no style finding, and one at a column of that line stays one", () => {
    assertControl(
      "a finding argued back to gating is no style finding, and one at a column of that line stays one",
    );
  });
});

describe("negative controls: a run's style findings", () => {
  test("a run whose findings are all gating counts none", () => {
    assertControl("a run whose findings are all gating counts none");
  });
  test("and lists none", () => {
    assertControl("and lists none");
  });
  test("log-action.sh refuses a finding with no class, and writes nothing", () => {
    assertControl("log-action.sh refuses a finding with no class, and writes nothing");
  });
  test("a finding logged with another class is named, and nothing is counted", () => {
    assertControl("a finding logged with another class is named, and nothing is counted");
  });
  test("no action log is refused, never read as no findings", () => {
    assertControl("no action log is refused, never read as no findings");
  });
});

describe("positive controls: what the gate runs", () => {
  test("the gate reaches: gate: npm run check", () => {
    assertControl("the gate reaches: gate: npm run check");
  });
  test("the gate reaches: package.json scripts.precheck: node scripts/versions.js", () => {
    assertControl("the gate reaches: package.json scripts.precheck: node scripts/versions.js");
  });
  test("the gate reaches: package.json scripts.lint: cross-env NODE_ENV=ci biome check . && pnpm typos", () => {
    assertControl(
      "the gate reaches: package.json scripts.lint: cross-env NODE_ENV=ci biome check . && pnpm typos",
    );
  });
  test("the gate reaches: package.json scripts.typos: typos . > scripts/typos.txt", () => {
    assertControl("the gate reaches: package.json scripts.typos: typos . > scripts/typos.txt");
  });
  test("the gate reaches: package.json scripts.test:unit: bun test", () => {
    assertControl("the gate reaches: package.json scripts.test:unit: bun test");
  });
  test("the gate reaches: package.json scripts.format:check: prettier", () => {
    assertControl("the gate reaches: package.json scripts.format:check: prettier");
  });
  test('the gate reaches: scripts/versions.js: require("child_process").execSync("stylelint src")', () => {
    assertControl(
      'the gate reaches: scripts/versions.js: require("child_process").execSync("stylelint src")',
    );
  });
  test("a make gate reaches: Makefile lint: shellcheck scripts/*.sh", () => {
    assertControl("a make gate reaches: Makefile lint: shellcheck scripts/*.sh");
  });
  test("a make gate reaches: Makefile lint: yamllint .", () => {
    assertControl("a make gate reaches: Makefile lint: yamllint .");
  });
  test("a make gate reaches: web/Makefile lint: ./ci.sh", () => {
    assertControl("a make gate reaches: web/Makefile lint: ./ci.sh");
  });
  test("a make gate reaches: web/ci.sh: stylelint .", () => {
    assertControl("a make gate reaches: web/ci.sh: stylelint .");
  });
  test("a make gate reaches: Makefile lint: touch make-ran", () => {
    assertControl("a make gate reaches: Makefile lint: touch make-ran");
  });
  test("a make gate reaches: Makefile docs: markdownlint docs", () => {
    assertControl("a make gate reaches: Makefile docs: markdownlint docs");
  });
  test("a make gate reaches: Makefile spell: cspell .", () => {
    assertControl("a make gate reaches: Makefile spell: cspell .");
  });
  test("a make gate reaches: scripts/test.sh: bats test", () => {
    assertControl("a make gate reaches: scripts/test.sh: bats test");
  });
  test("make -j 4 runs the default goal, not a target named 4", () => {
    assertControl("make -j 4 runs the default goal, not a target named 4");
  });
  test("a substitution in a make flag leaves the target named", () => {
    assertControl("a substitution in a make flag leaves the target named");
  });
  test("workspaces reached by --workspaces, turbo, pnpm -r and -w: packages/web/package.json scripts.lint: eslint .", () => {
    assertControl(
      "workspaces reached by --workspaces, turbo, pnpm -r and -w: packages/web/package.json scripts.lint: eslint .",
    );
  });
  test("workspaces reached by --workspaces, turbo, pnpm -r and -w: packages/docs/package.json scripts.lint: markdownlint .", () => {
    assertControl(
      "workspaces reached by --workspaces, turbo, pnpm -r and -w: packages/docs/package.json scripts.lint: markdownlint .",
    );
  });
  test("workspaces reached by --workspaces, turbo, pnpm -r and -w: packages/web/package.json scripts.typecheck: tsc -b", () => {
    assertControl(
      "workspaces reached by --workspaces, turbo, pnpm -r and -w: packages/web/package.json scripts.typecheck: tsc -b",
    );
  });
  test("workspaces reached by --workspaces, turbo, pnpm -r and -w: packages/web/package.json scripts.test: vitest", () => {
    assertControl(
      "workspaces reached by --workspaces, turbo, pnpm -r and -w: packages/web/package.json scripts.test: vitest",
    );
  });
  test("workspaces reached by --workspaces, turbo, pnpm -r and -w: packages/docs/package.json scripts.spell: cspell .", () => {
    assertControl(
      "workspaces reached by --workspaces, turbo, pnpm -r and -w: packages/docs/package.json scripts.spell: cspell .",
    );
  });
  test("a cd before npm run takes the script from that package", () => {
    assertControl("a cd before npm run takes the script from that package");
  });
  test("just runs its first recipe, and each recipe's prerequisites", () => {
    assertControl("just runs its first recipe, and each recipe's prerequisites");
  });
  test("past env, cross-env and an interpreter's flags: scripts/lint.sh: ruff check .", () => {
    assertControl("past env, cross-env and an interpreter's flags: scripts/lint.sh: ruff check .");
  });
  test('past env, cross-env and an interpreter\'s flags: scripts/lint.js: require("child_process").execSync("stylelint x")', () => {
    assertControl(
      'past env, cross-env and an interpreter\'s flags: scripts/lint.js: require("child_process").execSync("stylelint x")',
    );
  });
  test("past env, cross-env and an interpreter's flags: scripts/check.ts: execSync(`eslint ${dir}`)", () => {
    assertControl(
      "past env, cross-env and an interpreter's flags: scripts/check.ts: execSync(`eslint ${dir}`)",
    );
  });
  test("past env, cross-env and an interpreter's flags: scripts/check.sh: shellcheck *.sh", () => {
    assertControl(
      "past env, cross-env and an interpreter's flags: scripts/check.sh: shellcheck *.sh",
    );
  });
  test("pre-commit's config is reached, less its comments", () => {
    assertControl("pre-commit's config is reached, less its comments");
  });
  test("a build: inside the gate is part of it", () => {
    assertControl("a build: inside the gate is part of it");
  });
  test("a no-break space in a quoted word is read, not recursed into", () => {
    assertControl("a no-break space in a quoted word is read, not recursed into");
  });
  test("a gate in bold and backticks, on a bullet, is read", () => {
    assertControl("a gate in bold and backticks, on a bullet, is read");
  });
  test("a gate written gate :, is read", () => {
    assertControl("a gate written gate :, is read");
  });
  test("a repo in backticks is read", () => {
    assertControl("a repo in backticks is read");
  });
  test("a long file is shown in part", () => {
    assertControl("a long file is shown in part");
  });
  test("and read whole", () => {
    assertControl("and read whole");
  });
  test("npm runs a script's pre script", () => {
    assertControl("npm runs a script's pre script");
  });
});

describe("negative controls: what the gate runs", () => {
  test("the gate does not reach scripts.format: ", () => {
    assertControl("the gate does not reach scripts.format: ");
  });
  test("the gate does not reach scripts.docs", () => {
    assertControl("the gate does not reach scripts.docs");
  });
  test("the gate does not reach scripts.build: ", () => {
    assertControl("the gate does not reach scripts.build: ");
  });
  test("the gate does not reach scripts.test: ", () => {
    assertControl("the gate does not reach scripts.test: ");
  });
  test("the gate does not reach test:unit:slow", () => {
    assertControl("the gate does not reach test:unit:slow");
  });
  test("the gate does not reach jest", () => {
    assertControl("the gate does not reach jest");
  });
  test("the gate does not reach vitest", () => {
    assertControl("the gate does not reach vitest");
  });
  test("the gate does not reach hadolint", () => {
    assertControl("the gate does not reach hadolint");
  });
  test("the gate does not reach oxfmt", () => {
    assertControl("the gate does not reach oxfmt");
  });
  test("the gate does not reach oxlint", () => {
    assertControl("the gate does not reach oxlint");
  });
  test("the gate does not reach xo", () => {
    assertControl("the gate does not reach xo");
  });
  test("the gate does not reach knip", () => {
    assertControl("the gate does not reach knip");
  });
  test("the gate does not reach standard", () => {
    assertControl("the gate does not reach standard");
  });
  test("the gate does not reach jscpd", () => {
    assertControl("the gate does not reach jscpd");
  });
  test("the gate does not reach decoy", () => {
    assertControl("the gate does not reach decoy");
  });
  test("a make gate does not reach ruff", () => {
    assertControl("a make gate does not reach ruff");
  });
  test("a make gate does not reach pylint", () => {
    assertControl("a make gate does not reach pylint");
  });
  test("a make gate does not reach prettier", () => {
    assertControl("a make gate does not reach prettier");
  });
  test("a make gate does not reach decoy", () => {
    assertControl("a make gate does not reach decoy");
  });
  test("a make gate does not reach Makefile 4", () => {
    assertControl("a make gate does not reach Makefile 4");
  });
  test("a workspace script nothing runs is not reached", () => {
    assertControl("a workspace script nothing runs is not reached");
  });
  test("Yarn 2 and later run no pre script", () => {
    assertControl("Yarn 2 and later run no pre script");
  });
  test("nothing the gate runs was run", () => {
    assertControl("nothing the gate runs was run");
  });
  test("a waybill that names no gate is refused", () => {
    assertControl("a waybill that names no gate is refused");
  });
  test("a run with no branch of its name is refused, never read from the checkout", () => {
    assertControl("a run with no branch of its name is refused, never read from the checkout");
  });
});

describe("positive controls: the sort", () => {
  test("a sort of every finding passes, and prints its proposals and counts", () => {
    assertControl("a sort of every finding passes, and prints its proposals and counts");
  });
  test("findings that share a rule share a line, a rule may hold colons, and a new linter is its own proposal", () => {
    assertControl(
      "findings that share a rule share a line, a rule may hold colons, and a new linter is its own proposal",
    );
  });
  test("a linter run by a file the gate runs counts as run", () => {
    assertControl("a linter run by a file the gate runs counts as run");
  });
  test("a linter's case and markup are set aside", () => {
    assertControl("a linter's case and markup are set aside");
  });
  test("a linter the project has, and the gate does not run, is a new linter when its line says not-in-gate", () => {
    assertControl(
      "a linter the project has, and the gate does not run, is a new linter when its line says not-in-gate",
    );
  });
  test("a linter a make target runs counts as run", () => {
    assertControl("a linter a make target runs counts as run");
  });
  test("a linter named via a file of the branch that names it", () => {
    assertControl("a linter named via a file of the branch that names it");
  });
  test("a run with no style findings and no sort has nothing to sort", () => {
    assertControl("a run with no style findings and no sort has nothing to sort");
  });
  test("a sort with no linter and no docs line counts none of either", () => {
    assertControl("a sort with no linter and no docs line counts none of either");
  });
  test("a sort that opens with a byte-order mark is read", () => {
    assertControl("a sort that opens with a byte-order mark is read");
  });
  test("each proposal carries what the project's ledger last records of it, from any run", () => {
    assertControl(
      "each proposal carries what the project's ledger last records of it, from any run",
    );
  });
});

describe("negative controls: the sort, each fault named", () => {
  test("a finding left out", () => {
    assertControl("a finding left out");
  });
  test("a finding sorted twice", () => {
    assertControl("a finding sorted twice");
  });
  test("an id that is no style finding", () => {
    assertControl("an id that is no style finding");
  });
  test("a line with no reason", () => {
    assertControl("a line with no reason");
  });
  test("a kind that is not one of the three", () => {
    assertControl("a kind that is not one of the three");
  });
  test("a linter line with no enable or write", () => {
    assertControl("a linter line with no enable or write");
  });
  test("prose between the lines", () => {
    assertControl("prose between the lines");
  });
  test("and the forms are then given", () => {
    assertControl("and the forms are then given");
  });
  test("a linter only an echoed hint would reach", () => {
    assertControl("a linter only an echoed hint would reach");
  });
  test("a linter only a comment names", () => {
    assertControl("a linter only a comment names");
  });
  test("a linter only a shell comment names", () => {
    assertControl("a linter only a shell comment names");
  });
  test("a linter only a comment in a quoted command names", () => {
    assertControl("a linter only a comment in a quoted command names");
  });
  test("a linter only bun's own build would reach", () => {
    assertControl("a linter only bun's own build would reach");
  });
  test("a new linter the gate already runs", () => {
    assertControl("a new linter the gate already runs");
  });
  test("a new linter the project already has", () => {
    assertControl("a new linter the project already has");
  });
  test("a new linter proposed twice", () => {
    assertControl("a new linter proposed twice");
  });
  test("a new linter for no such finding", () => {
    assertControl("a new linter for no such finding");
  });
  test("a new linter for no finding at all", () => {
    assertControl("a new linter for no finding at all");
  });
  test("a via file that does not name the linter", () => {
    assertControl("a via file that does not name the linter");
  });
  test("a via file the branch does not have", () => {
    assertControl("a via file the branch does not have");
  });
  test("no sort at all, with findings to sort", () => {
    assertControl("no sort at all, with findings to sort");
  });
  test("a linter line with no gate to check it against", () => {
    assertControl("a linter line with no gate to check it against");
  });
  test("a sort for a run with no style findings", () => {
    assertControl("a sort for a run with no style findings");
  });
  test("no dispatch directory is a usage error", () => {
    assertControl("no dispatch directory is a usage error");
  });
});

describe("the gate is read as the run's branch has it", () => {
  test("a branch cut after a change reads the change", () => {
    assertControl("a branch cut after a change reads the change");
  });
  test("a run's own branch reads as it was, whatever the checkout now holds", () => {
    assertControl("a run's own branch reads as it was, whatever the checkout now holds");
  });
});

describe("the runbooks agree with this script", () => {
  test("the runbooks name list, count, gate and check, and no other subcommand", () => {
    assertControl("the runbooks name list, count, gate and check, and no other subcommand");
  });
  test("and a subcommand the script lacks would be caught", () => {
    assertControl("and a subcommand the script lacks would be caught");
  });
  test("every form coachman.md gives is a sort line", () => {
    assertControl("every form coachman.md gives is a sort line");
  });
  test("and a form that is not one would be caught", () => {
    assertControl("and a form that is not one would be caught");
  });
  test("coachman.md says: converge on a prescribed one-line fix for a gating finding", () => {
    assertControl("coachman.md says: converge on a prescribed one-line fix for a gating finding");
  });
  test("coachman.md says: is a finding about the LANE: log a `note`", () => {
    assertControl("coachman.md says: is a finding about the LANE: log a `note`");
  });
  test("coachman.md says: for style, how many findings go to the ship card's Style residue, as", () => {
    assertControl(
      "coachman.md says: for style, how many findings go to the ship card's Style residue, as",
    );
  });
  test("postmaster.md says: Check the style sort too, once the last leg's process has exited", () => {
    assertControl(
      "postmaster.md says: Check the style sort too, once the last leg's process has exited",
    );
  });
  test('postmaster.md says: --title "<title>" --project <repo>`, and log `ticket-check`', () => {
    assertControl(
      'postmaster.md says: --title "<title>" --project <repo>`, and log `ticket-check`',
    );
  });
  test("postmaster.md says: log a `note` with `style proposal asked: <proposal>` for each draft shown", () => {
    assertControl(
      "postmaster.md says: log a `note` with `style proposal asked: <proposal>` for each draft shown",
    );
  });
  test("postmaster.md says: and carry on with the stream", () => {
    assertControl("postmaster.md says: and carry on with the stream");
  });
  test("and the style sort is no escalation", () => {
    assertControl("and the style sort is no escalation");
  });
  test("and the rule's old wording would be caught", () => {
    assertControl("and the rule's old wording would be caught");
  });
});

describe("the cleanup asks nothing at a terminal", () => {
  test("at a terminal it removes a file git made read-only, and asks nothing", () => {
    assertControl("at a terminal it removes a file git made read-only, and asks nothing");
  });
  test("one that reads the terminal would ask instead, and remove nothing", () => {
    assertControl("one that reads the terminal would ask instead, and remove nothing");
  });
  test("JSTARS takes a U+001C indent like BASE", () => {
    assertControl("JSTARS takes a U+001C indent like BASE");
  });
  test("JSCOM strips after U+001C like BASE", () => {
    assertControl("JSCOM strips after U+001C like BASE");
  });
  test("SHCOM strips after U+001C like BASE", () => {
    assertControl("SHCOM strips after U+001C like BASE");
  });
  test("findings split U+001C like BASE", () => {
    assertControl("findings split U+001C like BASE");
  });
  test("fields stop at a U+001C next like BASE", () => {
    assertControl("fields stop at a U+001C next like BASE");
  });
  test("JALIAS takes a non-ASCII name like BASE", () => {
    assertControl("JALIAS takes a non-ASCII name like BASE");
  });
  test("JVAR takes a non-ASCII name like BASE", () => {
    assertControl("JVAR takes a non-ASCII name like BASE");
  });
  test("JRECIPE keeps a non-ASCII tail in the name like BASE", () => {
    assertControl("JRECIPE keeps a non-ASCII tail in the name like BASE");
  });
  test("JDEPS takes non-ASCII deps like BASE", () => {
    assertControl("JDEPS takes non-ASCII deps like BASE");
  });
  test("MAKEINC takes a U+001C gap like BASE", () => {
    assertControl("MAKEINC takes a U+001C gap like BASE");
  });
  test("RULE trims a U+001C gap like BASE", () => {
    assertControl("RULE trims a U+001C gap like BASE");
  });
  test("ASSIGN takes a U+001C gap like BASE", () => {
    assertControl("ASSIGN takes a U+001C gap like BASE");
  });
  test("YPKGS takes a NEL gap like BASE", () => {
    assertControl("YPKGS takes a NEL gap like BASE");
  });
  test("YITEM takes a U+001C indent like BASE", () => {
    assertControl("YITEM takes a U+001C indent like BASE");
  });
  test("YOUT strips a U+001C comment like BASE", () => {
    assertControl("YOUT strips a U+001C comment like BASE");
  });
  test("YIND takes U+001C like BASE", () => {
    assertControl("YIND takes U+001C like BASE");
  });
  test("MVER takes Arabic-Indic digits like BASE", () => {
    assertControl("MVER takes Arabic-Indic digits like BASE");
  });
  test("MUSTACHE takes a non-ASCII name like BASE", () => {
    assertControl("MUSTACHE takes a non-ASCII name like BASE");
  });
  test("COVERSPLIT splits U+001C like BASE", () => {
    assertControl("COVERSPLIT splits U+001C like BASE");
  });
  test("YARNRE takes Arabic-Indic digits like BASE", () => {
    assertControl("YARNRE takes Arabic-Indic digits like BASE");
  });
  test("MENDEF takes a U+001C gap like BASE", () => {
    assertControl("MENDEF takes a U+001C gap like BASE");
  });
  test("MIFCOND refuses endif+long-s like BASE", () => {
    assertControl("MIFCOND refuses endif+long-s like BASE");
  });
  test("MDEFINE takes a U+001C gap like BASE", () => {
    assertControl("MDEFINE takes a U+001C gap like BASE");
  });
  test("ENTRY takes an Arabic-Indic id like BASE", () => {
    assertControl("ENTRY takes an Arabic-Indic id like BASE");
  });
  test("shape splits U+001C heads like BASE", () => {
    assertControl("shape splits U+001C heads like BASE");
  });
  test("runbook quotes split U+001C like BASE", () => {
    assertControl("runbook quotes split U+001C like BASE");
  });
});
