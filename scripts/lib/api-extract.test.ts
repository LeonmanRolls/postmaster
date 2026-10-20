// Tests beside scripts/lib/api-extract.ts. The declarations here are for an invented library.

import { describe, expect, test } from "bun:test";
import { cleanDoc, extractEntries, scanLines } from "./api-extract.ts";

const FILE = "widget-kit/index.d.ts";

const DECLARATIONS = [
  "/**",
  " * Options for the widget. Not documented anywhere else.",
  " */",
  "export interface WidgetConfig {",
  "  /** Name shown in the header. More detail follows. */",
  "  title?: string;",
  "  /** @deprecated Use `title`. */",
  "  caption?: string;",
  "  _internal?: boolean;",
  "  readonly retry_count: number;",
  "  onOpen(event: OpenEvent): void;",
  "  nested: {",
  "    depth: number;",
  "  };",
  "  'quoted-key'?: string;",
  "  [key: string]: unknown;",
  "}",
  "/** Make a widget. */",
  "export declare function makeWidget(config: WidgetConfig): Widget;",
  "export declare const VERSION: string;",
  'export type Mode = "a" | "b";',
  "export declare class Widget {",
  "  private secret: string;",
  "  #hidden: number;",
  "  constructor(config: WidgetConfig);",
  "  open(): void;",
  "  static create(): Widget;",
  "}",
  "export declare enum Level {",
  "  Low = 0,",
  "  High = 1",
  "}",
  "export type Layout = {",
  "  columns: number;",
  "};",
  "export type Both = Base & {",
  "  extra: string;",
  "};",
  "declare namespace Tools {",
  "  function sharpen(blade: Blade): void;",
  "}",
  "export { Widget as default, helper };",
  "",
].join("\n");

const entries = extractEntries(DECLARATIONS, FILE);
const bySymbol = (symbol: string) => entries.find((e) => e.symbol === symbol);

describe("cleanDoc", () => {
  test("keeps the first sentence", () => {
    expect(cleanDoc(" Name shown in the header. More detail follows. ")).toBe(
      "Name shown in the header.",
    );
  });

  test("reads a block with asterisks down the side", () => {
    expect(cleanDoc("\n * Options for the widget.\n * Second line.\n ")).toBe(
      "Options for the widget.",
    );
  });

  test("joins the lines of one paragraph and stops at a blank line", () => {
    expect(cleanDoc("\n * A widget that\n * wraps lines\n *\n * New paragraph.\n")).toBe(
      "A widget that wraps lines",
    );
  });

  test("drops tags and marks a deprecation", () => {
    expect(cleanDoc("\n * Old way.\n * @deprecated Use the new one.\n * @param x the x\n")).toBe(
      "(deprecated) Old way.",
    );
    expect(cleanDoc(" @deprecated Use `title`. ")).toBe("(deprecated)");
  });

  test("a sentence over two hundred characters is clipped", () => {
    const got = cleanDoc(` ${"word ".repeat(80)}`);
    expect(got.length).toBeLessThanOrEqual(200);
    expect(got.endsWith("...")).toBe(true);
  });
});

describe("scanLines", () => {
  test("takes comments out of the code and keeps the line numbers", () => {
    const lines = scanLines("const a = 1; // trailing\n/* block */ const b = 2;\nconst c = 3;\n");
    expect(lines.map((l) => l.code.trim())).toEqual([
      "const a = 1;",
      "const b = 2;",
      "const c = 3;",
    ]);
    expect(lines.map((l) => l.no)).toEqual([1, 2, 3]);
  });

  test("a brace inside a string is not a brace", () => {
    const [line] = scanLines("const a = \"{\" + '}';\n");
    expect(line?.code).toContain('"{"');
    expect(line?.mask).not.toContain("{");
    expect(line?.mask).not.toContain("}");
  });

  test("a doc comment attaches to the code line below it", () => {
    const lines = scanLines("/** Reads it. */\nexport const a = 1;\nexport const b = 2;\n");
    const a = lines.find((l) => l.code.includes("const a"));
    const b = lines.find((l) => l.code.includes("const b"));
    expect(a?.doc).toBe("Reads it.");
    expect(b?.doc).toBe("");
  });

  test("a plain block comment is not a doc comment", () => {
    const lines = scanLines("/* Not a doc. */\nexport const a = 1;\n");
    expect(lines.find((l) => l.code.includes("const a"))?.doc).toBe("");
  });

  test("// comment lines above a declaration are its doc only when asked", () => {
    const text = "// Reads the thing.\n// More detail.\nexport function readThing() {}\n";
    expect(scanLines(text).find((l) => l.code.includes("readThing"))?.doc).toBe("");
    expect(scanLines(text, true).find((l) => l.code.includes("readThing"))?.doc).toBe(
      "Reads the thing.",
    );
  });

  test("a blank line ends a run of // comments", () => {
    const text = "// Far away.\n\nexport function readThing() {}\n";
    expect(scanLines(text, true).find((l) => l.code.includes("readThing"))?.doc).toBe("");
  });

  test("a block doc wins over a // run", () => {
    const text = "// Line.\n/** Block. */\nexport function f() {}\n";
    expect(scanLines(text, true).find((l) => l.code.includes("function f"))?.doc).toBe("Block.");
  });
});

describe("extractEntries", () => {
  test("lists the declarations and their kinds", () => {
    expect(bySymbol("WidgetConfig")?.kind).toBe("interface");
    expect(bySymbol("makeWidget")?.kind).toBe("function");
    expect(bySymbol("VERSION")?.kind).toBe("const");
    expect(bySymbol("Mode")?.kind).toBe("type");
    expect(bySymbol("Widget")?.kind).toBe("class");
    expect(bySymbol("Level")?.kind).toBe("enum");
    expect(bySymbol("Layout")?.kind).toBe("type");
  });

  test("lists interface members as properties and methods, with the doc above each", () => {
    expect(bySymbol("WidgetConfig.title")?.kind).toBe("property");
    expect(bySymbol("WidgetConfig.title")?.doc).toBe("Name shown in the header.");
    expect(bySymbol("WidgetConfig.retry_count")?.kind).toBe("property");
    expect(bySymbol("WidgetConfig.onOpen")?.kind).toBe("method");
    expect(bySymbol("WidgetConfig.caption")?.doc).toBe("(deprecated)");
  });

  test("reads the doc comment above a declaration", () => {
    expect(bySymbol("WidgetConfig")?.doc).toBe("Options for the widget.");
    expect(bySymbol("makeWidget")?.doc).toBe("Make a widget.");
  });

  test("reads a quoted member name and the members of a nested object type", () => {
    expect(bySymbol("WidgetConfig.quoted-key")?.kind).toBe("property");
    expect(bySymbol("WidgetConfig.nested")?.kind).toBe("property");
    expect(bySymbol("WidgetConfig.nested.depth")?.kind).toBe("property");
  });

  test("leaves out what is not part of an API", () => {
    const symbols = entries.map((e) => e.symbol);
    expect(symbols).not.toContain("WidgetConfig._internal");
    expect(symbols).not.toContain("WidgetConfig.[key");
    expect(symbols.some((s) => s.includes("secret"))).toBe(false);
    expect(symbols.some((s) => s.includes("hidden"))).toBe(false);
    expect(symbols).not.toContain("Widget.constructor");
    expect(symbols.some((s) => s.startsWith("WidgetConfig.[")).valueOf()).toBe(false);
  });

  test("lists the members of a class, static ones too", () => {
    expect(bySymbol("Widget.open")?.kind).toBe("method");
    expect(bySymbol("Widget.create")?.kind).toBe("method");
  });

  test("lists enum members", () => {
    expect(bySymbol("Level.Low")?.kind).toBe("member");
    expect(bySymbol("Level.High")?.kind).toBe("member");
  });

  test("reads the members of an object type alias, also after an intersection", () => {
    expect(bySymbol("Layout.columns")?.kind).toBe("property");
    expect(bySymbol("Both.extra")?.kind).toBe("property");
  });

  test("reads a function inside a namespace", () => {
    expect(bySymbol("sharpen")?.kind).toBe("function");
  });

  test("lists a re-export under its exported name", () => {
    expect(bySymbol("default")).toBeUndefined();
    expect(bySymbol("helper")?.kind).toBe("re-export");
  });

  test("gives each entry the file and the line it sits on", () => {
    const retry = bySymbol("WidgetConfig.retry_count");
    expect(retry?.file).toBe(FILE);
    expect(retry?.line).toBe(10);
    expect(bySymbol("makeWidget")?.line).toBe(19);
  });

  test("a signature is one clipped line without the trailing semicolon", () => {
    expect(bySymbol("makeWidget")?.signature).toBe(
      "export declare function makeWidget(config: WidgetConfig): Widget",
    );
    const long = extractEntries(
      `export declare function f(${"argument: string, ".repeat(20)}): void;\n`,
      FILE,
    );
    expect(long[0]?.signature.length).toBeLessThanOrEqual(140);
    expect(long[0]?.signature.endsWith("...")).toBe(true);
  });

  test("a declaration it cannot read is left out, not guessed", () => {
    expect(extractEntries("this is not a declaration file at all {{{\n", FILE)).toEqual([]);
    expect(extractEntries("", FILE)).toEqual([]);
  });

  test("a brace inside a string or a comment does not break the nesting", () => {
    const text = [
      "export interface A {",
      '  open: "{";',
      "  // } a stray brace in a comment",
      "  close: string;",
      "}",
      "export interface B {",
      "  only: number;",
      "}",
    ].join("\n");
    const symbols = extractEntries(text, FILE).map((e) => e.symbol);
    expect(symbols).toEqual(["A", "A.open", "A.close", "B", "B.only"]);
  });
});
