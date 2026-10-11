// Tests beside scripts/find-projects.ts: 1 control. The project list comes from the
// global config alone; a project's own settings never change where projects live.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "run");

let tmp = "";
let real = "";

beforeAll(() => {
  // The fixture lives behind a link on every system, as macOS TMPDIR does, so the
  // canonical-path assertion below pins the behavior where no Mac runs either.
  real = mkdtempSync(join(tmpdir(), "find-projects-test-"));
  tmp = `${real}-link`;
  symlinkSync(real, tmp);
});

afterAll(() => {
  rmSync(tmp, { force: true });
  rmSync(real, { recursive: true, force: true });
});

describe("find-projects", () => {
  test("lists the global roots and ignores project settings", () => {
    const seen = join(tmp, "seen");
    const unseen = join(tmp, "unseen");
    for (const d of [join(seen, "x"), join(unseen, "y")]) {
      mkdirSync(d, { recursive: true });
      const g = spawnSync("git", ["init", "-q", "-b", "main", d], { encoding: "utf8" });
      if ((g.status ?? 1) !== 0) throw new Error("cannot init the fixture repo");
      const c = spawnSync(
        "git",
        [
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
          "base",
        ],
        { encoding: "utf8" },
      );
      if ((c.status ?? 1) !== 0) throw new Error("cannot commit the fixture repo");
    }
    mkdirSync(join(seen, "x", ".postmaster"), { recursive: true });
    writeFileSync(
      join(seen, "x", ".postmaster", "settings.toml"),
      `projects_roots = ["${unseen}"]\n`,
    );
    const config = join(tmp, "config.toml");
    writeFileSync(config, `projects_roots = ["${seen}"]\n`);
    const env: Record<string, string | undefined> = {
      ...process.env,
      POSTMASTER_CONFIG: config,
      HOME: join(tmp, "home"),
      POSTMASTER_PROJECT: undefined,
      POSTMASTER_EXCLUDE: undefined,
    };
    const r = spawnSync(CLI, ["find-projects"], { encoding: "utf8", timeout: 30000, env });
    expect(r.status).toBe(0);
    expect(String(r.stdout)).toContain(realpathSync(join(seen, "x")));
    expect(String(r.stdout)).not.toContain("unseen");
  }, 30000);
});
