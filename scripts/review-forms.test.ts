// Tests beside scripts/review-forms.ts, moved from its --self-test on #109: 10 controls.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { run } from "./lib/proc.ts";

const self = join(import.meta.dir, "run");

describe("positive controls", () => {
  for (const h of ["claude", "codex", "mimo"]) {
    test(`a ${h} lane has a code-review form`, () => {
      const r = run(self, ["review-forms", "has", h]);
      expect(r.code).toBe(0);
    });
  }
});

describe("negative controls", () => {
  for (const h of ["pi", "muse", "grok", "agy", "bash"]) {
    test(`a ${h} lane has no code-review form: exit 3`, () => {
      const r = run(self, ["review-forms", "has", h]);
      expect(r.code).toBe(3);
    });
  }

  test("has with no harness is refused", () => {
    expect(run(self, ["review-forms", "has"]).code).toBe(1);
  });

  test("has with an extra argument is refused", () => {
    expect(run(self, ["review-forms", "has", "claude", "extra"]).code).toBe(1);
  });
});
