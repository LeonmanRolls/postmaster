// The shell-command part of the reach check: its functions' declarations and the types they
// use, as they stand in the code. The bodies are not given.

export type RecordOf<T = unknown> = Record<string, T>;
export type Access = "read" | "write" | "refused";
export type Place =
  | "inside"
  | "main checkout"
  | "synthesis worktree"
  | "another worktree"
  | "elsewhere";

export interface Touch {
  path: string;
  access: Access;
  place: Place;
  kind: "expected" | "finding" | "note";
  lane: string;
  lens?: string;
  source: "stream" | "checkout" | "round";
  user?: boolean;
  detail?: string;
}

export interface RunInfo {
  dispatch: string;
  repo: string;
  ticket: string;
  run: RecordOf;
  config: RecordOf;
  lanes: RecordOf;
  manifest: RecordOf;
  defaultBranch: string;
  tool: string;
  home: string;
}

export declare function expandPath(token: string, cwd: string): string | null;

export declare function isPathToken(token: string, cwd: string): boolean;

export declare function splitShell(source: string): string[];

export declare function shellWords(segment: string): string[];

export declare function unwrapShell(command: string): string[];

export declare function commandTouches(
  command: string,
  result: string,
  code: unknown,
  info: RunInfo,
  lane: string,
  ownFolder: string,
  ownDataHome: string,
  lens?: string,
): Touch[];
