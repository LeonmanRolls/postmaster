import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { run } from "./lib/proc.ts";

const SCRIPT = join(import.meta.dir, "spec-review-link.sh");
const SCRATCH = join(resolve(import.meta.dir, ".."), ".postmaster", "verify");

function withPackage<T>(body: (dispatch: string, specDirectory: string) => T): T {
  mkdirSync(SCRATCH, { recursive: true });
  const root = mkdtempSync(join(SCRATCH, "spec-review-link-test-"));
  const dispatch = join(root, "project", ".postmaster", "runs", "RUN-1");
  const specDirectory = join(dispatch, "spec-review");
  mkdirSync(specDirectory, { recursive: true });
  writeFileSync(join(specDirectory, "WORKHORSE-SPEC.md"), "the shared spec\n");
  try {
    return body(dispatch, specDirectory);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function setRunJson(dispatch: string, reviewLink?: string): void {
  const planning = reviewLink === undefined ? {} : { review_link: reviewLink };
  writeFileSync(
    join(dispatch, "run.json"),
    JSON.stringify({ config: { planning } }) + "\n",
  );
}

test("a configured editor link receives the folder that holds the reviewed spec", () =>
  withPackage((dispatch, specDirectory) => {
    setRunJson(dispatch, "https://code.example/?folder={path}");
    const result = run(SCRIPT, [dispatch, specDirectory]);
    expect(result.code).toBe(0);
    expect(result.out.trim()).toBe(
      `https://code.example/?folder=${realpathSync(specDirectory)}`,
    );
  }));

test("without an editor template the link is the spec file path", () =>
  withPackage((dispatch, specDirectory) => {
    setRunJson(dispatch);
    const result = run(SCRIPT, [dispatch, specDirectory]);
    expect(result.code).toBe(0);
    expect(result.out.trim()).toBe(realpathSync(join(specDirectory, "WORKHORSE-SPEC.md")));
  }));

test("a configured template without a path placeholder is refused", () =>
  withPackage((dispatch, specDirectory) => {
    setRunJson(dispatch, "https://code.example/open");
    const result = run(SCRIPT, [dispatch, specDirectory]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("must contain {path}");
  }));
