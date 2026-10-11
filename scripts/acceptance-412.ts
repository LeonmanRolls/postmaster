// Oracle helpers for #412: the stub-host layout the ticket's checks judge, with
// the builders and readers the cases need. The cases in acceptance-412.test.ts
// run the ticket's own interface (run clerk start, run host spawn/send/read,
// run ticket-ready mark) with stub herdr first on PATH, and a clerk role with
// an env file so the spawn takes the shell path, as the real clerk does.
// Covered: C1-C4. Not covered: C5 (the fixture run, scored at landing).
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { type Fx, readHerdr, SELF, sh, TWO_PART } from "./acceptance-373.ts";

export function clerkEnvConfig(fx: Fx): string {
  const lane = join(fx.root, "lane.env");
  writeFileSync(lane, "CLERK_ORACLE=1\n");
  const cfg = join(fx.root, "config.toml");
  writeFileSync(
    cfg,
    [
      "[lanes.one]",
      'harness = "claude"',
      'model = "lane-model"',
      "",
      "[team]",
      `clerk = { harness = "claude", model = "clerk-model", env_file = "${lane}" }`,
      "",
    ].join("\n"),
  );
  return cfg;
}

export function clerkSession(repo: string, id: string): { ticket: string; handle: string } | null {
  try {
    return JSON.parse(
      readFileSync(
        join(repo, ".postmaster", "runs", "postmaster", "clerks", `${encodeURIComponent(id)}.json`),
        "utf8",
      ),
    ) as { ticket: string; handle: string };
  } catch {
    return null;
  }
}

export function placementFor(fx: Fx, handle: string): { tab: string; pane: string } {
  const dir = join(fx.state, "placements");
  for (const file of readdirSync(dir)) {
    const entry = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
      handle?: unknown;
      tab?: unknown;
      pane?: unknown;
    };
    if (entry.handle === handle) return { tab: String(entry.tab), pane: String(entry.pane) };
  }
  throw new Error(`no placement for ${handle}`);
}

export function promptEntries(fx: Fx): string[][] {
  return readHerdr(fx).prompt as string[][];
}

export function promptText(repo: string, id: string): string {
  return readFileSync(
    join(repo, ".postmaster", "clerk", `${encodeURIComponent(id)}.prompt.md`),
    "utf8",
  );
}

// Split a printed command the way a shell splits it: single and double
// quotes group, a backslash escapes the next character, whitespace separates.
export function splitShell(line: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote = "";
  let escaped = false;
  let open = false;
  for (const ch of line) {
    if (escaped) {
      word += ch;
      escaped = false;
      open = true;
    } else if (ch === "\\" && quote !== "'") {
      escaped = true;
    } else if ((ch === "'" || ch === '"') && !quote) {
      quote = ch;
      open = true;
    } else if (ch === quote) {
      quote = "";
    } else if (!quote && (ch === " " || ch === "\t")) {
      if (open) {
        words.push(word);
        word = "";
        open = false;
      }
    } else {
      word += ch;
      open = true;
    }
  }
  if (escaped) word += "\\";
  if (open) words.push(word);
  return words;
}

export async function waitFor(done: () => boolean, secs: number): Promise<boolean> {
  const end = Date.now() + secs * 1000;
  for (;;) {
    if (done()) return true;
    if (Date.now() >= end) return false;
    await Bun.sleep(250);
  }
}

// A session as the base leaves one: spawned through the shell path with no
// agent able to show while the spawn names, its agent showing afterwards,
// never named. The unnamed premise holds by construction, not by a sleep
// winning a race, and both halves are asserted below.
export async function legacySession(
  fx: Fx,
  repo: string,
  id: string,
  env: Record<string, string>,
): Promise<{ handle: string; tab: string; pane: string }> {
  const handle = `clerk-${basename(repo)}-${id}-legacy`;
  writeFileSync(join(fx.stub, "agent.never"), "");
  const spawned = sh(
    SELF,
    ["host", "spawn", handle, repo, "--label", `#${id}, legacy`, "--", "bash", "-c", "exit 0"],
    env,
    fx.root,
  );
  rmSync(join(fx.stub, "agent.never"), { force: true });
  if (spawned.code !== 0) throw new Error(`spawn: ${spawned.err}`);
  const placed = placementFor(fx, handle);
  const shown = await waitFor(
    () => sh("herdr", ["agent", "get", placed.pane], env, fx.root).code === 0,
    15,
  );
  if (!shown) throw new Error(`agent never showed in ${placed.pane}`);
  if (sh("herdr", ["agent", "get", handle], env, fx.root).code === 0)
    throw new Error(`${handle} was named; the legacy premise needs it unnamed`);
  mkdirSync(join(repo, ".postmaster", "runs", "postmaster", "clerks"), { recursive: true });
  writeFileSync(
    join(repo, ".postmaster", "runs", "postmaster", "clerks", `${encodeURIComponent(id)}.json`),
    `${JSON.stringify({
      ticket: `#${id}, legacy`,
      brief: join(repo, ".postmaster", "clerk", `${id}.brief.md`),
      handle,
      opened: new Date().toISOString(),
    })}\n`,
  );
  return { handle, ...placed };
}

export function markReady(fx: Fx, repo: string, id: string, env: Record<string, string>): void {
  const final = join(fx.root, "final.md");
  writeFileSync(final, TWO_PART);
  const marked = sh(
    SELF,
    ["ticket-ready", "mark", repo, id, "--body", final, "--title", "Sorted list"],
    env,
    fx.root,
  );
  if (marked.code !== 0) throw new Error(`mark: ${marked.err}`);
  if (!marked.out.includes("closes when its turn ends"))
    throw new Error(`mark armed nothing: ${marked.out}`);
}
