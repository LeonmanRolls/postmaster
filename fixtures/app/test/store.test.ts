import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load, parseList, StoreError, save, serializeList, storePath } from "../src/store.ts";
import { emptyList, type TodoList } from "../src/tasks.ts";

const list: TodoList = {
  tasks: [
    { id: 1, text: "buy milk", done: false },
    { id: 2, text: "post the letter", done: true },
  ],
};

describe("storePath", () => {
  test("is todo.json in the working directory by default", () => {
    expect(storePath({}, "/ho" + "me/" + "som" + "eon" + "e")).toBe("/ho" + "me/" + "som" + "eon" + "e/t" + "odo" + ".js" + "on");
    expect(storePath({ TODO_FILE: "" }, "/ho" + "me/" + "som" + "eon" + "e")).toBe("/ho" + "me/" + "som" + "eon" + "e/t" + "odo" + ".js" + "on");
  });

  test("is the file TODO_FILE names, relative to the working directory", () => {
    expect(storePath({ TODO_FILE: "lists/work.json" }, "/ho" + "me/" + "som" + "eon" + "e")).toBe(
      "/ho" + "me/" + "som" + "eon" + "e/l" + "ist" + "s/w" + "ork" + ".js" + "on",
    );
    expect(storePath({ TODO_FILE: "/tmp/work.json" }, "/ho" + "me/" + "som" + "eon" + "e")).toBe("/tmp/work.json");
  });
});

describe("parseList", () => {
  test("reads back what serializeList wrote", () => {
    expect(parseList(serializeList(list), "todo.json")).toEqual(list);
  });

  test("keeps only the fields a task has", () => {
    const text = '{"tasks": [{"id": 1, "text": "a", "done": false, "colour": "red"}]}';
    expect(parseList(text, "todo.json")).toEqual({ tasks: [{ id: 1, text: "a", done: false }] });
  });

  test("refuses a file that is not JSON", () => {
    expect(() => parseList("tasks: none", "todo.json")).toThrow(StoreError);
  });

  test("refuses JSON that is not a todo list", () => {
    for (const text of ["[]", "{}", '{"tasks": [{"id": "1", "text": "a", "done": false}]}']) {
      expect(() => parseList(text, "todo.json")).toThrow("todo.json does not hold a todo list");
    }
  });
});

describe("load and save", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "todo-store-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("a file that does not exist yet is an empty list", async () => {
    expect(await load(join(dir, "todo.json"))).toEqual(emptyList);
  });

  test("save writes the whole list and load reads it back, leaving no other file", async () => {
    const path = join(dir, "todo.json");
    await save(path, list);
    expect(await load(path)).toEqual(list);
    expect(readFileSync(path, "utf8")).toBe(serializeList(list));
    expect(readdirSync(dir)).toEqual(["todo.json"]);
  });

  test("load reports a file that does not hold a list", async () => {
    const path = join(dir, "todo.json");
    writeFileSync(path, "not a list");
    expect(load(path)).rejects.toThrow(StoreError);
  });
});
