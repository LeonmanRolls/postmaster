import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinnedCommand, runPinned } from "./pinned-script";

let root = "";
let old = "";
let current = "";

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "pinned-script-"));
  old = join(root, "old");
  current = join(root, "current");
  mkdirSync(join(old, "scripts"), { recursive: true });
  mkdirSync(join(current, "scripts"), { recursive: true });
  writeFileSync(join(old, "scripts", "stage.sh"), "#!/bin/sh\nprintf 'old:%s\\n' \"$1\"\n");
  chmodSync(join(old, "scripts", "stage.sh"), 0o755);
  writeFileSync(join(current, "scripts", "run"), '#!/bin/sh\nprintf \'new:%s:%s\\n\' "$1" "$2"\n');
  chmodSync(join(current, "scripts", "run"), 0o755);
  writeFileSync(join(current, "scripts", "stage.ts"), "");
  mkdirSync(join(current, "scripts", "lib"));
  writeFileSync(join(current, "scripts", "lib", "text.ts"), "");
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

test("an older pinned copy uses its executable wrapper", () => {
  expect(pinnedCommand(old, "stage", ["list"])).toEqual({
    path: join(old, "scripts", "stage.sh"),
    args: ["list"],
  });
  const result = runPinned(old, "stage", ["list"]);
  expect(result.code).toBe(0);
  expect(result.out).toBe("old:list\n");
});

test("a newer pinned copy uses its entry and passes the name first", () => {
  expect(pinnedCommand(current, "stage", ["list"])).toEqual({
    path: join(current, "scripts", "run"),
    args: ["stage", "list"],
  });
  const result = runPinned(current, "stage", ["list"]);
  expect(result.code).toBe(0);
  expect(result.out).toBe("new:stage:list\n");
  expect(pinnedCommand(current, "text", ["show"])).toEqual({
    path: join(current, "scripts", "run"),
    args: ["text", "show"],
  });
});

test("missing and unsafe names fail closed", () => {
  expect(pinnedCommand(current, "missing", [])).toBeNull();
  expect(pinnedCommand(old, "../stage", [])).toBeNull();
  expect(runPinned(old, "missing", []).code).toBe(126);
});
