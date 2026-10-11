// A stand-in with the classifier's exports. It does nothing: every function returns an empty
// answer. Laws import from this file; when they are run for real, this file is replaced by one
// that exports the real functions under the same names.
import type * as S from "./signatures.ts";

export type { Access, Place, RecordOf, RunInfo, Touch } from "./signatures.ts";

export const expandPath: typeof S.expandPath = () => null;
export const isPathToken: typeof S.isPathToken = () => false;
export const splitShell: typeof S.splitShell = () => [];
export const shellWords: typeof S.shellWords = () => [];
export const unwrapShell: typeof S.unwrapShell = () => [];
export const commandTouches: typeof S.commandTouches = () => [];
