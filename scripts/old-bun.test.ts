// Tests beside scripts/old-bun.ts: which names it starts, what it calls a fault, and the
// refusal it drives, on a copy of the start command with its own minimum raised above the
// running Bun so no older Bun is needed to show it.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run, withTempDir } from "./lib/proc.ts";
import { scriptNames, verdict } from "./old-bun.ts";
import { bunVersionMessage } from "./lib/bun-min.ts";

const here = import.meta.dir;
const tool = join(here, "..");

test("every runnable script is named, without its tests or its folder", () => {
  const names = scriptNames(here);
  expect(names).toContain("old-bun");
  expect(names).toContain("landing");
  expect(names).toContain("bun-min");
  expect(names.some((n) => n.endsWith(".test"))).toBe(false);
  expect(new Set(names).size).toBe(names.length);
});

test("the verdict wants the version message and nothing else on stdout", () => {
  const msg = bunVersionMessage("postmaster", "9.0.0", "1.4.2");
  expect(verdict("a", 1, "", `${msg}\n`, msg)).toBeNull();
  expect(verdict("a", 0, "", "", msg)).toContain("exited 0");
  expect(verdict("a", null, "", "", msg)).toContain("not at all");
  expect(verdict("a", 1, "something\n", "", msg)).toContain("stdout");
  expect(verdict("a", 1, "", "run: no such script: a", msg)).toContain("stderr");
});

test("the driver refuses every script when the minimum is raised above this Bun", () => {
  const names = ["bun-min", "old-bun", "quiet", "stand-in"];
  withTempDir((tmp) => {
    const scripts = join(tmp, "scripts");
    mkdirSync(join(scripts, "lib"), { recursive: true });
    for (const rel of [
      join("scripts", "run"),
      join("scripts", "old-bun.ts"),
      join("scripts", "lib", "bun-min.ts"),
    ]) {
      writeFileSync(join(tmp, rel), readFileSync(join(tool, rel), "utf-8"));
    }
    writeFileSync(join(tmp, "bunfig.toml"), "");
    writeFileSync(
      join(tmp, "package.json"),
      `${JSON.stringify({ name: "postmaster", engines: { bun: ">=9.0.0" } }, null, 2)}\n`,
    );
    writeFileSync(join(scripts, "stand-in.ts"), 'console.log("ran past the check");\n');
    writeFileSync(join(scripts, "quiet.ts"), "");

    const drove = run("bun", [join(scripts, "old-bun.ts")]);
    expect(drove.code).toBe(0);
    expect(drove.out.trim()).toBe(
      `${names.length} of ${names.length} scripts refused on Bun ${Bun.version}`,
    );

    // Control: a start command with no version check lets the scripts run, and the
    // driver says so rather than passing them through.
    writeFileSync(
      join(scripts, "run"),
      [
        "#!/usr/bin/env bash",
        "set -eu",
        "name=$1",
        "shift",
        'scripts_dir=$(dirname "$0")',
        'exec bun --no-env-file "--config=$scripts_dir/../bunfig.toml" "$scripts_dir/$name.ts" "$@"',
        "",
      ].join("\n"),
    );
    const broken = run("bun", [join(scripts, "old-bun.ts")]);
    expect(broken.code).toBe(1);
    expect(broken.err).toContain("FAIL: stand-in:");
  });
});

test("under a Bun that meets the minimum the driver runs nothing", () => {
  const r = run("bun", [join(here, "old-bun.ts")]);
  expect(r.code).toBe(2);
  expect(r.out).toBe("");
  expect(r.err).toContain("needs a Bun below");
  expect(r.err).toContain(Bun.version);
});
