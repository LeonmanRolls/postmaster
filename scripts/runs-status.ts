import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, resolve } from "node:path";
import { writeError, writeOut } from "./lib/core.ts";

type Row = [string, string, string, string, string, string];
function walkFiles(root: string, output: string[] = []): string[] {
  for (const entry of readdirSync(root, { withFileTypes: true }) as any[]) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) walkFiles(path, output);
    else if (entry.isFile()) output.push(path);
  }
  return output;
}
function status(root: string): string {
  const escalation = join(root, "postmaster", "ESCALATION.md");
  const output: string[] = [];
  if (existsSync(escalation)) output.push(`POSTMASTER     escalation to the user is pending: ${escalation}`);
  const rows: Row[] = [];
  for (const run of (readdirSync(root) as string[]).sort()) {
    const directory = join(root, run);
    if (!statSync(directory).isDirectory() || run === "postmaster") continue;
    let stage = "no manifest",
      leg = "?";
    const manifest = join(directory, "manifest.json");
    if (existsSync(manifest)) {
      try {
        const data = JSON.parse(readFileSync(manifest, "utf8"));
        stage = String(data.stage ?? "?");
        leg = String(data.leg ?? "?");
      } catch {
        stage = "manifest unreadable";
      }
    }
    const files = walkFiles(directory);
    const markers: string[] = (files as string[])
      .map((file: string) => String(basename(file)))
      .filter(
        (name: string) =>
          name.endsWith("-ready") ||
          (name.startsWith(".leg-") && (name.endsWith("-done") || name.endsWith("-exited"))) ||
          name === ".waiting-on-user",
      )
      .sort();
    let newest = 0;
    for (const file of files) {
      if (basename(file).startsWith(".")) continue;
      try {
        newest = Math.max(newest, statSync(file).mtimeMs / 1000);
      } catch {
        /* A file may disappear during polling. */
      }
    }
    const idle = newest ? Math.trunc((Date.now() / 1000 - newest) / 60) : -1;
    const done = markers.includes(`.leg-${leg}-done`);
    const exited = markers.includes(`.leg-${leg}-exited`);
    let next: string;
    if (stage === "done" || stage === "abandoned") next = "-";
    else if (markers.includes(".waiting-on-user")) next = "USER";
    else if (markers.includes(".escalation-ready")) next = "RULE";
    else if (markers.includes(".card-ready")) next = "GATE";
    else if (done) next = "DISPATCH";
    else if (exited) next = "REMOUNT";
    else if (markers.some((marker) => marker.startsWith(".checkpoint-"))) next = "READ";
    else if (idle >= 30) next = "INSPECT";
    else next = "WAIT";
    rows.push([run, stage, leg, markers.join(",") || "-", String(idle), next]);
  }
  output.push(
    `${"RUN".padEnd(14)} ${"STAGE".padEnd(16)} ${"LEG".padEnd(4)} ${"MARKERS".padEnd(44)} ${"IDLE".padStart(6)}  NEXT`,
  );
  for (const [run, stage, leg, markers, idle, next] of rows)
    output.push(
      `${run.padEnd(14)} ${stage.padEnd(16)} ${leg.padEnd(4)} ${markers.padEnd(44)} ${`${idle}m`.padStart(6)}  ${next}`,
    );
  return output.join("\n");
}
function selfTest(): number {
  const temp = mkdtempSync(join(tmpdir(), "runs-status-"));
  const root = join(temp, "root");
  mkdirSync(root);
  let fails = 0;
  const ok = (label: string) => writeOut(`  ok   ${label}`);
  const fail = (label: string, got: string) => {
    writeOut(`  FAIL ${label}${got ? ` (got '${got}')` : ""}`);
    fails++;
  };
  const run = (name: string, stage: string, leg: number, ...markers: string[]) => {
    const directory = join(root, name);
    mkdirSync(join(directory, "logs"), { recursive: true });
    writeFileSync(join(directory, "manifest.json"), JSON.stringify({ stage, leg }));
    writeFileSync(join(directory, "run-log.md"), "");
    for (const marker of markers) writeFileSync(join(directory, marker), "");
  };
  const age = (name: string) => {
    const time = (Date.now() - 3600_000) / 1000;
    for (const file of walkFiles(join(root, name))) utimesSync(file, time, time);
  };
  const nextOf = (name: string) =>
    status(root)
      .split(/\r?\n/)
      .find((line) => line.startsWith(name.padEnd(14)))
      ?.trim()
      .split(/\s+/)
      .at(-1) ?? "";
  const expect = (label: string, name: string, wanted: string) => {
    const got = nextOf(name);
    got === wanted ? ok(label) : fail(label, got);
  };
  try {
    run("rule", "review", 2, ".escalation-ready");
    run("gate", "shipping", 3, ".card-ready");
    run("dispatch", "review", 2, ".leg-2-done", ".leg-2-exited");
    run("remount", "review", 2, ".leg-2-exited");
    run("read", "review", 2, ".checkpoint-review-ready");
    run("inspect", "review", 2);
    age("inspect");
    run("wait", "review", 2);
    run("user", "review", 2, ".waiting-on-user", ".leg-2-exited");
    run("closed", "done", 3, ".leg-3-done", ".leg-3-exited");
    run("earlier", "review", 2, ".leg-1-done");
    run("usergate", "shipping", 3, ".card-ready", ".waiting-on-user");
    run("userclosed", "done", 3, ".waiting-on-user");
    run("stall", "review", 2);
    age("stall");
    writeFileSync(join(root, "stall", ".leg-1-done"), "");
    mkdirSync(join(root, "postmaster"));
    writeFileSync(join(root, "postmaster", "ESCALATION.md"), "");
    writeOut("positive controls");
    expect("an escalation waiting is RULE", "rule", "RULE");
    expect("a complete ship card is GATE", "gate", "GATE");
    expect("the current leg done is DISPATCH", "dispatch", "DISPATCH");
    expect("the current leg gone with nothing written is REMOUNT", "remount", "REMOUNT");
    expect("a checkpoint card waiting is READ", "read", "READ");
    expect("nothing changed for an hour is INSPECT", "inspect", "INSPECT");
    expect("a leg at work is WAIT", "wait", "WAIT");
    expect("a run waiting on the user is USER, whatever else it holds", "user", "USER");
    expect("a closed run is -", "closed", "-");
    writeOut("negative controls");
    expect("an earlier leg's done marker dispatches nothing", "earlier", "WAIT");
    expect("a ship card put to the user waits on the user, not the gate", "usergate", "USER");
    expect("a closed run stays closed with a stale marker", "userclosed", "-");
    expect("touching a marker does not hide a stall", "stall", "INSPECT");
    nextOf("postmaster") === ""
      ? ok("the postmaster's own directory is not a run")
      : fail("the postmaster's own directory is not a run", nextOf("postmaster"));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  writeOut("");
  writeOut(fails === 0 ? "self-test: all controls behaved" : `self-test: ${fails} control(s) misbehaved`);
  return fails === 0 ? 0 : 1;
}

const args = process.argv.slice(2);
if (args[0] === "--self-test") process.exit(selfTest());
if (args.length !== 1) {
  writeError("usage: runs-status.sh <project-run-root> | --self-test");
  process.exit(1);
}
let root: string;
try {
  root = resolve(args[0]);
  if (!statSync(root).isDirectory()) throw new Error();
} catch {
  writeError(`runs-status: no such root: ${args[0]}`);
  process.exit(1);
}
writeOut(status(root));
