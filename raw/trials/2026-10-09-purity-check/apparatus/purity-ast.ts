// The rules of purity-check.ts found from syntax trees instead of tokens, as an Oxlint plugin.
// It shares the list of names with the token version and nothing else, so the two agreeing on a
// module is a check on how each finds the places, not on what it looks for.
//
// Loaded by Oxlint (Node), through a configuration made by cross-check.ts:
//   { "jsPlugins": [<this file>], "rules": { "purity/flag": "error" } }
import { MEMBER_RULES, MODULE_KINDS } from "./purity-check.ts";

type Node = {
  type: string;
  name?: string;
  value?: unknown;
  computed?: boolean;
  optional?: boolean;
  object?: Node;
  property?: Node;
  meta?: Node;
  callee?: Node;
  arguments?: Node[];
  source?: Node | null;
  importKind?: string;
  exportKind?: string;
};

type Context = Readonly<{ report(d: Readonly<{ node: Node; message: string }>): void }>;

const memberName = (m: Node): string | undefined => {
  const p = m.property;
  if (p === undefined) return undefined;
  if (!m.computed && p.type === "Identifier") return p.name;
  if (m.computed && p.type === "Literal" && typeof p.value === "string") return p.value;
  return undefined;
};

const moduleOf = (source: Node | null | undefined): string | undefined => {
  if (source === null || source === undefined) return undefined;
  if (source.type !== "Literal" || typeof source.value !== "string") return undefined;
  const spec = source.value.startsWith("node:") ? source.value.slice(5) : source.value;
  return MODULE_KINDS.has(spec) ? spec : undefined;
};

const flag = {
  meta: { type: "problem", docs: { description: "the places the purity check flags" }, schema: [] },
  create(context: Context) {
    const report = (node: Node, rule: string, typeOnly = false): void =>
      context.report({ node, message: rule + (typeOnly ? " (type only)" : "") });
    const fromModule = (node: Node, source: Node | null | undefined, typeOnly = false): void => {
      const spec = moduleOf(source);
      if (spec !== undefined) report(node, `import:${spec}`, typeOnly);
    };
    return {
      MemberExpression(node: Node) {
        const obj = node.object;
        const prop = memberName(node);
        if (obj === undefined || prop === undefined) return;
        if (obj.type === "Identifier" && MEMBER_RULES.has(`${obj.name}.${prop}`)) {
          report(node, `${obj.name}.${prop}`);
        } else if (
          obj.type === "MetaProperty" &&
          obj.meta?.name === "import" &&
          obj.property?.name === "meta" &&
          prop === "env"
        ) {
          report(node, "import.meta.env");
        }
      },
      NewExpression(node: Node) {
        if (node.callee?.type === "Identifier" && node.callee.name === "Date") {
          if (node.arguments?.length === 0) report(node, "new Date()");
        }
      },
      ImportDeclaration(node: Node) {
        fromModule(node, node.source, node.importKind === "type");
      },
      ImportExpression(node: Node) {
        fromModule(node, node.source);
      },
      ExportAllDeclaration(node: Node) {
        fromModule(node, node.source);
      },
      ExportNamedDeclaration(node: Node) {
        fromModule(node, node.source);
      },
      CallExpression(node: Node) {
        if (node.callee?.type === "Identifier" && node.callee.name === "require") {
          fromModule(node, node.arguments?.[0]);
        }
      },
    };
  },
} as const;

export default { meta: { name: "purity" }, rules: { flag } } as const;
