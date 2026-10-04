import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("remove uses the CLI and stores the remaining list", () => {
  const cwd = mkdtempSync(join(tmpdir(), "todo-cli-acceptance-"));
  dirs.push(cwd);
  const listPath = join(cwd, "todo.json");
  writeFileSync(
    listPath,
    `${JSON.stringify({
      tasks: [
        { id: 1, text: "buy milk", done: false },
        { id: 2, text: "walk the dog", done: true },
        { id: 3, text: "water the plants", done: false },
      ],
      lastId: 3,
    })}\n`,
  );
  const result = spawnSync(
    process.execPath,
    [join(import.meta.dir, "../src/cli.ts"), "remove", "2"],
    {
      cwd,
      env: { ...process.env, TODO_FILE: listPath },
      encoding: "utf8",
    },
  );
  const stored = JSON.parse(readFileSync(listPath, "utf8"));
  console.log(
    `todo remove 2: exit=${result.status}; stdout=${JSON.stringify(result.stdout)}; stderr=${JSON.stringify(result.stderr)}; stored=${JSON.stringify(stored)}`,
  );

  expect(result.status).toBe(0);
  expect(result.stdout).toBe("removed 2\n");
  expect(result.stderr).toBe("");
  expect(stored).toEqual({
    tasks: [
      { id: 1, text: "buy milk", done: false },
      { id: 3, text: "water the plants", done: false },
    ],
    lastId: 3,
  });
});
