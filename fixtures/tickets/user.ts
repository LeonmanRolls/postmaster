// How the hidden acceptance tests drive the app: as a user would, through its command, in a
// directory of their own. They never import the app's code, because how it is built inside is
// the run's to choose. FIXTURE_APP names the app's directory; scripts/run fixture sets it.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const app = process.env.FIXTURE_APP;
if (app === undefined || app === "") {
  throw new Error("FIXTURE_APP must name the app's directory");
}
const manifest = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.todo;
if (typeof bin !== "string") {
  throw new Error(`${app}/package.json names no todo command in bin`);
}
const command = resolve(app, bin);

export type Result = { code: number | null; out: string[]; err: string[] };
export type Task = { id: number; done: boolean; text: string };

export class User {
  constructor(
    readonly home: string = mkdtempSync(join(tmpdir(), "todo-user-")),
    readonly file: string = join(home, "todo.json"),
  ) {}

  /** The same user in the same directory, keeping another list in another file. */
  withFile(name: string): User {
    return new User(this.home, join(this.home, name));
  }

  /** Runs one command, as its own process; one that hangs is killed after ten seconds. */
  todo(...args: string[]): Result {
    const run = Bun.spawnSync([process.execPath, command, ...args], {
      cwd: this.home,
      env: { PATH: process.env.PATH ?? "", HOME: this.home, TODO_FILE: this.file },
      stdin: "ignore",
      timeout: 10_000,
    });
    return { code: run.exitCode, out: lines(run.stdout), err: lines(run.stderr) };
  }

  /** Adds a task and returns the id `todo add` printed. */
  add(text: string): number {
    const result = this.todo("add", text);
    const id = /^added (\d+)$/.exec(result.out[0] ?? "")?.[1];
    if (result.code !== 0 || id === undefined) {
      throw new Error(`todo add ${text}: ${JSON.stringify(result)}`);
    }
    return Number(id);
  }

  /** The list as `todo list` prints it; a line that is not a task fails the test. */
  list(): Task[] {
    const result = this.todo("list");
    if (result.code !== 0) {
      throw new Error(`todo list: ${JSON.stringify(result)}`);
    }
    if (result.out.length === 1 && result.out[0] === "no tasks") {
      return [];
    }
    return result.out.map((line) => {
      const match = /^(\d+) \[( |x)\] (.*)$/.exec(line);
      if (match === null) {
        throw new Error(`todo list printed a line that is not a task: ${JSON.stringify(line)}`);
      }
      return { id: Number(match[1]), done: match[2] === "x", text: match[3] ?? "" };
    });
  }

  /** Writes the list the way the app wrote it before the ticket. */
  writeOldList(tasks: Task[]): void {
    const stored = tasks.map(({ id, text, done }) => ({ id, text, done }));
    writeFileSync(this.file, `${JSON.stringify({ tasks: stored }, null, 2)}\n`);
  }

  close(): void {
    rmSync(this.home, { recursive: true, force: true });
  }
}

export function task(id: number, text: string, done = false): Task {
  return { id, done, text };
}

function lines(output: Buffer): string[] {
  const text = output.toString();
  return text === "" ? [] : text.replace(/\n$/, "").split("\n");
}
