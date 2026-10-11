// Tests beside scripts/lib/bun-min.ts: the version comparison, the one message, and the
// start command's refusal before a script loads.
import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run, withTempDir } from "./proc.ts";
import { bunVersionMessage, compareVersions, minimumOf } from "./bun-min.ts";

test("the minimum is the first version the range names", () => {
  expect(minimumOf(">=1.4.2")).toBe("1.4.2");
  expect(minimumOf("1.4.2")).toBe("1.4.2");
  expect(minimumOf("^1.10.0")).toBe("1.10.0");
  expect(minimumOf("")).toBeNull();
  expect(minimumOf("newest")).toBeNull();
});

test("versions compare as numbers, not as text", () => {
  expect(compareVersions("1.4.2", "1.4.2")).toBe(0);
  expect(compareVersions("1.4.10", "1.4.2")).toBe(1);
  expect(compareVersions("1.10.0", "1.4.2")).toBe(1);
  expect(compareVersions("1.3.14", "1.4.2")).toBe(-1);
  expect(compareVersions("1.4.1", "1.4.2")).toBe(-1);
  expect(compareVersions("2.0.0", "1.4.2")).toBe(1);
  expect(compareVersions("nope", "1.4.2")).toBeNull();
});

test("the message names what is needed and what was found", () => {
  const msg = bunVersionMessage("postmaster", "1.4.2", "1.3.14");
  expect(msg).toContain("1.4.2");
  expect(msg).toContain("1.3.14");
});

test("the running Bun passes the manifest's own minimum, and a raised one does not", () => {
  const here = import.meta.dir;
  const tool = join(here, "..", "..");
  const ok = run("bun", [join(here, "bun-min.ts"), join(tool, "package.json")]);
  expect(ok.code).toBe(0);
  expect(ok.out).toBe("");
  expect(ok.err).toBe("");

  withTempDir((tmp) => {
    const raised = join(tmp, "package.json");
    writeFileSync(
      raised,
      `${JSON.stringify({ name: "postmaster", engines: { bun: ">=9.0.0" } }, null, 2)}\n`,
    );
    const refused = run("bun", [join(here, "bun-min.ts"), raised]);
    expect(refused.code).toBe(1);
    expect(refused.out).toBe("");
    expect(refused.err.trim()).toBe(bunVersionMessage("postmaster", "9.0.0", Bun.version));
  });
});

test("started through run with a raised minimum, the version message stops a script that would not even load", () => {
  withTempDir((tmp) => {
    const scripts = join(tmp, "scripts");
    mkdirSync(join(scripts, "lib"), { recursive: true });
    const here = import.meta.dir;
    const tool = join(here, "..", "..");
    writeFileSync(
      join(scripts, "run"),
      // The start command itself, taken from the tool so the refusal path is the real one.
      readFileSync(join(tool, "scripts", "run"), "utf-8"),
    );
    writeFileSync(
      join(scripts, "lib", "bun-min.ts"),
      readFileSync(join(here, "bun-min.ts"), "utf-8"),
    );
    writeFileSync(join(tmp, "bunfig.toml"), "");
    writeFileSync(
      join(scripts, "stand-in.ts"),
      'import { anExportBunLacks } from "node:fs";\nconsole.log(anExportBunLacks);\n',
    );
    writeFileSync(
      join(tmp, "package.json"),
      `${JSON.stringify({ name: "postmaster", engines: { bun: ">=9.0.0" } }, null, 2)}\n`,
    );

    // Under the raised minimum the start command refuses before the load error can appear.
    const refused = run("bash", [join(scripts, "run"), "stand-in"]);
    expect(refused.code).toBe(1);
    expect(refused.out).toBe("");
    expect(refused.err.trim()).toBe(bunVersionMessage("postmaster", "9.0.0", Bun.version));

    // Control: the same script under a minimum the running Bun meets loads and fails to
    // link instead, so the message above is the version check's, not Bun's.
    writeFileSync(
      join(tmp, "package.json"),
      `${JSON.stringify({ name: "postmaster", engines: { bun: ">=1.4.2" } }, null, 2)}\n`,
    );
    const loaded = run("bash", [join(scripts, "run"), "stand-in"]);
    expect(loaded.code).not.toBe(0);
    expect(loaded.err).not.toBe(refused.err);
    expect(loaded.err).toContain("anExportBunLacks");
  });
});

test("run refuses a version check whose manifest cannot be read", () => {
  const missing = run("bun", [join(import.meta.dir, "bun-min.ts"), "/nonexistent/package.json"]);
  expect(missing.code).toBe(1);
  expect(missing.err).toContain("cannot read");
});
