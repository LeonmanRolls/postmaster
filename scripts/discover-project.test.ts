// Tests beside scripts/discover-project.ts, ported from its --self-test on #110: 10 controls.
// Each family agrees with itself: install= and the gate runner name one manager.
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run, withTempDir } from "./lib/proc.ts";

const self = join(import.meta.dir, "run");

const lineOf = (out: string, key: string): string => {
  const found = out.split("\n").filter((l) => l.startsWith(`${key}=`));
  expect(found.length).toBe(1);
  return found[0]!.slice(key.length + 1);
};

const pkg = (dir: string): void => {
  writeFileSync(join(dir, "package.json"), '{"scripts":{"check":"true"}}');
};

const touch = (dir: string, name: string): void => {
  writeFileSync(join(dir, name), "");
};

const agree = (dir: string, family: string, install: string, gate: string): void => {
  const r = run(self, ["discover-project", dir]);
  expect(r.code).toBe(0);
  expect(lineOf(r.out, "install")).toBe(install);
  expect(lineOf(r.out, "gate")).toBe(gate);
};

describe("install line: one manager for install and gate", () => {
  test("npm with a lockfile names one manager for install and gate", () => {
    withTempDir((tmp) => {
      const d = join(tmp, "npm-lock");
      mkdirSync(d);
      pkg(d);
      touch(d, "package-lock.json");
      agree(d, "npm", "npm ci --prefer-offline --no-audit --no-fund", "npm run check");
    });
  });

  test("npm without a lockfile names one manager for install and gate", () => {
    withTempDir((tmp) => {
      const d = join(tmp, "npm-bare");
      mkdirSync(d);
      pkg(d);
      agree(d, "npm", "npm install --prefer-offline --no-audit --no-fund", "npm run check");
    });
  });

  test("pnpm with a lockfile names one manager for install and gate", () => {
    withTempDir((tmp) => {
      const d = join(tmp, "pnpm");
      mkdirSync(d);
      pkg(d);
      touch(d, "pnpm-lock.yaml");
      agree(d, "pnpm", "pnpm install --frozen-lockfile", "pnpm run check");
    });
  });

  test("bun with a lockfile names one manager for install and gate", () => {
    withTempDir((tmp) => {
      const d = join(tmp, "bun");
      mkdirSync(d);
      pkg(d);
      touch(d, "bun.lock");
      agree(d, "bun", "bun install --frozen-lockfile", "bun run check");
    });
  });

  test("bun with a binary lockfile names one manager for install and gate", () => {
    withTempDir((tmp) => {
      const d = join(tmp, "bunb");
      mkdirSync(d);
      pkg(d);
      touch(d, "bun.lockb");
      agree(d, "bun", "bun install --frozen-lockfile", "bun run check");
    });
  });

  test("yarn classic names one manager for install and gate", () => {
    withTempDir((tmp) => {
      const d = join(tmp, "yarn1");
      mkdirSync(d);
      pkg(d);
      touch(d, "yarn.lock");
      agree(d, "yarn", "yarn install --frozen-lockfile", "yarn run check");
    });
  });

  test("yarn berry names one manager for install and gate", () => {
    withTempDir((tmp) => {
      const d = join(tmp, "yarnberry");
      mkdirSync(d);
      pkg(d);
      touch(d, "yarn.lock");
      touch(d, ".yarnrc.yml");
      agree(d, "yarn", "yarn install --immutable", "yarn run check");
    });
  });

  test("cargo needs no install step", () => {
    withTempDir((tmp) => {
      const d = join(tmp, "cargo");
      mkdirSync(d);
      touch(d, "Cargo.toml");
      const r = run(self, ["discover-project", d]);
      expect(r.code).toBe(0);
      expect(lineOf(r.out, "install")).toBe("");
    });
  });

  test("a bare directory installs nothing", () => {
    withTempDir((tmp) => {
      const d = join(tmp, "bare");
      mkdirSync(d);
      const r = run(self, ["discover-project", d]);
      expect(r.code).toBe(0);
      expect(lineOf(r.out, "install")).toBe("");
    });
  });

  test("the gate line is still emitted", () => {
    withTempDir((tmp) => {
      const d = join(tmp, "bare-gate");
      mkdirSync(d);
      const r = run(self, ["discover-project", d]);
      expect(r.code).toBe(0);
      expect(r.out.split("\n").filter((l) => l.startsWith("gate=")).length).toBe(1);
    });
  });

  test("the tracker prefix comes from the commits, with the real grep or none at all", () => {
    withTempDir((tmp) => {
      const d = join(tmp, "abc");
      mkdirSync(d);
      run("git", ["init", "-q", "-b", "main", d]);
      for (const message of ["first: nothing", "second: ABC-1", "third: ABC-2", "fourth: ABC-3"]) {
        const r = run("git", [
          "-C",
          d,
          "-c",
          "user.name=t",
          "-c",
          "user.email=t@t",
          "commit",
          "-q",
          "--allow-empty",
          "-m",
          message,
        ]);
        expect(r.code).toBe(0);
      }
      const withReal = run(self, ["discover-project", d]);
      expect(withReal.code).toBe(0);
      expect(lineOf(withReal.out, "tracker_prefix")).toBe("ABC");

      const bin = join(tmp, "no-grep");
      mkdirSync(bin);
      const grep = join(bin, "grep");
      writeFileSync(grep, "#!/bin/sh\nexit 2\n");
      chmodSync(grep, 0o755);
      const withoutGrep = run(self, ["discover-project", d], {
        env: { PATH: `${bin}:${process.env.PATH}` },
      });
      expect(withoutGrep.code).toBe(0);
      expect(lineOf(withoutGrep.out, "tracker_prefix")).toBe("ABC");
    });
  });
});

describe("where the project keeps its written rules", () => {
  test("rule_sources names the conventional files found, with what each usually is", () => {
    withTempDir((tmp) => {
      const d = join(tmp, "rules");
      mkdirSync(join(d, ".greptile"), { recursive: true });
      mkdirSync(join(d, ".github", "workflows"), { recursive: true });
      pkg(d);
      touch(d, "STYLEGUIDE.md");
      touch(d, "REVIEW.md");
      touch(d, "biome.json");
      writeFileSync(join(d, ".greptile", "config.json"), "{}");
      touch(join(d, ".github", "workflows"), "ci.yml");
      touch(join(d, ".github", "workflows"), "claude-review.yml");
      const r = run(self, ["discover-project", d]);
      expect(r.code).toBe(0);
      expect(lineOf(r.out, "rule_sources")).toBe(
        "styleguide:STYLEGUIDE.md review-bot:REVIEW.md review-bot:.greptile/config.json linter:biome.json review-bot:.github/workflows/claude-review.yml",
      );
    });
  });

  test("a project with none prints an empty rule_sources, and no notes", () => {
    withTempDir((tmp) => {
      const d = join(tmp, "bare");
      mkdirSync(d);
      pkg(d);
      const r = run(self, ["discover-project", d]);
      expect(lineOf(r.out, "rule_sources")).toBe("");
      expect(lineOf(r.out, "notes")).toBe("NONE");
      expect(lineOf(r.out, "sources")).toBe("");
    });
  });

  test("an instruction file in a folder above the project is named", () => {
    withTempDir((tmp) => {
      const family = join(tmp, "family");
      const d = join(family, "shop");
      mkdirSync(d, { recursive: true });
      pkg(d);
      writeFileSync(join(family, "CLAUDE.md"), "Read the family wiki.");
      const r = run(self, ["discover-project", d]);
      expect(lineOf(r.out, "instruction_files_above")).toContain(join(family, "CLAUDE.md"));
    });
  });

  test("a notes file is reported when the project has one", () => {
    withTempDir((tmp) => {
      const d = join(tmp, "noted");
      mkdirSync(join(d, ".postmaster"), { recursive: true });
      pkg(d);
      writeFileSync(join(d, ".postmaster", "notes.md"), "<!-- route: clerk -->\nA note.");
      expect(lineOf(run(self, ["discover-project", d]).out, "notes")).toBe(".postmaster/notes.md");
    });
  });

  test("a registered source whose applies_to matches the project is proposed", () => {
    withTempDir((tmp) => {
      const family = join(tmp, "family");
      const d = join(family, "shop");
      mkdirSync(d, { recursive: true });
      pkg(d);
      const config = join(tmp, "config.toml");
      writeFileSync(
        config,
        `[sources.family-wiki]\npath = "${join(tmp, "wiki")}"\napplies_to = ["${family}/*"]\n[sources.other]\npath = "${tmp}"\napplies_to = ["/nowhere/*"]\n`,
      );
      const r = run(self, ["discover-project", d], {
        env: { ...process.env, POSTMASTER_CONFIG: config },
      });
      expect(lineOf(r.out, "sources")).toBe("family-wiki");
    });
  });
});
