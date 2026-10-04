// Ambient declarations for the Bun and Node standard APIs the scripts use.
// Development dependencies are only typescript and @biomejs/biome, so these live here.

type BufferEncoding = "utf8" | "utf-8" | "hex" | "base64" | "ascii" | "binary" | "latin1";

interface Dirent {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

type Buffer = Uint8Array & {
  toString(encoding?: BufferEncoding, start?: number, end?: number): string;
  equals(other: Uint8Array): boolean;
  slice(start?: number, end?: number): Uint8Array;
};

declare const Buffer: {
  from(data: string | Uint8Array | ArrayBuffer, encoding?: BufferEncoding): Buffer;
  alloc(size: number, fill?: string | number, encoding?: BufferEncoding): Buffer;
  concat(list: Array<Uint8Array | Buffer>, totalLength?: number): Buffer;
  isBuffer(obj: unknown): obj is Buffer;
  compare(a: Uint8Array, b: Uint8Array): number;
  byteLength(string: string | Uint8Array | ArrayBuffer, encoding?: BufferEncoding): number;
};

declare function require(id: string): unknown;

interface ErrnoException extends Error {
  code?: string;
  errno?: number;
  path?: string;
  syscall?: string;
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
  interface ErrnoException extends Error {
    code?: string;
    errno?: number;
    path?: string;
    syscall?: string;
  }
  type Signals =
    | "SIGTERM"
    | "SIGKILL"
    | "SIGINT"
    | "SIGHUP"
    | "SIGSTOP"
    | "SIGCONT"
    | "SIGUSR1"
    | "SIGUSR2"
    | string;
}

interface ImportMeta {
  dir: string;
  file: string;
  path: string;
  url: string;
  main: boolean;
  resolve(id: string): string;
}

declare const process: {
  argv: string[];
  argv0: string;
  env: Record<string, string | undefined>;
  cwd(): string;
  chdir(dir: string): void;
  exit(code?: number): never;
  exitCode?: number;
  pid: number;
  ppid: number;
  platform: string;
  arch: string;
  version: string;
  execPath: string;
  stdout: {
    write(data: string | Uint8Array): boolean;
    isTTY: boolean;
    fd: number;
    columns?: number;
    rows?: number;
  };
  stderr: {
    write(data: string | Uint8Array): boolean;
    isTTY: boolean;
    fd: number;
  };
  stdin: {
    isTTY: boolean;
    fd: number;
  };
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
  hrtime(time?: [number, number]): [number, number];
  nextTick(fn: () => void): void;
  kill(pid: number, signal?: string | number): boolean;
  getuid(): number;
  getgid(): number;
  geteuid(): number;
  getegid(): number;
  uptime(): number;
  memoryUsage(): { rss: number; heapTotal: number; heapUsed: number; external: number };
};

declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
};

declare function setTimeout(handler: (...args: unknown[]) => void, ms?: number): number;
declare function clearTimeout(handle: number): void;
declare function setInterval(handler: (...args: unknown[]) => void, ms?: number): number;
declare function clearInterval(handle: number): void;
declare function setImmediate(handler: (...args: unknown[]) => void): number;
declare function clearImmediate(handle: number): void;
declare function queueMicrotask(fn: () => void): void;

declare const Bun: {
  version: string;
  TOML: {
    parse(text: string): Record<string, unknown>;
  };
  file(path: string | URL): {
    exists(): Promise<boolean>;
    text(): Promise<string>;
    json<T = unknown>(): Promise<T>;
    arrayBuffer(): Promise<ArrayBuffer>;
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
    pid: number;
    stdout: ReadableStream<Uint8Array> | null;
    stderr: ReadableStream<Uint8Array> | null;
    stdin: WritableStream<Uint8Array> | null;
    exited: Promise<number>;
    kill(code?: number | string): void;
  };
  sleep(ms: number): Promise<void>;
  hash(data: string | Uint8Array): string;
  spawnSync(options: {
    cmd: string[];
    cwd?: string;
    env?: Record<string, string | undefined>;
    stdin?: "inherit" | "pipe" | "ignore" | null | Uint8Array | string;
    stdout?: "inherit" | "pipe" | "ignore" | null;
    stderr?: "inherit" | "pipe" | "ignore" | null;
  }): {
    exitCode: number;
    stdout: Uint8Array;
    stderr: Uint8Array;
  };
  spawnSync(
    cmd: string[],
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      stdin?: "inherit" | "pipe" | "ignore" | null | Uint8Array | string;
      stdout?: "inherit" | "pipe" | "ignore" | null;
      stderr?: "inherit" | "pipe" | "ignore" | null;
    },
  ): {
    exitCode: number;
    stdout: Uint8Array;
    stderr: Uint8Array;
  };
};

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
  export function which(cmd: string): string | null;
  export const env: Record<string, string | undefined>;
  export const argv: string[];
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
  export function sleep(ms: number): Promise<void>;
}

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: BufferEncoding): string;
  export function readFileSync(
    path: string,
    options: { encoding: BufferEncoding; flag?: string } | BufferEncoding,
  ): string;
  export function readFileSync(path: string): Buffer;
  export function readFileSync(fd: number, encoding: BufferEncoding): string;
  export function readFileSync(fd: number): Buffer;
  export function writeFileSync(
    path: string | number,
    data: string | Uint8Array,
    encoding?: BufferEncoding | { encoding?: BufferEncoding; flag?: string; mode?: number },
  ): void;
  export function appendFileSync(
    path: string,
    data: string | Uint8Array,
    encoding?: BufferEncoding | { encoding?: BufferEncoding; flag?: string },
  ): void;
  export function mkdirSync(
    path: string,
    options?: { recursive?: boolean; mode?: number },
  ): string | undefined;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function rmdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readdirSync(path: string): string[];
  export function readdirSync(
    path: string,
    options: { recursive: true; withFileTypes?: false },
  ): string[];
  export function readdirSync(
    path: string,
    options: { recursive: true; withFileTypes: true },
  ): Dirent[];
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  export function readdirSync(path: string, options: { withFileTypes?: false }): string[];
  export function statSync(path: string): {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    mtimeMs: number;
    size: number;
    mode: number;
    uid: number;
    gid: number;
  };
  export function lstatSync(path: string): {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    mtimeMs: number;
    size: number;
    mode: number;
    uid: number;
    gid: number;
  };
  export function lstatSync(
    path: string,
    options: { throwIfNoEntry: false },
  ):
    | {
        isFile(): boolean;
        isDirectory(): boolean;
        isSymbolicLink(): boolean;
        mtimeMs: number;
        size: number;
        mode: number;
        uid: number;
        gid: number;
      }
    | undefined;
  export function realpathSync(path: string): string;
  export function renameSync(from: string, to: string): void;
  export function unlinkSync(path: string): void;
  export function copyFileSync(from: string, to: string): void;
  export function chmodSync(path: string, mode: number | string): void;
  export function chownSync(path: string, uid: number, gid: number): void;
  export function cpSync(
    from: string,
    to: string,
    options?: {
      recursive?: boolean;
      force?: boolean;
      verbatimSymlinks?: boolean;
      preserveTimestamps?: boolean;
      errorOnExist?: boolean;
    },
  ): void;
  export function symlinkSync(
    target: string,
    path: string,
    type?: "dir" | "file" | "junction",
  ): void;
  export function linkSync(existing: string, path: string): void;
  export function readlinkSync(path: string): string;
  export const constants: {
    F_OK: number;
    R_OK: number;
    W_OK: number;
    X_OK: number;
    O_RDONLY: number;
    O_WRONLY: number;
    O_RDWR: number;
    O_CREAT: number;
    O_EXCL: number;
    O_TRUNC: number;
    O_APPEND: number;
    O_NONBLOCK: number;
  };
  export function accessSync(path: string, mode?: number): void;
  export function mkdtempSync(prefix: string): string;
  export function openSync(path: string, flags: string | number, mode?: number): number;
  export function closeSync(fd: number): void;
  export function readSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
  ): number;
  export function writeSync(fd: number, data: string | Uint8Array): number;
  export function writeSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position?: number | null,
  ): number;
  export function writeSync(
    fd: number,
    data: string,
    position?: number | null,
    encoding?: BufferEncoding,
  ): number;
  export function fstatSync(fd: number): {
    size: number;
    isFile(): boolean;
    isDirectory(): boolean;
    mtimeMs: number;
  };
  export function ftruncateSync(fd: number, len?: number): void;
  export function fsyncSync(fd: number): void;
  export function mkfifoSync(path: string, mode?: number): void;
  export function createReadStream(
    path: string,
    options?: { encoding?: BufferEncoding; start?: number; end?: number },
  ): NodeJS.ReadableStream;
  export function utimesSync(path: string, atime: number | Date, mtime: number | Date): void;
  export function mkdirSync(path: string, options: { recursive: true }): string | undefined;
  export type Dirent = {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  };
  export function watch(
    filename: string,
    listener: (event: string, filename: string | null) => void,
  ): { close(): void };
  export class FSWatcher {
    close(): void;
  }
}

declare module "node:fs/promises" {
  export function readFile(path: string, encoding: BufferEncoding): Promise<string>;
  export function readFile(path: string): Promise<Buffer>;
  export function writeFile(
    path: string,
    data: string | Uint8Array,
    encoding?: BufferEncoding,
  ): Promise<void>;
  export function appendFile(
    path: string,
    data: string | Uint8Array,
    encoding?: BufferEncoding,
  ): Promise<void>;
  export function mkdir(
    path: string,
    options?: { recursive?: boolean },
  ): Promise<string | undefined>;
  export function rm(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): Promise<void>;
  export function readdir(path: string): Promise<string[]>;
  export function readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
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
  export function chmod(path: string, mode: number | string): Promise<void>;
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
  export function toNamespacedPath(path: string): string;
  export const posix: {
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
  export const win32: typeof posix;
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
    posix: typeof posix;
    win32: typeof posix;
  };
  export default path;
}

declare module "node:os" {
  export const constants: {
    signals: Record<string, number>;
    errno: Record<string, number>;
    priority: Record<string, number>;
  };
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
  export function endianness(): "LE" | "BE";
  export function type(): string;
  export function release(): string;
  export function machine(): string;
}

declare module "node:process" {
  export = process;
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
  export function spawnSync(command: string): SpawnSyncReturns<Buffer>;
  export function spawnSync(
    command: string,
    options: { encoding: "utf8" | "utf-8" } & {
      cwd?: string;
      env?: Record<string, string | undefined>;
      input?: string | Uint8Array;
      timeout?: number;
      shell?: boolean;
      maxBuffer?: number;
      stdio?: unknown;
    },
  ): SpawnSyncReturns<string>;
  export function spawnSync(
    command: string,
    options: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      encoding?: BufferEncoding;
      input?: string | Uint8Array;
      timeout?: number;
      shell?: boolean;
      maxBuffer?: number;
      killSignal?: string | number;
      detached?: boolean;
      stdio?: unknown | Array<"pipe" | "inherit" | "ignore" | number | null>;
    },
  ): SpawnSyncReturns<string | Buffer>;
  export function spawnSync(command: string, args: string[]): SpawnSyncReturns<Buffer>;
  export function spawnSync(
    command: string,
    args: string[],
    options: { encoding: "utf8" | "utf-8" } & {
      cwd?: string;
      env?: Record<string, string | undefined>;
      input?: string | Uint8Array;
      timeout?: number;
      shell?: boolean;
      maxBuffer?: number;
      killSignal?: string | number;
      detached?: boolean;
      stdio?: unknown | Array<"pipe" | "inherit" | "ignore" | number | null>;
    },
  ): SpawnSyncReturns<string>;
  export function spawnSync(
    command: string,
    args: string[],
    options: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      encoding?: BufferEncoding;
      input?: string | Uint8Array;
      timeout?: number;
      shell?: boolean;
      maxBuffer?: number;
      killSignal?: string | number;
      detached?: boolean;
      stdio?: unknown | Array<"pipe" | "inherit" | "ignore" | number | null>;
    },
  ): SpawnSyncReturns<string | Buffer>;
  export function execFileSync(
    command: string,
    args?: string[],
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      encoding?: BufferEncoding;
      input?: string | Uint8Array;
      timeout?: number;
      stdio?: unknown | Array<"pipe" | "inherit" | "ignore" | number>;
    },
  ): string | Buffer;
  export interface ChildProcess {
    pid: number | undefined;
    exitCode: number | null;
    stdout: NodeJS.ReadableStream | null;
    stderr: NodeJS.ReadableStream | null;
    stdin: NodeJS.WritableStream | null;
    kill(signal?: string | number): boolean;
    unref(): void;
    ref(): void;
    on(event: "exit", listener: (code: number | null, signal: string | null) => void): ChildProcess;
    on(
      event: "close",
      listener: (code: number | null, signal: string | null) => void,
    ): ChildProcess;
    on(event: "error", listener: (err: Error) => void): ChildProcess;
    on(event: string, listener: (...args: never[]) => void): ChildProcess;
    once(
      event: "exit",
      listener: (code: number | null, signal: string | null) => void,
    ): ChildProcess;
    once(
      event: "close",
      listener: (code: number | null, signal: string | null) => void,
    ): ChildProcess;
    once(event: "error", listener: (err: Error) => void): ChildProcess;
    once(event: string, listener: (...args: never[]) => void): ChildProcess;
  }
  export function spawn(
    command: string,
    args?: string[],
    options?: {
      cwd?: string;
      env?: Record<string, string | undefined>;
      stdio?: unknown | Array<"pipe" | "inherit" | "ignore" | number>;
      detached?: boolean;
      shell?: boolean;
    },
  ): ChildProcess;
}

declare module "node:util" {
  export function format(...args: unknown[]): string;
  export function inspect(value: unknown, options?: { depth?: number; colors?: boolean }): string;
  export function promisify<T extends (...args: never[]) => unknown>(
    fn: T,
  ): (...args: Parameters<T>) => Promise<unknown>;
  export function inherits(constructor: unknown, superConstructor: unknown): void;
}

declare module "node:crypto" {
  export function createHash(algorithm: string): {
    update(data: string | Uint8Array): { digest(encoding: "hex" | "base64"): string };
    digest(encoding: "hex" | "base64"): string;
  };
  export function randomBytes(size: number): Buffer;
  export function randomUUID(): string;
}

declare module "node:readline" {
  export function createInterface(options: { input: NodeJS.ReadableStream; crlfDelay?: number }): {
    on(event: "line", listener: (line: string) => void): void;
    on(event: "close", listener: () => void): void;
    close(): void;
  };
}

declare module "node:net" {
  export interface Socket {
    destroy(): void;
    on(event: string, listener: () => void): void;
  }
  export interface Server {
    listen(port: number, host: string, listening: () => void): void;
    address(): { port: number } | null;
    close(done: () => void): void;
  }
  export function createServer(onConnection: (sock: Socket) => void): Server;
}
declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
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

declare class URL {
  constructor(input: string, base?: string | URL);
  pathname: string;
  search: string;
  hash: string;
  href: string;
  protocol: string;
  hostname: string;
  port: string;
  origin: string;
  searchParams: URLSearchParams;
  toString(): string;
}
declare class URLSearchParams {
  constructor(init?: string | Record<string, string>);
  get(name: string): string | null;
  set(name: string, value: string): void;
  has(name: string): boolean;
  delete(name: string): void;
  append(name: string, value: string): void;
  toString(): string;
}
declare class TextDecoder {
  constructor(encoding?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: Uint8Array | ArrayBuffer | null): string;
}
declare class TextEncoder {
  constructor();
  encode(input?: string): Uint8Array;
}
interface ReadableStream<R = unknown> {
  readonly locked: boolean;
  cancel(reason?: unknown): Promise<void>;
  getReader(): {
    read(): Promise<{ done: true; value?: undefined } | { done: false; value: R }>;
  };
}
interface WritableStream<W = unknown> {
  readonly locked: boolean;
}
declare class Response {
  constructor(body?: ReadableStream<Uint8Array> | Uint8Array | string | null);
  text(): Promise<string>;
}
declare const crypto: {
  getRandomValues<T extends Uint8Array>(array: T): T;
  randomUUID(): string;
  subtle: unknown;
};

declare function fetch(
  input: string | URL | { url?: string },
  init?: RequestInit,
): Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}>;
interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array | null;
  signal?: AbortSignal | null;
}
interface AbortSignal {
  aborted: boolean;
}
declare var AbortSignal: {
  timeout(milliseconds: number): AbortSignal;
};

declare module "bun:test" {
  export interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeUndefined(): void;
    toBeDefined(): void;
    toBeNull(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toContain(expected: unknown): void;
    toMatch(expected: string | RegExp): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toBeCloseTo(expected: number, digits?: number): void;
    toThrow(expected?: unknown): void;
    toHaveLength(expected: number): void;
    not: Matchers;
  }
  export function expect(actual: unknown): Matchers;
  export function test(name: string, fn: () => unknown, timeout?: number): void;
  export namespace test {
    export function skipIf(
      condition: boolean,
    ): (name: string, fn: () => unknown, timeout?: number) => void;
  }
  export function describe(name: string, fn: () => void): void;
  export function beforeAll(fn: () => unknown, timeout?: number): void;
  export function afterAll(fn: () => unknown, timeout?: number): void;
  export function beforeEach(fn: () => unknown, timeout?: number): void;
  export function afterEach(fn: () => unknown, timeout?: number): void;
}
