// Controls for the folder link of spec-review-link, beside the script: {path} fills the
// folder that holds the spec, a missing template still prints the file path, and a
// template without {path} is refused. The controls the script carries inside it still
// cover its other refusals.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "spec-review-link.sh");

function withFixture(
  fn: (d: string, folder: string, spec: string) => void,
  template?: string,
): void {
  const tmp = mkdtempSync(join(tmpdir(), "spec-review-link-test-"));
  try {
    const d = join(tmp, "project", ".postmaster", "runs", "RUN-1");
    const folder = join(tmp, "project", ".worktrees", "RUN-1-spec-review");
    mkdirSync(d, { recursive: true });
    mkdirSync(folder, { recursive: true });
    const spec = join(folder, "WORKHORSE-SPEC.md");
    writeFileSync(spec, "approved plan\n");
    const config =
      template === undefined
        ? '{"config":{}}\n'
        : `{"config":{"planning":{"review_link":${JSON.stringify(template)}}}}\n`;
    writeFileSync(join(d, "run.json"), config);
    fn(d, folder, spec);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function go(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bash", [script, ...args], { encoding: "utf8", timeout: 15_000 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

describe("a folder link", () => {
  test("{path} fills the folder that holds the spec, not the file", () => {
    withFixture((d, folder) => {
      const r = go(d, folder);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(`https://code.example/?folder=${realpathSync(folder)}`);
    }, "https://code.example/?folder={path}");
  });

  test("every {path} in the template is filled", () => {
    withFixture((d, folder) => {
      const r = go(d, folder);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(
        `https://code.example/?folder=${realpathSync(folder)}&also=${realpathSync(folder)}`,
      );
    }, "https://code.example/?folder={path}&also={path}");
  });
});

describe("no template", () => {
  test("the link is the spec file's own path", () => {
    withFixture((d, folder, spec) => {
      const r = go(d, folder);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(realpathSync(spec));
    });
  });
});

describe("a template without {path}", () => {
  test("is refused, and prints nothing", () => {
    withFixture((d, folder) => {
      const r = go(d, folder);
      expect(r.status).toBe(2);
      expect(r.stdout.trim()).toBe("");
      expect(r.stderr).toContain("must contain {path}");
    }, "https://code.example/open");
  });
});
