/**
 * CallGraphProvider — semantic edition.
 *
 * Walks the TS AST to find function-like declarations (FunctionDeclaration,
 * arrow / function-expression bound to a const/let/var), then walks each
 * body for CallExpression nodes whose head identifier names another
 * declared function. The regex-era false positives are gone:
 *
 *   - `foo` mentioned without `(` — not a call, no edge
 *   - `obj.foo()` — not a call to local `foo`, no edge
 *   - `foo("foo()")` — string literal contents are ignored
 *   - `// foo()` inside a comment — comments aren't in the AST
 *
 * Self-recursion is still suppressed (no self-loop noise). Cross-file
 * calls are out of scope here; LSP `callHierarchy` is the natural next
 * iteration.
 */
import ts from 'typescript';
import type { RelationProvider, ProviderContext, RelationGraph } from '../types';
import { fileKindFromPath, scriptViewOf, toDocOffset, lineOfOffset, type ScriptView } from '../ast';

interface FnDecl {
  id: string;
  name: string;
  /** Doc offset of the name token. */
  nameStart: number;
  body: ts.Node;
}

function declNameAndBody(decl: ts.VariableDeclaration): { name: string; body: ts.Node } | null {
  if (!decl.initializer) return null;
  if (!ts.isIdentifier(decl.name)) return null;
  const init = decl.initializer;
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
    return { name: decl.name.text, body: init.body };
  }
  return null;
}

export function extractDecls(view: ScriptView): FnDecl[] {
  const decls: FnDecl[] = [];
  const seen = new Set<string>();
  function add(name: string, body: ts.Node, namePos: number) {
    if (seen.has(name)) return;
    seen.add(name);
    decls.push({
      id: `fn:${name}`,
      name,
      nameStart: toDocOffset(view, namePos),
      body,
    });
  }
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      add(node.name.text, node.body, node.name.pos);
      // Don't recurse — captured the body via `add`. We still want to
      // catch nested function declarations though, so walk in.
      ts.forEachChild(node.body, visit);
      return;
    }
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        const got = declNameAndBody(d);
        if (got) add(got.name, got.body, d.name.pos);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(view.source);
  return decls;
}

/**
 * For each function, walk its body for CallExpression nodes and check
 * whether the call head identifier matches another declared name.
 */
export function inferEdges(decls: FnDecl[]): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  const byName = new Map<string, FnDecl>();
  for (const d of decls) byName.set(d.name, d);

  for (const caller of decls) {
    const seenEdge = new Set<string>();
    function visit(n: ts.Node) {
      if (ts.isCallExpression(n)) {
        const head = n.expression;
        if (ts.isIdentifier(head)) {
          const callee = byName.get(head.text);
          if (callee && callee !== caller) {
            const key = `${caller.id}|${callee.id}`;
            if (!seenEdge.has(key)) {
              seenEdge.add(key);
              edges.push({ from: caller.id, to: callee.id });
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    }
    visit(caller.body);
  }
  return edges;
}

export function wordAtCursor(doc: string, pos: number): string | null {
  const lineStart = doc.lastIndexOf('\n', pos - 1) + 1;
  const lineEnd = doc.indexOf('\n', pos);
  const line = doc.slice(lineStart, lineEnd < 0 ? doc.length : lineEnd);
  const col = pos - lineStart;
  const left = line.slice(0, col).match(/[A-Za-z_$][\w$]*$/)?.[0] ?? '';
  const right = line.slice(col).match(/^[\w$]*/)?.[0] ?? '';
  return left + right || null;
}

export const callGraphProvider: RelationProvider = {
  kind: 'call',
  supports(ctx: ProviderContext): boolean {
    return fileKindFromPath(ctx.filePath) !== null;
  },
  async build(ctx: ProviderContext): Promise<RelationGraph | null> {
    const kind = fileKindFromPath(ctx.filePath);
    if (!kind) return null;
    const view = scriptViewOf(ctx.doc, kind);
    const decls = extractDecls(view);
    if (decls.length < 2) return null;

    const edges = inferEdges(decls);
    if (edges.length === 0) return null;

    const cursorWord = wordAtCursor(ctx.doc, ctx.pos);
    const centerId =
      cursorWord && decls.find((d) => d.name === cursorWord) ? `fn:${cursorWord}` : null;

    // Hover semantics: only surface the call graph when the cursor is actually
    // on a function that's part of it. Without this gate the whole-file graph
    // popped on *any* hover (regression after the import graph moved off hover).
    if (!centerId) return null;

    const nodes = decls.map((d) => ({
      id: d.id,
      label: d.name,
      kind: 'symbol' as const,
      center: d.id === centerId,
      title: `function ${d.name}`,
      navigate: { filePath: ctx.filePath, line: lineOfOffset(ctx.doc, d.nameStart) },
    }));

    return {
      kind: 'call',
      title: `Call graph · ${decls.length} fn${decls.length === 1 ? '' : 's'}, ${edges.length} edge${edges.length === 1 ? '' : 's'}`,
      nodes,
      edges,
    };
  },
};

export const __test = { extractDecls, inferEdges, wordAtCursor };
