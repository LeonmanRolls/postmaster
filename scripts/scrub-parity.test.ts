import { afterEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { compatJson } from "./scrub-core.ts";
import { cleanupScratch, commit, initRepo, ROOT, runScript, token } from "./scrub-test-kit.ts";

afterEach(cleanupScratch);

interface Golden {
  _note: string;
  spans: string;
  findingsOutput: string;
  safePath: string;
  exits: { spans: number; findings: number; safePath: number; logDetection: number };
  logDetection: string;
}

function invoke(command: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  return spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: "utf8" });
}

function normalizedLog(text: string, commit: string): string {
  return text.split("\n").filter(Boolean).map((line) => {
    const row = JSON.parse(line) as Record<string, unknown>;
    row.commit = "<commit>";
    row.ts = "<timestamp>";
    return compatJson(row, true);
  }).join("\n") + (text.endsWith("\n") ? "\n" : "");
}

function noLeaks(output: string, values: string[]): boolean {
  return values.every((value) => !output.includes(value));
}

test("C25 unchanged CLI forms match the first-version goldens", () => {
  const repo = initRepo();
  const secret = ["abcde", "fghij", "klmno", "pqrst", "uvwxy", "z1234"].join("");
  const access = [token(), "op56"].join("");
  const marker = ["private-data", ":allow token --"].join("");
  const unused = ["private-data", ":allow token -- synthetic fixture"].join("");
  const cases = [
    [String.fromCodePoint(0x1f600), " ", access].join(""),
    ["SERVICE_TOKEN=", secret].join(""),
    [access, " ", marker].join(""),
    unused,
  ].join("\n") + "\n";
  const casesPath = join(repo, "cases.txt");
  writeFileSync(casesPath, cases);
  commit(repo, "add parity baseline");
  const base = invoke("git", ["rev-parse", "HEAD"], repo).stdout.trim();
  const rangePath = join(repo, "range.txt");
  writeFileSync(rangePath, cases);
  const head = commit(repo, "add parity range");
  const brokenPath = join(repo, "broken.txt");
  writeFileSync(brokenPath, Buffer.concat([Buffer.from([0xff, 0x20]), Buffer.from(access)]));
  const secretValues = [secret, access];
  const fixturePath = join(ROOT, "scripts", "fixtures", "scrub-check-parity.json");
  let golden = JSON.parse(readFileSync(fixturePath, "utf8")) as Golden;

  const oraclePath = process.env.SCRUB_PARITY_ORACLE;
  if (process.env.SCRUB_PARITY_UPDATE === "1") {
    if (!oraclePath) throw new Error("set SCRUB_PARITY_ORACLE to the branch-135 export");
    const oracle = resolve(oraclePath);
    const span = invoke("bash", [oracle, "--spans", casesPath, brokenPath], repo);
    const findings = invoke("bash", [oracle, "--findings", base, head], repo);
    const safe = invoke("bash", [oracle, "--safe-path", `private-${access}`], repo);
    const logPath = join(repo, "oracle-detections.jsonl");
    for (const [rule, line] of [["token", "1"], ["dotenv", "2"]]) {
      const logged = invoke("bash", [oracle, "--log-detection", rule, "cases.txt", line, head], repo, { POSTMASTER_DETECTIONS_LOG: logPath });
      if (logged.status !== 0 || logged.stdout || logged.stderr) throw new Error("branch-135 detection control failed");
    }
    const logs = readFileSync(logPath, "utf8");
    if (!noLeaks([span.stdout, findings.stdout, safe.stdout, logs].join(""), secretValues)) throw new Error("branch-135 output exposed a fixture value");
    if (span.status !== 0 || findings.status !== 1 || safe.status !== 0 || !noLeaks(span.stderr + findings.stderr + safe.stderr, secretValues)) {
      throw new Error("branch-135 parity command failed");
    }
    golden = {
      _note: golden._note,
      spans: span.stdout,
      findingsOutput: findings.stdout.replaceAll(head, "<commit>"),
      safePath: safe.stdout,
      exits: { spans: span.status, findings: findings.status, safePath: safe.status, logDetection: 0 },
      logDetection: normalizedLog(logs, head),
    };
    writeFileSync(fixturePath, `${JSON.stringify(golden, null, 2)}\n`);
  }

  const spans = runScript("scrub-check", ["--spans", casesPath, brokenPath], repo);
  expect(spans.status).toBe(golden.exits.spans);
  expect(spans.stdout === golden.spans).toBe(true);
  expect(noLeaks(spans.stdout + spans.stderr, secretValues)).toBe(true);

  const findings = runScript("scrub-check", ["--findings", base, head], repo);
  expect(findings.status).toBe(golden.exits.findings);
  expect(findings.stdout.replaceAll(head, "<commit>") === golden.findingsOutput).toBe(true);
  expect(noLeaks(findings.stdout + findings.stderr, secretValues)).toBe(true);

  const safe = runScript("scrub-check", ["--safe-path", `private-${access}`], repo);
  expect(safe.status).toBe(golden.exits.safePath);
  expect(safe.stdout === golden.safePath).toBe(true);
  expect(noLeaks(safe.stdout + safe.stderr, secretValues)).toBe(true);

  const logPath = join(repo, "current-detections.jsonl");
  for (const [rule, line] of [["token", "1"], ["dotenv", "2"]]) {
    const logged = runScript("scrub-check", ["--log-detection", rule, "cases.txt", line, head], repo, { POSTMASTER_DETECTIONS_LOG: logPath });
    expect(logged.status).toBe(golden.exits.logDetection);
    expect(logged.stdout).toBe("");
    expect(logged.stderr).toBe("");
  }
  const currentLog = readFileSync(logPath, "utf8");
  expect(noLeaks(currentLog, secretValues)).toBe(true);
  expect(normalizedLog(currentLog, head) === golden.logDetection).toBe(true);
  console.log("C25: four CLI forms match branch-135 output; exits 0, 1, 0, 0");
});
