// An Oxlint rule that finds every place a function changes something, for the two mutation counts
// of #372. It reports once per file, at the end, with a JSON message: every function with its
// lines, every change with what it lands on, and the events that tell what a function touches.
// What a change lands on is decided in mutation-core.ts; this file only reads the syntax tree and
// the scope analysis, so it is the one place that depends on Oxlint's plugin interface.
import {
  type Binding,
  type Ctx,
  type FileEvent,
  type Node,
  callSite,
  classifyRebind,
  classifyTarget,
  need,
  patternTargets,
  propertyName,
  unwrap,
} from "./mutation-core.ts";

const FS_MODULES = new Set(["node:fs", "fs", "node:fs/promises", "fs/promises"]);
const PROC_MODULES = new Set(["node:child_process", "child_process"]);
const OS_MODULES = new Set(["node:os", "os"]);
const BUN_TAGS: Readonly<Record<string, FileEvent[1]>> = {
  env: "env",
  file: "files",
  write: "files",
  spawn: "proc",
  spawnSync: "proc",
  $: "proc",
};

const moduleTag = (source: string): FileEvent[1] | null =>
  FS_MODULES.has(source)
    ? "files"
    : PROC_MODULES.has(source)
      ? "proc"
      : OS_MODULES.has(source)
        ? "os"
        : null;

// What the rule uses of Oxlint's ESLint-style plugin interface, named here so that none of it is `any`.
type Reference = Readonly<{
  identifier: Node;
  resolved: Variable | null;
  /** the expression a write gives the name; null for a read */
  writeExpr: Node | null;
  isWrite(): boolean;
}>;
type Definition = Readonly<{
  /** ImportBinding, Parameter, Variable, FunctionName, CatchClause, ... */
  type: string;
  node: Node;
  name?: Node;
  parent?: Node | null;
}>;
type Variable = Readonly<{
  defs: readonly Definition[];
  scope: Scope;
  references: readonly Reference[];
}>;
type Scope = Readonly<{
  set: ReadonlyMap<string, Variable>;
  upper: Scope | null;
  variableScope: Scope;
  block: Node;
  references: readonly Reference[];
}>;
type SourceCode = Readonly<{
  lines: readonly string[];
  scopeManager: Readonly<{ scopes: readonly Scope[] }>;
  getScope(node: Node): Scope;
  getText(node: Node): string;
}>;
type RuleContext = Readonly<{
  sourceCode: SourceCode;
  report(descriptor: Readonly<{ node: Node; message: string }>): void;
}>;
type Visitors = Readonly<Record<string, (node: Node) => void>>;

type Open = { id: number; node: Node; isArrow: boolean; isCtor: boolean };

const rule = {
  meta: { type: "suggestion", schema: [] },
  create(context: RuleContext): Visitors {
    const sc = context.sourceCode;
    const functions: Record<string, unknown>[] = [];
    const stack: Open[] = [];
    const places: Record<string, unknown>[] = [];
    const events: FileEvent[] = [];
    const imports: [string, boolean][] = [];
    const bindings = new Map<Variable, Binding | null>();

    const variableOf = (id: Node): Variable | null => {
      const name = id.name ?? "";
      for (let s: Scope | null = sc.getScope(id); s !== null; s = s.upper) {
        const v = s.set.get(name);
        if (v !== undefined) return v;
      }
      return null;
    };

    const bindingOf = (v: Variable): Binding | null => {
      const cached = bindings.get(v);
      if (cached !== undefined) return cached;
      const def = v.defs[0];
      let made: Binding | null = null;
      if (def !== undefined) {
        const block = v.scope.variableScope.block;
        const owner: Node | null = block.type === "Program" ? null : block;
        if (def.type === "ImportBinding") {
          made = { kind: "import", owner: null, rest: false, assigned: [], iterated: [] };
        } else if (def.type === "Parameter") {
          made = {
            kind: "param",
            owner: def.node,
            rest: def.name?.parent?.type === "RestElement",
            assigned: [],
            iterated: [],
          };
        } else {
          const declaration = def.type === "Variable" ? (def.parent ?? null) : null;
          const loop = declaration?.parent;
          const looped = loop?.right;
          const iterated: Node[] =
            (loop?.type === "ForOfStatement" || loop?.type === "ForInStatement") &&
            loop.left === declaration &&
            looped !== undefined
              ? [looped]
              : [];
          const assigned: Node[] = [];
          for (const r of v.references) {
            if (r.isWrite() && r.writeExpr) assigned.push(r.writeExpr);
          }
          made = { kind: "var", owner, rest: false, assigned, iterated };
        }
      }
      bindings.set(v, made);
      return made;
    };

    const resolve = (id: Node): Binding | null => {
      const v = variableOf(id);
      return v === null ? null : bindingOf(v);
    };

    // a builtin such as Date has an entry in the global scope, but no declaration in the file
    const isGlobal = (id: Node): boolean => {
      if (id.type !== "Identifier") return false;
      const v = variableOf(id);
      return v === null || v.defs.length === 0;
    };

    const ctxNow = (): Ctx => {
      let i = stack.length - 1;
      while (i >= 0 && (stack[i] as Open).isArrow) i--;
      return {
        resolve,
        fn: stack.length > 0 ? (stack[stack.length - 1] as Open).node : null,
        thisIsOwn: i >= 0 && (stack[i] as Open).isCtor,
      };
    };

    const squash = (text: string, max: number): string =>
      text.replace(/\s+/gu, " ").trim().slice(0, max);

    const addPlace = (op: string, how: string, target: Node, at: Node, rebind: boolean): void => {
      const ctx = ctxNow();
      const { root, alias } = rebind
        ? classifyRebind(unwrap(target), ctx)
        : classifyTarget(target, ctx);
      const line = at.loc.start.line;
      places.push({
        line,
        col: at.loc.start.column + 1,
        off: at.range[0],
        fn: stack.length > 0 ? (stack[stack.length - 1] as Open).id : -1,
        op,
        how,
        root,
        alias,
        target: squash(sc.getText(target), 80),
        src: squash(sc.lines[line - 1] ?? "", 160),
      });
    };

    const assignTargets = (left: Node, how: string, at: Node): void => {
      for (const t of patternTargets(left)) {
        if (t.type === "Identifier") addPlace("rebind", how, t, at, true);
        else addPlace("prop", how, need(t.object), at, false);
      }
    };

    const enter = (node: Node): void => {
      const parent = node.parent;
      const isCtor = parent?.type === "MethodDefinition" && parent.kind === "constructor";
      const id = functions.length;
      functions.push({
        id,
        parent: stack.length > 0 ? (stack[stack.length - 1] as Open).id : -1,
        kind: node.type,
        name: nameOf(node),
        startLine: node.loc.start.line,
        endLine: node.loc.end.line,
        start: node.range[0],
        end: node.range[1],
      });
      stack.push({ id, node, isArrow: node.type === "ArrowFunctionExpression", isCtor });
    };
    const exit = (): void => {
      stack.pop();
    };

    const nameOf = (node: Node): string => {
      if (node.id?.name) return node.id.name;
      const p = node.parent;
      if (p === undefined || p === null) return "";
      const pid = p.id;
      if (p.type === "VariableDeclarator" && pid?.type === "Identifier") return pid.name ?? "";
      const key = p.key;
      if (
        (p.type === "Property" ||
          p.type === "MethodDefinition" ||
          p.type === "PropertyDefinition") &&
        key
      ) {
        return key.type === "Identifier" ? (key.name ?? "") : squash(sc.getText(key), 40);
      }
      if (p.type === "AssignmentExpression") return squash(sc.getText(need(p.left)), 40);
      if (p.type === "CallExpression" && p.callee !== node) {
        return `callback of ${squash(sc.getText(need(p.callee)), 40)}`;
      }
      return "";
    };

    const event = (at: Node, tag: FileEvent[1]): void => {
      events.push([at.range[0], tag]);
    };

    return {
      FunctionDeclaration: enter,
      "FunctionDeclaration:exit": exit,
      FunctionExpression: enter,
      "FunctionExpression:exit": exit,
      ArrowFunctionExpression: enter,
      "ArrowFunctionExpression:exit": exit,

      AssignmentExpression(node: Node) {
        assignTargets(need(node.left), node.operator ?? "", node);
      },
      UpdateExpression(node: Node) {
        assignTargets(need(node.argument), node.operator ?? "", node);
      },
      UnaryExpression(node: Node) {
        if (node.operator !== "delete") return;
        const arg = unwrap(need(node.argument));
        if (arg.type === "MemberExpression") {
          addPlace("delete", "delete", need(arg.object), node, false);
        }
      },
      CallExpression(node: Node) {
        const callee = unwrap(need(node.callee));
        const site = callSite(node);
        if (site !== null) {
          const at = site.op === "call" ? need(callee.property) : node;
          addPlace(site.op, site.how, site.target, at, false);
        }
        if (callee.type === "MemberExpression") {
          const object = unwrap(need(callee.object));
          const name = propertyName(callee);
          if (object.type === "Identifier" && isGlobal(object) && name !== null) {
            if (object.name === "Date" && name === "now") event(node, "clock");
            if (object.name === "performance" && name === "now") event(node, "clock");
          }
        } else if (callee.type === "Identifier" && callee.name === "require" && isGlobal(callee)) {
          const first = need(node.arguments)[0];
          const tag = first?.type === "Literal" ? moduleTag(String(first.value)) : null;
          if (tag !== null) event(node, tag);
        }
      },
      NewExpression(node: Node) {
        const callee = unwrap(need(node.callee));
        if (callee.type === "Identifier" && callee.name === "Date" && isGlobal(callee)) {
          if (need(node.arguments).length === 0) event(node, "clock");
        }
      },
      ImportExpression(node: Node) {
        const source = node.source;
        const tag = source?.type === "Literal" ? moduleTag(String(source.value)) : null;
        if (tag !== null) event(node, tag);
      },
      ImportDeclaration(node: Node) {
        imports.push([String(need(node.source).value), node.importKind === "type"]);
      },
      MemberExpression(node: Node) {
        const object = unwrap(need(node.object));
        const name = propertyName(node);
        if (name === null) return;
        if (object.type === "MetaProperty" && name === "env") event(node, "env");
        if (object.type !== "Identifier" || !isGlobal(object)) return;
        if (object.name === "process" && name === "env") event(node, "env");
        if (object.name === "Bun" && Object.hasOwn(BUN_TAGS, name)) {
          event(node, BUN_TAGS[name] as FileEvent[1]);
        }
      },
      VariableDeclarator(node: Node) {
        // const { env } = process;  const { file, write } = Bun;
        const init = node.init ? unwrap(node.init) : null;
        const pattern = node.id;
        if (init === null || init.type !== "Identifier" || !isGlobal(init)) return;
        if (pattern?.type !== "ObjectPattern") return;
        for (const q of need(pattern.properties)) {
          const key = q.key;
          if (q.type !== "Property" || key?.type !== "Identifier") continue;
          const name = key.name ?? "";
          if (init.name === "process" && name === "env") event(q, "env");
          if (init.name === "Bun" && Object.hasOwn(BUN_TAGS, name)) {
            event(q, BUN_TAGS[name] as FileEvent[1]);
          }
        }
      },
      ForInStatement(node: Node) {
        const left = need(node.left);
        if (left.type !== "VariableDeclaration") assignTargets(left, "for-in", node);
      },
      ForOfStatement(node: Node) {
        const left = need(node.left);
        if (left.type !== "VariableDeclaration") assignTargets(left, "for-of", node);
      },

      "Program:exit"(node: Node) {
        // a name that comes from fs, child_process or os, used anywhere, is an event where it is used
        for (const scope of sc.scopeManager.scopes) {
          for (const ref of scope.references) {
            const def = ref.resolved?.defs[0];
            if (def?.type !== "ImportBinding") continue;
            const declaration = def.parent;
            if (declaration === null || declaration === undefined) continue;
            if (declaration.importKind === "type" || def.node.importKind === "type") continue;
            const tag = moduleTag(String(need(declaration.source).value));
            if (tag !== null) event(ref.identifier, tag);
          }
        }
        const blank: number[] = [];
        sc.lines.forEach((text, i) => {
          if (text.trim() === "") blank.push(i + 1);
        });
        context.report({
          node,
          message: JSON.stringify({
            // a final newline leaves an empty last element, which is no line of the file
            lines: sc.lines.length - (sc.lines[sc.lines.length - 1] === "" ? 1 : 0),
            blank,
            imports,
            functions,
            places,
            events,
          }),
        });
      },
    };
  },
};

export default { meta: { name: "mutation" }, rules: { count: rule } };
