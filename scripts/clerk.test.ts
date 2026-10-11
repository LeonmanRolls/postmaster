// Tests beside scripts/clerk.ts: the form splitter, the brief writer, the
// headless start, and the two-verb usage. A start against a live host needs
// a model and a session host, so the checks that need them stay code-reviewed.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clerkHandle, splitCommand } from "./clerk.ts";

const SELF = join(import.meta.dir, "run");
const LOCAL = join(import.meta.dir, "run");

function sh(
  cmd: string,
  args: string[],
  env?: Record<string, string | undefined>,
): { code: number; out: string; err: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8", env: { ...process.env, ...env } });
  return { code: r.status ?? 1, out: String(r.stdout ?? ""), err: String(r.stderr ?? "") };
}

function stubBin(): string {
  const bin = mkdtempSync(join(tmpdir(), "clerk-bin-"));
  writeFileSync(join(bin, "claude"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "claude"), 0o755);
  return bin;
}

function stubConfig(dir: string, extra = ""): string {
  mkdirSync(dir, { recursive: true });
  const cfg = join(dir, "config.toml");
  writeFileSync(
    cfg,
    [
      `[lanes.one]`,
      `harness = "claude"`,
      `model = "lane-model"`,
      ``,
      `[team]`,
      `clerk = { harness = "claude", model = "clerk-model" }`,
      ...(extra ? [extra] : []),
      ``,
    ].join("\n"),
  );
  return cfg;
}

function localRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "clerk-repo-"));
  sh("git", ["init", "-q", repo]);
  sh("git", [
    "-C",
    repo,
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "base",
  ]);
  const init = sh(LOCAL, ["local", repo, "store", "init"]);
  if (init.code !== 0) throw new Error(`store init failed: ${init.err}`);
  return repo;
}

function localTicket(repo: string, title: string): string {
  const body = join(repo, "body.md");
  writeFileSync(body, "A body.\n");
  const r = sh(LOCAL, ["local", repo, "create", title, body]);
  if (r.code !== 0) throw new Error(`create failed: ${r.err}`);
  return r.out.trim();
}

describe("splitCommand", () => {
  test("a printed interactive form splits back into argv", () => {
    expect(
      splitCommand(
        "launch: cd /tmp/lit && claude --model cm --name \\#2\\,\\ Fix\\ the\\ list --dangerously-skip-permissions",
      ),
    ).toEqual([
      "claude",
      "--model",
      "cm",
      "--name",
      "#2, Fix the list",
      "--dangerously-skip-permissions",
    ]);
  });

  test("quotes group, an escaped space stays one word, and '' is an empty word", () => {
    expect(splitCommand("launch: cd /x && foo \"a b\" 'c d' plain\\ x ''")).toEqual([
      "foo",
      "a b",
      "c d",
      "plain x",
      "",
    ]);
  });

  test("a form without a cd prefix splits as printed", () => {
    expect(splitCommand("launch: claude -p hello")).toEqual(["claude", "-p", "hello"]);
  });

  test("the spawn handle names the project and the ticket", () => {
    expect(clerkHandle("/home/user/Code/blog", "1")).toBe("clerk-blog-1");
    expect(clerkHandle("/home/user/Code/blog", "1")).not.toBe(
      clerkHandle("/home/user/Code/shop", "1"),
    );
  });

  test("a quoted hostile session name stays one argv word", () => {
    expect(
      splitCommand(
        "launch: cd /tmp/lit && claude --model cm --name \\#1\\,\\ =\\<\\ --tools\\ x\\> --dangerously-skip-permissions",
      ),
    ).toEqual([
      "claude",
      "--model",
      "cm",
      "--name",
      "#1, =< --tools x>",
      "--dangerously-skip-permissions",
    ]);
  });
});

describe("brief", () => {
  test("brief writes the draft and the brief, and unmarks a ready ticket", () => {
    const repo = localRepo();
    const id = localTicket(repo, "Fix the list");
    const labels = sh(LOCAL, ["local", repo, "label", id, "add", "ready"]);
    expect(labels.code).toBe(0);
    const cfgDir = mkdtempSync(join(tmpdir(), "clerk-cfg-"));
    const cfg = stubConfig(cfgDir, `[planning]\nreview_link = "https://edit.example/{path}"`);
    writeFileSync(join(cfgDir, "preferences.md"), "Prefer short tickets.\n");
    const r = sh(SELF, ["clerk", "brief", repo, id], { POSTMASTER_CONFIG: cfg });
    expect(r.code).toBe(0);
    const draft = readFileSync(join(repo, ".postmaster", "clerk", `${id}.md`), "utf8");
    expect(draft).toContain(`DRAFT: #${id} is being prepared`);
    const brief = readFileSync(join(repo, ".postmaster", "clerk", `${id}.brief.md`), "utf8");
    expect(brief).toContain(`# Brief: booking clerk for #${id}, Fix the list`);
    expect(brief).toContain(`Ticket: #${id} on local`);
    expect(brief).toContain(`Repository: ${repo}`);
    expect(brief).toContain("Base: ");
    expect(brief).toContain("skills/clerk/SKILL.md");
    expect(brief).toContain("skills/clerk/clerk.md");
    expect(brief).toContain("Prefer short tickets.");
    expect(brief).toContain("Editor link: https://edit.example/");
    expect(brief).toContain("Title: Fix the list");
    const read = sh(LOCAL, ["local", repo, "read", id]);
    const labelsLine = read.out.split("\n").find((l) => l.startsWith("labels:")) ?? "";
    expect(labelsLine).not.toContain("ready");
  });

  test("brief for a subdir lists the project's checks and verifiers from its top", () => {
    const repo = localRepo();
    const id = localTicket(repo, "Fix the list");
    writeFileSync(join(repo, "package.json"), `{"scripts": {"check": "true"}}\n`);
    mkdirSync(join(repo, "verify-app"), { recursive: true });
    writeFileSync(join(repo, "verify-app", "README.md"), "# app on the command line\n");
    const sub = join(repo, "sub");
    mkdirSync(sub, { recursive: true });
    const cfgDir = mkdtempSync(join(tmpdir(), "clerk-cfg-"));
    const cfg = stubConfig(cfgDir);
    const r = sh(SELF, ["clerk", "brief", sub, id], { POSTMASTER_CONFIG: cfg });
    expect(r.code).toBe(0);
    const brief = readFileSync(join(sub, ".postmaster", "clerk", `${id}.brief.md`), "utf8");
    expect(brief).toContain("## Checks and verifiers");
    expect(brief).toContain(SELF);
    expect(brief).toContain("gate\tdefault:gate\tnpm run check");
    expect(brief).toContain("verify-app");
    expect(brief).toContain("command line");
  });

  test("brief reads the review link from the project settings over the global config", () => {
    const repo = localRepo();
    const id = localTicket(repo, "Fix the list");
    const cfgDir = mkdtempSync(join(tmpdir(), "clerk-cfg-"));
    const cfg = stubConfig(cfgDir, `[planning]\nreview_link = "https://global.example/{path}"`);
    mkdirSync(join(repo, ".postmaster"), { recursive: true });
    writeFileSync(
      join(repo, ".postmaster", "settings.toml"),
      `[planning]\nreview_link = "https://project.example/{path}"\n`,
    );
    const r = sh(SELF, ["clerk", "brief", repo, id], { POSTMASTER_CONFIG: cfg });
    expect(r.code).toBe(0);
    const brief = readFileSync(join(repo, ".postmaster", "clerk", `${id}.brief.md`), "utf8");
    expect(brief).toContain("Editor link: https://project.example/");
    expect(brief).not.toContain("global.example");
  });

  test("brief leaves one label holding a comma alone: it is not the ready mark", () => {
    const repo = localRepo();
    const id = localTicket(repo, "Fix the list");
    const labels = sh(LOCAL, ["local", repo, "label", id, "add", "blocked, ready"]);
    expect(labels.code).toBe(0);
    const cfgDir = mkdtempSync(join(tmpdir(), "clerk-cfg-"));
    const cfg = stubConfig(cfgDir);
    const r = sh(SELF, ["clerk", "brief", repo, id], { POSTMASTER_CONFIG: cfg });
    expect(r.code).toBe(0);
    const read = sh(LOCAL, ["local", repo, "read", id]);
    const labelsLine = read.out.split("\n").find((l) => l.startsWith("labels:")) ?? "";
    expect(labelsLine).toBe("labels: blocked, ready");
  });

  test("brief keeps an existing draft and proceeds for an unreadable ticket", () => {
    const repo = localRepo();
    const cfgDir = mkdtempSync(join(tmpdir(), "clerk-cfg-"));
    const cfg = stubConfig(cfgDir);
    const first = sh(SELF, ["clerk", "brief", repo, "9"], { POSTMASTER_CONFIG: cfg });
    expect(first.code).toBe(0);
    const draftPath = join(repo, ".postmaster", "clerk", "9.md");
    writeFileSync(draftPath, "The clerk's own words.\n");
    const second = sh(SELF, ["clerk", "brief", repo, "9"], { POSTMASTER_CONFIG: cfg });
    expect(second.code).toBe(0);
    expect(readFileSync(draftPath, "utf8")).toBe("The clerk's own words.\n");
    const brief = readFileSync(join(repo, ".postmaster", "clerk", "9.brief.md"), "utf8");
    expect(brief).not.toContain("## The ticket as read");
    expect(brief).toContain("None are set.");
  });

  test("brief on a tracker without an adapter warns about its labels", () => {
    const otherRepo = mkdtempSync(join(tmpdir(), "clerk-other-"));
    sh("git", ["init", "-q", otherRepo]);
    sh("git", [
      "-C",
      otherRepo,
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "base",
    ]);
    const cfgDir = mkdtempSync(join(tmpdir(), "clerk-cfg-"));
    const cfg = join(cfgDir, "config.toml");
    writeFileSync(cfg, '[tracker]\nkind = "other"\n');
    const r = sh(SELF, ["clerk", "brief", otherRepo, "EXT-1"], { POSTMASTER_CONFIG: cfg });
    expect(r.code).toBe(0);
    expect(r.err).toContain("has no adapter script");
  });

  test("brief refuses an unreadable ticket while its ready marker is queued", () => {
    const repo = localRepo();
    const cfgDir = mkdtempSync(join(tmpdir(), "clerk-cfg-"));
    const cfg = stubConfig(cfgDir);
    const dir = join(repo, ".postmaster", "runs", "postmaster", "ready");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "9.ready"), "9\n");
    const r = sh(SELF, ["clerk", "brief", repo, "9"], { POSTMASTER_CONFIG: cfg });
    expect(r.code).toBe(1);
    expect(r.err).toContain("a ready marker is queued for it");
    expect(r.err).toContain("run ticket-ready consume");
  });

  test("brief refuses a queued ticket on a tracker without an adapter", () => {
    const otherRepo = mkdtempSync(join(tmpdir(), "clerk-other-"));
    sh("git", ["init", "-q", otherRepo]);
    sh("git", [
      "-C",
      otherRepo,
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "base",
    ]);
    const cfgDir = mkdtempSync(join(tmpdir(), "clerk-cfg-"));
    const cfg = join(cfgDir, "config.toml");
    writeFileSync(cfg, '[tracker]\nkind = "other"\n');
    const dir = join(otherRepo, ".postmaster", "runs", "postmaster", "ready");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "EXT-1.ready"), "EXT-1\n");
    const r = sh(SELF, ["clerk", "brief", otherRepo, "EXT-1"], { POSTMASTER_CONFIG: cfg });
    expect(r.code).toBe(1);
    expect(r.err).toContain("has no adapter script");
    expect(r.err).toContain("through the tracker's own tooling");
    expect(r.err).toContain("run ticket-ready consume");
  });

  test("brief keeps a slashed id inside the clerk directory", () => {
    const repo = localRepo();
    const cfgDir = mkdtempSync(join(tmpdir(), "clerk-cfg-"));
    const cfg = stubConfig(cfgDir);
    const r = sh(SELF, ["clerk", "brief", repo, "../../x"], { POSTMASTER_CONFIG: cfg });
    expect(r.code).toBe(0);
    expect(existsSync(join(repo, "x.brief.md"))).toBe(false);
    expect(existsSync(join(repo, "x.md"))).toBe(false);
    expect(existsSync(join(repo, ".postmaster", "clerk", "..%2F..%2Fx.brief.md"))).toBe(true);
  });
});

describe("start", () => {
  test("start with no host prints the command to open by hand and exits 3", () => {
    const repo = localRepo();
    const id = localTicket(repo, "Fix the list");
    const cfgDir = mkdtempSync(join(tmpdir(), "clerk-cfg-"));
    const cfg = stubConfig(cfgDir);
    const bin = stubBin();
    const r = sh(SELF, ["clerk", "start", repo, id], {
      POSTMASTER_CONFIG: cfg,
      POSTMASTER_HOST: "none",
      PATH: `${bin}:${process.env.PATH ?? ""}`,
    });
    expect(r.code).toBe(3);
    expect(r.err).toContain(`open #${id}, Fix the list by hand:`);
    expect(r.err).toContain(
      `cd ${repo} && claude --model clerk-model --name \\#${id}\\,\\ Fix\\ the\\ list --dangerously-skip-permissions`,
    );
    expect(r.err).toContain(`${id}.brief.md`);
  });
});

describe("usage", () => {
  test("an unknown verb prints the two verbs and exits 1", () => {
    const r = sh(SELF, ["clerk", "reader", "m", "plain.md", "wt"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("run clerk brief <repo> <id>");
    expect(r.err).toContain("run clerk start <repo> <id>");
    expect(r.err).not.toContain("reader");
  });
});
