#!/usr/bin/env bun
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { command, makeTemp, removeTree, scriptDir, writeError, writeOut } from "./lib/core.ts";

const wrapper = join(scriptDir(import.meta.url), "github.sh");
const states = ["todo", "in-progress", "blocked", "done", "cancelled"];
const columns: Record<string, string> = { todo: "todo", "in-progress": "inprogress", done: "done", cancelled: "done" };
const blocked = "blocked";
class ExitFault extends Error {
  constructor(
    message: string,
    readonly code = 1,
  ) {
    super(message);
  }
}
type Obj = Record<string, any>;
function die(message: string, code = 1): never {
  throw new ExitFault(message, code);
}
function jsonResult(text: string, argv: string[]): any {
  try {
    return JSON.parse(text);
  } catch {
    die("gh " + argv.slice(0, 3).join(" ") + " returned no JSON");
  }
}
function makeAdapter(remote: string, args: string[]): number {
  const match = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!match) die("origin is not a GitHub remote: " + remote);
  const owner = match[1]!,
    name = match[2]!,
    nwo = owner + "/" + name;
  const cmd = args[0] ?? "";
  const gh = (argv: string[]): string => {
    const result = command("gh", argv, { input: "" });
    if (result.code !== 0)
      die("gh " + argv.slice(0, 3).join(" ") + ": " + (result.stderr || result.stdout).trim().slice(0, 300));
    return result.stdout;
  };
  const ghj = (argv: string[]): any => jsonResult(gh(argv), argv);
  const linkedBoards = (): Obj[] => {
    const query =
      "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){projectsV2(first:20){nodes{id number title closed url owner{... on User{login} ... on Organization{login}}}}}}";
    const data = ghj(["api", "graphql", "-f", "query=" + query, "-F", "owner=" + owner, "-F", "name=" + name]);
    const nodes = data.data?.repository?.projectsV2?.nodes ?? [];
    return nodes.filter((b: Obj) => !b.closed);
  };
  const board = (): Obj => {
    const boards = linkedBoards();
    if (!boards.length) die(nwo + " has no linked board; run: github.sh <repo> board init", 3);
    const named = boards.filter((b) => b.title === name);
    const result = boards.length > 1 && named.length ? named[0]! : boards[0]!;
    result.ownerLogin = result.owner?.login || owner;
    return result;
  };
  const boardInit = (title: string) => {
    const boards = linkedBoards();
    if (boards.length) {
      const b = boards[0]!;
      writeOut("board exists: #" + b.number + " " + b.title + " " + b.url);
      return;
    }
    const made = ghj(["project", "create", "--owner", owner, "--title", title, "--format", "json"]);
    gh(["project", "link", String(made.number), "--owner", owner, "--repo", nwo]);
    writeOut("board created: #" + made.number + " " + title + " " + (made.url ?? ""));
  };
  const statusField = (b: Obj): [string, Record<string, string>] => {
    const data = ghj(["project", "field-list", String(b.number), "--owner", b.ownerLogin, "--format", "json"]);
    for (const field of data.fields ?? []) {
      if (String(field.name ?? "").toLowerCase() === "status" && field.options != null) {
        const options: Record<string, string> = {};
        for (const option of field.options) options[String(option.name).replace(/\W/g, "").toLowerCase()] = option.id;
        return [field.id, options];
      }
    }
    die("board #" + b.number + " has no Status field");
  };
  const itemId = (b: Obj, number: number, url: string): [string, string | null] => {
    const data = ghj([
      "project",
      "item-list",
      String(b.number),
      "--owner",
      b.ownerLogin,
      "--format",
      "json",
      "--limit",
      "1000",
    ]);
    for (const item of data.items ?? []) {
      const content = item.content ?? {};
      if (content.type === "Issue" && content.number === number && content.repository === nwo)
        return [item.id, item.status ?? null];
    }
    const added = ghj([
      "project",
      "item-add",
      String(b.number),
      "--owner",
      b.ownerLogin,
      "--url",
      url,
      "--format",
      "json",
    ]);
    return [added.id, null];
  };
  const setColumn = (b: Obj, number: number, url: string, flow: string) => {
    const [field, options] = statusField(b),
      key = columns[flow]!;
    if (!(key in options))
      die(
        "board #" +
          b.number +
          " has no Status column for " +
          flow +
          " (its columns: " +
          Object.keys(options).join(", ") +
          ")",
      );
    const [item] = itemId(b, number, url);
    gh([
      "project",
      "item-edit",
      "--project-id",
      b.id,
      "--id",
      item,
      "--field-id",
      field,
      "--single-select-option-id",
      options[key]!,
    ]);
  };
  const boardStatuses = (b: Obj): Record<number, string> => {
    const data = ghj([
      "project",
      "item-list",
      String(b.number),
      "--owner",
      b.ownerLogin,
      "--format",
      "json",
      "--limit",
      "1000",
    ]);
    const output: Record<number, string> = {};
    for (const item of data.items ?? []) {
      const content = item.content ?? {};
      if (content.type === "Issue" && content.repository === nwo) output[content.number] = item.status || "";
    }
    return output;
  };
  const issue = (number: number): Obj => {
    const query =
      "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){number title body state stateReason url createdAt labels(first:50){nodes{name}} comments(first:100){nodes{body createdAt author{login}}}}}}";
    const data = ghj([
      "api",
      "graphql",
      "-f",
      "query=" + query,
      "-F",
      "owner=" + owner,
      "-F",
      "name=" + name,
      "-F",
      "number=" + number,
    ]);
    const result = data.data?.repository?.issue;
    if (!result) die("no issue #" + number + " in " + nwo);
    result.labels = result.labels?.nodes ?? [];
    result.comments = result.comments?.nodes ?? [];
    return result;
  };
  const allIssues = (): Obj[] => {
    const query =
      "query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){issues(first:100,after:$after,states:[OPEN,CLOSED],orderBy:{field:CREATED_AT,direction:ASC}){pageInfo{hasNextPage endCursor} nodes{number title state stateReason labels(first:50){nodes{name}}}}}}";
    const output: Obj[] = [];
    let after = "";
    for (;;) {
      const argv = ["api", "graphql", "-f", "query=" + query, "-F", "owner=" + owner, "-F", "name=" + name];
      if (after) argv.push("-F", "after=" + after);
      const page = ghj(argv).data?.repository?.issues ?? {};
      for (const issue of page.nodes ?? [])
        output.push({
          number: issue.number,
          title: issue.title,
          state: issue.state,
          stateReason: issue.stateReason,
          labels: issue.labels?.nodes ?? [],
        });
      if (!page.pageInfo?.hasNextPage) return output;
      after = page.pageInfo.endCursor;
    }
  };
  const flowState = (iss: Obj, status: string | undefined): string => {
    if (iss.state === "CLOSED") return iss.stateReason === "NOT_PLANNED" ? "cancelled" : "done";
    if ((iss.labels ?? []).some((label: Obj) => String(label.name ?? "").toLowerCase() === blocked)) return "blocked";
    return String(status ?? "")
      .replace(/\W/g, "")
      .toLowerCase() === "inprogress"
      ? "in-progress"
      : "todo";
  };
  const ensureLabel = () => {
    const names = new Set(
      ghj(["label", "list", "-R", nwo, "--json", "name", "--limit", "200"]).map((label: Obj) =>
        label.name.toLowerCase(),
      ),
    );
    if (!names.has(blocked))
      gh([
        "label",
        "create",
        blocked,
        "-R",
        nwo,
        "--color",
        "B60205",
        "--description",
        "Waiting on something outside the run",
      ]);
  };
  const setLabel = (number: number, present: boolean) => {
    if (present) {
      ensureLabel();
      gh(["issue", "edit", String(number), "-R", nwo, "--add-label", blocked]);
    } else gh(["issue", "edit", String(number), "-R", nwo, "--remove-label", blocked]);
  };
  const usage = (text: string): never => die("usage: github.sh <repo> " + text);
  const issueNumber = (text: string): number => {
    if (!/^#?\d+$/.test(text)) die("not an issue number: " + text);
    return Number(text.replace(/^#/, ""));
  };
  const readText = (path: string, what: string): string => {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      die("cannot read " + what + " " + path + ": " + String(error).replace(/^Error: /, ""));
    }
  };
  const bodyFile = (path: string): string => {
    const text = readText(path, "body file");
    if (!text.trim()) die("the body file " + path + " is empty");
    return text;
  };
  const normal = (text: string): string => {
    const lines = text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.replace(/\s+$/, ""));
    while (lines.length && !lines[0]) lines.shift();
    while (lines.length && !lines.at(-1)) lines.pop();
    return lines.join("\n");
  };
  if (cmd === "board") {
    if (args.length === 1) {
      const b = board();
      writeOut("#" + b.number + "\t" + b.title + "\t" + b.url);
    } else if (args[1] === "init" && (args.length === 2 || args.length === 3)) boardInit(args[2] ?? name);
    else usage("board [init [title]]");
  } else if (cmd === "create") {
    if (args.length !== 3) usage("create <title> <body-file>");
    bodyFile(args[2]!);
    const b = board();
    if (!(columns.todo in statusField(b)[1]))
      die("board #" + b.number + " has no Status column for todo; nothing was created");
    const output = gh(["issue", "create", "-R", nwo, "--title", args[1]!, "--body-file", args[2]!]);
    const url = output.trim().split("\n").at(-1)!;
    const number = Number(url.replace(/\/$/, "").split("/").at(-1));
    try {
      setColumn(b, number, url, "todo");
    } catch (error) {
      if (!(error instanceof ExitFault)) throw error;
      writeOut(String(number));
      writeError("github: #" + number + " was created, but is not on the board");
      return 5;
    }
    writeOut(String(number));
  } else if (cmd === "edit") {
    if (args.length !== 4 || !existsSync(args[2]!) || !statFile(args[2]!))
      usage("edit <n> <body-file> <base-file>" + (args.length === 4 ? "; no such body file: " + args[2] : ""));
    const number = issueNumber(args[1]!);
    bodyFile(args[2]!);
    const base = readText(args[3]!, "base file");
    board();
    const current = issue(number);
    if (normal(current.body ?? "") !== normal(base))
      die("#" + number + " changed since " + args[3] + " was read; read it again", 4);
    gh(["issue", "edit", String(number), "-R", nwo, "--body-file", args[2]!]);
    writeOut("#" + number + ": edited");
  } else if (cmd === "read") {
    const bodyOnly = args.slice(2).join(" ") === "--body" && args.length === 3;
    if (args.length !== 2 && !bodyOnly) usage("read <n> [--body]");
    const number = issueNumber(args[1]!);
    const current = issue(number),
      b = board();
    if (bodyOnly) {
      process.stdout.write((current.body ?? "") + "\n");
      return 0;
    }
    const statuses = boardStatuses(b);
    const lines = [
      "id: #" + number,
      "title: " + (current.title ?? ""),
      "state: " + flowState(current, statuses[number]),
      "labels: " + (current.labels ?? []).map((label: Obj) => label.name).join(", "),
      "created: " + String(current.createdAt ?? "").slice(0, 10),
      "url: " + (current.url ?? ""),
      "",
      (current.body ?? "").trim(),
    ];
    let output = lines.join("\n") + "\n";
    const comments = [...(current.comments ?? [])].sort((a: Obj, b: Obj) =>
      String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")),
    );
    if (comments.length) {
      output += "\n## Log\n";
      for (const comment of comments) {
        let text = String(comment.body ?? "")
          .split(/\s+/)
          .filter(Boolean)
          .join(" ");
        if (!/^\d{4}-\d{2}-\d{2} /.test(text))
          text = String(comment.createdAt ?? "").slice(0, 10) + " " + (comment.author?.login ?? "?") + ": " + text;
        output += "- " + text + "\n";
      }
    }
    process.stdout.write(output);
  } else if (cmd === "state") {
    if (args.length !== 3) usage("state <n> <state>");
    const number = issueNumber(args[1]!),
      next = args[2]!;
    if (!states.includes(next)) die("invalid state " + next + " (one of: " + states.join(", ") + ")", 2);
    const b = board(),
      current = issue(number);
    const blockedNow = (current.labels ?? []).some((label: Obj) => String(label.name ?? "").toLowerCase() === blocked);
    const closed = current.state === "CLOSED";
    if (next === "blocked") {
      if (closed) gh(["issue", "reopen", String(number), "-R", nwo]);
      if (!blockedNow) setLabel(number, true);
    } else {
      if (blockedNow) setLabel(number, false);
      if ((next === "todo" || next === "in-progress") && closed) gh(["issue", "reopen", String(number), "-R", nwo]);
      else if (next === "done" && !closed) gh(["issue", "close", String(number), "-R", nwo, "--reason", "completed"]);
      else if (next === "cancelled" && !(closed && current.stateReason === "NOT_PLANNED")) {
        gh(["issue", "close", String(number), "-R", nwo, "--reason", "not planned"]);
      }
      setColumn(b, number, current.url, next);
    }
    writeOut("#" + number + ": " + next);
  } else if (cmd === "comment") {
    if (args.length < 4) usage("comment <n> <actor> <text>");
    const number = issueNumber(args[1]!),
      actor = args[2]!,
      text = args.slice(3).join(" ");
    const now = new Date();
    const stamp =
      [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join(
        "-",
      ) +
      " " +
      String(now.getHours()).padStart(2, "0") +
      ":" +
      String(now.getMinutes()).padStart(2, "0");
    const line = stamp + " " + actor + ": " + text;
    gh(["issue", "comment", String(number), "-R", nwo, "--body", line]);
    writeOut("#" + number + ": " + line);
  } else if (cmd === "list") {
    if (args.length !== 1 && args.length !== 2) usage("list [state]");
    const want = args[1];
    if (want && !states.includes(want)) die("invalid state " + want + " (one of: " + states.join(", ") + ")", 2);
    const statuses = boardStatuses(board());
    for (const current of allIssues().sort((a, b) => a.number - b.number)) {
      const state = flowState(current, statuses[current.number]);
      if (!want || state === want) writeOut("#" + current.number + "\t" + state + "\t" + (current.title ?? ""));
    }
  } else if (cmd === "access") {
    if (args.length !== 1) usage("access");
    const query = "query($owner:String!,$name:String!){repository(owner:$owner,name:$name){viewerPermission}}";
    const data = ghj(["api", "graphql", "-f", "query=" + query, "-F", "owner=" + owner, "-F", "name=" + name]);
    const permission = data.data?.repository?.viewerPermission;
    if (!permission) die("no permission on " + nwo + " could be read");
    writeOut(permission);
  } else if (cmd === "search") {
    if (args.length !== 2) usage("search <text>");
    const query = '"' + args[1]!.replace(/[":]/g, " ").trim() + '"';
    const hits = ghj(["search", "issues", query, "--repo", nwo, "--json", "number,title,state", "--limit", "100"]);
    for (const hit of hits.sort((a: Obj, b: Obj) => a.number - b.number))
      writeOut("#" + hit.number + "\t" + String(hit.state ?? "").toLowerCase() + "\t" + (hit.title ?? ""));
  } else usage("board|create|edit|read|state|comment|list|access|search ...");
  return 0;
}
function statFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
function run(args: string[]): number {
  try {
    if (args[0] === "--self-test") return args.length === 1 ? selfTest() : usage();
    const repo = args[0];
    if (!repo || args.length < 2) return usage();
    if (!existsSync(repo)) die("no such directory: " + repo);
    if (!findProgram("gh")) die("gh is not on PATH");
    if (command("gh", ["auth", "status"]).code !== 0) die("gh is not logged in; the user runs: gh auth login");
    const remote = command("git", ["-C", repo, "remote", "get-url", "origin"]);
    if (remote.code !== 0) die(repo + " has no origin remote");
    return makeAdapter(remote.stdout.trim(), args.slice(1));
  } catch (error) {
    if (error instanceof ExitFault) {
      writeError("github: " + error.message);
      return error.code;
    }
    writeError("github: " + String(error));
    return 1;
  }
}
function usage(): never {
  die("usage: github.sh <repo> board|create|edit|read|state|comment|list|access ... | --self-test");
}
function findProgram(name: string, path = process.env.PATH ?? ""): boolean {
  return path.split(":").some((dir) => existsSync(join(dir || ".", name)));
}
function selfTest(): number {
  const tmp = makeTemp("github-test-"),
    stubDir = join(tmp, "stub"),
    bin = join(tmp, "bin"),
    repo = join(tmp, "repo");
  mkdirSync(stubDir, { recursive: true });
  mkdirSync(bin);
  mkdirSync(repo);
  const stubPath = join(bin, "gh.ts");
  const stubSource =
    [
      "#!/usr/bin/env bun",
      'import { appendFileSync, copyFileSync, existsSync, readFileSync } from "node:fs";',
      'import { join } from "node:path";',
      "const d = process.env.GITHUB_SH_STUB!;",
      "const args = process.argv.slice(2);",
      "const [a, b] = args;",
      'const emitFile = (name: string) => process.stdout.write(readFileSync(join(d, name), "utf8"));',
      'if (a === "auth" && b === "status") process.exit(0);',
      'if (a === "api" && b === "graphql") {',
      '  const q = args.find((x) => x.startsWith("query=")) ?? "";',
      '  if (q.includes("projectsV2")) emitFile("boards.json");',
      '  else if (q.includes("viewerPermission")) emitFile("access.json");',
      '  else if (q.includes("issue(number:")) {',
      '    const n = args.find((x) => x.startsWith("number="))?.slice(7) ?? "";',
      '    if (existsSync(join(d, "issue-" + n + ".json"))) emitFile("issue-" + n + ".json");',
      "    else process.stdout.write(JSON.stringify({ data: { repository: { issue: null } } }));",
      '  } else { process.stderr.write("stub gh: unexpected query\\n"); process.exit(1); }',
      '} else if (a === "project" && b === "item-list") emitFile("items.json");',
      'else if (a === "project" && b === "field-list") emitFile("fields.json");',
      'else if (a === "project" && b === "item-add") {',
      '  if (existsSync(join(d, "no-item-add"))) { process.stderr.write("stub gh: item-add refused\\n"); process.exit(1); }',
      '  process.stdout.write(JSON.stringify({ id: "PVTI_new" }));',
      '} else if (a === "project" && b === "item-edit") process.exit(0);',
      'else if (a === "issue" && b === "create") { appendFileSync(join(d, "creates.log"), "create\\n"); process.stdout.write("https://github.com/o/r/issues/60\\n"); }',
      'else if (a === "search" && b === "issues") { appendFileSync(join(d, "searches.log"), args.join(" ") + "\\n"); emitFile("search.json"); }',
      'else if (a === "issue" && b === "edit") {',
      '  const i = args.indexOf("--body-file");',
      '  appendFileSync(join(d, "edits.log"), "call:" + args.map((x) => "[" + x + "]").join("") + "\\n");',
      '  copyFileSync(args[i + 1]!, join(d, "edited-body"));',
      '} else { process.stderr.write("stub gh: unexpected: " + args.join(" ")); process.exit(1); }',
    ].join("\n") + "\n";
  writeFileSync(stubPath, stubSource);
  chmodSync(stubPath, 0o755);
  symlinkSync(stubPath, join(bin, "gh"));
  command("git", ["init", "-q", repo]);
  command("git", ["-C", repo, "remote", "add", "origin", "https://github.com/o/r.git"]);
  const boardJson =
    '{"data":{"repository":{"projectsV2":{"nodes":[{"id":"PVT_1","number":1,"title":"r","closed":false,"url":"https://github.com/users/o/projects/1","owner":{"login":"o"}}]}}}}';
  const itemsJson =
    '{"items":[{"id":"PVTI_7","status":"Todo","content":{"type":"Issue","number":7,"repository":"o/r"}}]}';
  const fieldsJson =
    '{"fields":[{"id":"F1","name":"Status","options":[{"id":"o1","name":"Todo"},{"id":"o2","name":"In Progress"},{"id":"o3","name":"Done"}]}]}';
  const lfBody =
    "## Problem / feature\nA body with " +
    String.fromCharCode(96) +
    "code" +
    String.fromCharCode(96) +
    ', "quotes" and a trailing space. \n\n## Direction\nNone.';
  const crlfBody = "## Problem / feature\r\nStored with CRLF line endings.\r\n\r\n## Direction\r\nNone.\r\n";
  const newBody = "## Problem / feature\nThe new body.\n\n## Direction\nNone: any approach that meets the criteria.\n";
  const put = (name: string, value: string) => writeFileSync(join(tmp, name), value);
  const putStub = (name: string, value: string) => writeFileSync(join(stubDir, name), value);
  const storeIssue = (number: number, body: string) =>
    putStub(
      "issue-" + number + ".json",
      JSON.stringify({
        data: {
          repository: {
            issue: {
              number,
              title: "Check a ticket's shape",
              body,
              state: "OPEN",
              stateReason: null,
              url: "https://github.com/o/r/issues/" + number,
              createdAt: "2026-09-23T00:00:00Z",
              labels: { nodes: [] },
              comments: { nodes: [] },
            },
          },
        },
      }),
    );
  const env = { PATH: bin + ":" + (process.env.PATH ?? ""), GITHUB_SH_STUB: stubDir };
  const invoke = (args: string[]) => command(wrapper, [repo, ...args], { env });
  let fails = 0;
  const ok = (label: string) => writeOut("  ok   " + label);
  const fail = (label: string, output = "") => {
    writeOut("  FAIL " + label);
    if (output) for (const line of output.split("\n")) writeOut("         " + line);
    fails++;
  };
  const check = (label: string, good: boolean, output = "") => (good ? ok(label) : fail(label, output));
  const edits = () => {
    try {
      return (readFileSync(join(stubDir, "edits.log"), "utf8") as string).split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  };
  try {
    writeFileSync(join(stubDir, "boards.json"), boardJson);
    writeFileSync(join(stubDir, "items.json"), itemsJson);
    writeFileSync(join(stubDir, "fields.json"), fieldsJson);
    put("lf.md", lfBody);
    put("crlf.md", crlfBody);
    put("new.md", newBody);
    storeIssue(7, lfBody);
    writeOut("positive controls");
    let result = invoke(["read", "7", "--body"]);
    check(
      "read --body prints the stored body byte for byte, then one newline",
      result.code === 0 && result.stdout === lfBody + "\n",
      result.stdout,
    );
    storeIssue(7, crlfBody);
    result = invoke(["read", "7", "--body"]);
    check("read --body keeps a CRLF body's line endings", result.code === 0 && result.stdout === crlfBody + "\n");
    storeIssue(7, lfBody);
    result = invoke(["read", "7"]);
    check(
      "read without --body still prints the header before the body",
      result.code === 0 &&
        result.stdout.split("\n")[0] === "id: #7" &&
        result.stdout.includes("title: Check a ticket's shape"),
    );
    invoke(["read", "7", "--body"]);
    try {
      rmSync(join(stubDir, "edits.log"));
    } catch {}
    result = invoke(["edit", "7", join(tmp, "new.md"), join(tmp, "lf.md")]);
    const edited = readFileSync(join(stubDir, "edited-body"), "utf8") as string;
    const log = readFileSync(join(stubDir, "edits.log"), "utf8") as string;
    check(
      "edit against the body as read calls gh issue edit once, with the body file and no title",
      result.code === 0 &&
        result.stdout.trim() === "#7: edited" &&
        edits() === 1 &&
        log.includes("[--body-file]") &&
        !log.includes("[--title]") &&
        edited === newBody,
      result.stdout + log,
    );
    storeIssue(7, crlfBody);
    put("base-lf.md", crlfBody.replace(/\r/g, ""));
    try {
      rmSync(join(stubDir, "edits.log"));
    } catch {}
    result = invoke(["edit", "7", join(tmp, "new.md"), join(tmp, "base-lf.md")]);
    check(
      "a body stored with CRLF matches the same base with LF",
      result.code === 0 && result.stdout.trim() === "#7: edited" && edits() === 1,
      result.stdout,
    );
    writeOut("negative controls: nothing is written");
    const refused = (label: string, want: number, contains: string, args: string[]) => {
      try {
        rmSync(join(stubDir, "edits.log"));
      } catch {}
      const r = invoke(["edit", ...args]),
        output = r.stdout + r.stderr;
      check(label, r.code === want && edits() === 0 && output.includes(contains), output);
    };
    storeIssue(7, lfBody);
    put("stale.md", "## Problem / feature\nChanged in the tracker since.\n");
    put("empty.md", " \n\n");
    refused("a base the issue no longer matches exits 4", 4, "#7 changed since", [
      "7",
      join(tmp, "new.md"),
      join(tmp, "stale.md"),
    ]);
    refused("an empty body file exits 1", 1, "is empty", ["7", join(tmp, "empty.md"), join(tmp, "lf.md")]);
    refused("a missing base file exits 1", 1, "cannot read base file", [
      "7",
      join(tmp, "new.md"),
      join(tmp, "nowhere.md"),
    ]);
    refused("a pull request number exits 1", 1, "no issue #34", ["34", join(tmp, "new.md"), join(tmp, "lf.md")]);
    refused("the old form, with a title, is a usage error", 1, "usage:", [
      "7",
      "Check a ticket's shape",
      join(tmp, "new.md"),
    ]);
    writeFileSync(join(stubDir, "boards.json"), '{"data":{"repository":{"projectsV2":{"nodes":[]}}}}');
    refused("no linked board exits 3", 3, "no linked board", ["7", join(tmp, "new.md"), join(tmp, "lf.md")]);
    result = invoke(["read", "7", "--body"]);
    check("read --body without a linked board exits 3", result.code === 3);
    writeFileSync(join(stubDir, "boards.json"), boardJson);
    writeOut("access");
    writeFileSync(join(stubDir, "access.json"), '{"data":{"repository":{"viewerPermission":"ADMIN"}}}');
    result = invoke(["access"]);
    check("access prints the user's permission", result.code === 0 && result.stdout.trim() === "ADMIN");
    writeFileSync(join(stubDir, "access.json"), '{"data":{"repository":{"viewerPermission":"READ"}}}');
    result = invoke(["access"]);
    check("a repository the user only reads says READ", result.code === 0 && result.stdout.trim() === "READ");
    writeFileSync(join(stubDir, "access.json"), '{"data":{"repository":null}}');
    result = invoke(["access"]);
    check("a repository gh cannot see exits 1", result.code === 1 && result.stderr.includes("no permission on o/r"));
    writeOut("create and search");
    putStub("creates.log", "");
    result = invoke(["create", "A title", join(tmp, "new.md")]);
    const created = readFileSync(join(stubDir, "creates.log"), "utf8") as string;
    check(
      "create files the issue and prints its number",
      result.code === 0 && result.stdout.trim() === "60" && created.trim() === "create",
    );
    putStub("creates.log", "");
    putStub("no-item-add", "");
    result = invoke(["create", "A title", join(tmp, "new.md")]);
    check(
      "an issue that misses the board still prints its number, and exits 5",
      result.code === 5 &&
        result.stdout.trim() === "60" &&
        (readFileSync(join(stubDir, "creates.log"), "utf8") as string).trim() === "create" &&
        result.stderr.includes("#60 was created, but is not on the board"),
      result.stdout + result.stderr,
    );
    rmSync(join(stubDir, "no-item-add"));
    putStub("creates.log", "");
    writeFileSync(
      join(stubDir, "fields.json"),
      '{"fields":[{"id":"F1","name":"Status","options":[{"id":"o1","name":"Backlog"},{"id":"o3","name":"Done"}]}]}',
    );
    result = invoke(["create", "A title", join(tmp, "new.md")]);
    check(
      "a board with no Todo column is refused before anything is created",
      result.code === 1 &&
        !(readFileSync(join(stubDir, "creates.log"), "utf8") as string).trim() &&
        result.stderr.includes("nothing was created"),
      result.stderr,
    );
    writeFileSync(join(stubDir, "fields.json"), fieldsJson);
    writeFileSync(
      join(stubDir, "search.json"),
      '[{"number":9,"title":"Later","state":"CLOSED"},{"number":4,"title":"Earlier","state":"OPEN"}]',
    );
    result = invoke(["search", "tf-0a1b2c3d"]);
    const searches = readFileSync(join(stubDir, "searches.log"), "utf8") as string;
    check(
      "search asks for the phrase in this repository, and prints number, state and title",
      result.code === 0 &&
        result.stdout === "#4\topen\tEarlier\n#9\tclosed\tLater\n" &&
        searches.includes('"tf-0a1b2c3d" --repo o/r'),
    );
    invoke(["search", "Tool fault in scripts/x.sh:"]);
    const lastSearch = (readFileSync(join(stubDir, "searches.log"), "utf8") as string).trim().split("\n").at(-1) ?? "";
    check(
      "a colon in the text is searched as a space, which GitHub's query accepts",
      lastSearch.includes('"Tool fault in scripts/x.sh " --repo o/r') ||
        lastSearch.includes('"Tool fault in scripts/x.sh" --repo o/r'),
      lastSearch,
    );
  } finally {
    removeTree(tmp);
  }
  writeOut("");
  writeOut(fails ? "self-test: " + fails + " control(s) misbehaved" : "self-test: all controls behaved");
  return fails ? 1 : 0;
}
process.exit(run(process.argv.slice(2)));
