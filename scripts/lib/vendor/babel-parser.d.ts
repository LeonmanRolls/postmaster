// Minimal types for the vendored @babel/parser bundle: only the surface
// switch-offs.ts uses. The bundle is CommonJS; Bun resolves the named
// import from its exports.
export interface BabelPosition {
  line: number;
  column: number;
  index: number;
}
export interface BabelComment {
  type: "CommentBlock" | "CommentLine";
  value: string;
  start: number;
  end: number;
  loc: { start: BabelPosition; end: BabelPosition } | null;
}
export interface BabelNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}
export interface BabelFile {
  comments: BabelComment[] | null;
  errors: unknown[];
  program: BabelNode;
}
export interface BabelOptions {
  plugins?: (string | [string, Record<string, unknown>])[];
  sourceType?: "script" | "module" | "unambiguous";
  errorRecovery?: boolean;
  allowImportExportEverywhere?: boolean;
  allowAwaitOutsideFunction?: boolean;
  allowReturnOutsideFunction?: boolean;
  allowSuperOutsideMethod?: boolean;
  allowUndeclaredExports?: boolean;
}
export function parse(code: string, options?: BabelOptions): BabelFile;
