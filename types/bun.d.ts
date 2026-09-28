// Ambient declarations for the Bun and Node standard APIs the scripts use.
// Development dependencies are only typescript and @biomejs/biome, so these live here.

declare module "bun" {
  export interface ShellOutput {
    stdout: Buffer;
    stderr: Buffer;
    exitCode: number;
    ok: boolean;
    text(): string;
    json<T = unknown>(): T;
    lines(): string[];
  }
  export interface ShellPromise extends Promise<ShellOutput> {
    quiet(): ShellPromise;
    nothrow(): ShellPromise;
    text(): Promise<string>;
    json<T = unknown>(): Promise<T>;
    lines(): Promise<string[]>;
    arrayBuffer(): Promise<ArrayBuffer>;
  }
  export const $: ((
    strings: TemplateStringsArray,
    ...exprs: Array<string | number | ShellOutput | ShellPromise>
  ) => ShellPromise) & {
    (cmd: string): ShellPromise;
    spawn(cmd: string[] | string): Promise<import("node:child_process").ChildProcess>;
    cwd(dir: string): void;
    env(env: Record<string, string | undefined>): void;
    quiet(): void;
  };
  export const TOML: {
    parse(text: string): Record<string, unknown>;
  };
  export function file(path: string | URL): {
    exists(): Promise<boolean>;
    text(): Promise<string>;
    json<T = unknown>(): Promise<T>;
    arrayBuffer(): Promise<ArrayBuffer>;
  };
  export function write(path: string | URL, data: string | Uint8Array | Blob): Promise<number>;
  export const argv: string[];
  export const env: Record<string, string | undefined>;
  export function which(cmd: string): string | null;
  export function spawn(
    cmd: string[] | string,
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      stdin?: "inherit" | "pipe" | "ignore" | null;
      stdout?: "inherit" | "pipe" | "ignore" | null;
      stderr?: "inherit" | "pipe" | "ignore" | null;
    },
  ): {
    stdout: ReadableStream<Uint8Array> | null;
    stderr: ReadableStream<Uint8Array> | null;
    stdin: WritableStream<Uint8Array> | null;
    exited: Promise<number>;
    kill(code?: number): void;
  };
}

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string, encoding?: "utf8"): void;
  export function appendFileSync(path: string, data: string, encoding?: "utf8"): void;
  export function mkdirSync(
    path: string,
    options?: { recursive?: boolean; mode?: number },
  ): string | undefined;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function readdirSync(
    path: string,
    options?: { withFileTypes?: boolean },
  ):
    | string[]
    | Array<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>;
  export function statSync(path: string): {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    mtimeMs: number;
    size: number;
  };
  export function lstatSync(path: string): {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    mtimeMs: number;
    size: number;
  };
  export function realpathSync(path: string): string;
  export function renameSync(from: string, to: string): void;
  export function unlinkSync(path: string): void;
  export function rmdirSync(path: string): void;
  export function copyFileSync(from: string, to: string): void;
  export function chmodSync(path: string, mode: number): void;
  export function cpSync(
    from: string,
    to: string,
    options?: { recursive?: boolean; force?: boolean },
  ): void;
  export function symlinkSync(
    target: string,
    path: string,
    type?: "dir" | "file" | "junction",
  ): void;
  export function readlinkSync(path: string): string;
  export const constants: { F_OK: number; R_OK: number; W_OK: number; X_OK: number };
  export function accessSync(path: string, mode?: number): void;
  export function mkdtempSync(prefix: string): string;
  export function openSync(path: string, flags: string | number): number;
  export function closeSync(fd: number): void;
  export function readSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): number;
  export function writeSync(fd: number, data: string | Uint8Array): number;
  export function fstatSync(fd: number): { size: number; isFile(): boolean };
  export type Dirent = {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  };
}

declare module "node:fs/promises" {
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function writeFile(path: string, data: string, encoding?: "utf8"): Promise<void>;
  export function appendFile(path: string, data: string, encoding?: "utf8"): Promise<void>;
  export function mkdir(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<string | undefined>;
  export function rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void>;
  export function readdir(
    path: string,
    options?: { withFileTypes?: boolean },
  ):
    | Promise<string[]>
    | Promise<
        Array<{
          name: string;
          isDirectory(): boolean;
          isFile(): boolean;
          isSymbolicLink(): boolean;
        }>
      >;
  export function stat(path: string): Promise<{
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    mtimeMs: number;
    size: number;
  }>;
  export function lstat(path: string): Promise<{
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    mtimeMs: number;
    size: number;
  }>;
  export function realpath(path: string): Promise<string>;
  export function rename(from: string, to: string): Promise<void>;
  export function unlink(path: string): Promise<void>;
  export function copyFile(from: string, to: string): Promise<void>;
  export function chmod(path: string, mode: number): Promise<void>;
  export function mkdtemp(prefix: string): Promise<string>;
  export function access(path: string, mode?: number): Promise<void>;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string, ext?: string): string;
  export function extname(path: string): string;
  export function resolve(...parts: string[]): string;
  export function normalize(path: string): string;
  export function relative(from: string, to: string): string;
  export function isAbsolute(path: string): boolean;
  export const sep: string;
  export const delimiter: string;
  export function parse(path: string): {
    root: string;
    dir: string;
    base: string;
    ext: string;
    name: string;
  };
  const path: {
    join(...parts: string[]): string;
    dirname(path: string): string;
    basename(path: string, ext?: string): string;
    extname(path: string): string;
    resolve(...parts: string[]): string;
    normalize(path: string): string;
    relative(from: string, to: string): string;
    isAbsolute(path: string): boolean;
    sep: string;
    delimiter: string;
    parse(path: string): {
      root: string;
      dir: string;
      base: string;
      ext: string;
      name: string;
    };
  };
  export default path;
}

declare module "node:os" {
  export function tmpdir(): string;
  export function homedir(): string;
  export function hostname(): string;
  export function platform(): string;
  export function arch(): string;
  export const EOL: string;
  export function userInfo(): { username: string; homedir: string };
  export function cpus(): Array<{ model: string; speed: number }>;
  export function totalmem(): number;
  export function freemem(): number;
  export function uptime(): number;
  export function networkInterfaces(): Record<
    string,
    Array<{ address: string; family: string; internal: boolean }> | undefined
  >;
}

declare module "node:process" {
  export const argv: string[];
  export const argv0: string;
  export const env: Record<string, string | undefined>;
  export const cwd: () => string;
  export function chdir(dir: string): void;
  export const exit: (code?: number) => never;
  export const pid: number;
  export const platform: string;
  export const stdout: {
    write(data: string | Uint8Array): boolean;
    isTTY: boolean;
  };
  export const stderr: {
    write(data: string | Uint8Array): boolean;
    isTTY: boolean;
  };
  export const stdin: {
    isTTY: boolean;
  };
  export function on(event: string, listener: (...args: unknown[]) => void): void;
  export function once(event: string, listener: (...args: unknown[]) => void): void;
  export function hrtime(): [number, number];
  const process: {
    argv: string[];
    argv0: string;
    env: Record<string, string | undefined>;
    cwd: () => string;
    chdir(dir: string): void;
    exit: (code?: number) => never;
    pid: number;
    platform: string;
    stdout: {
      write(data: string | Uint8Array): boolean;
      isTTY: boolean;
    };
    stderr: {
      write(data: string | Uint8Array): boolean;
      isTTY: boolean;
    };
    stdin: {
      isTTY: boolean;
    };
    on(event: string, listener: (...args: unknown[]) => void): void;
    once(event: string, listener: (...args: unknown[]) => void): void;
    hrtime(): [number, number];
  };
  export default process;
}

declare module "node:child_process" {
  export interface SpawnSyncReturns<T = Buffer> {
    pid: number;
    output: Array<T | null>;
    stdout: T;
    stderr: T;
    status: number | null;
    signal: string | null;
    error?: Error;
  }
  export function spawnSync(
    command: string,
    args?: string[],
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      encoding?: "utf8" | "buffer";
      input?: string | Uint8Array;
      timeout?: number;
      shell?: boolean;
      maxBuffer?: number;
      stdio?: "pipe" | "inherit" | Array<"pipe" | "inherit" | "ignore">;
    },
  ): SpawnSyncReturns<string | Buffer>;
  export function execFileSync(
    command: string,
    args?: string[],
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      encoding?: "utf8" | "buffer";
      input?: string | Uint8Array;
      timeout?: number;
      stdio?: "pipe" | "inherit" | Array<"pipe" | "inherit" | "ignore">;
    },
  ): string | Buffer;
  export interface ChildProcess {
    pid: number | undefined;
    stdout: NodeJS.ReadableStream | null;
    stderr: NodeJS.ReadableStream | null;
    stdin: NodeJS.WritableStream | null;
    kill(signal?: string): boolean;
    on(event: string, listener: (...args: unknown[]) => void): ChildProcess;
  }
  export function spawn(
    command: string,
    args?: string[],
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      stdio?: "pipe" | "inherit" | "ignore" | Array<"pipe" | "inherit" | "ignore">;
      detached?: boolean;
      shell?: boolean;
    },
  ): ChildProcess;
}

declare module "node:util" {
  export function format(...args: unknown[]): string;
  export function inspect(value: unknown, options?: { depth?: number; colors?: boolean }): string;
  export function promisify<T extends (...args: unknown[]) => unknown>(
    fn: T,
  ): (...args: Parameters<T>) => Promise<unknown>;
}

declare module "node:crypto" {
  export function createHash(algorithm: string): {
    update(data: string | Uint8Array): void;
    digest(encoding: "hex" | "base64"): string;
  };
  export function randomBytes(size: number): Uint8Array;
  export function randomUUID(): string;
}

declare module "node:readline" {
  export function createInterface(options: { input: NodeJS.ReadableStream; crlfDelay?: number }): {
    on(event: "line", listener: (line: string) => void): void;
    on(event: "close", listener: () => void): void;
    close(): void;
  };
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
  export function pathToFileURL(path: string): URL;
  export function pathToFileURL(path: string): URL;
  export class URL {
    constructor(input: string, base?: string | URL);
    pathname: string;
    search: string;
    hash: string;
    href: string;
    protocol: string;
    hostname: string;
    port: string;
    searchParams: URLSearchParams;
  }
}

declare module "node:os/process" {
  export * from "node:process";
}

declare namespace NodeJS {
  interface ReadableStream {
    read(): string | Buffer | null;
    on(event: string, listener: (...args: never[]) => void): ReadableStream;
    setEncoding(encoding: string): void;
  }
  interface WritableStream {
    write(data: string | Uint8Array): boolean;
    end(): void;
  }
}

interface ImportMeta {
  dir: string;
  file: string;
  path: string;
  url: string;
  main: boolean;
  resolve(id: string): string;
}

declare const Bun: {
  TOML: {
    parse(text: string): Record<string, unknown>;
  };
  file(path: string | URL): {
    exists(): Promise<boolean>;
    text(): Promise<string>;
    json<T = unknown>(): Promise<T>;
  };
  write(path: string | URL, data: string | Uint8Array | Blob): Promise<number>;
  which(cmd: string): string | null;
  env: Record<string, string | undefined>;
  argv: string[];
  spawn(
    cmd: string[] | string,
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      stdin?: "inherit" | "pipe" | "ignore" | null;
      stdout?: "inherit" | "pipe" | "ignore" | null;
      stderr?: "inherit" | "pipe" | "ignore" | null;
    },
  ): {
    stdout: ReadableStream<Uint8Array> | null;
    stderr: ReadableStream<Uint8Array> | null;
    stdin: WritableStream<Uint8Array> | null;
    exited: Promise<number>;
    kill(code?: number): void;
  };
  sleep(ms: number): Promise<void>;
  hash(data: string | Uint8Array): string;
};

declare const process: {
  argv: string[];
  argv0: string;
  env: Record<string, string | undefined>;
  cwd(): string;
  chdir(dir: string): void;
  exit(code?: number): never;
  pid: number;
  platform: string;
  stdout: {
    write(data: string | Uint8Array): boolean;
    isTTY: boolean;
  };
  stderr: {
    write(data: string | Uint8Array): boolean;
    isTTY: boolean;
  };
  stdin: {
    isTTY: boolean;
  };
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  hrtime(): [number, number];
  nextTick(fn: () => void): void;
};

declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
};

declare function setTimeout(handler: () => void, ms?: number): number;
declare function clearTimeout(handle: number): void;
declare function setInterval(handler: () => void, ms?: number): number;
declare function clearInterval(handle: number): void;
declare function setImmediate(handler: () => void): number;
declare function clearImmediate(handle: number): void;
declare function queueMicrotask(fn: () => void): void;

interface Buffer extends Uint8Array {
  toString(encoding?: "utf8" | "hex" | "base64"): string;
}
declare const Buffer: {
  from(data: string | Uint8Array, encoding?: "utf8" | "hex" | "base64"): Buffer;
  alloc(size: number): Buffer;
  isBuffer(obj: unknown): obj is Buffer;
};
