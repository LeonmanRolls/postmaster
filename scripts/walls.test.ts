// Tests beside scripts/walls.ts: the reset forms providers have used (D4, D5), the wall
// lines' read-back in file order, and the one command surface's lines and exits (C2,
// C13-C21). The machine-zone forms run in a child with TZ pinned, so the clock the tests
// set is the only variable.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./lib/proc.ts";
import { readWalls } from "./walls.ts";

const self = join(import.meta.dir, "walls.sh");
const HERE = import.meta.dir;

let tmp = "";
let parseTs = "";

const CODEX_MSG =
  "You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 2:29 AM.";
const CLAUDE_MSG = "You've hit your weekly limit · resets 3am (UTC)";

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "postmaster-walls-"));
  parseTs = join(tmp, "parse.ts");
  writeFileSync(
    parseTs,
    `import { parseWallReset } from ${JSON.stringify(join(HERE, "lib", "wall.ts"))};\nconst v = parseWallReset(process.argv[2] ?? "", Number(process.argv[3]));\nconsole.log(v === null ? "none" : v);\n`,
  );
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** parseWallReset in a child on a pinned zone: the machine zone is never the test's variable. */
function parseIn(msg: string, nowMs: number, tz = "UTC"): string {
  const r = run("bun", [parseTs, msg, String(nowMs)], { env: { ...process.env, TZ: tz } });
  expect(r.code).toBe(0);
  return r.out.trim();
}

describe("the reset, in the shapes providers have used", () => {
  const NOW = Date.parse("2026-10-05T00:30:00Z");

  test("a bare time is 02:29 that day while it is ahead", () => {
    expect(parseIn("try again at 2:29 AM.", NOW)).toBe("2026-10-05T02:29:00Z");
  });

  test("a bare time more than five minutes past is the next day (D4)", () => {
    expect(parseIn("try again at 2:29 AM.", Date.parse("2026-10-05T03:00:00Z"))).toBe(
      "2026-10-06T02:29:00Z",
    );
  });

  test("a bare time five minutes past or less counts as passed, not tomorrow", () => {
    expect(parseIn("try again at 2:29 AM.", Date.parse("2026-10-05T02:31:00Z"))).toBe(
      "2026-10-05T02:29:00Z",
    );
  });

  test("a time with (UTC) is 03:00 UTC, today or tomorrow by the same rule", () => {
    expect(parseIn("You've hit your weekly limit · resets 3am (UTC)", NOW)).toBe(
      "2026-10-05T03:00:00Z",
    );
    expect(parseIn("resets 3am (UTC)", Date.parse("2026-10-05T04:00:00Z"))).toBe(
      "2026-10-06T03:00:00Z",
    );
  });

  test("a time with an IANA zone is read in that zone", () => {
    expect(parseIn("resets 3am (America/New_York)", NOW)).toBe("2026-10-05T07:00:00Z");
  });

  test("Oct 5th, 2026 2:29 AM and Oct 5, 2026 2:29 AM read as written", () => {
    expect(parseIn("try again Oct 5th, 2026 2:29 AM.", NOW)).toBe("2026-10-05T02:29:00Z");
    expect(parseIn("try again Oct 5, 2026 2:29 AM.", NOW)).toBe("2026-10-05T02:29:00Z");
  });

  test("in 20 minutes counts from the stop", () => {
    expect(parseIn("try again in 20 minutes", NOW)).toBe("2026-10-05T00:50:00Z");
    expect(parseIn("try again in 2 hours", NOW)).toBe("2026-10-05T02:30:00Z");
  });

  test("of two times the later counts", () => {
    expect(parseIn("try again at 2:29 AM or 3:15 AM", NOW)).toBe("2026-10-05T03:15:00Z");
    expect(parseIn("resets 3am (UTC), or at 9:00 AM", NOW)).toBe("2026-10-05T09:00:00Z");
  });

  test("no time, or an abbreviation zone, means no reset time (D5)", () => {
    expect(parseIn("You have been throttled. Slow down.", NOW)).toBe("none");
    expect(parseIn("resets 3am (PST)", NOW)).toBe("none");
    expect(parseIn("resets at noon", NOW)).toBe("none");
  });

  test("the codex wall's own message gives its 2:29 AM in the machine's zone", () => {
    expect(parseIn(CODEX_MSG, NOW)).toBe("2026-10-05T02:29:00Z");
  });

  test("the claude wall's own message gives 3am UTC", () => {
    expect(parseIn(CLAUDE_MSG, NOW)).toBe("2026-10-05T03:00:00Z");
  });
});

describe("the wall lines, read back in file order", () => {
  function dispatch(name: string): string {
    const d = join(tmp, name);
    mkdirSync(d, { recursive: true });
    return d;
  }
  function line(action: string, target: string, detail: string, actor = "postmaster"): string {
    return `${JSON.stringify({
      ts: "2026-10-05T00:00:00Z",
      project: "p",
      run: "T",
      actor,
      action,
      target,
      detail,
    })}\n`;
  }
  const WALL = (lane: string, extra = ""): string =>
    line("wall", lane, `workhorse - - none a wall message ${extra}`, `lane:${lane}`);

  test("a told and a ruling before a wall never cover the wall after them (C21)", () => {
    const d = dispatch("order");
    writeFileSync(
      join(d, "actions.jsonl"),
      WALL("sec") +
        line("told", "sec", "workhorse - -") +
        line("rule", "sec", "wall go-on") +
        WALL("sec", "again"),
    );
    const walls = readWalls(d);
    expect(walls.length).toBe(2);
    expect(walls[0]!.told).toBe(true);
    expect(walls[0]!.ruled).toBe(true);
    expect(walls[1]!.told).toBe(false);
    expect(walls[1]!.ruled).toBe(false);
  });

  test("a divergence rule does not rule a wall", () => {
    const d = dispatch("divergence");
    writeFileSync(
      join(d, "actions.jsonl"),
      WALL("stub") + line("rule", "stub", "naming: short over long", "coachman"),
    );
    expect(readWalls(d)[0]!.ruled).toBe(false);
  });

  test("the carry-out is read from the lines after the wall", () => {
    const d = dispatch("carry");
    writeFileSync(
      join(d, "actions.jsonl"),
      WALL("stub") +
        line("rule", "stub", "wall go-on") +
        line("carry", "stub", "wall go-on", "coachman"),
    );
    const w = readWalls(d)[0]!;
    expect(w.ruled).toBe(true);
    expect(w.carried).toBe(true);
  });

  test("a malformed wall line still reads as a wall with no state", () => {
    const d = dispatch("malformed");
    writeFileSync(join(d, "actions.jsonl"), line("wall", "x", "broken", "lane:x"));
    const w = readWalls(d)[0]!;
    expect(w.role).toBe("workhorse");
    expect(w.told).toBe(false);
    expect(w.ruled).toBe(false);
  });
});

describe("walls.sh show: the line the cards print", () => {
  let d = "";
  beforeAll(() => {
    d = join(tmp, "show-run");
    mkdirSync(d, { recursive: true });
    writeFileSync(
      join(d, "actions.jsonl"),
      JSON.stringify({
        ts: "2026-10-05T00:00:00Z",
        project: "p",
        run: "show-run",
        actor: "lane:stub",
        action: "wall",
        target: "stub",
        detail: `workhorse - - 2026-10-05T02:29:00Z ${CODEX_MSG}`,
      }) +
        "\n" +
        JSON.stringify({
          ts: "2026-10-05T00:00:01Z",
          project: "p",
          run: "show-run",
          actor: "lane:sec",
          action: "wall",
          target: "sec",
          detail: `reviewer security 1 none ${CLAUDE_MSG}`,
        }) +
        "\n",
    );
  });

  test("the run, the lane, the role, the message and the reset with its date", () => {
    const r = run(self, ["show", d], { env: { ...process.env, TZ: "UTC" } });
    expect(r.code).toBe(0);
    const lines = r.out.trim().split("\n");
    expect(lines[0]).toContain(`show-run stub: DEGRADED, provider wall: "${CODEX_MSG}"`);
    expect(lines[0]).toContain("workhorse");
    expect(lines[0]).toContain("resets 2026-10-05T02:29:00+00:00");
    expect(lines[1]).toContain(`show-run sec security: DEGRADED, provider wall: "${CLAUDE_MSG}"`);
    expect(lines[1]).toContain("reviewer round 1");
    expect(lines[1]).toContain("no reset time");
  });

  test("with TZ set to two zones, each shows its own local date (C6)", () => {
    const utc = run(self, ["show", d], { env: { ...process.env, TZ: "UTC" } });
    const ny = run(self, ["show", d], { env: { ...process.env, TZ: "America/New_York" } });
    expect(utc.out).toContain("2026-10-05T02:29:00+00:00");
    expect(ny.out).toContain("2026-10-04T22:29:00-04:00");
    expect(ny.out).not.toContain("2026-10-05T02:29:00-04:00");
  });
});

describe("walls.sh open: the pause gate", () => {
  let d = "";
  const write = (body: string): void => writeFileSync(join(d, "actions.jsonl"), body);
  const wall = (lane: string): string =>
    `${JSON.stringify({ ts: "2026-10-05T00:00:00Z", actor: `lane:${lane}`, action: "wall", target: lane, detail: "workhorse - - none stuck" })}\n`;

  beforeAll(() => {
    d = join(tmp, "open-run");
    mkdirSync(d, { recursive: true });
  });

  test("no walls: exit 0", () => {
    write("");
    const r = run(self, ["open", d]);
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
  });

  test("a wall with no ruling: exit 1, listed, naming the lane and the message", () => {
    write(wall("stub"));
    const r = run(self, ["open", d]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('stub: no ruling: "stuck"');
  });

  test("every wall ruled: exit 0 (C14)", () => {
    write(wall("stub") + line2("rule", "stub", "wall go-on"));
    const r = run(self, ["open", d]);
    expect(r.code).toBe(0);
  });

  function line2(action: string, target: string, detail: string, actor = "postmaster"): string {
    return `${JSON.stringify({ ts: "2026-10-05T00:00:02Z", actor, action, target, detail })}\n`;
  }
});

describe("walls.sh rule: the one ruling, and what it refuses", () => {
  let d = "";
  const wallLine = (lane: string): string =>
    `${JSON.stringify({ ts: "2026-10-05T00:00:00Z", actor: `lane:${lane}`, action: "wall", target: lane, detail: "workhorse - - none stuck" })}\n`;
  const actions = (): string => {
    try {
      return readFileSync(join(d, "actions.jsonl"), "utf8");
    } catch {
      return "";
    }
  };
  const ruleLines = (): string[] =>
    actions()
      .split("\n")
      .filter((l) => l.includes('"action":"rule"'));

  function fresh(name: string, workhorses: string[]): void {
    d = join(tmp, name);
    mkdirSync(join(d, "logs"), { recursive: true });
    writeFileSync(join(d, "run.json"), `${JSON.stringify({ config: { team: { workhorses } } })}\n`);
    writeFileSync(
      join(d, "brief.md"),
      `# Waybill: T\n\n## Project profile\nrepo: ${join(tmp, "proj")}\n\n## Dispatch\nsynthesis worktree: ${join(tmp, "proj", ".worktrees", "T")}\n`,
    );
  }

  test("go-on on a reviewer wall is accepted and recorded (C15)", () => {
    fresh("rule-reviewer", ["stub", "mimo"]);
    writeFileSync(join(d, "actions.jsonl"), wallLine("sec"));
    const r = run(self, ["rule", d, "sec", "go-on"]);
    expect(r.code).toBe(0);
    expect(ruleLines().length).toBe(1);
    expect(ruleLines()[0]).toContain('"target":"sec"');
    expect(ruleLines()[0]).toContain("wall go-on");
  });

  test("rest, reset-now and substitute exit 2 and record nothing (C18)", () => {
    fresh("rule-refused", ["stub", "mimo"]);
    writeFileSync(join(d, "actions.jsonl"), wallLine("stub"));
    for (const ruling of ["rest", "reset-now", "substitute"]) {
      const before = actions();
      const r = run(self, ["rule", d, "stub", ruling]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("separate ticket");
      expect(actions()).toBe(before);
    }
    expect(ruleLines().length).toBe(0);
  });

  test("go-on on a workhorse while another is walled open is accepted; the last one is refused (C19)", () => {
    fresh("rule-last", ["stub", "mimo"]);
    writeFileSync(join(d, "actions.jsonl"), wallLine("stub") + wallLine("mimo"));
    const first = run(self, ["rule", d, "stub", "go-on"]);
    expect(first.code).toBe(0);
    expect(ruleLines().length).toBe(1);
    const before = actions();
    const second = run(self, ["rule", d, "mimo", "go-on"]);
    expect(second.code).toBe(2);
    expect(second.err).toContain(
      "no other workhorse is running, has a summary, or is walled with no ruling",
    );
    expect(actions()).toBe(before);
  });

  test("go-on is accepted while another workhorse still runs", () => {
    fresh("rule-running", ["stub", "mimo"]);
    writeFileSync(join(d, "actions.jsonl"), wallLine("stub"));
    writeFileSync(join(d, "logs", "mimo-events.jsonl"), ""); // launched, marker not landed
    const r = run(self, ["rule", d, "stub", "go-on"]);
    expect(r.code).toBe(0);
  });

  test("go-on is accepted when another workhorse has its summary", () => {
    fresh("rule-summary", ["stub", "mimo"]);
    writeFileSync(join(d, "actions.jsonl"), wallLine("stub"));
    const wt = join(tmp, "proj", ".worktrees", "rule-summary-mimo");
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(wt, "WORKHORSE-SUMMARY.md"), "done\n");
    const r = run(self, ["rule", d, "stub", "go-on"]);
    expect(r.code).toBe(0);
  });

  test("a ruling after the carry-out is refused (C20)", () => {
    fresh("rule-after-carry", ["stub", "mimo"]);
    writeFileSync(join(d, "actions.jsonl"), wallLine("stub") + wallLine("mimo"));
    expect(run(self, ["rule", d, "stub", "go-on"]).code).toBe(0);
    expect(run(self, ["carry", d, "stub"]).code).toBe(0);
    const before = actions();
    const r = run(self, ["rule", d, "stub", "go-on"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("carried out");
    expect(actions()).toBe(before);
  });

  test("a ruling for a lane with no wall is usage (exit 1), and an unknown ruling too", () => {
    fresh("rule-usage", ["stub"]);
    writeFileSync(join(d, "actions.jsonl"), wallLine("stub"));
    expect(run(self, ["rule", d, "other", "go-on"]).code).toBe(1);
    expect(run(self, ["rule", d, "stub", "carry-on"]).code).toBe(1);
  });
});

describe("walls.sh told, escalate and carry", () => {
  let d = "";
  const wallLine = (lane: string, reset = "none", msg = "stuck"): string =>
    `${JSON.stringify({ ts: "2026-10-05T00:00:00Z", actor: `lane:${lane}`, action: "wall", target: lane, detail: `workhorse - - ${reset} ${msg}` })}\n`;
  const count = (action: string): number =>
    readFileSync(join(d, "actions.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.includes(`"action":"${action}"`)).length;

  beforeAll(() => {
    d = join(tmp, "told-run");
    mkdirSync(join(d, "logs"), { recursive: true });
    writeFileSync(
      join(d, "run.json"),
      `${JSON.stringify({ config: { team: { workhorses: ["stub", "mimo"] } } })}\n`,
    );
    writeFileSync(
      join(d, "brief.md"),
      `# Waybill: T\n\n## Project profile\nrepo: ${join(tmp, "proj")}\n`,
    );
  });

  test("told marks every untold wall of the lane once, and again for a new wall (C5, C21)", () => {
    writeFileSync(join(d, "actions.jsonl"), wallLine("stub") + wallLine("mimo"));
    expect(run(self, ["told", d, "stub"]).code).toBe(0);
    expect(count("told")).toBe(1);
    expect(run(self, ["told", d, "stub"]).code).toBe(0);
    expect(count("told")).toBe(1); // never told twice
    writeFileSync(join(d, "actions.jsonl"), wallLine("stub") + wallLine("mimo") + wallLine("stub"));
    expect(run(self, ["told", d, "stub"]).code).toBe(0);
    expect(count("told")).toBe(2); // the new wall is told
  });

  test("escalate writes the escalation, its markers and the line (C13)", () => {
    writeFileSync(join(d, "actions.jsonl"), wallLine("stub", "2026-10-05T02:29:00Z", CODEX_MSG));
    const r = run(self, ["escalate", d]);
    expect(r.code).toBe(0);
    const esc = readFileSync(join(d, "ESCALATION.md"), "utf8");
    expect(esc).toContain("## stub (workhorse)");
    expect(esc).toContain(`Provider message: ${CODEX_MSG}`);
    expect(esc).toContain("Reset: 2026-10-05T02:29:00Z");
    expect(esc).toContain("go on");
    expect(existsSync(join(d, ".escalation-ready"))).toBe(true);
    expect(existsSync(join(d, ".wall-pause"))).toBe(true);
    expect(count("escalate")).toBe(1);
  });

  test("escalate with no open wall is refused (exit 1)", () => {
    writeFileSync(
      join(d, "actions.jsonl"),
      wallLine("stub") +
        `${JSON.stringify({ ts: "2026-10-05T00:00:01Z", actor: "postmaster", action: "rule", target: "stub", detail: "wall go-on" })}\n`,
    );
    const r = run(self, ["escalate", d]);
    expect(r.code).toBe(1);
  });

  test("escalate's escalation says no reset time when the message gives none", () => {
    writeFileSync(join(d, "actions.jsonl"), wallLine("mimo", "none", "no time at all"));
    expect(run(self, ["escalate", d]).code).toBe(0);
    const esc = readFileSync(join(d, "ESCALATION.md"), "utf8");
    expect(esc).toContain("Reset: no reset time");
  });

  test("carry records each go-on once, and refuses one that is unruled (C16, C20)", () => {
    writeFileSync(join(d, "actions.jsonl"), wallLine("stub"));
    expect(run(self, ["carry", d, "stub"]).code).toBe(2); // no ruling to carry
    writeFileSync(
      join(d, "actions.jsonl"),
      wallLine("stub") +
        `${JSON.stringify({ ts: "2026-10-05T00:00:01Z", actor: "postmaster", action: "rule", target: "stub", detail: "wall go-on" })}\n`,
    );
    expect(run(self, ["carry", d, "stub"]).code).toBe(0);
    expect(count("carry")).toBe(1);
    expect(run(self, ["carry", d, "stub"]).code).toBe(0);
    expect(count("carry")).toBe(1);
    expect(run(self, ["carry", d, "nobody"]).code).toBe(1);
  });
});

describe("usage", () => {
  test("every command checks its shape", () => {
    expect(run(self, []).code).toBe(1);
    expect(run(self, ["show"]).code).toBe(1);
    expect(run(self, ["show", join(tmp, "no-such-dispatch")]).code).toBe(1);
    expect(run(self, ["carry", join(tmp)]).code).toBe(1);
    expect(run(self, ["rule", join(tmp), "lane"]).code).toBe(1);
    expect(run(self, ["nonsense", join(tmp)]).code).toBe(1);
  });
});
