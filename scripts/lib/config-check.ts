// Validity checks shared by setup, front-door and check-setup: the rules
// setup applies when it writes a config, and the route's needs. setup.ts
// dies on the first problem, check-setup.ts prints them all, and front-door
// prefixes the postmaster one; the messages stay byte-identical in setup and
// front-door, which is why the rules live here once (design rule 7).
//
// The checks are conditional on the values setup writes: a role the merged
// settings do not name is not judged, except team.postmaster, which the route
// needs, and the lanes, which the count needs.
import { run } from "./proc.ts";

const isTable = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Whether a named harness is on PATH. Spawns; the edge, not the core. */
export function isInstalled(tool: string): boolean {
  // command -v is a shell builtin: setup ran it in the shell, so this must too.
  return run("bash", ["-c", 'command -v "$1" >/dev/null 2>&1', "_", tool]).code === 0;
}

/** setup's harness rule, as it reads when it writes a config. */
export function harnessProblem(harness: string): string | null {
  if (!isInstalled(harness)) {
    return `setup: harness '${harness}' is not on PATH; install it or choose another`;
  }
  return null;
}

/** setup's lane-count rule. */
export function laneCountProblem(lanes: string[]): string | null {
  if (lanes.length < 2) return "setup: at least two lanes are needed";
  return null;
}

/** setup's reviewer-membership rule. lanesText is how the lanes read in the
 * message: setup passes its raw answer, so its message never changes. */
export function reviewerProblem(
  name: string,
  lanes: string[],
  lanesText: string,
  lens = "",
): string | null {
  if (!lanes.includes(name)) {
    const who = lens === "" ? "reviewer" : `${lens} reviewer`;
    return `setup: ${who} '${name}' is not one of the lanes (${lanesText})`;
  }
  return null;
}

/** setup's coachman-model rule. subject is "the coachman" or "the fallback
 * coachman", as the message reads it. */
export function coachmanModelProblem(
  model: string,
  laneModels: string[],
  subject: string,
): string | null {
  if (laneModels.includes(model)) {
    return `setup: ${subject} cannot run on a lane's model (${model})`;
  }
  return null;
}

/** How one side of a postmaster spec fails the route's needs: missing
 * is falsy, nonstring truthy but not a string, blank all whitespace, and
 * control a string carrying control characters. */
export type PostmasterKeyFailure = "missing" | "nonstring" | "blank" | "control";

/** Where a postmaster spec fails: absent when it is no table, else per key.
 * The single analysis behind postmasterProblems' messages and check-setup's
 * per-layer attribution, so the two never disagree. */
export interface PostmasterFailure {
  absent: boolean;
  harness: PostmasterKeyFailure | null;
  model: PostmasterKeyFailure | null;
}

function keyFailure(v: unknown): PostmasterKeyFailure | null {
  if (!v) return "missing";
  if (typeof v !== "string") return "nonstring";
  if (v.trim() === "") return "blank";
  if (
    [...v].some((c) => {
      const o = c.codePointAt(0) ?? 0;
      return o < 0x20 || o === 0x7f;
    })
  ) {
    return "control";
  }
  return null;
}

export function postmasterFailure(spec: unknown): PostmasterFailure {
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    return { absent: true, harness: null, model: null };
  }
  const s = spec as Record<string, unknown>;
  return { absent: false, harness: keyFailure(s.harness), model: keyFailure(s.model) };
}

/** front-door's postmaster rule, without its prefix: the spec is a table
 * naming a harness and a model, both non-blank strings without control
 * characters. At most one problem: the first the route would refuse. */
export function postmasterProblems(spec: unknown, source: string): string[] {
  const f = postmasterFailure(spec);
  if (f.absent || f.harness === "missing" || f.model === "missing") {
    return [`${source} has no team.postmaster with a harness and a model`];
  }
  if (f.harness === "nonstring" || f.model === "nonstring") {
    return [`${source} team.postmaster harness and model must be strings`];
  }
  if (f.harness === "blank" || f.model === "blank") {
    return [`${source} team.postmaster harness and model must not be blank`];
  }
  if (f.harness === "control" || f.model === "control") {
    return [`${source} team.postmaster harness and model must not contain control characters`];
  }
  return [];
}

export interface LaneEntryResult {
  problems: string[];
  /** The lane's model where it names a usable one, for the coachman rule. */
  model: string | null;
}

/** One lane entry of merged settings: names a harness on PATH and a model. */
export function checkLaneEntry(name: string, entry: unknown): LaneEntryResult {
  if (!isTable(entry)) {
    return {
      problems: [`setup: lane '${name}' names no harness`, `setup: lane '${name}' names no model`],
      model: null,
    };
  }
  const problems: string[] = [];
  const harness = entry.harness;
  if (typeof harness !== "string") {
    problems.push(`setup: lane '${name}' names no harness`);
  } else {
    const p = harnessProblem(harness);
    if (p !== null) problems.push(p);
  }
  let model: string | null = null;
  const m = entry.model;
  if (typeof m !== "string" || m.trim() === "") {
    problems.push(`setup: lane '${name}' names no model`);
  } else {
    model = m;
  }
  return { problems, model };
}

/** The harness a team role names, where it names one. */
export function roleHarness(spec: unknown): string | null {
  if (!isTable(spec)) return null;
  return typeof spec.harness === "string" ? spec.harness : null;
}

/** The model a team role names, where it names a usable one. */
export function roleModel(spec: unknown): string | null {
  if (!isTable(spec)) return null;
  const m = spec.model;
  return typeof m === "string" && m.trim() !== "" ? m : null;
}

/** setup's reviewer-membership rule over merged settings: team.reviewers and
 * every team.lens_reviewers list name lanes. Values that are not lists are
 * shapes setup never writes, and are not judged; a list holding a non-string
 * is judged, since reviewers lines refuses it downstream. */
export function reviewersProblems(team: unknown, laneNames: string[]): string[] {
  if (!isTable(team)) return [];
  const problems: string[] = [];
  const text = laneNames.join(", ");
  const reviewers = team.reviewers;
  if (Array.isArray(reviewers)) {
    if (!reviewers.every((n) => typeof n === "string")) {
      problems.push("setup: [team] reviewers is not a list of lane names");
    }
    for (const name of reviewers) {
      if (typeof name !== "string") continue;
      const p = reviewerProblem(name, laneNames, text);
      if (p !== null) problems.push(p);
    }
  }
  const lenses = team.lens_reviewers;
  if (isTable(lenses)) {
    for (const lens of Object.keys(lenses).sort()) {
      const names = lenses[lens];
      if (!Array.isArray(names)) continue;
      if (!names.every((n) => typeof n === "string")) {
        problems.push(`setup: [team.lens_reviewers] ${lens} is not a list of lane names`);
      }
      for (const name of names) {
        if (typeof name !== "string") continue;
        const p = reviewerProblem(name, laneNames, text, lens);
        if (p !== null) problems.push(p);
      }
    }
  }
  return problems;
}
