// Finding a harness's durable session record on disk, shared by the session
// export and the responsiveness report (design rule 7: shared code lives
// once). A store holds many threads, and one id can hide inside another, so
// neither a substring nor a bare dash suffix is a match: codex names files
// rollout-<timestamp>-<thread>.jsonl with a fixed timestamp shape, and only
// that shape is matched; claude and pi name the file for the thread exactly.
import type { Dirent } from "node:fs";
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { BOUND_L, BOUND_R, D_CLASS, END_OF_STRING } from "./text.ts";

export type SessionRecordEnv = {
  CLAUDE_CONFIG_DIR?: string;
  CODEX_HOME?: string;
};

const isDir = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

export const collectJsonl = (root: string): string[] => {
  const found: string[] = [];
  let failed = false;
  const walk = (dir: string): void => {
    if (failed) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      failed = true;
      return;
    }
    for (const ent of entries) {
      if (failed) return;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith(".jsonl") && (ent.isFile() || ent.isSymbolicLink())) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found;
};

const REGEX_SPECIAL_RE = /[\^$\\.*+?()[\]{}|]/gu;
const regexEscape = (value: string): string => value.replace(REGEX_SPECIAL_RE, "\\$&");

export const sessionStoreRoot = (
  harness: string,
  env: SessionRecordEnv = process.env,
): string | null => {
  const home = homedir();
  if (harness === "codex") return join(env.CODEX_HOME ?? join(home, ".codex"), "sessions");
  if (harness === "claude") return join(env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "projects");
  if (harness === "pi") return join(home, ".pi", "agent", "sessions");
  return null;
};

export const claudeProjectsRoot = (env: SessionRecordEnv = process.env): string =>
  join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects");

export const encodeProjectFolder = (cwd: string): string => cwd.replaceAll("/", "-");

export const claudeProjectFolder = (repo: string, env: SessionRecordEnv = process.env): string =>
  join(claudeProjectsRoot(env), encodeProjectFolder(repo));

export const findNativeRecord = (
  harness: string,
  thread: string,
  env: SessionRecordEnv = process.env,
  onWarn?: (message: string) => void,
): string => {
  const root = sessionStoreRoot(harness, env);
  if (root === null) throw new Error(`unknown harness: ${harness}`);
  if (!isDir(root)) throw new Error(`no durable ${harness} session store is available`);
  const digit = `[${D_CLASS}]`;
  const codexStem = new RegExp(
    `^rollout-${digit}{4}-${digit}{2}-${digit}{2}T${digit}{2}-${digit}{2}-${digit}{2}-${regexEscape(thread)}${END_OF_STRING}`,
    "u",
  );
  const exact: string[] = [];
  const suffixed: string[] = [];
  for (const path of collectJsonl(root)) {
    const stem = basename(path).slice(0, -".jsonl".length);
    if (stem === thread) exact.push(path);
    else if (harness === "codex" && codexStem.test(stem)) suffixed.push(path);
  }
  const found = exact.length > 0 ? exact : suffixed;
  if (found.length === 0)
    throw new Error(`no durable ${harness} record was found for thread ${thread}`);
  if (found.length > 1) {
    onWarn?.(`${found.length} ${harness} records name thread ${thread}; keeping the newest`);
  }
  const withMtime = found.map((path) => ({ ms: statSync(path).mtimeMs, path }));
  withMtime.sort((a, b) => b.ms - a.ms);
  return withMtime[0]!.path;
};

const readCustomTitle = (path: string): string | null => {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row: unknown = JSON.parse(line);
      if (
        row !== null &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        (row as Record<string, unknown>).type === "custom-title" &&
        typeof (row as Record<string, unknown>).customTitle === "string"
      ) {
        return (row as Record<string, unknown>).customTitle as string;
      }
    } catch {
      // A line that is not JSON carries no title.
    }
  }
  return null;
};

const POSTMASTER_WORD = new RegExp(`${BOUND_L}postmaster${BOUND_R}`, "iu");
const namesPostmaster = (title: string): boolean => POSTMASTER_WORD.test(title);

export const findNewestPostmasterRecord = (
  repo: string,
  env: SessionRecordEnv = process.env,
): string => {
  const folder = claudeProjectFolder(repo, env);
  if (!isDir(folder)) throw new Error(`no Claude Code project folder for ${repo}`);
  let entries: string[];
  try {
    entries = readdirSync(folder);
  } catch {
    throw new Error(`no Claude Code project folder for ${repo}`);
  }
  const candidates = entries
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => join(folder, name))
    .filter((path) => {
      try {
        return lstatSync(path).isFile();
      } catch {
        return false;
      }
    })
    .flatMap((path) => {
      const title = readCustomTitle(path);
      return title !== null && namesPostmaster(title) ? [path] : [];
    });
  if (candidates.length === 0) {
    throw new Error(`no postmaster record was found in ${folder}`);
  }
  const withMtime = candidates.map((path) => ({ ms: statSync(path).mtimeMs, path }));
  withMtime.sort((a, b) => b.ms - a.ms);
  return withMtime[0]!.path;
};
