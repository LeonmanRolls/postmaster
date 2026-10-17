// A run's external wait: `<dispatch>/wait.json`, written by the postmaster
// when a run starts waiting on something outside itself (Stage F). The
// watcher checks each wait at every look; the run status reads files only.
//
//   {"kind": "fixture", "fixture": "<abs fixture copy>", "marker": "<abs>"}
//       Over when the fixture copy's postmaster marker lands. `marker`
//       overrides the derived `<fixture>/.postmaster/runs/postmaster/.exited`.
//   {"kind": "pull-request", "repo": "<abs>", "pr": "<ref>",
//    "cardHead": "<sha>", "noneCount": 0}
//       Over when the pull request's checks pass or fail; a second
//       consecutive `none` counts as over. `noneCount` seeds that count
//       with the asks the postmaster already made (0 or 1).
//
// A wait that cannot be read is a fault, never over.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type Wait =
  | { kind: "fixture"; fixture: string; marker: string }
  | { kind: "pull-request"; repo: string; pr: string; cardHead: string; noneCount: number };

export type WaitState =
  | { state: "none" }
  | { state: "open"; wait: Wait }
  | { state: "done"; wait: Wait }
  | { state: "fault"; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function absField(rec: Record<string, unknown>, name: string): string | null {
  const v = rec[name];
  return typeof v === "string" && v.startsWith("/") && v.trim() === v && v !== "/" ? v : null;
}

function textField(rec: Record<string, unknown>, name: string): string | null {
  const v = rec[name];
  return typeof v === "string" && v !== "" && !/[\u0000-\u001f\u007f]/u.test(v) ? v : null;
}

/** The parsed wait in a dispatch directory, files only. */
export function readWait(dispatch: string): WaitState {
  const path = join(dispatch, "wait.json");
  try {
    statSync(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return { state: "none" };
    return { state: "fault", error: "wait.json cannot be read" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { state: "fault", error: "wait.json is not valid JSON" };
  }
  if (!isRecord(parsed)) return { state: "fault", error: "wait.json is not an object" };
  if (parsed.kind === "fixture") {
    const fixture = absField(parsed, "fixture");
    if (fixture === null)
      return { state: "fault", error: "fixture wait needs an absolute fixture path" };
    let marker = join(fixture, ".postmaster", "runs", "postmaster", ".exited");
    if ("marker" in parsed) {
      const named = absField(parsed, "marker");
      if (named === null)
        return { state: "fault", error: "fixture wait marker needs an absolute path" };
      marker = named;
    }
    const wait: Wait = { kind: "fixture", fixture, marker };
    if (!existsSync(fixture))
      return { state: "fault", error: "fixture wait names a fixture copy that does not exist" };
    return existsSync(marker) ? { state: "done", wait } : { state: "open", wait };
  }
  if (parsed.kind === "pull-request") {
    const repo = absField(parsed, "repo");
    const pr = textField(parsed, "pr");
    const cardHead = textField(parsed, "cardHead");
    if (repo === null || pr === null || cardHead === null)
      return { state: "fault", error: "pull-request wait needs repo, pr and cardHead" };
    if (pr.startsWith("-"))
      return { state: "fault", error: "pull-request wait pr must not start with -" };
    let noneCount = 0;
    if ("noneCount" in parsed) {
      const n = parsed.noneCount;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 1)
        return { state: "fault", error: "pull-request wait noneCount must be 0 or 1" };
      noneCount = n;
    }
    return { state: "open", wait: { kind: "pull-request", repo, pr, cardHead, noneCount } };
  }
  return { state: "fault", error: "wait.json kind must be fixture or pull-request" };
}
