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
});

describe("tracker prefix from commit messages", () => {
  test("the prefix is found in-process when grep is unavailable or fails", () => {
    withTempDir((tmp) => {
      const repo = join(tmp, "repo");
      const bin = join(tmp, "bin");
      mkdirSync(repo);
      mkdirSync(bin);
      expect(run("git", ["init", "-q", repo]).code).toBe(0);
      for (const ticket of ["ABC-1", "ABC-2", "ABC-3"]) {
        const commit = run("git", [
          "-C",
          repo,
          "-c",
          "user.name=brindlewick",
          "-c",
          "user.email=332054101+brindlewick@users.noreply.github.com",
          "commit",
          "--allow-empty",
          "-m",
          ticket,
        ]);
        expect(commit.code).toBe(0);
      }
      const grep = join(bin, "grep");
      writeFileSync(grep, "#!/bin/sh\nexit 2\n");
      chmodSync(grep, 0o755);

      const normal = run(self, ["discover-project", repo]);
      const failedGrep = run(self, ["discover-project", repo], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
      });
      expect(normal.code).toBe(0);
      expect(failedGrep.code).toBe(0);
      expect(lineOf(normal.out, "tracker_prefix")).toBe("ABC");
      expect(lineOf(failedGrep.out, "tracker_prefix")).toBe("ABC");
    });
  });
});
