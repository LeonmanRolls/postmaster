// Hidden acceptance tests for ../ticket.md, one describe per acceptance criterion.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { task, User } from "../../user.ts";

let user: User;
beforeEach(() => {
  user = new User();
});
afterEach(() => {
  user.close();
});

function addAll(...texts: string[]): void {
  for (const text of texts) {
    user.add(text);
  }
}

describe("1. remove deletes the task with that id", () => {
  test("prints `removed <id>` and exits 0", () => {
    addAll("buy milk", "post the letter");
    const result = user.todo("remove", "1");
    expect(result.code).toBe(0);
    expect(result.out).toEqual(["removed 1"]);
    expect(user.list()).toEqual([task(2, "post the letter")]);
  });

  test("a task that is done can be removed", () => {
    addAll("buy milk", "post the letter");
    user.todo("done", "2");
    expect(user.todo("remove", "2").out).toEqual(["removed 2"]);
    expect(user.list()).toEqual([task(1, "buy milk")]);
  });
});

describe("2. remove takes several ids", () => {
  test("deletes each and prints one line per id, in the order given", () => {
    addAll("a", "b", "c", "d");
    const result = user.todo("remove", "3", "1");
    expect(result.code).toBe(0);
    expect(result.out).toEqual(["removed 3", "removed 1"]);
    expect(user.list()).toEqual([task(2, "b"), task(4, "d")]);
  });
});

describe("3. an id not on the list", () => {
  test("deletes nothing, names the first missing id on stderr, and exits 1", () => {
    addAll("a", "b");
    const result = user.todo("remove", "1", "9", "2", "8");
    expect(result).toEqual({ code: 1, out: [], err: ["no task 9"] });
    expect(user.list()).toEqual([task(1, "a"), task(2, "b")]);
  });

  test("on an empty list", () => {
    expect(user.todo("remove", "1")).toEqual({ code: 1, out: [], err: ["no task 1"] });
  });
});

describe("4. no id, or an argument that is not a positive whole number", () => {
  test.each([[[]], [["one"]], [["0"]], [["-1"]], [["1.5"]], [["2", "x"]], [["9", "x"]]])(
    "remove %j prints the usage line to stderr, deletes nothing, and exits 2",
    (args) => {
      addAll("a", "b");
      const result = user.todo("remove", ...args);
      expect(result.code).toBe(2);
      expect(result.out).toEqual([]);
      expect(result.err.join("\n")).not.toBe("");
      expect(user.list()).toEqual([task(1, "a"), task(2, "b")]);
    },
  );
});

describe("5. the tasks that remain are unchanged", () => {
  test("they keep their ids, text, done and order", () => {
    addAll("a", "b", "c", "d");
    user.todo("done", "3");
    user.todo("remove", "2");
    expect(user.list()).toEqual([task(1, "a"), task(3, "c", true), task(4, "d")]);
  });
});

describe("6. an id is never used twice", () => {
  function remove(id: string): void {
    expect(user.todo("remove", id).out).toEqual([`removed ${id}`]);
  }

  test("a task added after removing the highest id gets the next id", () => {
    addAll("a", "b");
    remove("2");
    expect(user.add("c")).toBe(3);
  });

  test("a task added after the list was emptied gets the next id", () => {
    addAll("a");
    remove("1");
    expect(user.add("b")).toBe(2);
    expect(user.list()).toEqual([task(2, "b")]);
  });

  test("removing several of the highest ids one by one", () => {
    addAll("a", "b", "c");
    remove("3");
    remove("2");
    expect(user.add("d")).toBe(4);
    expect(user.list()).toEqual([task(1, "a"), task(4, "d")]);
  });
});

describe("7. a todo.json written before this change", () => {
  test("still loads, and a task can be removed from it", () => {
    user.writeOldList([task(1, "a"), task(4, "b", true)]);
    expect(user.list()).toEqual([task(1, "a"), task(4, "b", true)]);
    expect(user.add("c")).toBe(5);
    expect(user.todo("remove", "1").out).toEqual(["removed 1"]);
    expect(user.list()).toEqual([task(4, "b", true), task(5, "c")]);
  });

  test("its highest id counts as had, even once that task is removed", () => {
    user.writeOldList([task(1, "a"), task(4, "b", true)]);
    expect(user.todo("remove", "4").out).toEqual(["removed 4"]);
    expect(user.add("c")).toBe(5);
    expect(user.list()).toEqual([task(1, "a"), task(5, "c")]);
  });
});

describe("8. the usage line names remove", () => {
  test("todo with no arguments", () => {
    const result = user.todo();
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).toContain("remove");
  });
});
