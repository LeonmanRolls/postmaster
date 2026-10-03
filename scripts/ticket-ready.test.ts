import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scriptsDir } from "./lib/paths.ts";
import { run } from "./lib/proc.ts";
import { mdToHtml } from "./plane.ts";

const HERE = scriptsDir(import.meta);
const SCRIPT = join(HERE, "ticket-ready.sh");
const LOCAL = join(HERE, "local.sh");
const BODY = `## Problem / feature
A list item cannot be fixed after it is filed.

## Acceptance criteria
1. The ready check accepts this ticket after it is signed off.
2. It names each reason the ticket is not ready.

## Direction
None: any approach that meets the criteria.

## Turnpikes
default

## For the agents

### Checks
- **C1** The command reports a ready ticket.
- **C2** It reports missing readiness reasons.

### Technical notes
- The check reads a ticket through the local adapter. (C1, C2)

### Verified at 0000000000000000000000000000000000000000
The fixture commit is the verified base.
`;
const DRAFT = `DRAFT: waiting for the user's sign-off

${BODY}`;
const REMOVE_ONE_PART = `## Problem / feature
A task can only be removed by hand editing the list.

## Acceptance criteria
1. The user can remove a task by its id.

## Direction
None: any approach that meets the criteria.

## Turnpikes
default
`;
const STUB_GH = `#!/usr/bin/env bash
d=$GITHUB_READY_STUB
case "$1 $2" in
  "auth status") exit 0 ;;
  "api graphql")
    q="" n=""
    for a in "$@"; do case $a in query=*) q=$a ;; number=*) n=\${a#number=} ;; esac; done
    case $q in
      *projectsV2*) echo '{"data":{"repository":{"projectsV2":{"nodes":[{"id":"P1","number":1,"title":"repo","closed":false,"url":"https://github.com/o/r/projects/1","owner":{"login":"o"}}]}}}}' ;;
      *"issue(number:"*) cat "$d/issue-$n.json" ;;
      *) echo "unexpected GraphQL query" >&2; exit 1 ;;
    esac ;;
  "project item-list") echo '{"items":[]}' ;;
  *) echo "unexpected gh command: $*" >&2; exit 1 ;;
esac
`;
const PLANE_SERVER = `
const data = JSON.parse(await Bun.file(process.env.PLANE_READY_STUB_DATA).text());
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
  const path = new URL(req.url).pathname.replace(/^\\/api\\/v1\\//, "");
  const item = path.match(/^workspaces\\/ws\\/work-items\\/(PM-\\d+)\\/$/);
  if (item) return Response.json(data.items[item[1]] ?? null, { status: data.items[item[1]] ? 200 : 404 });
  if (path === "workspaces/ws/projects/p1/states/") return Response.json({ results: [{ id: "state-todo", group: "unstarted" }] });
  if (path === "workspaces/ws/projects/p1/labels/") return Response.json({ results: [{ id: "ready-label", name: "ready" }] });
  if (/workspaces\\/ws\\/projects\\/p1\\/work-items\\/[^/]+\\/comments\\//.test(path)) return Response.json({ results: [] });
  console.error("unexpected Plane route", path);
  return Response.json({ error: "unexpected route" }, { status: 404 });
}});
console.log("READY_PORT=" + server.port);
`;

let temp = "";
let repo = "";
let config = "";
let ticketBody = "";
let githubRepo = "";
let githubConfig = "";
let githubBin = "";
let githubStub = "";
let planeRepo = "";
let planeConfig = "";
let planeChild: ReturnType<typeof spawn> | null = null;
let planePort = 0;

function cli(args: string[], moreEnv: Record<string, string> = {}) {
  const r = run("bash", [SCRIPT, ...args], {
    env: { ...process.env, POSTMASTER_CONFIG: config, ...moreEnv },
  });
  return { code: r.code, out: `${r.out}${r.err}` };
}

function adapter(...args: string[]) {
  return run("bash", [LOCAL, repo, ...args]);
}

beforeAll(async () => {
  temp = mkdtempSync(join(tmpdir(), "ticket-ready-"));
  repo = join(temp, "repo");
  mkdirSync(repo, { recursive: true });
  run("git", ["init", "-q", "-b", "main", repo]);
  run("git", ["-C", repo, "-c", "user.name=test", "-c", "user.email=test@example.invalid", "commit", "-q", "--allow-empty", "-m", "init"]);
  config = join(temp, "config.toml");
  writeFileSync(config, '[tracker]\nkind = "local"\n');
  ticketBody = join(temp, "ticket.md");
  writeFileSync(ticketBody, BODY);
  expect(adapter("store", "init").code).toBe(0);
  expect(adapter("create", "Fix the list", ticketBody).code).toBe(0);
  expect(adapter("create", "Fix the list", ticketBody).code).toBe(0);
  writeFileSync(join(temp, "remove.md"), REMOVE_ONE_PART);
  expect(adapter("create", "Remove", join(temp, "remove.md")).code).toBe(0);
  writeFileSync(join(temp, "draft.md"), DRAFT);
  expect(adapter("create", "Draft", join(temp, "draft.md")).code).toBe(0);
  writeFileSync(join(temp, "invalid.md"), "A malformed ticket body.\n");
  expect(adapter("create", "Several failures", join(temp, "invalid.md")).code).toBe(0);
  expect(adapter("label", "1", "add", "ready").code).toBe(0);
  expect(adapter("label", "3", "add", "ready").code).toBe(0);
  expect(adapter("label", "4", "add", "ready").code).toBe(0);

  githubRepo = join(temp, "github-repo");
  mkdirSync(githubRepo, { recursive: true });
  run("git", ["init", "-q", "-b", "main", githubRepo]);
  run("git", ["-C", githubRepo, "remote", "add", "origin", "https://github.com/o/r.git"]);
  githubConfig = join(temp, "github-config.toml");
  writeFileSync(githubConfig, '[tracker]\nkind = "github"\n');
  githubStub = join(temp, "github-stub");
  githubBin = join(temp, "github-bin");
  mkdirSync(githubStub, { recursive: true });
  mkdirSync(githubBin, { recursive: true });
  writeFileSync(join(githubBin, "gh"), STUB_GH, { mode: 0o755 });
  chmodSync(join(githubBin, "gh"), 0o755);
  const githubBodies = [BODY, BODY, REMOVE_ONE_PART, DRAFT];
  const githubLabels = [[{ name: "ready" }], [], [{ name: "ready" }], [{ name: "ready" }]];
  githubBodies.forEach((body, index) => {
    const n = index + 1;
    writeFileSync(join(githubStub, `issue-${n}.json`), JSON.stringify({ data: { repository: { issue: {
      number: n,
      title: n === 3 ? "Remove" : n === 4 ? "Draft" : "Fix the list",
      body,
      state: "OPEN",
      stateReason: null,
      labels: { nodes: githubLabels[index] },
      comments: { nodes: [] },
    } } } }));
  });

  planeRepo = join(temp, "plane-repo");
  mkdirSync(planeRepo, { recursive: true });
  run("git", ["init", "-q", "-b", "main", planeRepo]);
  planeConfig = join(temp, "plane-config.toml");
  const planeData = { items: Object.fromEntries(githubBodies.map((body, index) => {
    const n = index + 1;
    const labels = githubLabels[index]!.length ? ["ready-label"] : [];
    return [`PM-${n}`, {
      id: `item-${n}`,
      sequence_id: n,
      name: n === 3 ? "Remove" : n === 4 ? "Draft" : "Fix the list",
      description_html: mdToHtml(body),
      state: "state-todo",
      project: "p1",
      labels,
      created_at: "2026-10-03T00:00:00Z",
    }];
  })) };
  const planeDataFile = join(temp, "plane-data.json");
  writeFileSync(planeDataFile, JSON.stringify(planeData));
  planeChild = spawn(process.execPath, ["-e", PLANE_SERVER], {
    env: { ...process.env, PLANE_READY_STUB_DATA: planeDataFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  planePort = await new Promise<number>((resolve, reject) => {
    let stdout = "";
    const timeout = setTimeout(() => reject(new Error("Plane test double did not start")), 10000);
    planeChild!.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = /READY_PORT=(\d+)/u.exec(stdout);
      if (match) {
        clearTimeout(timeout);
        resolve(Number(match[1]));
      }
    });
    planeChild!.on("error", (error) => { clearTimeout(timeout); reject(error); });
    planeChild!.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`Plane test double exited ${code}: ${stdout}`)); });
  });
  writeFileSync(planeConfig, `[tracker]\nkind = "plane"\nurl = "http://127.0.0.1:${planePort}"\nworkspace = "ws"\n`);
});

afterAll(() => {
  planeChild?.kill();
  rmSync(temp, { recursive: true, force: true });
});

describe("ticket readiness", () => {
  test("a two-part ticket with a ready label passes both ticket checks", () => {
    const r = cli([repo, "1"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("ready: 1");
  });

  test("missing mark, missing agent part and draft line are each reported", () => {
    const missingMark = cli([repo, "2"]);
    expect(missingMark.code).toBe(2);
    expect(missingMark.out).toContain("ready label is missing");

    const missingParts = cli([repo, "3"]);
    expect(missingParts.code).toBe(2);
    expect(missingParts.out).toContain("parts:");

    const draft = cli([repo, "4"]);
    expect(draft.code).toBe(2);
    expect(draft.out).toContain("parts: line 1: draft:");
  });

  test("all failing reasons print, and an unknown ticket is an error", () => {
    const r = cli([repo, "5"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("ready label is missing");
    expect(r.out).toContain("ticket:");
    expect(r.out).toContain("parts:");
    const missing = cli([repo, "999"]);
    expect(missing.code).toBe(1);
    expect(missing.out).toContain("could not read 999");
  });

  test("mark refuses an invalid draft without adding the ready label", () => {
    expect(adapter("label", "3", "remove", "ready").code).toBe(0);
    const r = cli(["mark", repo, "3", "--body", join(temp, "remove.md")]);
    expect(r.code).toBe(2);
    expect(adapter("read", "3").out).not.toContain("labels: ready");
  });

  test("mark writes body and title, adds the label, records turnpikes, and queues the ticket", () => {
    const r = cli(["mark", repo, "2", "--body", ticketBody, "--title", "Fix the list"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("marked ready and queued");
    expect(cli([repo, "2"]).code).toBe(0);
    const ticket = adapter("read", "2").out;
    expect(ticket).toContain("title: Fix the list");
    expect(ticket).toContain("labels: ready");
    const ledger = readFileSync(join(repo, ".postmaster", "runs", "ledger.jsonl"), "utf8");
    expect(ledger).toContain('"action":"note"');
    expect(ledger).toContain('"detail":"turnpikes: style, bug, security"');
    expect(cli(["pending", repo]).out).toContain("2");
  });

  test("opening a ready ticket removes its mark", () => {
    const r = cli(["unmark", repo, "1"]);
    expect(r.code).toBe(0);
    expect(cli([repo, "1"]).out).toContain("ready label is missing");
  });

  test("the other-tracker body and label-list path applies the same checks", () => {
    const body = join(temp, "other.md");
    const labels = join(temp, "labels.txt");
    writeFileSync(body, BODY);
    writeFileSync(labels, "ready\n");
    const pass = cli(["--body", body, "--labels", labels, "--title", "Other ticket", "--project", repo]);
    expect(pass.code).toBe(0);
    writeFileSync(labels, "");
    const fail = cli(["--body", body, "--labels", labels, "--title", "Other ticket", "--project", repo]);
    expect(fail.code).toBe(2);
    expect(fail.out).toContain("ready label is missing");
  });

  test("the GitHub adapter test double reports the same ready and not-ready cases", () => {
    const runGithub = (id: number) => cli([githubRepo, String(id)], {
      POSTMASTER_CONFIG: githubConfig,
      PATH: `${githubBin}:${process.env.PATH ?? ""}`,
      GITHUB_READY_STUB: githubStub,
    });
    expect(runGithub(1).code).toBe(0);
    expect(runGithub(2).out).toContain("ready label is missing");
    expect(runGithub(2).code).toBe(2);
    expect(runGithub(3).out).toContain("parts:");
    expect(runGithub(3).code).toBe(2);
    expect(runGithub(4).out).toContain("parts: line 1: draft:");
    expect(runGithub(4).code).toBe(2);
  }, 30000);

  test("the Plane adapter test double reports the same ready and not-ready cases", () => {
    const runPlane = (id: number) => cli([planeRepo, `PM-${id}`], {
      POSTMASTER_CONFIG: planeConfig,
      PLANE_API_KEY: "stub-key",
    });
    expect(runPlane(1).code).toBe(0);
    expect(runPlane(2).out).toContain("ready label is missing");
    expect(runPlane(2).code).toBe(2);
    expect(runPlane(3).out).toContain("parts:");
    expect(runPlane(3).code).toBe(2);
    expect(runPlane(4).out).toContain("parts: line 1: draft:");
    expect(runPlane(4).code).toBe(2);
  }, 30000);
});
