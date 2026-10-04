import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readWalls } from "./walls.ts";
import { run, withTempDir } from "./lib/proc.ts";

const WALLS = join(import.meta.dir, "walls.sh");
const LOG = join(import.meta.dir, "log-action.sh");
const HOST = join(import.meta.dir, "host.sh");

function fixture(root: string): { repo: string; dispatch: string } {
  const repo = join(root, "repo");
  const dispatch = join(repo, ".postmaster", "runs", "T");
  mkdirSync(join(dispatch, "logs"), { recursive: true });
  writeFileSync(
    join(dispatch, "run.json"),
    JSON.stringify({ config: { team: { workhorses: ["stub", "mimo"] } } }) + "\n",
  );
  writeFileSync(join(dispatch, "brief.md"), `# Waybill: T\n\n## Project profile\nrepo: ${repo}\n`);
  chmodSync(WALLS, 0o755);
  chmodSync(LOG, 0o755);
  return { repo, dispatch };
}

function addWall(
  dispatch: string,
  lane: string,
  message: string,
  reset: string,
  role: "workhorse" | "reviewer" = "workhorse",
  lens = "",
  round = "",
): void {
  const args = [
    dispatch,
    `lane:${lane}`,
    "wall",
    lane,
    "--role",
    role,
    "--message",
    message,
    "--reset",
    reset,
  ];
  if (role === "reviewer") args.push("--lens", lens, "--round", round);
  const result = run(LOG, args);
  if (result.code !== 0) throw new Error(result.err || result.out);
}

describe("provider wall records", () => {
  test("wall actions hold exact messages, reset times, roles, and repeated reviewer rounds", () => {
    withTempDir((root) => {
      const { dispatch } = fixture(root);
      const message = "You've hit your weekly limit · resets 3am (UTC)";
      addWall(dispatch, "sec", message, "2026-10-02T03:00:00.000Z", "reviewer", "security", "1");
      addWall(dispatch, "sec", message, "2026-10-02T03:00:00.000Z", "reviewer", "security", "2");
      const walls = readWalls(dispatch);
      expect(walls).toHaveLength(2);
      expect(walls[0]?.lane).toBe("sec");
      expect(walls[0]?.role).toBe("reviewer");
      expect(walls[0]?.lens).toBe("security");
      expect(walls[0]?.round).toBe(1);
      expect(walls[0]?.sequence).toBe(1);
      expect(walls[0]?.message).toBe(message);
      expect(walls[1]?.lane).toBe("sec");
      expect(walls[1]?.role).toBe("reviewer");
      expect(walls[1]?.lens).toBe("security");
      expect(walls[1]?.round).toBe(2);
      expect(walls[1]?.sequence).toBe(2);
      const stored = JSON.parse(
        readFileSync(join(dispatch, "actions.jsonl"), "utf8").split("\n")[0]!,
      ) as {
        wall: { message: string; reset: string };
      };
      expect(stored.wall.message).toBe(message);
      expect(stored.wall.reset).toBe("2026-10-02T03:00:00.000Z");
    });
  });

  test("show prints each run wall with its reset date in the machine zone", () => {
    withTempDir((root) => {
      const { dispatch } = fixture(root);
      addWall(dispatch, "stub", "usage limit reached", "2026-10-02T02:29:00.000Z");
      const utc = run(WALLS, ["show", dispatch], { env: { TZ: "UTC" } });
      const pacific = run(WALLS, ["show", dispatch], { env: { TZ: "America/Los_Angeles" } });
      expect(utc.code).toBe(0);
      expect(utc.out).toContain(
        'T · wall 1 · stub: DEGRADED, provider wall: "usage limit reached"',
      );
      expect(utc.out).toContain("Oct 2, 2026, 2:29 AM (UTC)");
      expect(pacific.out).toContain("Oct 1, 2026, 7:29 PM (America/Los_Angeles)");
    });
  });

  test("show names a reviewer lane, lens, degraded state, message and reset", () => {
    withTempDir((root) => {
      const { dispatch } = fixture(root);
      addWall(
        dispatch,
        "sec",
        "You've hit the weekly limit",
        "2026-10-05T03:00:00.000Z",
        "reviewer",
        "security",
        "2",
      );
      const shown = run(WALLS, ["show", dispatch], { env: { TZ: "UTC" } });
      expect(shown.out).toContain(
        'T · wall 1 · sec security: DEGRADED, provider wall: "You\'ve hit the weekly limit"',
      );
      expect(shown.out).toContain("role reviewer");
      expect(shown.out).toContain("Oct 5, 2026, 3:00 AM (UTC)");
    });
  });

  test("told removes a wall from the next notice and open waits for every ruling", () => {
    withTempDir((root) => {
      const { dispatch } = fixture(root);
      addWall(dispatch, "stub", "quota reached", "none");
      const notice = run(WALLS, ["show", dispatch, "--untold"]);
      expect(notice.out).toContain("untold");
      const beforeNotice = run(WALLS, ["rule", dispatch, "stub", "go-on"]);
      expect(beforeNotice.code).toBe(2);
      expect(beforeNotice.err).toContain("user has not been told");
      expect(readWalls(dispatch)[0]?.ruling).toBe("");
      expect(run(WALLS, ["told", dispatch, "stub"]).code).toBe(0);
      expect(run(WALLS, ["show", dispatch, "--untold"]).out).toContain("no provider walls to tell");
      expect(run(WALLS, ["open", dispatch]).code).toBe(1);
      for (const ruling of ["rest", "reset-now", "substitute"]) {
        const refused = run(WALLS, ["rule", dispatch, "stub", ruling]);
        expect(refused.code).toBe(2);
        expect(refused.err).toContain("this ticket allows only go-on");
        expect(readWalls(dispatch)[0]?.ruling).toBe("");
      }
      expect(run(WALLS, ["rule", dispatch, "stub", "go-on"]).code).toBe(0);
      expect(run(WALLS, ["open", dispatch]).code).toBe(0);
      expect(readWalls(dispatch)[0]?.ruling).toBe("go-on");
    });
  });

  test("a question already waiting stays beside the wall in the host waiting list", () => {
    withTempDir((root) => {
      const { repo, dispatch } = fixture(root);
      const question = join(dispatch, ".waiting-on-user");
      writeFileSync(
        question,
        "Earlier question: keep the branch?\n\nProvider wall: go on for stub?\n",
      );
      const runs = join(repo, ".postmaster", "runs");
      const env = {
        HOME: join(root, "home"),
        POSTMASTER_HOST: "none",
        POSTMASTER_HOST_STATE: join(root, "host-state"),
      };
      expect(run(HOST, ["leg", "waiting", "add", runs, "T", question], { env }).code).toBe(0);
      const listed = run(HOST, ["leg", "waiting", "list", runs], { env });
      expect(listed.code).toBe(0);
      expect(listed.out).toContain("Earlier question: keep the branch?");
      expect(listed.out).toContain("Provider wall: go on for stub?");
    });
  });

  test("go-on preserves the last workhorse that may still produce work", () => {
    withTempDir((root) => {
      const { dispatch } = fixture(root);
      writeFileSync(join(dispatch, "logs", "stub.done"), "");
      writeFileSync(join(dispatch, "logs", "mimo.done"), "");
      addWall(dispatch, "stub", "stub limit", "none");
      addWall(dispatch, "mimo", "mimo limit", "none");
      expect(run(WALLS, ["told", dispatch, "stub"]).code).toBe(0);
      expect(run(WALLS, ["told", dispatch, "mimo"]).code).toBe(0);
      expect(run(WALLS, ["rule", dispatch, "stub", "go-on"]).code).toBe(0);
      const refused = run(WALLS, ["rule", dispatch, "mimo", "go-on"]);
      expect(refused.code).toBe(2);
      expect(refused.err).toContain("no other workhorse can still produce work");
      expect(readWalls(dispatch).find((wall) => wall.lane === "mimo")?.ruling).toBe("");
    });
  });

  test("a workhorse with a blocked result cannot keep a go-on ruling viable", () => {
    withTempDir((root) => {
      const { repo, dispatch } = fixture(root);
      mkdirSync(join(repo, ".worktrees", "T-mimo"), { recursive: true });
      writeFileSync(join(repo, ".worktrees", "T-mimo", "WORKHORSE-BLOCKED.md"), "blocked\n");
      addWall(dispatch, "stub", "stub limit", "none");
      expect(run(WALLS, ["told", dispatch, "stub"]).code).toBe(0);
      const refused = run(WALLS, ["rule", dispatch, "stub", "go-on"]);
      expect(refused.code).toBe(2);
      expect(refused.err).toContain("no other workhorse can still produce work");
      expect(readWalls(dispatch)[0]?.ruling).toBe("");
    });
  });

  test("carry is recorded once and escalation asks for go-on before synthesis", () => {
    withTempDir((root) => {
      const { dispatch } = fixture(root);
      addWall(dispatch, "stub", "usage limit reached", "none");
      expect(run(WALLS, ["escalate", dispatch]).code).toBe(0);
      expect(existsSync(join(dispatch, ".escalation-ready"))).toBe(true);
      const question = readFileSync(join(dispatch, "ESCALATION.md"), "utf8");
      expect(question).toContain("stub (workhorse)");
      expect(question).toContain("usage limit reached");
      expect(question).toContain("Reset: no reset time");
      expect(question).toContain("Ruling: go-on");
      expect(run(WALLS, ["told", dispatch, "stub"]).code).toBe(0);
      expect(run(WALLS, ["rule", dispatch, "stub", "go-on"]).code).toBe(0);
      expect(run(WALLS, ["carry", dispatch, "stub"]).code).toBe(0);
      expect(run(WALLS, ["carry", dispatch, "stub"]).code).toBe(0);
      expect(readWalls(dispatch)[0]?.carried).toBe(true);
      const carried = JSON.parse(
        readFileSync(join(dispatch, "actions.jsonl"), "utf8").trim().split("\n").at(-1)!,
      ) as Record<string, unknown>;
      expect(carried.action).toBe("carry");
    });
  });

  test("a ruling recorded before the pause is carried without escalation", () => {
    withTempDir((root) => {
      const { dispatch } = fixture(root);
      addWall(dispatch, "stub", "usage limit reached", "none");
      expect(run(WALLS, ["told", dispatch, "stub"]).code).toBe(0);
      expect(run(WALLS, ["rule", dispatch, "stub", "go-on"]).code).toBe(0);
      expect(run(WALLS, ["open", dispatch]).code).toBe(0);
      expect(run(WALLS, ["carry", dispatch, "stub"]).code).toBe(0);
      expect(existsSync(join(dispatch, ".provider-walls-paused"))).toBe(false);
      expect(readWalls(dispatch)[0]?.carried).toBe(true);
      expect(readFileSync(join(dispatch, "run-log.md"), "utf8")).toContain(
        'stub: DEGRADED, provider wall: "usage limit reached"',
      );
    });
  });
});
