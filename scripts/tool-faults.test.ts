// Tests beside scripts/tool-faults.ts, moved from its --self-test on #109: 44 controls.
// The sequence runs once in beforeAll with a recording check(); one test per recorded label.
// runPatternParity and normRid moved here with the suite; the script keeps parityCases for regen.
// The python3 branches use the top-level cond; their in-sequence skip logs are replaced by it.
import { beforeAll, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { scriptsDir, toolRoot } from "./lib/paths.ts";
import { run, withTempDir } from "./lib/proc.ts";
import { casefold, literalI, NAME_L, NAME_R } from "./lib/text.ts";
import {
  CONTROLS_VALUE_RE,
  DONE_RE,
  digest,
  doneOf,
  EMAIL_RE,
  FAULT_ID_RE,
  FILELIKE,
  faultId,
  faultsOf,
  fidBoundaryRe,
  fields,
  HEX_RE,
  IPV4_RE,
  KEY_RE,
  MARK_RE,
  type PatCase,
  PROFILE_END_RE,
  PROFILE_HEAD_RE,
  PROFILE_REPO_RE,
  parityCases,
  profileRepo,
  RURL_M1,
  RURL_M2,
  type RunR,
  remoteUrl,
  Safe,
  STATE_RE,
  TICKET_RE,
  TICKS_RE,
  TOKEN,
  URL_RE,
  WORD_RE,
  WTOK_RE,
} from "./tool-faults.ts";

const HERE = scriptsDir(import.meta);
const TOOL = toolRoot(import.meta);

// These records came from runs pinned before the single-entry migration. Keep their logged
// targets in each copied tool so the harvest still recognizes files from that pinned version.
function plantLegacyTargets(copy: string): void {
  for (const name of [
    "cut-scratch",
    "github",
    "handoff-check",
    "host",
    "launch",
    "log-action",
    "runs-status",
    "stage",
    "ticket-check",
    "tool-faults",
    "wait-for-markers",
  ]) {
    const script = join(copy, "scripts", `${name}.sh`);
    writeFileSync(script, `#!/bin/sh\nexec "$(dirname "$0")/run" ${name} "$@"\n`);
    chmodSync(script, 0o755);
  }
}

// The parity comparisons run BASE's pinned script through a python3 that runs;
// a Command Line Tools stub that cannot run skips instead. skips.toml says so.
const skipPython = run("python3", ["-c", "pass"]).code !== 0;

// #163 deliberately reworded the draft's Notes on main; the pinned BASE still carries
// the old sentence, so parity remaps BASE's drafts to the new wording before comparing.
// The port's own wording is asserted directly by the contract-checker control, so the
// remap never runs on the port side.
function note163(body: string): string {
  return body
    .replace(
      "proposed fix. If the fix changes the coachman contract (markers, the waybill shape, completion detection), a fixture run confirms it before it merges.",
      "proposed fix. The postmaster's contract checker decides from the final branch whether a fixture run is required; this ticket's wording does not decide it.",
    )
    .replace("by `scripts/tool-faults.sh`", "by `scripts/run tool-faults`");
}

function normRid(s: string): string {
  return s
    .replace(/(run )[0-9a-f]{10}(?![\p{L}\p{N}_])/gu, "$1RID")
    .replace(/(tool-faults\/)[0-9a-f]{10}/gu, "$1RID");
}

interface ControlRecord {
  label: string;
  ok: boolean;
  detail: string;
}

const records: ControlRecord[] = [];

const check = (label: string, cond: boolean, detail?: string): void => {
  records.push({ label, ok: cond, detail: detail ?? "" });
};

const assertControl = (label: string): void => {
  const r = records.find((x) => x.label === label);
  expect(r).toBeDefined();
  if (r !== undefined && !r.ok) throw new Error(r.detail === "" ? r.label : r.detail);
  expect(r?.ok).toBe(true);
};

// Round-10 pattern parity: every regex above, diffed against BASE's own
// pattern text (bb782a9 scripts/run tool-faults) on the vectors where
// Unicode meets the pattern. The port side runs the real consts, so a
// routed pattern that drifts fails here before any harvest runs.
// Multi-slash remote tails are absent on purpose: BASE's /*$ and the
// port's /?$ disagree there, and that P3 rides a card, not this suite.
function runPatternParity(tmp: string): void {
  const FID = "tf-abcdef12";
  const namesShape = (words: string[]): RegExp =>
    new RegExp(`${NAME_L}(${words.map((w) => literalI(w)).join("|")})${NAME_R}`, "giu");
  const NAMES_WORDS = ["harbor", "illegal", "straße"];
  const normGroup = (v: unknown): unknown => (v === undefined ? "" : v);
  const runPort = (c: PatCase): unknown => {
    if (c.op === "profile") return profileRepo(c.s);
    if (c.op === "remote") return remoteUrl(c.s);
    let re: RegExp;
    switch (c.id) {
      case "done":
        re = DONE_RE;
        break;
      case "url":
        re = URL_RE;
        break;
      case "email":
        re = EMAIL_RE;
        break;
      case "ipv4":
        re = IPV4_RE;
        break;
      case "key":
        re = KEY_RE;
        break;
      case "filelike":
        re = FILELIKE;
        break;
      case "faultid":
        re = FAULT_ID_RE;
        break;
      case "hex":
        re = HEX_RE;
        break;
      case "mark":
        re = MARK_RE;
        break;
      case "word":
        re = WORD_RE;
        break;
      case "wtok":
        re = WTOK_RE;
        break;
      case "ticks":
        re = TICKS_RE;
        break;
      case "token":
        re = TOKEN;
        break;
      case "names":
        re = namesShape(NAMES_WORDS);
        break;
      case "ticket":
        re = TICKET_RE;
        break;
      case "state":
        re = STATE_RE;
        break;
      case "fid":
        re = fidBoundaryRe(FID);
        break;
      case "controls":
        re = CONTROLS_VALUE_RE;
        break;
      case "rurl1":
        re = RURL_M1;
        break;
      case "rurl2":
        re = RURL_M2;
        break;
      case "phead":
        re = PROFILE_HEAD_RE;
        break;
      case "pend":
        re = PROFILE_END_RE;
        break;
      case "prepo":
        re = PROFILE_REPO_RE;
        break;
      default:
        throw new Error(`unknown pattern ${c.id}`);
    }
    re.lastIndex = 0;
    if (c.op === "search") {
      const m = re.exec(c.s);
      return m ? [m[0], ...[...m].slice(1).map(normGroup)] : [];
    }
    if (c.op === "fullmatch") {
      const m = re.exec(c.s);
      return m !== null && m[0] === c.s;
    }
    const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
    // ASCII: flags reuses re.flags of a u-flagged module pattern, plus g.
    return [...c.s.matchAll(new RegExp(re.source, flags))].map((m) => {
      const gs = [...m].slice(1).map(normGroup);
      if (gs.length === 0) return m[0];
      return gs.length === 1 ? gs[0] : gs;
    });
  };
  // The BASE side is committed, not run: the cases still build live
  // (fresh git repos under tmp), and the truth comes from the fixture
  // (regen per its _note). HOME and the git config are pinned while the
  // port side runs, and the port's expanded home is normalized to the
  // pinned value before comparing: homedir() reads the user database,
  // not the environment, so the ~/ppp row would otherwise carry the
  // test machine's home. The expansion mechanics are still differenced.
  const saveHome = process.env.HOME;
  const saveGGlobal = process.env.GIT_CONFIG_GLOBAL;
  const saveGSystem = process.env.GIT_CONFIG_SYSTEM;
  process.env.HOME = "/nonexistent-109-home";
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_SYSTEM = "/dev/null";
  const mism: string[] = [];
  let cases: PatCase[] = [];
  try {
    cases = parityCases(tmp);
    const fixture = JSON.parse(
      readFileSync(join(HERE, "fixtures", "tool-faults-parity.json"), "utf-8"),
    ) as { python: string; truth: Array<{ ok: boolean; r: unknown }> };
    const truth = fixture.truth;
    if (truth.length !== cases.length) {
      mism.push(
        `fixture has ${truth.length} rows for ${cases.length} cases: regen per scripts/fixtures/tool-faults-parity.json _note`,
      );
    } else {
      for (let i = 0; i < cases.length; i++) {
        let mine: unknown;
        try {
          mine = runPort(cases[i]!);
        } catch (e) {
          mine = `Error: ${String((e as Error).message ?? e)}`;
        }
        const want = truth[i]!;
        if (typeof mine === "string" && mine.startsWith(homedir()))
          mine = "/nonexistent-109-home" + mine.slice(homedir().length);
        if (JSON.stringify(mine) !== JSON.stringify(want.r)) {
          const c = cases[i]!;
          mism.push(
            `${c.id} ${c.op} ${JSON.stringify(c.s.slice(0, 50))}: port ${JSON.stringify(mine)} vs BASE ${JSON.stringify(want.r)}`,
          );
        }
      }
    }
    // doneOf wiring: the fixed DONE_RE parses clean details and rejects
    // run-ons (the regex itself is differenced above; this locks the call).
    const doneCases: Array<[Record<string, unknown>, string | null]> = [
      [
        {
          detail: "tool fault tf-abcdef12 filed in run abc123",
          actor: "postmaster",
          action: "ticket-create",
          target: "t",
        },
        "tf-abcdef12!abc123",
      ],
      [
        {
          detail: "tool fault tf-abcdef12 seen again in run abc123xyz",
          actor: "postmaster",
          action: "ticket-comment",
          target: "t",
        },
        null,
      ],
      [
        {
          detail: "tool fault tf-abcdef12 declined in run abc123é",
          actor: "postmaster",
          action: "note",
          target: "t",
        },
        null,
      ],
    ];
    for (const [entry, want] of doneCases) {
      const got = [...doneOf([entry]).keys()];
      const wantKeys = want === null ? [] : [want];
      if (JSON.stringify(got) !== JSON.stringify(wantKeys)) {
        mism.push(`doneOf ${JSON.stringify(entry.detail)}: got ${JSON.stringify(got)}`);
      }
    }
    check(
      `pattern parity with BASE (${cases.length} cases)`,
      mism.length === 0,
      mism.slice(0, 12).join("\n"),
    );
  } finally {
    if (saveHome === undefined) delete process.env.HOME;
    else process.env.HOME = saveHome;
    if (saveGGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = saveGGlobal;
    if (saveGSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
    else process.env.GIT_CONFIG_SYSTEM = saveGSystem;
  }
}

// bun:test's types omit the hook timeout, though the runtime honors it.

beforeAll(() => {
  withTempDir((tmp) => {
    const T = join(tmp, "tool");
    const S = join(tmp, "stub");
    const RUNS = join(tmp, "runs");
    mkdirSync(join(T, "skills"), { recursive: true });
    mkdirSync(S, { recursive: true });
    mkdirSync(join(tmp, "bin"), { recursive: true });

    // Copy scripts and skills (plus the bunfig the copied wrappers resolve beside themselves)
    run("cp", ["-R", HERE, join(T, "scripts")]);
    plantLegacyTargets(T);
    copyFileSync(join(TOOL, "bunfig.toml"), join(T, "bunfig.toml"));
    run("cp", ["-R", join(TOOL, "skills/postmaster"), join(T, "skills/postmaster")]);
    run("git", ["-C", T, "init", "-q"]);
    run("git", ["-C", T, "remote", "add", "origin", "https://github.com/o/postmaster.git"]);

    // Write the stub gh
    const stubGh = join(tmp, "bin", "gh");
    writeFileSync(
      stubGh,
      `#!/usr/bin/env bun
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { casefold } from "${scriptsDir(import.meta)}/lib/text.ts";
const d = process.env.TOOL_FAULTS_STUB!;
const a = process.argv.slice(2);
const dbPath = d + "/db.json";
const db = JSON.parse(readFileSync(dbPath, "utf-8"));
function save() { writeFileSync(dbPath, JSON.stringify(db)); }
function arg(flag: string): string { const i = a.indexOf(flag); return i >= 0 ? a[i + 1] ?? "" : ""; }
function write(line: string) { appendFileSync(d + "/writes.log", line + "\\n"); }

if (a[0] === "auth" && a[1] === "status") process.exit(0);
if (a[0] === "api" && a[1] === "graphql") {
  const q = a.find((x: string) => x.startsWith("query=")) ?? "";
  if (q.includes("viewerPermission")) {
    console.log(JSON.stringify({ data: { repository: { viewerPermission: db.access } } }));
  } else if (q.includes("projectsV2")) {
    console.log(JSON.stringify({ data: { repository: { projectsV2: { nodes: [{ id: "PVT_1", number: 1, title: "postmaster", closed: false, url: "https://github.com/users/o/projects/1", owner: { login: "o" } }] } } } }));
  } else if (q.includes("issue(number:")) {
    const n = (a.find((x: string) => x.startsWith("number=")) ?? "").split("=")[1] ?? "";
    const i = db.issues[n];
    console.log(JSON.stringify({ data: { repository: { issue: i == null ? null : {
      number: parseInt(n), title: i.title, body: i.body, state: i.state, stateReason: null,
      url: "https://github.com/o/postmaster/issues/" + n, createdAt: "2026-01-01T00:00:00Z",
      labels: { nodes: [] },
      comments: { nodes: i.comments.map((c: string) => ({ body: c, createdAt: "2026-01-01T00:00:00Z", author: { login: "o" } })) },
    } } } }));
  } else {
    console.error("stub gh: unexpected query"); process.exit(1);
  }
} else if (a[0] === "search" && a[1] === "issues") {
  if (existsSync(d + "/no-search")) { console.error("stub gh: search is down"); process.exit(1); }
  const q = casefold((a[2] ?? "").replace(/^"|"$/gu, ""));
  const hits = Object.entries(db.issues).filter(([n, i]: [string, any]) =>
    q in {} ? false : casefold(i.title + "\\n" + i.body + "\\n" + i.comments.join("\\n")).includes(q)
  ).map(([n, i]: [string, any]) => ({ number: parseInt(n), title: i.title, state: i.state }));
  console.log(JSON.stringify(hits));
} else if (a[0] === "project" && a[1] === "item-list") {
  console.log('{"items": []}');
} else if (a[0] === "project" && a[1] === "field-list") {
  console.log('{"fields": [{"id": "F1", "name": "Status", "options": [{"id": "o1", "name": "Todo"}, {"id": "o2", "name": "In Progress"}, {"id": "o3", "name": "Done"}]}]}');
} else if (a[0] === "project" && a[1] === "item-add") {
  if (existsSync(d + "/no-item-add")) { console.error("stub gh: item-add refused"); process.exit(1); }
  console.log('{"id": "PVTI_new"}');
} else if (a[0] === "project" && a[1] === "item-edit") {
  // pass
} else if (a[0] === "issue" && a[1] === "create") {
  const n = String(db.next); db.next += 1;
  db.issues[n] = { title: arg("--title"), body: readFileSync(arg("--body-file"), "utf-8"), state: "OPEN", comments: [] };
  save(); write("create #" + n + " " + arg("--title"));
  writeFileSync(d + "/created-" + n + ".md", db.issues[n].body);
  console.log("https://github.com/o/postmaster/issues/" + n);
} else if (a[0] === "issue" && a[1] === "comment") {
  db.issues[a[2]].comments.push(arg("--body")); save();
  write("comment #" + a[2] + " " + arg("--body"));
} else {
  console.error("stub gh: unexpected: " + a.join(" ")); process.exit(1);
}
`,
    );
    run("chmod", ["+x", stubGh]);

    const db = (access: string, ...rest: string[]): void => {
      const issues: Record<string, any> = {};
      for (let i = 0; i < rest.length; i += 4) {
        issues[rest[i]!] = {
          state: rest[i + 1],
          title: rest[i + 2],
          body: rest[i + 3],
          comments: [],
        };
      }
      writeFileSync(join(S, "db.json"), JSON.stringify({ access, next: 60, issues }));
    };

    const tf = (...args: string[]): RunR => {
      return run(join(T, "scripts", "run"), ["tool-faults", ...args], {
        env: {
          ...process.env,
          PATH: `${join(tmp, "bin")}:${process.env.PATH}`,
          TOOL_FAULTS_STUB: S,
        },
      });
    };

    const logf = (d: string, ...args: string[]): void => {
      run(join(T, "scripts", "run"), ["log-action", d, ...args]);
    };

    const writes = (prefix: string): number => {
      try {
        return readFileSync(join(S, "writes.log"), "utf-8")
          .split("\n")
          .filter((l: string) => l.startsWith(`${prefix} `)).length;
      } catch {
        return 0;
      }
    };

    // Random name generators
    const rand = (n: number, chars = "abcdefghijklmnopqrstuvwxyz"): string => {
      let s = "";
      for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
      return s;
    };

    const NAME = `zq${rand(6)}`;
    // ASCII: NAME is rand() lowercase, uppercased for ticket keys below.
    const NAME_UP = NAME.toUpperCase();
    const OWNER = `yq${rand(6)}`;
    const WORD = `xq${rand(6)}`;
    const IDENT = `vq${rand(5)}Totals`;
    const IDENT2 = `wq${rand(5)}Revenue`;
    const UUID = crypto.randomUUID
      ? crypto.randomUUID()
      : `${rand(8)}-${rand(4)}-${rand(4)}-${rand(4)}-${rand(12)}`;
    const HOMEP = `/home/wq${rand(5)}/code/${NAME}/${UUID}`;
    const SECRET = rand(32, "0123456789abcdef");
    const CYR = rand(7, "абвгдежзиклмнопрстуфхцчшщ");
    const CYR2 = rand(7, "αβγδεζηθικλμνξπρστυφχψω");
    const KEYX = `QZ${rand(3, "ABCDEFGHJKLMNPRSTUVWXYZ")}-${rand(3, "123456789")}`;
    const PROPER = `Q${rand(7)}`;
    const EMAIL = `jq${rand(5)}@kq${rand(5)}.example`;
    const IP = `10.${rand(2, "123456789")}.${rand(2, "123456789")}.${rand(2, "123456789")}`;
    const NG = ["column", "harness", "before", "board", "lane", "every", "merge"];
    const SENTENCE = `${NG[6]} ${NG[5]} ${NG[4]} ${NG[3]} ${NG[2]} the ${NG[1]} ${NG[0]}`;
    const TICKET = `${NAME_UP}-12`;
    const REPO = join(tmp, "home", "My Code", NAME);
    mkdirSync(REPO, { recursive: true });
    run("git", ["-C", REPO, "init", "-q"]);
    run("git", ["-C", REPO, "remote", "add", "origin", `https://github.com/${OWNER}/${NAME}.git`]);

    const PLANTED = [
      NAME,
      OWNER,
      WORD,
      IDENT,
      IDENT2,
      HOMEP,
      REPO,
      TICKET,
      SENTENCE,
      `${NG[6]} ${NG[5]} ${NG[4]} ${NG[3]}`,
      UUID.split("-")[0]!,
      UUID.split("-").pop()!,
      SECRET,
      CYR,
      CYR2,
      KEYX,
      EMAIL,
      IP,
      PROPER,
    ];

    // BASE's `leaks()` is `grep -qiF`, whose case-insensitivity is the C
    // library's locale-defined 1:1 matching — not lowercasing and not
    // casefold (it equates σ/ς/Σ but neither ß/s nor i/İ). Spawning the
    // same binary under the same environment is the only exact port, so
    // this runs grep itself, one marker at a time, matching on status.
    // The markers parameter exists for the control; production passes
    // the planted set.
    const leaks = (text: string, markers: string[] = PLANTED): string[] => {
      return markers.filter((p) => run("grep", ["-qiF", "--", p], { input: text }).code === 0);
    };

    const newrun = (project: string, ticket: string, stage: string): string => {
      const d = join(RUNS, project, ".postmaster", "runs", ticket);
      mkdirSync(d, { recursive: true });
      writeFileSync(
        join(d, "brief.md"),
        `# Waybill: ${ticket}\n\n## Ticket\nThe ${WORD} ledger for ${NAME}: ${SENTENCE}. ${CYR}.\n\nrepo: ${T}\n\n## Project profile\nrepo: ${REPO}          default branch: main       BASE: 0123abc\n`,
      );
      writeFileSync(
        join(d, "manifest.json"),
        `${JSON.stringify({ stage, leg: 3, base: "0123abc", lanes: {}, coachman: { legs: {} } })}\n`,
      );
      writeFileSync(
        join(d, "run.json"),
        `${JSON.stringify({
          postmaster: {
            commit: "89abcdef0123456789abcdef0123456789abcdef",
            uncommitted_changes: false,
          },
        })}\n`,
      );
      return d;
    };

    const lineOf = (out: string, id: string): string => {
      return out.split("\n").find((l: string) => l.startsWith(`${id}  `)) || "";
    };

    const idWhere = (out: string, pattern: string): string => {
      const re = new RegExp(`^tf-[0-9a-f]{8}  ${pattern}`, "u");
      const line = out.split("\n").find((l: string) => re.test(l));
      return line ? line.slice(0, 11) : "";
    };

    const stateOf = (d: string, id: string): string => {
      try {
        const st = JSON.parse(readFileSync(join(d, "tool-faults.json"), "utf-8"));
        return (st.faults || [])
          .filter((x: any) => x.id === id)
          .map((x: any) => x.state)
          .join(" ");
      } catch {
        return "";
      }
    };

    const draftOf = (d: string, id: string): string => {
      const st = JSON.parse(readFileSync(join(d, "tool-faults.json"), "utf-8"));
      const x = (st.faults || []).filter((x: any) => x.id === id).pop();
      return join(d, x.draft);
    };

    const draftsAll = (): string => {
      const out: string[] = [];
      const walk = (dir: string) => {
        try {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (
              (e.name.endsWith(".md") || e.name.endsWith(".title")) &&
              p.split(sep).includes("tool-faults")
            )
              out.push(readFileSync(p, "utf-8"));
          }
        } catch {
          /* empty */
        }
      };
      walk(RUNS);
      return out.join("");
    };

    // Set up the main run
    const d = newrun(NAME, TICKET, "done");
    logf(d, "postmaster", "dispatch", TICKET, "leg 1");
    logf(
      d,
      "coachman",
      "tool-fault",
      "scripts/wait-for-markers.sh",
      "--ran",
      `scripts/wait-for-markers.sh ${REPO}/logs 'r1-*.done' 3 2400`,
      "--failed",
      `returned before 1 of 3 markers were in ${HOMEP}/logs`,
      "--error",
      `exit 0; ${NAME} has 1 marker`,
      "--diagnosis",
      `\`${IDENT}\` wrote its marker early`,
      "--fix",
      "count only regular files, with find -type f",
    );
    logf(d, "coachman", "escalate", "scripts/wait-for-markers.sh", "the wait is a control");
    logf(
      d,
      "coachman",
      "tool-fault",
      `${T}/scripts/wait-for-markers.sh`,
      "--ran",
      "the same wait, round 2",
      "--failed",
      "Returned before 2 of 3 markers were in /elsewhere/logs.",
      "--error",
      "none",
      "--diagnosis",
      "same",
      "--fix",
      "count only regular files, with find -type f",
    );
    logf(
      d,
      "coachman",
      "tool-fault",
      "scripts/wait-for-markers.sh",
      "--ran",
      "the same wait, round 3",
      "--failed",
      `returned before 1 of 3 markers were in ${HOMEP}/logs`,
      "--error",
      "none",
      "--diagnosis",
      "same",
      "--fix",
      "count only regular files",
    );
    logf(
      d,
      "coachman",
      "tool-fault",
      "skills/postmaster/harnesses.md",
      "--ran",
      `resume of ${TICKET}'s leg 2`,
      "--failed",
      `the resume form hung while the ${WORD} ledger was open, reading src/${WORD}/billing.ts in ${NAME} of ${OWNER} for ${PROPER}, ${CYR} and ${CYR2} and ${KEYX}, mailed to ${EMAIL}, after scripts/ticket-check.sh quoted: ${SENTENCE}`,
      "--error",
      `timeout after 600s in ${HOMEP}`,
      "--diagnosis",
      `the prompt went to ${OWNER}/${NAME}`,
      "--fix",
      `pass the prompt on stdin, as for \`${IDENT}\` and cfg[${IDENT2}] in ${HOMEP}/src at ${IP}, key ${SECRET}; see https://github.com/${OWNER}/${NAME}`,
      "--workaround",
      "resumed by hand in the recorded form",
    );
    logf(
      d,
      "coachman",
      "tool-fault",
      "scripts/wait-for-markers.sh",
      "--ran",
      "wait, round 4",
      "--failed",
      "counted a directory named like a marker",
      "--error",
      "none",
      "--diagnosis",
      "find has no -type",
      "--fix",
      "add -type f to the find",
    );
    logf(d, "postmaster", "escalate", TICKET, "a scope ruling, about nothing here");
    logf(
      d,
      "coachman",
      "tool-fault",
      "skills/postmaster/coachman.md",
      "--ran",
      "stage 2",
      "--failed",
      "the step runs scripts/stage.sh with a flag it does not take",
      "--error",
      "none",
      "--diagnosis",
      "x",
      "--fix",
      "drop the flag",
      "--control",
      "action-log",
    );
    logf(
      d,
      "coachman",
      "tool-fault",
      "skills/postmaster/coachman.md",
      "--ran",
      "stage 2",
      "--failed",
      "the step runs scripts/handoff-check.sh with a flag it does not take",
      "--error",
      "none",
      "--diagnosis",
      "x",
      "--fix",
      "drop the flag",
      "--control",
      "check",
    );
    logf(d, "coachman", "ticket-comment", TICKET, "ready to merge");
    appendFileSync(join(d, "actions.jsonl"), "this line is not JSON\n");
    appendFileSync(
      join(d, "actions.jsonl"),
      '{"ts":"2026-01-01T00:00:00Z","project":"p","run":"r","actor":"coachman","action":"note","target":"x","detail":"a raw \\u2028 line separator"}\n',
    );

    // --- positive controls ---
    console.log("positive controls");
    db("ADMIN", "12", "OPEN", "An ordinary issue", "Nothing to do with faults.");
    let outR = tf("harvest", d);
    let out = outR.out + outR.err;
    let rc = outR.code;
    const A = idWhere(out, String.raw`scripts/wait-for-markers.sh  control \(wait\)  3 times`);
    const B = idWhere(out, "skills/postmaster/harnesses.md");
    const C = idWhere(out, String.raw`scripts/wait-for-markers.sh  control \(wait\)  once`);
    const D1 = idWhere(out, String.raw`skills/postmaster/coachman.md  control \(action-log\)`);
    const D2 = idWhere(out, String.raw`skills/postmaster/coachman.md  control \(check\)`);
    if (!A || !B || !C || !D1 || !D2)
      throw new Error(`harvest exit ${rc}; A=${A} B=${B} C=${C} D1=${D1} D2=${D2}\n${out}`);
    const faultCount = out.split("\n").filter((l: string) => /^tf-[0-9a-f]{8} {2}/u.test(l)).length;
    check(
      "seven fault lines are five faults: one seen three ways, and two naming different scripts kept apart",
      rc === 0 &&
        faultCount === 5 &&
        !!(A && B && C && D1 && D2) &&
        D1.length === 11 &&
        D2.length === 11 &&
        D1 !== D2,
      `exit ${rc}, ${faultCount} faults, A=${A} B=${B} C=${C} D1=${D1} D2=${D2}`,
    );
    const badLineCount = out
      .split("\n")
      .filter((l: string) => l.includes("is not a log line, and was left out")).length;
    check(
      "a line that is not JSON is left out, and said so; one with a raw line separator is read",
      badLineCount === 1,
      out,
    );
    {
      const rid = out.split(" ")[1]?.replace(/:/u, "") || "";
      const logContent = readFileSync(join(d, "actions.jsonl"), "utf-8");
      check(
        "the harvest logs what it found",
        logContent.includes(
          `"action":"note","target":"${rid}","detail":"tool faults harvested: 5, 5 new"`,
        ),
        logContent.split("\n").slice(-2).join("\n"),
      );
    }
    {
      const bDraft = draftOf(d, B);
      const bLine = lineOf(out, B);
      check(
        "a fault no ticket holds is new, and its line names its draft",
        stateOf(d, B) === "new" && existsSync(bDraft) && bLine.includes("new  tool-faults/"),
        `state=${stateOf(d, B)} draft=${bDraft} line=${bLine}`,
      );
    }
    {
      const cLine = out
        .split("\n")
        .find(
          (l: string) =>
            l ===
            `  ${C}: a fault in a control, and the log has no escalate naming its file after it`,
        );
      const aLine = out.includes(`  ${A}: a fault in a control, and`);
      const aDraft = readFileSync(draftOf(d, A), "utf-8");
      const cDraft = readFileSync(draftOf(d, C), "utf-8");
      check(
        "only an escalate naming the fault's file counts as its escalation",
        !!cLine &&
          !aLine &&
          aDraft.includes("The run stopped and escalated.") &&
          !cDraft.includes("The run stopped and escalated."),
        out,
      );
    }
    {
      let shape = 0;
      for (const fid of [A, B, C]) {
        const f = draftOf(d, fid);
        const r = run(join(T, "scripts", "run"), [
          "ticket-check",
          "--body",
          f,
          "--title",
          readFileSync(f.replace(/\.md$/u, ".title"), "utf-8").trim(),
        ]);
        if (r.code !== 0) shape++;
        if (!readFileSync(f, "utf-8").split("\n").includes("## Turnpikes")) shape++;
      }
      check(
        "each draft is in the ticket shape, with its turnpikes, and passes scripts/ticket-check.sh",
        shape === 0,
        `${shape} fail`,
      );
    }
    {
      const rid = JSON.parse(readFileSync(join(d, "tool-faults.json"), "utf-8")).runs.pop().run_id;
      const aDraft = readFileSync(draftOf(d, A), "utf-8");
      check(
        "a draft names the run by its public id, and the postmaster it ran",
        aDraft.includes(`It was seen 3 times in run ${rid}, which ran postmaster 89abcdef0123.`),
        aDraft,
      );
    }
    {
      const bMd = draftOf(d, B);
      const bTitle = readFileSync(bMd.replace(/\.md$/u, ".title"), "utf-8");
      const bBody = readFileSync(bMd, "utf-8");
      const all = bTitle + bBody;
      const marks = [
        "path",
        "project",
        "code",
        "link",
        "withheld",
        "ticket text",
        "ticket",
        "address",
      ];
      const marked = marks.every((m) => all.includes(`[${m}]`));
      check(
        "postmaster's own files and words are kept, and what is withheld is marked",
        bTitle.includes("skills/postmaster/harnesses.md") &&
          bBody.includes("pass the prompt on stdin") &&
          bBody.includes("scripts/ticket-check.sh") &&
          marked,
        `${bTitle}\n${bBody}`,
      );
    }
    // Re-harvest with known tickets
    db(
      "ADMIN",
      "12",
      "OPEN",
      "An ordinary issue",
      "Nothing to do with faults.",
      "57",
      "OPEN",
      `Tool fault in scripts/wait-for-markers.sh: returned early [${A}]`,
      "A body.",
      "58",
      "OPEN",
      "Retitled by hand",
      `Tool fault id: \`${D1}\`.`,
    );
    outR = tf("harvest", d);
    out = outR.out + outR.err;
    {
      const aLine = lineOf(out, A);
      const cLine = lineOf(out, C);
      const d1Line = lineOf(out, D1);
      const bLine = lineOf(out, B);
      check(
        "a ticket holding the id in its title or its body is known; one only like it is not; a draft already shown is asked",
        / known #57 \(open\)$/u.test(aLine) &&
          / asked, like #57 {2}tool-faults\//u.test(cLine) &&
          / known #58 \(open\)$/u.test(d1Line) &&
          / asked {2}tool-faults\//u.test(bLine),
        out,
      );
    }
    // comment
    writeFileSync(join(S, "writes.log"), "");
    outR = tf("comment", d, A);
    out = outR.out + outR.err;
    rc = outR.code;
    {
      const logContent = readFileSync(join(d, "actions.jsonl"), "utf-8");
      const writesLog = readFileSync(join(S, "writes.log"), "utf-8");
      const rid = JSON.parse(readFileSync(join(d, "tool-faults.json"), "utf-8")).runs.pop().run_id;
      check(
        "comment says once, on the ticket that holds it, that it was seen again, and logs it",
        rc === 0 &&
          writes("comment") === 1 &&
          writesLog.includes("comment #57 ") &&
          writesLog.includes(`tool fault ${A} seen again: 3 times in run ${rid}`) &&
          logContent.includes(`"target":"#57","detail":"tool fault ${A} seen again in run ${rid}`),
        `exit ${rc}\n${writesLog}\n${out}`,
      );
    }
    outR = tf("comment", d, C, "12");
    out = outR.out + outR.err;
    rc = outR.code;
    {
      const writesLog = readFileSync(join(S, "writes.log"), "utf-8");
      const rid = JSON.parse(readFileSync(join(d, "tool-faults.json"), "utf-8")).runs.pop().run_id;
      const lastLine = writesLog.trim().split("\n").pop() || "";
      check(
        "on the user's word that a ticket holds a new fault, comment names it there",
        rc === 0 &&
          lastLine.includes("comment #12 ") &&
          lastLine.includes(`tool fault ${C} seen again: once in run ${rid}`),
        `exit ${rc}\n${writesLog}`,
      );
    }
    // file
    const bMdPath = draftOf(d, B);
    outR = tf("file", d, B);
    out = outR.out + outR.err;
    rc = outR.code;
    {
      const writesLog = readFileSync(join(S, "writes.log"), "utf-8");
      const created = readFileSync(join(S, "created-60.md"), "utf-8");
      const bBody = readFileSync(bMdPath, "utf-8");
      const logContent = readFileSync(join(d, "actions.jsonl"), "utf-8");
      const rid = JSON.parse(readFileSync(join(d, "tool-faults.json"), "utf-8")).runs.pop().run_id;
      check(
        "file files the draft as it is, once, and logs the new ticket",
        rc === 0 &&
          writes("create") === 1 &&
          created === bBody &&
          out.trim() === `${B}: filed as #60` &&
          logContent.includes(`"target":"#60","detail":"tool fault ${B} filed in run ${rid}`),
        `exit ${rc}\n${out}\n${writesLog}`,
      );
    }
    tf("comment", d, D1);
    outR = tf("decline", d, D2, "the user: not worth a ticket");
    out = outR.out + outR.err;
    rc = outR.code;
    {
      const logContent = readFileSync(join(d, "actions.jsonl"), "utf-8");
      const rid = JSON.parse(readFileSync(join(d, "tool-faults.json"), "utf-8")).runs.pop().run_id;
      check(
        "decline records the user's no, and files nothing",
        rc === 0 &&
          writes("create") === 1 &&
          logContent.includes(
            `"target":"${D2}","detail":"tool fault ${D2} declined in run ${rid}, by the user: the user: not worth a ticket"`,
          ),
        `exit ${rc}\n${out}`,
      );
    }
    // later harvest reads from log
    {
      const stateWas = readFileSync(join(d, "tool-faults.json"), "utf-8");
      const stObj = JSON.parse(stateWas);
      for (const x of stObj.faults) x.state = "new";
      writeFileSync(join(d, "tool-faults.json"), JSON.stringify(stObj));
      outR = tf("harvest", d);
      out = outR.out + outR.err;
      const checks = [
        `${A} commented #57`,
        `${B} filed #60`,
        `${C} commented #12`,
        `${D1} commented #58`,
        `${D2} declined`,
      ];
      let allOk = true;
      for (const f of checks) {
        const [id, ...rest] = f.split(" ");
        const want = rest.join(" ");
        const line = out.split("\n").find((l: string) => l.startsWith(`${id}  `));
        if (!line?.trim().endsWith(want)) {
          allOk = false;
          break;
        }
      }
      check(
        "a later harvest reads what was done from the run's log, not its state file",
        allOk,
        out,
      );
    }
    // later run
    const again = newrun(NAME, `${NAME_UP}-16`, "done");
    logf(
      again,
      "coachman",
      "tool-fault",
      "scripts/wait-for-markers.sh",
      "--ran",
      "wait",
      "--failed",
      "counted a directory named like a marker",
      "--error",
      "none",
      "--diagnosis",
      "find has no -type",
      "--fix",
      "add -type f to the find",
      "--control",
      "wait",
    );
    // set issue 12 to CLOSED
    {
      const dbObj = JSON.parse(readFileSync(join(S, "db.json"), "utf-8"));
      dbObj.issues["12"].state = "CLOSED";
      writeFileSync(join(S, "db.json"), JSON.stringify(dbObj));
    }
    outR = tf("harvest", again);
    out = outR.out + outR.err;
    {
      const cLine = lineOf(out, C);
      check(
        "in a later run, a fault a comment names on any ticket is known there",
        / known #12 \(closed\)$/u.test(cLine),
        out,
      );
    }
    outR = tf("comment", again, C);
    out = outR.out + outR.err;
    rc = outR.code;
    {
      const writesLog = readFileSync(join(S, "writes.log"), "utf-8");
      const lastLine = writesLog.trim().split("\n").pop() || "";
      check(
        "a comment on a closed ticket says it is closed",
        rc === 0 &&
          lastLine.includes("comment #12 ") &&
          lastLine.includes("This ticket is closed."),
        `exit ${rc}\n${lastLine}`,
      );
    }
    // postmaster's own faults
    const pmDir = join(RUNS, NAME, ".postmaster", "runs", "postmaster");
    mkdirSync(pmDir, { recursive: true });
    logf(
      pmDir,
      "postmaster",
      "tool-fault",
      "scripts/runs-status.sh",
      "--ran",
      "the poll",
      "--failed",
      "listed a run twice",
      "--error",
      "none",
      "--diagnosis",
      "x",
      "--fix",
      "list each once",
    );
    outR = tf("harvest", pmDir);
    out = outR.out + outR.err;
    const P = idWhere(out, "scripts/runs-status.sh");
    outR = tf("file", pmDir, P);
    out = outR.out + outR.err;
    // close issue 61
    {
      const dbObj = JSON.parse(readFileSync(join(S, "db.json"), "utf-8"));
      dbObj.issues["61"].state = "CLOSED";
      writeFileSync(join(S, "db.json"), JSON.stringify(dbObj));
    }
    logf(
      pmDir,
      "postmaster",
      "tool-fault",
      "scripts/runs-status.sh",
      "--ran",
      "the poll, later",
      "--failed",
      "listed a run twice",
      "--error",
      "none",
      "--diagnosis",
      "x",
      "--fix",
      "list each once",
    );
    outR = tf("harvest", pmDir);
    out = outR.out + outR.err;
    const P2 = idWhere(out, "scripts/runs-status.sh");
    const PR = JSON.parse(readFileSync(join(pmDir, "tool-faults.json"), "utf-8")).runs.length;
    {
      const pLine = lineOf(out, P);
      check(
        "the postmaster's own faults: a recurrence after its ticket is filed is a new harvest, and known",
        P2 === P && PR === 2 && /once {2}known #61 \(closed\)$/u.test(pLine),
        out,
      );
    }
    // draft checks
    const notesDir = newrun("notes", "IT-12", "done");
    writeFileSync(join(S, "writes.log"), "");
    const PAY = ["late", "was", "it", "refused", "payment"];
    appendFileSync(
      join(notesDir, "brief.md"),
      `The ${PAY[4]} ${PAY[1]} ${PAY[3]} ${PAY[2]} ${PAY[1]} ${PAY[0]}.\n`,
    );
    logf(
      notesDir,
      "coachman",
      "tool-fault",
      "scripts/launch.sh",
      "--ran",
      "launch",
      "--failed",
      "the stream flag was refused",
      "--error",
      "none",
      "--diagnosis",
      "renamed",
      "--fix",
      "use the new flag",
    );
    logf(
      notesDir,
      "coachman",
      "tool-fault",
      "scripts/cut-scratch.sh",
      "--ran",
      "cut",
      "--failed",
      "cloned a directory twice",
      "--error",
      "none",
      "--diagnosis",
      "a loop",
      "--fix",
      "clone each once",
    );
    outR = tf("harvest", notesDir);
    out = outR.out + outR.err;
    const N1 = idWhere(out, "scripts/launch.sh");
    const N2 = idWhere(out, "scripts/cut-scratch.sh");
    outR = tf("file", notesDir, N1);
    out = outR.out + outR.err;
    rc = outR.code;
    {
      const n1Draft = draftOf(notesDir, N1);
      const n1Body = readFileSync(n1Draft, "utf-8");
      check(
        "a draft as the harvest wrote it is filed as written, though a check of the whole would withhold a phrase",
        rc === 0 && writes("create") === 1 && n1Body.split("\n").includes("## Notes"),
        `exit ${rc}\n${out}`,
      );
      check(
        "a draft's Notes leave the fixture decision to the contract checker, not the wording",
        n1Body.includes(
          "The postmaster's contract checker decides from the final branch whether a fixture run is required",
        ) && !n1Body.includes("a fixture run confirms it before it merges"),
        n1Body,
      );
    }
    appendFileSync(draftOf(notesDir, N2), "It was seen on a quiet day.\n");
    outR = tf("file", notesDir, N2);
    out = outR.out + outR.err;
    rc = outR.code;
    check(
      "a changed draft is filed when it is still safe, in a project named with words postmaster uses",
      rc === 0 && writes("create") === 2,
      `exit ${rc}\n${out}`,
    );
    {
      const pad = "the step ran on ".repeat(10).slice(0, 70);
      logf(
        notesDir,
        "coachman",
        "tool-fault",
        "skills/postmaster/coachman.md",
        "--ran",
        "stage 2",
        "--failed",
        `${pad} then scripts/wait-for-markers.sh waited for ever`,
        "--error",
        "none",
        "--diagnosis",
        "x",
        "--fix",
        "bound the wait",
        "--control",
        "wait",
      );
    }
    outR = tf("harvest", notesDir);
    out = outR.out + outR.err;
    const N3 = idWhere(out, "skills/postmaster/coachman.md");
    appendFileSync(draftOf(notesDir, N3), "It was seen once more.\n");
    outR = tf("file", notesDir, N3);
    out = outR.out + outR.err;
    rc = outR.code;
    check(
      "a title is cut between words, so a changed draft keeps its paths whole",
      rc === 0 && writes("create") === 3,
      `exit ${rc}\n${out}`,
    );
    // control kinds
    const kindsDir = newrun(NAME, `${NAME_UP}-19`, "done");
    writeFileSync(
      join(kindsDir, "actions.jsonl"),
      '{"ts":"2026-01-01T00:00:00Z","project":"p","run":"r","actor":"coachman","action":"tool-fault","target":"scripts/wait-for-markers.sh","detail":"waited on the wrong folder","fault":{"ran":"x","failed":"waited on the wrong folder","error":"none","diagnosis":"x","fix":"y","workaround":"","control":"gate"}}\n' +
        '{"ts":"2026-01-01T00:00:00Z","project":"p","run":"r","actor":"coachman","action":"tool-fault","target":"scripts/log-action.sh","detail":"wrote nothing","fault":{"ran":"x","failed":"wrote nothing","error":"none","diagnosis":"x","fix":"y","workaround":"","control":""}}\n',
    );
    outR = tf("harvest", kindsDir);
    out = outR.out + outR.err;
    check(
      "a fault keeps the kind of control its line recorded; with none recorded, the list's",
      /^tf-[0-9a-f]{8} {2}scripts\/wait-for-markers\.sh {2}control \(gate\) {2}once/mu.test(out) &&
        /^tf-[0-9a-f]{8} {2}scripts\/log-action\.sh {2}control \(action-log\) {2}once/mu.test(out),
      out,
    );
    // long token
    const longDir = newrun(NAME, `${NAME_UP}-20`, "done");
    logf(
      longDir,
      "coachman",
      "tool-fault",
      "scripts/launch.sh",
      "--ran",
      "x",
      "--failed",
      `choked on ${rand(100000, "abcdefghij")}`,
      "--error",
      "none",
      "--diagnosis",
      "x",
      "--fix",
      "y",
    );
    const startSec = Date.now();
    outR = tf("harvest", longDir);
    out = outR.out + outR.err;
    rc = outR.code;
    const elapsed = (Date.now() - startSec) / 1000;
    check(
      "a fault with a 100,000-character token is harvested in seconds",
      rc === 0 && elapsed < 25,
      `exit ${rc}, ${elapsed.toFixed(1)}s`,
    );
    // fault the log no longer gives
    {
      const stObj = JSON.parse(readFileSync(join(longDir, "tool-faults.json"), "utf-8"));
      stObj.faults.push({ ...stObj.faults[0], id: "tf-0badf00d", state: "new" });
      writeFileSync(join(longDir, "tool-faults.json"), JSON.stringify(stObj));
      outR = tf("comment", longDir, "tf-0badf00d");
      out = outR.out + outR.err;
      rc = outR.code;
      check(
        "a fault the log no longer gives is refused by name",
        rc === 1 && out.includes("no longer gives tf-0badf00d") && !out.includes("Traceback"),
        `exit ${rc}\n${out}`,
      );
    }
    // board
    const boardDir = newrun(NAME, `${NAME_UP}-17`, "done");
    writeFileSync(join(S, "writes.log"), "");
    logf(
      boardDir,
      "coachman",
      "tool-fault",
      "scripts/cut-scratch.sh",
      "--ran",
      "cut",
      "--failed",
      "cloned no dependency directory",
      "--error",
      "none",
      "--diagnosis",
      "x",
      "--fix",
      "clone them",
    );
    outR = tf("harvest", boardDir);
    out = outR.out + outR.err;
    const K1 = idWhere(out, "scripts/cut-scratch.sh");
    writeFileSync(join(S, "no-item-add"), "");
    outR = tf("file", boardDir, K1);
    out = outR.out + outR.err;
    rc = outR.code;
    rmSync(join(S, "no-item-add"), { force: true });
    outR = tf("harvest", boardDir);
    const out2 = outR.out + outR.err;
    {
      const k1Line = out2.split("\n").find((l: string) => l.startsWith(`${K1}  `)) || "";
      check(
        "a ticket created but not put on the board is still filed, and logged",
        rc === 0 &&
          out.includes("it is not on the board") &&
          / filed #6[0-9]$/u.test(k1Line.trim()),
        `exit ${rc}\n${out}\n${out2}`,
      );
    }
    check(
      "the leak check finds a planted piece",
      leaks(`zz ${NAME} zz`).length > 0,
      `NAME=${NAME}`,
    );

    // --- negative controls ---
    console.log("negative controls");
    {
      const all =
        draftsAll() +
        readFileSync(join(S, "writes.log"), "utf-8") +
        readdirSync(S)
          .filter((f) => f.startsWith("created-"))
          .map((f) => readFileSync(join(S, f), "utf-8"))
          .join("");
      const l = leaks(all);
      check(
        "no planted name, path, id, word, key, address, code or ticket text reaches a draft, a ticket or a comment",
        l.length === 0,
        l.join("\n"),
      );
    }
    writeFileSync(join(S, "writes.log"), "");
    outR = tf("comment", d, A);
    const rc1 = outR.code;
    const out1 = outR.out + outR.err;
    outR = tf("file", d, B);
    const rc2 = outR.code;
    const out2b = outR.out + outR.err;
    {
      const writesLog = readFileSync(join(S, "writes.log"), "utf-8");
      check(
        "a second comment or file says it is done, and writes nothing",
        rc1 === 0 &&
          rc2 === 0 &&
          out1.trim() === `${A}: already commented #57` &&
          out2b.trim() === `${B}: already filed #60` &&
          writesLog.trim() === "",
        `(${rc1}, ${rc2})\n${out1}\n${out2b}`,
      );
    }
    {
      const cleanDir = newrun(NAME, `${NAME_UP}-13`, "done");
      logf(cleanDir, "coachman", "note", TICKET, "nothing went wrong");
      outR = tf("harvest", cleanDir);
      out = outR.out + outR.err;
      rc = outR.code;
      const rid = JSON.parse(readFileSync(join(cleanDir, "tool-faults.json"), "utf-8")).runs.pop()
        .run_id;
      check(
        "a clean log yields no fault and no draft",
        rc === 0 &&
          out.trim() === `run ${rid}: no tool faults` &&
          !existsSync(join(cleanDir, "tool-faults")),
        `exit ${rc}\n${out}`,
      );
    }
    {
      const openDir = newrun(NAME, `${NAME_UP}-14`, "review");
      logf(
        openDir,
        "coachman",
        "tool-fault",
        "scripts/launch.sh",
        "--ran",
        "x",
        "--failed",
        "y",
        "--error",
        "none",
        "--diagnosis",
        "z",
        "--fix",
        "w",
      );
      outR = tf("harvest", openDir);
      out = outR.out + outR.err;
      rc = outR.code;
      check(
        "a run still open is not harvested",
        rc === 1 && out.includes("still open") && !existsSync(join(openDir, "tool-faults.json")),
        `exit ${rc}\n${out}`,
      );
    }
    const mineDir = newrun(NAME, `${NAME_UP}-15`, "abandoned");
    logf(
      mineDir,
      "coachman",
      "tool-fault",
      "scripts/launch.sh",
      "--ran",
      "launch",
      "--failed",
      "the model flag was refused",
      "--error",
      "none",
      "--diagnosis",
      "renamed",
      "--fix",
      "use the new flag",
    );
    // set access to READ
    {
      const dbObj = JSON.parse(readFileSync(join(S, "db.json"), "utf-8"));
      dbObj.access = "READ";
      writeFileSync(join(S, "db.json"), JSON.stringify(dbObj));
    }
    outR = tf("harvest", mineDir);
    out = outR.out + outR.err;
    rc = outR.code;
    const F = idWhere(out, "scripts/launch.sh");
    check(
      "a repository the user does not own is no tracker: the faults are kept",
      rc === 0 &&
        out.includes("the user does not own postmaster's repository") &&
        stateOf(mineDir, F) === "kept",
      `exit ${rc}\n${out}`,
    );
    outR = tf("file", mineDir, F);
    out = outR.out + outR.err;
    rc = outR.code;
    {
      const writesLog = readFileSync(join(S, "writes.log"), "utf-8");
      check(
        "and nothing is filed there",
        rc === 1 && out.includes("no tracker of postmaster's own") && writesLog.trim() === "",
        `exit ${rc}\n${out}`,
      );
    }
    // restore ADMIN
    {
      const dbObj = JSON.parse(readFileSync(join(S, "db.json"), "utf-8"));
      dbObj.access = "ADMIN";
      writeFileSync(join(S, "db.json"), JSON.stringify(dbObj));
    }
    // vendored copy
    mkdirSync(join(REPO, "tools/postmaster"), { recursive: true });
    run("cp", ["-R", join(T, "scripts"), join(REPO, "tools/postmaster/")]);
    run("cp", ["-R", join(T, "skills"), join(REPO, "tools/postmaster/")]);
    copyFileSync(join(T, "bunfig.toml"), join(REPO, "tools/postmaster/bunfig.toml"));
    const vendDir = newrun(NAME, `${NAME_UP}-18`, "done");
    logf(
      vendDir,
      "coachman",
      "tool-fault",
      "scripts/launch.sh",
      "--ran",
      "launch",
      "--failed",
      `the effort flag was refused for ${NAME}`,
      "--error",
      "none",
      "--diagnosis",
      "x",
      "--fix",
      "use the new flag",
    );
    outR = run(join(REPO, "tools/postmaster/scripts/run"), ["tool-faults", "harvest", vendDir], {
      env: {
        ...process.env,
        PATH: `${join(tmp, "bin")}:${process.env.PATH}`,
        TOOL_FAULTS_STUB: S,
      },
    });
    out = outR.out + outR.err;
    rc = outR.code;
    {
      const draftsContent = (() => {
        try {
          return readdirSync(join(vendDir, "tool-faults"), { recursive: true })
            .map((f) => {
              try {
                return readFileSync(join(vendDir, "tool-faults", String(f)), "utf-8");
              } catch {
                return "";
              }
            })
            .join("");
        } catch {
          return "";
        }
      })();
      check(
        "a copy of postmaster inside the target is no tracker, and withholds the target all the same",
        rc === 0 &&
          out.includes("not a git checkout of its own") &&
          leaks(draftsContent).length === 0,
        `exit ${rc}\n${out}`,
      );
    }
    // no-search
    outR = tf("harvest", mineDir);
    writeFileSync(join(S, "no-search"), "");
    outR = tf("harvest", mineDir);
    outR = tf("file", mineDir, F);
    out = outR.out + outR.err;
    rc = outR.code;
    rmSync(join(S, "no-search"), { force: true });
    {
      const writesLog = readFileSync(join(S, "writes.log"), "utf-8");
      check(
        "a tracker that cannot be searched leaves the fault unchecked, and nothing is filed",
        stateOf(mineDir, F) === "unchecked" &&
          rc === 1 &&
          out.includes("could not be read, so nothing is filed") &&
          writesLog.trim() === "",
        `exit ${rc}\n${out}`,
      );
    }
    // unsafe draft
    appendFileSync(draftOf(mineDir, F), `\`${IDENT}\` is the one to fix\n`);
    outR = tf("file", mineDir, F);
    out = outR.out + outR.err;
    rc = outR.code;
    {
      const writesLog = readFileSync(join(S, "writes.log"), "utf-8");
      check(
        "file refuses a draft changed to carry the target's code",
        rc === 2 && writesLog.trim() === "" && out.includes("not safe to publish"),
        `exit ${rc}\n${out}`,
      );
    }

    // Fault ids are BASE's sha256 over "file\nkey", first 8 hex digits; a draft's
    // digest is sha256 over title, NUL, body. Both pin to goldens captured from
    // python3's hashlib once, on 2026-09-29: the same inputs must give the same
    // id on both sides, or a run across the cutover files under another fault's
    // name. Regenerate under python3 with -c and, respectively:
    //   "import hashlib; print('tf-'+hashlib.sha256(b'<file>\n<key>').hexdigest()[:8])"
    //   "import hashlib; print(hashlib.sha256(open('<title>','rb').read()+b'\0'+open('<body>','rb').read()).hexdigest())"
    // The formula control below uses fixed keys on purpose: the keys the
    // grouping derives come from the tool vocabulary, so end-to-end ids would
    // bake the vocabulary into the golden. The wiring control then checks the
    // grouping files each entry under faultId of its own target and key.
    {
      const cases: Array<[string, string, string]> = [
        ["scripts/launch.sh", "codex --json hung", "tf-e2ae0dba"],
        ["scripts/host.sh", "tmux: no server running", "tf-eb56942b"],
        ["", "", "tf-01ba4719"],
        ["a", "b\nc", "tf-ea7fb08b"],
        ["snowman ☃", "key ☃", "tf-b1776d54"],
      ];
      const seen: string[] = [];
      let fidsMatch = true;
      for (const [file, key, want] of cases) {
        const got = faultId(file, key);
        seen.push(`${JSON.stringify(file)} ${JSON.stringify(key)}: ${got} vs ${want}`);
        if (got !== want) fidsMatch = false;
      }
      check("fault ids are BASE's sha256 over file, newline, key", fidsMatch, seen.join("\n"));
    }
    {
      const d = join(tmp, "fid");
      mkdirSync(d, { recursive: true });
      const safe = new Safe([], d, false);
      const entries = [
        {
          action: "tool-fault",
          target: "scripts/launch.sh",
          fault: { failed: "codex --json hung", control: "", workaround: "" },
        },
        {
          action: "tool-fault",
          target: "scripts/host.sh",
          fault: { failed: "tmux: no server running", control: "retry", workaround: "" },
        },
      ];
      const groups = faultsOf(entries, safe, 0);
      let wiredOk = groups.length === 2;
      const seen: string[] = [];
      for (const g of groups) {
        const e = g.entries[0]!;
        const want = faultId(String(e.target || ""), safe.key(String(fields(e).failed || "")));
        seen.push(`${g.id} vs ${want}`);
        if (g.id !== want) wiredOk = false;
      }
      check("grouping files each entry under its fault id", wiredOk, seen.join("\n"));
    }
    {
      const cases: Array<[Buffer, Buffer, string]> = [
        [
          Buffer.from("A title\n", "utf8"),
          Buffer.from("A body.\n", "utf8"),
          "7318098db1171d190bf06cb08ac941f67a6dc4cbbd11be829fd849d3ca0d19c3",
        ],
        [
          Buffer.from(new Uint8Array([0x54, 0xff, 0x0a])),
          Buffer.from("body\0with NUL\n", "utf8"),
          "be4624694fee7015471a8b74f6c0787794fb99db785e7bd5d554169f108ddc81",
        ],
      ];
      let digestsMatch = true;
      const seen: string[] = [];
      cases.forEach(([title, body, want], i) => {
        const titlePath = join(tmp, `t${i}.title`);
        const bodyPath = join(tmp, `b${i}.md`);
        writeFileSync(titlePath, title);
        writeFileSync(bodyPath, body);
        const got = digest(titlePath, bodyPath);
        seen.push(`${got} vs ${want}`);
        if (got !== want) digestsMatch = false;
      });
      check("draft digests are BASE's sha256 over title, NUL, body", digestsMatch, seen.join("\n"));
    }
    // The casefold primitive, pinned to goldens captured from python3's
    // str.casefold once, on 2026-09-29: every entry below is a code point
    // where folding differs from lowercasing (plus sigma, where the
    // context-free fold beats the final-sigma lower). Regenerate under
    // python3 with -c and: "print(repr('<chars>'.casefold()))".
    {
      const cases: Array<[string, string]> = [
        ["ß", "ss"],
        ["İ", "i\u0307"],
        ["ς", "σ"],
        ["Σ", "σ"],
        ["ﬀ", "ff"],
        ["ﬁ", "fi"],
        ["ſ", "s"],
        ["ŉ", "\u02bcn"],
        ["ǰ", "j\u030c"],
        ["µ", "μ"],
        ["Straße", "strasse"],
        ["ςigma DBΣ", "σigma dbσ"],
      ];
      const seen: string[] = [];
      let foldOk = true;
      for (const [input, want] of cases) {
        const got = casefold(input);
        if (got !== want) {
          foldOk = false;
          seen.push(`${JSON.stringify(input)}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
        }
      }
      check("casefold folds as Python's str.casefold", foldOk, seen.join("\n"));
    }
    if (!skipPython) {
      const T2 = join(tmp, "tool2");
      mkdirSync(join(T2, "skills"), { recursive: true });
      run("cp", ["-R", HERE, join(T2, "scripts")]);
      plantLegacyTargets(T2);
      copyFileSync(join(TOOL, "bunfig.toml"), join(T2, "bunfig.toml"));
      run("cp", ["-R", join(TOOL, "skills/postmaster"), join(T2, "skills/postmaster")]);
      const oldControls = run("git", [
        "-C",
        TOOL,
        "show",
        "bb782a973e69427c820ce16a676718e87f51995b:skills/postmaster/controls.md",
      ]);
      if (oldControls.code !== 0) throw new Error(oldControls.err);
      writeFileSync(join(T2, "skills/postmaster/controls.md"), oldControls.out);
      writeFileSync(
        join(T2, "skills/postmaster/probe.md"),
        "see docs/straße.md and straße.md for the probe\nthe straße word lives here\nref https://straße.example/x here\n",
      );
      const shown = run("git", [
        "-C",
        TOOL,
        "show",
        "bb782a973e69427c820ce16a676718e87f51995b:scripts/tool-faults.sh",
      ]);
      const baseLines = shown.out.split("\n");
      const ghStart = baseLines.findIndex((l) => l.startsWith("cat > ") && l.includes("<<'GH'"));
      const ghEnd = baseLines.findIndex((l, i) => i > ghStart && l === "GH");
      const baseTf = join(T2, "scripts", "base-tf.sh");
      writeFileSync(baseTf, shown.out);
      run("chmod", ["+x", baseTf]);
      run("git", ["-C", T2, "init", "-q"]);
      run("git", ["-C", T2, "remote", "add", "origin", "https://github.com/o/postmaster.git"]);
      // BASE's stub gh, extracted from its self-test (the `cat ... <<'GH'` body).
      const binB = join(tmp, "binB");
      mkdirSync(binB, { recursive: true });
      writeFileSync(join(binB, "gh"), `${baseLines.slice(ghStart + 1, ghEnd).join("\n")}\n`);
      run("chmod", ["+x", join(binB, "gh")]);
      const S2 = join(tmp, "stub2");
      const S2B = join(tmp, "stub2B");
      for (const s of [S2, S2B]) {
        mkdirSync(s, { recursive: true });
        writeFileSync(
          join(s, "db.json"),
          JSON.stringify({ access: "ADMIN", next: 60, issues: {} }),
        );
      }
      const faults: Array<[string, string]> = [
        ["scripts/launch.sh", "crash in Straße 42"],
        ["scripts/launch.sh", "ςigma failed on DBΣ now"],
        ["scripts/launch.sh", "İllegal instruction"],
        ["scripts/launch.sh", "see İ/ſ docs"],
        ["scripts/launch.sh", "see docs/STRASSE.md"],
        ["scripts/launch.sh", "STRASSE broke it"],
        ["scripts/launch.sh", "großartig qzxv jkwv bnpm"],
        ["scripts/launch.sh", "run `STRASSE` now"],
        ["scripts/launch.sh", "see STRASSE.MD"],
        ["scripts/launch.sh", "see https://STRASSE.example/x"],
        ["scripts/launch.sh", "plain ascii failure"],
      ];
      const mkDisp = (name: string): string => {
        const d = join(tmp, name);
        mkdirSync(d, { recursive: true });
        writeFileSync(
          join(d, "manifest.json"),
          '{"stage": "done", "leg": 3, "base": "0123abc", "lanes": {}, "coachman": {"legs": {}}}\n',
        );
        writeFileSync(join(d, "run.json"), '{"written": "2026-01-01T00:00:00Z", "run": "t"}\n');
        writeFileSync(
          join(d, "brief.md"),
          "# Waybill: t\n\nGROSSARTIG QZXV JKWV BNPM are waybill words.\n",
        );
        writeFileSync(
          join(d, "actions.jsonl"),
          `${faults
            .map(([target, failed], i) =>
              JSON.stringify({
                ts: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`,
                project: "postmaster",
                run: "t",
                actor: "coachman",
                action: "tool-fault",
                target,
                detail: "x",
                fault: { failed, control: "", workaround: "" },
              }),
            )
            .join("\n")}\n`,
        );
        return d;
      };
      const mismatches: string[] = [];
      if (shown.code !== 0 || ghStart < 0 || ghEnd < 0) {
        mismatches.push("could not extract BASE tool-faults.sh and its stub gh");
      } else {
        const dB = mkDisp("runsB");
        const dP = mkDisp("runsP");
        const base = run("bash", [baseTf, "harvest", dB], {
          env: { ...process.env, PATH: `${binB}:${process.env.PATH}`, TOOL_FAULTS_STUB: S2B },
        });
        const port = run(join(T2, "scripts", "run"), ["tool-faults", "harvest", dP], {
          env: {
            ...process.env,
            PATH: `${join(tmp, "bin")}:${process.env.PATH}`,
            TOOL_FAULTS_STUB: S2,
          },
        });
        const rid = normRid;
        if (base.code !== 0 || port.code !== 0) {
          mismatches.push(
            `exits: base ${base.code} port ${port.code}\nbase: ${base.err}\nport: ${port.err}`,
          );
        } else if (rid(base.out) !== rid(port.out)) {
          mismatches.push(
            `harvest output differs:\n--- base\n${rid(base.out)}\n--- port\n${rid(port.out)}`,
          );
        } else {
          const drafts = (d: string): Map<string, string> => {
            const m = new Map<string, string>();
            for (const sub of readdirSync(join(d, "tool-faults"))) {
              for (const f of readdirSync(join(d, "tool-faults", sub))) {
                if (f === "tool-faults.json") continue;
                m.set(f, rid(readFileSync(join(d, "tool-faults", sub, f), "utf-8")));
              }
            }
            return m;
          };
          const b = drafts(dB);
          const p = drafts(dP);
          for (const [f, body] of b) b.set(f, note163(body));
          for (const [f, body] of b) {
            if (!p.has(f)) mismatches.push(`draft only on BASE: ${f}`);
            else if (p.get(f) !== body) mismatches.push(`draft differs: ${f}`);
          }
          for (const f of p.keys()) {
            if (!b.has(f)) mismatches.push(`draft only on port: ${f}`);
          }
        }
      }
      check(
        "folding parity: BASE and port harvests agree on ids and drafts, ß/İ/ς alike",
        mismatches.length === 0,
        mismatches.join("\n\n").slice(0, 4000),
      );
      // Round-10 Unicode primitives: every routed pattern, both harvest CLIs
      // on one synthetic dispatch. Vectors: non-ASCII emails, Arabic-Indic
      // digits, ſ, ß, dotted İ, plus an ASCII control per pattern. SK and AR7
      // are joined, never written whole: whole, they would sit in this file,
      // hence in the tool's vocab/tokens, and neutralize their own vectors.
      const SK = "s" + "kib" + "idi";
      const AR7 = "١٢٣٤" + "٥٦٧";
      const AR3 = "١٢" + "٣";
      const O3 = "١٢" + "٣";
      const AB3 = "ab" + "٣";
      const D7 = "123" + "4567";
      const D3 = "78" + "9";
      const ID8 = "1234" + "5678";
      // Q, D3A and the halves below stay split for the same reason as SK and
      // AR7: whole, they would sit in this file, hence in the tool's own
      // vocab/tokens, and neutralize their own vectors. Every break-sensitive
      // fault below is alone in its key group: the group draft shows only the
      // first entry, so a sensitive second entry would be shadowed and dead.
      const Q = "qu" + "ay";
      const D3A = "٣";
      const C12 = "abcdef" + "123456";
      const HXAB = "abcdefab" + "٣";
      const FS = "\x1c";
      const primFaults: Array<[string, string]> = [
        ["scripts/launch.sh", "mailed to ü@internal.example today"],
        ["scripts/launch.sh", "ping admin@exämple.com now"],
        ["scripts/launch.sh", "note user@exämple.com here"],
        ["scripts/launch.sh", "mail qzxvndr@例え.テスト ok"],
        ["scripts/launch.sh", "ask josé@acme-corp.com please"],
        ["scripts/launch.sh", "mail u@example.com ok"],
        ["scripts/launch.sh", `see ${"üP" + "M"}-12 and more`],
        ["scripts/launch.sh", `see ${"xüP" + "M"}-99 here`],
        ["scripts/launch.sh", "see PM-12 here"],
        ["scripts/launch.sh", `again ${"é" + "tf"}-${ID8} broke`],
        ["scripts/launch.sh", `again ${"ß" + "tf"}-${ID8} broke`],
        ["scripts/launch.sh", `again ${"İ" + "tf"}-${ID8} broke`],
        ["scripts/launch.sh", `again tf-${ID8} broke`],
        ["scripts/launch.sh", `still TF-${ID8} broke`],
        ["scripts/launch.sh", `open ${"ßht" + "tp"}://x.com/a now`],
        ["scripts/launch.sh", `open ${"αht" + "tp"}://x.com/a now`],
        ["scripts/launch.sh", `open ß${"http" + "/x"} now`],
        ["scripts/launch.sh", `hash ${"ßabc" + "def1"} done`],
        ["scripts/launch.sh", `hash ${HXAB}! done`],
        ["scripts/launch.sh", `saw ß${C12} here`],
        ["scripts/launch.sh", `read data.${"ß" + "x"} now`],
        ["scripts/launch.sh", `read secret.${"é" + "xt"} now`],
        ["scripts/launch.sh", `read file.${"日" + "本"} now`],
        ["scripts/launch.sh", "read data.txt now"],
        ["scripts/launch.sh", `run \`${AR7}\` now`],
        ["scripts/launch.sh", `call ${AR7} ok`],
        ["scripts/launch.sh", `run \`${D7}\` now`],
        ["scripts/launch.sh", `hail \`${AR3}\` now`],
        ["scripts/launch.sh", `ring ${AR3} ok`],
        ["scripts/launch.sh", `call ${AB3} ok`],
        ["scripts/launch.sh", `see ${D3} here`],
        ["scripts/launch.sh", `ſ${SK.slice(1)} failed`],
        ["scripts/launch.sh", `${SK} failed`],
        ["scripts/launch.sh", `see _${SK} fail`],
        ["scripts/launch.sh", `see ${D3A}${SK} fail`],
        ["scripts/launch.sh", `see ${SK}${D3A}x fail`],
        ["scripts/launch.sh", `see _${Q} fail`],
        ["scripts/launch.sh", `spot ${Q}_ fail`],
        ["scripts/launch.sh", `see é${Q} fail`],
        ["scripts/launch.sh", `see ${Q}é fail`],
        ["scripts/launch.sh", `note ${Q} fails`],
        ["scripts/launch.sh", `see a${FS}b here`],
        ["scripts/launch.sh", `ping ${"ü1" + "0"}.0.0.1 now`],
        ["scripts/launch.sh", `ping ${O3}.${O3}.${O3}.${O3} now`],
        ["scripts/launch.sh", "ping 10.0.0.1 yet"],
      ];
      const primMismatches: string[] = [];
      {
        const S10 = join(tmp, "stub10");
        const S10B = join(tmp, "stub10B");
        for (const s of [S10, S10B]) {
          mkdirSync(s, { recursive: true });
          writeFileSync(
            join(s, "db.json"),
            JSON.stringify({ access: "ADMIN", next: 60, issues: {} }),
          );
        }
        const mkPrim = (sub: string): string => {
          const d = join(tmp, SK, sub);
          mkdirSync(d, { recursive: true });
          writeFileSync(join(d, "manifest.json"), '{"stage": "done", "leg": 3}\n');
          writeFileSync(
            join(d, "run.json"),
            '{"postmaster": {"commit": "abcdef1234567890abcdef1234567890abcdef12"}}\n',
          );
          writeFileSync(
            join(d, "brief.md"),
            "# Waybill: t\n\nPlain ascii waybill words here.\nQuay work happens here.\n",
          );
          writeFileSync(
            join(d, "actions.jsonl"),
            `${primFaults
              .map(([target, failed], i) =>
                JSON.stringify({
                  ts: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`,
                  project: "postmaster",
                  run: "t",
                  actor: "coachman",
                  action: "tool-fault",
                  target,
                  detail: "x",
                  fault: { failed, control: "", workaround: "" },
                }),
              )
              .join("\n")}\n`,
          );
          return d;
        };
        const pB = mkPrim("runsB10");
        const pP = mkPrim("runsP10");
        const bOut = run("bash", [baseTf, "harvest", pB], {
          env: { ...process.env, PATH: `${binB}:${process.env.PATH}`, TOOL_FAULTS_STUB: S10B },
        });
        const pOut = run(join(T2, "scripts", "run"), ["tool-faults", "harvest", pP], {
          env: {
            ...process.env,
            PATH: `${join(tmp, "bin")}:${process.env.PATH}`,
            TOOL_FAULTS_STUB: S10,
          },
        });
        const rid10 = normRid;
        if (bOut.code !== 0 || pOut.code !== 0) {
          primMismatches.push(
            `exits: base ${bOut.code} port ${pOut.code}\nbase: ${bOut.err}\nport: ${pOut.err}`,
          );
        } else if (rid10(bOut.out) !== rid10(pOut.out)) {
          primMismatches.push(
            `harvest output differs:\n--- base\n${rid10(bOut.out)}\n--- port\n${rid10(pOut.out)}`,
          );
        } else {
          const drafts10 = (d: string): Map<string, string> => {
            const m = new Map<string, string>();
            for (const sub of readdirSync(join(d, "tool-faults"))) {
              for (const f of readdirSync(join(d, "tool-faults", sub))) {
                if (f === "tool-faults.json") continue;
                m.set(f, rid10(readFileSync(join(d, "tool-faults", sub, f), "utf-8")));
              }
            }
            return m;
          };
          const b = drafts10(pB);
          const p = drafts10(pP);
          for (const [f, body] of b) b.set(f, note163(body));
          for (const [f, body] of b) {
            if (!p.has(f)) primMismatches.push(`draft only on BASE: ${f}`);
            else if (p.get(f) !== body) primMismatches.push(`draft differs: ${f}`);
          }
          for (const f of p.keys()) {
            if (!b.has(f)) primMismatches.push(`draft only on port: ${f}`);
          }
        }
      }
      check(
        "unicode primitives: BASE and port harvests agree, email/digits/ſßİ alike",
        primMismatches.length === 0,
        primMismatches.join("\n\n").slice(0, 4000),
      );
      // Round-10 pattern parity: every regex above, diffed against BASE's own
      // pattern text (bb782a9 scripts/run tool-faults) on the vectors where
      // Unicode meets the pattern. The port side runs the real consts, so a
      // routed pattern that drifts fails here before any harvest runs.
      // Multi-slash remote tails are absent on purpose: BASE's /*$ and the
      // port's /?$ disagree there, and that P3 rides a card, not this suite.
      runPatternParity(tmp);
      // sameRepo under casefold: the tool copy's own remote is Straße-form,
      // the waybill target's STRASSE-form, so BASE takes the own-repo path
      // (waybill public) and a toLowerCase port takes the foreign one.
      // A foreign remote pair pins the else branch on both. The load-bearing
      // word is joined, never written whole: whole, it would sit in this
      // file, hence in the tool's own vocab, published on both sides.
      {
        const word = "zx" + "qv";
        const T3 = join(tmp, "tool3");
        run("cp", ["-R", T2, T3]);
        run("git", [
          "-C",
          T3,
          "remote",
          "set-url",
          "origin",
          "https://github.com/o/Straße-tool.git",
        ]);
        const mkRepo = (name: string, origin: string): string => {
          const d = join(tmp, name);
          mkdirSync(d, { recursive: true });
          run("git", ["-C", d, "init", "-q"]);
          run("git", ["-C", d, "remote", "add", "origin", origin]);
          return d;
        };
        const ownR = mkRepo("repo-own", "https://github.com/o/STRASSE-tool.git");
        const forR = mkRepo("repo-for", "https://github.com/other/thing.git");
        const S11 = join(tmp, "stub11");
        const S11B = join(tmp, "stub11B");
        for (const s of [S11, S11B]) {
          mkdirSync(s, { recursive: true });
          writeFileSync(
            join(s, "db.json"),
            JSON.stringify({ access: "ADMIN", next: 60, issues: {} }),
          );
        }
        const mkSame = (sub: string, repo: string): string => {
          const d = join(tmp, sub);
          mkdirSync(d, { recursive: true });
          writeFileSync(join(d, "manifest.json"), '{"stage": "done", "leg": 3}\n');
          writeFileSync(join(d, "run.json"), '{"written": "2026-01-01T00:00:00Z", "run": "t"}\n');
          writeFileSync(
            join(d, "brief.md"),
            `## Project profile\nrepo: ${repo}\n\n${word} is load-bearing.\n`,
          );
          writeFileSync(
            join(d, "actions.jsonl"),
            `${JSON.stringify({
              ts: "2026-01-01T00:00:00Z",
              project: "postmaster",
              run: "t",
              actor: "coachman",
              action: "tool-fault",
              target: "scripts/launch.sh",
              detail: "x",
              fault: { failed: `${word} broke the build`, control: "", workaround: "" },
            })}\n`,
          );
          return d;
        };
        const sameMismatches: string[] = [];
        for (const [label, repo] of [
          ["own", ownR],
          ["foreign", forR],
        ] as Array<[string, string]>) {
          const dB = mkSame(`sameB-${label}`, repo);
          const dP = mkSame(`sameP-${label}`, repo);
          const bOut = run("bash", [join(T3, "scripts", "base-tf.sh"), "harvest", dB], {
            env: { ...process.env, PATH: `${binB}:${process.env.PATH}`, TOOL_FAULTS_STUB: S11B },
          });
          const pOut = run(join(T3, "scripts", "run"), ["tool-faults", "harvest", dP], {
            env: {
              ...process.env,
              PATH: `${join(tmp, "bin")}:${process.env.PATH}`,
              TOOL_FAULTS_STUB: S11,
            },
          });
          const norm = normRid;
          if (bOut.code !== 0 || pOut.code !== 0) {
            sameMismatches.push(
              `${label}: exits base ${bOut.code} port ${pOut.code}\nbase: ${bOut.err}\nport: ${pOut.err}`,
            );
          } else {
            if (norm(bOut.out) !== norm(pOut.out)) {
              sameMismatches.push(
                `${label} output differs:\n--- base\n${norm(bOut.out)}\n--- port\n${norm(pOut.out)}`,
              );
            }
            const drafts11 = (d: string): Map<string, string> => {
              const m = new Map<string, string>();
              for (const sub of readdirSync(join(d, "tool-faults"))) {
                for (const f of readdirSync(join(d, "tool-faults", sub))) {
                  if (f === "tool-faults.json") continue;
                  m.set(f, norm(readFileSync(join(d, "tool-faults", sub, f), "utf-8")));
                }
              }
              return m;
            };
            const b = drafts11(dB);
            const p = drafts11(dP);
            for (const [f, body] of b) b.set(f, note163(body));
            for (const [f, body] of b) {
              if (!p.has(f)) sameMismatches.push(`${label} draft only on BASE: ${f}`);
              else if (p.get(f) !== body) {
                sameMismatches.push(
                  `${label} draft differs: ${f}\n--- base\n${body}\n--- port\n${p.get(f)}`,
                );
              }
            }
            for (const f of p.keys()) {
              if (!b.has(f)) sameMismatches.push(`${label} draft only on port: ${f}`);
            }
          }
        }
        check(
          "sameRepo folds remotes as BASE: own-repo waybill public, foreign withheld",
          sameMismatches.length === 0,
          sameMismatches.join("\n\n").slice(0, 4000),
        );
      }
    }
    if (!skipPython) {
      const shown = run("git", [
        "-C",
        TOOL,
        "show",
        "bb782a973e69427c820ce16a676718e87f51995b:scripts/tool-faults.sh",
      ]);
      const baseLines = shown.out.split("\n");
      const ghStart = baseLines.findIndex((l) => l.startsWith("cat > ") && l.includes("<<'GH'"));
      const ghEnd = baseLines.findIndex((l, i) => i > ghStart && l === "GH");
      const mismatches: string[] = [];
      if (shown.code !== 0 || ghStart < 0 || ghEnd < 0) {
        mismatches.push("could not extract BASE's stub gh");
      } else {
        const binS = join(tmp, "binS");
        mkdirSync(binS, { recursive: true });
        writeFileSync(join(binS, "gh"), `${baseLines.slice(ghStart + 1, ghEnd).join("\n")}\n`);
        run("chmod", ["+x", join(binS, "gh")]);
        const mkDb = (dir: string): void => {
          mkdirSync(dir, { recursive: true });
          writeFileSync(
            join(dir, "db.json"),
            JSON.stringify({
              access: "ADMIN",
              next: 80,
              issues: {
                "70": {
                  state: "OPEN",
                  title: "Straße outage",
                  body: "The straße broke",
                  comments: [],
                },
                "71": {
                  state: "OPEN",
                  title: "ςigma alert",
                  body: "on DBΣ",
                  comments: ["σighting"],
                },
                "72": { state: "CLOSED", title: "İllegal state", body: "plain", comments: [] },
                "73": {
                  state: "OPEN",
                  title: "plain ascii",
                  body: "nothing special",
                  comments: [],
                },
              },
            }),
          );
        };
        const sB = join(tmp, "stubB");
        const sP = join(tmp, "stubP");
        mkDb(sB);
        mkDb(sP);
        const hits = (
          gh: string,
          stub: string,
          q: string,
        ): Array<{ number: number; title: string; state: string }> => {
          const r = run(gh, ["search", "issues", q], {
            env: { ...process.env, TOOL_FAULTS_STUB: stub },
          });
          if (r.code !== 0) {
            mismatches.push(`search ${JSON.stringify(q)} exited ${r.code} on ${gh}: ${r.err}`);
            return [];
          }
          const parsed = JSON.parse(r.out) as Array<{
            number: number;
            title: string;
            state: string;
          }>;
          return [...parsed].sort((a, b) => a.number - b.number);
        };
        for (const q of ["strasse", "STRASSE", "σ", "ς", "Σ", "i", "i\u0307", "plain"]) {
          const b = hits(join(binS, "gh"), sB, q);
          const p = hits(join(tmp, "bin", "gh"), sP, q);
          if (JSON.stringify(b) !== JSON.stringify(p)) {
            mismatches.push(
              `query ${JSON.stringify(q)}: base ${JSON.stringify(b)} vs port ${JSON.stringify(p)}`,
            );
          }
        }
      }
      check(
        "the stub tracker search folds as BASE's stub does, ß/İ/ς alike",
        mismatches.length === 0,
        mismatches.join("\n"),
      );
    }
    // The planted-marker search is BASE's `grep -qiF` invocation, marker
    // for marker: the port runs the same binary under the same environment,
    // so the only thing to pin is the wiring, on the vectors where folding
    // would lie (σ held against ς, i held out of İ). Needs no python3.
    {
      const markers = ["Straße", "İ", "ς", "plain", "i"];
      const texts = [
        "STRASSE here",
        "nothing",
        "İ and i",
        "Σ ς σ",
        "PLAIN plain",
        "straße",
        "σ only",
        "İ",
      ];
      const mismatches: string[] = [];
      for (const text of texts) {
        const want = markers.filter(
          (p) => run("grep", ["-qiF", "--", p], { input: text }).code === 0,
        );
        const got = leaks(text, markers);
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          mismatches.push(
            `${JSON.stringify(text)}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`,
          );
        }
      }
      check(
        "the planted-marker search matches grep -qiF marker for marker, ß/İ/ς alike",
        mismatches.length === 0,
        mismatches.join("\n"),
      );
    }
  });
}, 300000);

describe("positive controls", () => {
  test("seven fault lines are five faults: one seen three ways, and two naming different scripts kept apart", () => {
    assertControl(
      "seven fault lines are five faults: one seen three ways, and two naming different scripts kept apart",
    );
  });
  test("a line that is not JSON is left out, and said so; one with a raw line separator is read", () => {
    assertControl(
      "a line that is not JSON is left out, and said so; one with a raw line separator is read",
    );
  });
  test("the harvest logs what it found", () => {
    assertControl("the harvest logs what it found");
  });
  test("a fault no ticket holds is new, and its line names its draft", () => {
    assertControl("a fault no ticket holds is new, and its line names its draft");
  });
  test("only an escalate naming the fault's file counts as its escalation", () => {
    assertControl("only an escalate naming the fault's file counts as its escalation");
  });
  test("each draft is in the ticket shape, with its turnpikes, and passes scripts/ticket-check.sh", () => {
    assertControl(
      "each draft is in the ticket shape, with its turnpikes, and passes scripts/ticket-check.sh",
    );
  });
  test("a draft names the run by its public id, and the postmaster it ran", () => {
    assertControl("a draft names the run by its public id, and the postmaster it ran");
  });
  test("postmaster's own files and words are kept, and what is withheld is marked", () => {
    assertControl("postmaster's own files and words are kept, and what is withheld is marked");
  });
  test("a ticket holding the id in its title or its body is known; one only like it is not; a draft already shown is asked", () => {
    assertControl(
      "a ticket holding the id in its title or its body is known; one only like it is not; a draft already shown is asked",
    );
  });
  test("comment says once, on the ticket that holds it, that it was seen again, and logs it", () => {
    assertControl(
      "comment says once, on the ticket that holds it, that it was seen again, and logs it",
    );
  });
  test("on the user's word that a ticket holds a new fault, comment names it there", () => {
    assertControl("on the user's word that a ticket holds a new fault, comment names it there");
  });
  test("file files the draft as it is, once, and logs the new ticket", () => {
    assertControl("file files the draft as it is, once, and logs the new ticket");
  });
  test("decline records the user's no, and files nothing", () => {
    assertControl("decline records the user's no, and files nothing");
  });
  test("a later harvest reads what was done from the run's log, not its state file", () => {
    assertControl("a later harvest reads what was done from the run's log, not its state file");
  });
  test("in a later run, a fault a comment names on any ticket is known there", () => {
    assertControl("in a later run, a fault a comment names on any ticket is known there");
  });
  test("a comment on a closed ticket says it is closed", () => {
    assertControl("a comment on a closed ticket says it is closed");
  });
  test("the postmaster's own faults: a recurrence after its ticket is filed is a new harvest, and known", () => {
    assertControl(
      "the postmaster's own faults: a recurrence after its ticket is filed is a new harvest, and known",
    );
  });
  test("a draft as the harvest wrote it is filed as written, though a check of the whole would withhold a phrase", () => {
    assertControl(
      "a draft as the harvest wrote it is filed as written, though a check of the whole would withhold a phrase",
    );
  });
  test("a draft's Notes leave the fixture decision to the contract checker, not the wording", () => {
    assertControl(
      "a draft's Notes leave the fixture decision to the contract checker, not the wording",
    );
  });
  test("a changed draft is filed when it is still safe, in a project named with words postmaster uses", () => {
    assertControl(
      "a changed draft is filed when it is still safe, in a project named with words postmaster uses",
    );
  });
  test("a title is cut between words, so a changed draft keeps its paths whole", () => {
    assertControl("a title is cut between words, so a changed draft keeps its paths whole");
  });
  test("a fault keeps the kind of control its line recorded; with none recorded, the list's", () => {
    assertControl(
      "a fault keeps the kind of control its line recorded; with none recorded, the list's",
    );
  });
  test("a fault with a 100,000-character token is harvested in seconds", () => {
    assertControl("a fault with a 100,000-character token is harvested in seconds");
  });
  test("a fault the log no longer gives is refused by name", () => {
    assertControl("a fault the log no longer gives is refused by name");
  });
  test("a ticket created but not put on the board is still filed, and logged", () => {
    assertControl("a ticket created but not put on the board is still filed, and logged");
  });
  test("the leak check finds a planted piece", () => {
    assertControl("the leak check finds a planted piece");
  });
});

describe("negative controls", () => {
  test("no planted name, path, id, word, key, address, code or ticket text reaches a draft, a ticket or a comment", () => {
    assertControl(
      "no planted name, path, id, word, key, address, code or ticket text reaches a draft, a ticket or a comment",
    );
  });
  test("a second comment or file says it is done, and writes nothing", () => {
    assertControl("a second comment or file says it is done, and writes nothing");
  });
  test("a clean log yields no fault and no draft", () => {
    assertControl("a clean log yields no fault and no draft");
  });
  test("a run still open is not harvested", () => {
    assertControl("a run still open is not harvested");
  });
  test("a repository the user does not own is no tracker: the faults are kept", () => {
    assertControl("a repository the user does not own is no tracker: the faults are kept");
  });
  test("and nothing is filed there", () => {
    assertControl("and nothing is filed there");
  });
  test("a copy of postmaster inside the target is no tracker, and withholds the target all the same", () => {
    assertControl(
      "a copy of postmaster inside the target is no tracker, and withholds the target all the same",
    );
  });
  test("a tracker that cannot be searched leaves the fault unchecked, and nothing is filed", () => {
    assertControl(
      "a tracker that cannot be searched leaves the fault unchecked, and nothing is filed",
    );
  });
  test("file refuses a draft changed to carry the target's code", () => {
    assertControl("file refuses a draft changed to carry the target's code");
  });
  test("fault ids are BASE's sha256 over file, newline, key", () => {
    assertControl("fault ids are BASE's sha256 over file, newline, key");
  });
  test("grouping files each entry under its fault id", () => {
    assertControl("grouping files each entry under its fault id");
  });
  test("draft digests are BASE's sha256 over title, NUL, body", () => {
    assertControl("draft digests are BASE's sha256 over title, NUL, body");
  });
  test("casefold folds as Python's str.casefold", () => {
    assertControl("casefold folds as Python's str.casefold");
  });
  test.skipIf(skipPython)(
    "folding parity: BASE and port harvests agree on ids and drafts, \u00df/\u0130/\u03c2 alike",
    () => {
      assertControl(
        "folding parity: BASE and port harvests agree on ids and drafts, \u00df/\u0130/\u03c2 alike",
      );
    },
  );
  test.skipIf(skipPython)(
    "unicode primitives: BASE and port harvests agree, email/digits/\u017f\u00df\u0130 alike",
    () => {
      assertControl(
        "unicode primitives: BASE and port harvests agree, email/digits/\u017f\u00df\u0130 alike",
      );
    },
  );
  test("pattern parity with BASE (128 cases)", () => {
    assertControl("pattern parity with BASE (128 cases)");
  });
  test("sameRepo folds remotes as BASE: own-repo waybill public, foreign withheld", () => {
    assertControl("sameRepo folds remotes as BASE: own-repo waybill public, foreign withheld");
  });
  test.skipIf(skipPython)(
    "the stub tracker search folds as BASE's stub does, \u00df/\u0130/\u03c2 alike",
    () => {
      assertControl(
        "the stub tracker search folds as BASE's stub does, \u00df/\u0130/\u03c2 alike",
      );
    },
  );
  test.skipIf(skipPython)(
    "the planted-marker search matches grep -qiF marker for marker, \u00df/\u0130/\u03c2 alike",
    () => {
      assertControl(
        "the planted-marker search matches grep -qiF marker for marker, \u00df/\u0130/\u03c2 alike",
      );
    },
  );
});
