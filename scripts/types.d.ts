declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  pid: number;
  platform: string;
  getuid?(): number;
  cwd(): string;
  chdir(path: string): void;
  exit(code?: number): never;
  stdout: { write(value: string | Uint8Array): boolean };
  stderr: { write(value: string | Uint8Array): boolean };
  stdin: { read(): Uint8Array | null; on(event: string, callback: (...args: any[]) => void): void };
};

declare const Bun: {
  version: string;
  TOML: { parse(text: string): unknown };
  file(path: string): { text(): Promise<string>; exists(): Promise<boolean>; arrayBuffer(): Promise<ArrayBuffer> };
  write(path: string, data: string | Uint8Array): Promise<number>;
  sleep(milliseconds: number): Promise<void>;
  spawn(command: string[], options?: any): any;
  $: any;
};

declare module "node:fs" {
  export const accessSync: any;
  export const appendFileSync: any;
  export const chmodSync: any;
  export const closeSync: any;
  export const copyFileSync: any;
  export const cpSync: any;
  export const existsSync: any;
  export const fstatSync: any;
  export const lstatSync: any;
  export const mkdirSync: any;
  export const mkdtempSync: any;
  export const openSync: any;
  export const readFileSync: any;
  export const readdirSync: any;
  export const readlinkSync: any;
  export const realpathSync: any;
  export const renameSync: any;
  export const rmSync: any;
  export const statSync: any;
  export const symlinkSync: any;
  export const unlinkSync: any;
  export const utimesSync: any;
  export const writeFileSync: any;
  export const constants: any;
}
declare module "node:fs/promises" {
  export const access: any;
  export const cp: any;
  export const mkdir: any;
  export const mkdtemp: any;
  export const readFile: any;
  export const readdir: any;
  export const realpath: any;
  export const rm: any;
  export const stat: any;
  export const writeFile: any;
}
declare module "node:path" {
  export const basename: any;
  export const dirname: any;
  export const extname: any;
  export const isAbsolute: any;
  export const join: any;
  export const normalize: any;
  export const parse: any;
  export const relative: any;
  export const resolve: any;
  export const sep: string;
}
declare module "node:os" {
  export const homedir: any;
  export const tmpdir: any;
  export const EOL: string;
}
declare module "node:crypto" {
  export const createHash: any;
  export const randomBytes: any;
  export const randomUUID: any;
}
declare module "node:child_process" {
  export const spawn: any;
  export const spawnSync: any;
  export const execFileSync: any;
}
declare module "node:url" {
  export const fileURLToPath: any;
}
declare module "node:util" {
  export const promisify: any;
}
