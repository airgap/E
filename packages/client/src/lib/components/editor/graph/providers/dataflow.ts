/**
 * DataflowProvider — semantic edition.
 *
 * Within the smallest enclosing function (or whole script when at top
 * level), each `const`/`let`/`var X = expr` becomes a node; identifiers
 * on the RHS that resolve to a previously-declared name become incoming
 * edges. Compared to the v1 brace-counter:
 *
 *   - Real function scope (FunctionDeclaration / Function/Arrow Expression
 *     / Method / Constructor / Get/Set) discovered via AST, not braces
 *   - Identifier references collected via the shared AST walker, which
 *     correctly skips property-access tails, type positions, JSX attribute
 *     names, and binding patterns
 *   - Destructuring binding patterns (`const { a, b } = obj`) now register
 *     `a` and `b` as separate variables (regex couldn't handle this)
 *   - Strings + comments don't false-edge (they aren't in the AST)
 */
import ts from 'typescript';
import type { RelationProvider, ProviderContext, RelationGraph } from '../types';
import {
  fileKindFromPath,
  scriptViewOf,
  enclosingFunction,
  collectIdentifierRefs,
  toDocOffset,
  lineOfOffset,
  type ScriptView,
} from '../ast';

interface VarDecl {
  id: string;
  name: string;
  /** Doc offset of the name token (for cursor centering + navigate). */
  nameOffset: number;
  /** The initialiser expression — used for ref inference. */
  initializer: ts.Node | null;
  /** Source-order index. Edges only flow from earlier→later (declared-before). */
  order: number;
}

/**
 * Recursively pull names out of a binding pattern. Handles:
 *   `const { a, b: alias, ...rest } = obj`
 *   `const [ x, y, ...tail ] = arr`
 * Each leaf identifier is reported with its position.
 */
function collectPatternNames(node: ts.BindingName): Array<{ name: string; pos: number }> {
  if (ts.isIdentifier(node)) return [{ name: node.text, pos: node.pos }];
  const out: Array<{ name: string; pos: number }> = [];
  if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
    for (const el of node.elements) {
      if (ts.isOmittedExpression(el)) continue;
      out.push(...collectPatternNames(el.name));
    }
  }
  return out;
}

/**
 * Collect every VariableDeclaration in `scope` (the FunctionLikeDeclaration
 * body or the script SourceFile when at top level). We do NOT descend into
 * nested function bodies — those are their own scopes for our purposes.
 */
export function extractDecls(view: ScriptView, scope: ts.Node): VarDecl[] {
  const decls: VarDecl[] = [];
  let order = 0;
  function visit(node: ts.Node) {
    // Don't dive into nested function-like bodies; they have their own
    // scope and their decls belong to a different graph.
    if (node !== scope) {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node)
      ) {
        return;
      }
    }
    if (ts.isVariableDeclaration(node)) {
      const names = collectPatternNames(node.name);
      for (const { name, pos } of names) {
        decls.push({
          id: `var:${name}`,
          name,
          nameOffset: toDocOffset(view, pos),
          initializer: node.initializer ?? null,
          order: order++,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(scope);
  return decls;
}

export function inferEdges(decls: VarDecl[]): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  const byName = new Map<string, VarDecl>();
  for (const d of decls) {
    if (d.initializer) {
      const refs = collectIdentifierRefs(d.initializer, { excludeTypes: true });
      const seenLocal = new Set<string>();
      for (const ref of refs) {
        if (ref.name === d.name) continue;
        if (seenLocal.has(ref.name)) continue;
        const src = byName.get(ref.name);
        if (src && src.order < d.order) {
          edges.push({ from: src.id, to: d.id });
          seenLocal.add(ref.name);
        }
      }
    }
    // Only register AFTER scanning so forward refs (use-before-decl)
    // don't emit edges.
    byName.set(d.name, d);
  }
  return edges;
}

function wordAtCursor(doc: string, pos: number): string | null {
  const lineStart = doc.lastIndexOf('\n', pos - 1) + 1;
  const lineEnd = doc.indexOf('\n', pos);
  const line = doc.slice(lineStart, lineEnd < 0 ? doc.length : lineEnd);
  const col = pos - lineStart;
  const left = line.slice(0, col).match(/[A-Za-z_$][\w$]*$/)?.[0] ?? '';
  const right = line.slice(col).match(/^[\w$]*/)?.[0] ?? '';
  return left + right || null;
}

export const dataflowProvider: RelationProvider = {
  kind: 'dataflow',
  supports(ctx: ProviderContext): boolean {
    return fileKindFromPath(ctx.filePath) !== null;
  },
  async build(ctx: ProviderContext): Promise<RelationGraph | null> {
    const kind = fileKindFromPath(ctx.filePath);
    if (!kind) return null;
    const view = scriptViewOf(ctx.doc, kind);
    if (!view.text) return null;

    // Translate doc-pos into script-pos (subtract scriptStart).
    const scriptPos = ctx.pos - view.start;
    const scope: ts.Node = enclosingFunction(view.source, scriptPos) ?? view.source;

    const decls = extractDecls(view, scope);
    if (decls.length < 2) return null;

    const edges = inferEdges(decls);
    if (edges.length === 0) return null;

    const cursorWord = wordAtCursor(ctx.doc, ctx.pos);
    const centerId =
      cursorWord && decls.find((d) => d.name === cursorWord) ? `var:${cursorWord}` : null;

    // Hover semantics: only surface when the cursor is on a variable in the
    // graph, so this doesn't pop on any code (see call-graph for context).
    if (!centerId) return null;

    const nodes = decls.map((d) => ({
      id: d.id,
      label: d.name,
      kind: 'symbol' as const,
      center: d.id === centerId,
      title: d.name,
      navigate: { filePath: ctx.filePath, line: lineOfOffset(ctx.doc, d.nameOffset) },
    }));

    return {
      kind: 'dataflow',
      title: `Dataflow · ${decls.length} var${decls.length === 1 ? '' : 's'}, ${edges.length} edge${edges.length === 1 ? '' : 's'}`,
      nodes,
      edges,
    };
  },
};

export const __test = { extractDecls, inferEdges, collectPatternNames, wordAtCursor };
