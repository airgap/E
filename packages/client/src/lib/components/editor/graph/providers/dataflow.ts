/**
 * DataflowProvider — Phase 3.
 *
 * Intra-function variable dataflow DAG. Within the function/block scope
 * that contains the cursor, each `const`/`let`/`var X = expr` becomes a
 * node; identifiers appearing on the RHS that match a previously-declared
 * name in the same scope become incoming edges.
 *
 *   let a = source()
 *   let b = a + 1
 *   let c = transform(b, a)
 *
 *     a  ──►  b
 *     ╰────►  c
 *     b  ────►  c
 *
 * Scope: we walk outward from the cursor offset to the nearest enclosing
 * `{ … }` block (via brace-balance scan). If no enclosing block is found
 * (cursor at top level), the whole file is the scope.
 *
 * Lexical, not semantic — destructuring patterns, shadowed names, and
 * type-only references will give the same false positives the other
 * regex-based providers do. The trade is intentional for v1.
 */
import type { RelationProvider, ProviderContext, RelationGraph } from '../types';

const SUPPORTED_EXT = /\.(ts|tsx|svelte|pui)$/;

interface VarDecl {
  id: string;
  name: string;
  /** Offset of the name token in the original doc (for cursor centering). */
  nameOffset: number;
  /** RHS source (initialiser expression). */
  rhs: string;
}

// ── Scope finding ──────────────────────────────────────────────────────

/**
 * Find the smallest `{ … }` block that contains `pos`. Returns the
 * substring from the open brace to the matching close brace, with the
 * absolute offset where it starts. Returns the whole doc when no
 * enclosing block exists (cursor sits at top level).
 */
export function enclosingScope(doc: string, pos: number): { start: number; text: string } {
  // Walk backward, counting braces. When we see a `{` that doesn't have a
  // matching `}` between it and pos, that's our enclosing open brace.
  let unmatchedClose = 0;
  let openIdx = -1;
  for (let i = pos - 1; i >= 0; i--) {
    const ch = doc[i];
    if (ch === '}') unmatchedClose++;
    else if (ch === '{') {
      if (unmatchedClose === 0) {
        openIdx = i;
        break;
      }
      unmatchedClose--;
    }
  }
  if (openIdx < 0) return { start: 0, text: doc };

  // Find the matching close.
  let depth = 0;
  for (let i = openIdx; i < doc.length; i++) {
    if (doc[i] === '{') depth++;
    else if (doc[i] === '}') {
      depth--;
      if (depth === 0) {
        return { start: openIdx, text: doc.slice(openIdx, i + 1) };
      }
    }
  }
  return { start: openIdx, text: doc.slice(openIdx) };
}

// ── Variable extraction ───────────────────────────────────────────────

/**
 * Match a declaration head `const|let|var NAME =` (single-name only —
 * destructuring patterns are out of scope for v1) and slice the
 * initialiser up to the next `;` or unbalanced `,` at depth 0. We use
 * paren/brace/bracket depth tracking so commas inside `f(a, b)` don't
 * end the slice prematurely.
 */
const VAR_HEAD = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?\s*=/g;

function extractDecls(scopeText: string, scopeStart: number): VarDecl[] {
  const decls: VarDecl[] = [];
  let m: RegExpExecArray | null;
  VAR_HEAD.lastIndex = 0;
  while ((m = VAR_HEAD.exec(scopeText)) !== null) {
    const name = m[1];
    const nameOffset = scopeStart + m.index + m[0].indexOf(name);
    const rhsStart = m.index + m[0].length;
    const rhs = sliceInitialiser(scopeText, rhsStart);
    decls.push({ id: `var:${name}`, name, nameOffset, rhs });
  }
  return decls;
}

/**
 * Slice from `start` up to the next `;`, `\n`, or unbalanced `,` at
 * depth 0 of `(` / `[` / `{` — approximation of a JS expression
 * boundary. Good enough for the regex-tier we're operating at.
 */
function sliceInitialiser(doc: string, start: number): string {
  let depth = 0;
  for (let i = start; i < doc.length; i++) {
    const ch = doc[i];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth < 0) return doc.slice(start, i);
    } else if (depth === 0 && (ch === ';' || ch === '\n')) {
      return doc.slice(start, i);
    }
  }
  return doc.slice(start);
}

/**
 * Collect identifier references inside `text`, excluding:
 *   - identifiers immediately after a `.` (member access — `foo.bar`
 *     should not count `bar` as a reference to a declared variable)
 *   - JS keywords / boolean literals
 *   - strings (rough — we skip content between matched quotes)
 */
const KEYWORDS = new Set([
  'true',
  'false',
  'null',
  'undefined',
  'this',
  'new',
  'typeof',
  'instanceof',
  'in',
  'of',
  'as',
  'await',
  'async',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'default',
  'break',
  'continue',
  'function',
  'const',
  'let',
  'var',
  'class',
  'extends',
  'super',
  'try',
  'catch',
  'finally',
  'throw',
  'void',
  'yield',
  'delete',
]);

function extractRefs(text: string): Set<string> {
  // Strip string literals (single/double/backtick) so identifiers inside
  // them don't count. Naive — doesn't handle escapes inside strings, but
  // false positives there are harmless for our lexical inference.
  const noStrings = text.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""');

  const refs = new Set<string>();
  const ID_RE = /([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = ID_RE.exec(noStrings)) !== null) {
    const name = m[1];
    if (KEYWORDS.has(name)) continue;
    // Skip if preceded by `.` (member access, optional chaining, etc).
    const prev = noStrings[m.index - 1];
    if (prev === '.') continue;
    refs.add(name);
  }
  return refs;
}

// ── Provider ──────────────────────────────────────────────────────────

function inferEdges(decls: VarDecl[]): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  const byName = new Map<string, VarDecl>();
  for (const d of decls) {
    const refs = extractRefs(d.rhs);
    for (const name of refs) {
      const src = byName.get(name);
      if (src && src !== d) edges.push({ from: src.id, to: d.id });
    }
    // Only declared-before-use counts: register AFTER scanning so
    // self-references and forward-refs are correctly skipped.
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

function lineNumberOf(doc: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < doc.length; i++) {
    if (doc[i] === '\n') line++;
  }
  return line;
}

export const dataflowProvider: RelationProvider = {
  kind: 'dataflow',
  supports(ctx: ProviderContext): boolean {
    return SUPPORTED_EXT.test(ctx.filePath);
  },
  async build(ctx: ProviderContext): Promise<RelationGraph | null> {
    const scope = enclosingScope(ctx.doc, ctx.pos);
    const decls = extractDecls(scope.text, scope.start);
    if (decls.length < 2) return null;

    const edges = inferEdges(decls);
    if (edges.length === 0) return null;

    const cursorWord = wordAtCursor(ctx.doc, ctx.pos);
    const centerId =
      cursorWord && decls.find((d) => d.name === cursorWord) ? `var:${cursorWord}` : null;

    const nodes = decls.map((d) => ({
      id: d.id,
      label: d.name,
      kind: 'symbol' as const,
      center: d.id === centerId,
      title: d.name,
      navigate: { filePath: ctx.filePath, line: lineNumberOf(ctx.doc, d.nameOffset) },
    }));

    return {
      kind: 'dataflow',
      title: `Dataflow · ${decls.length} var${decls.length === 1 ? '' : 's'}, ${edges.length} edge${edges.length === 1 ? '' : 's'}`,
      nodes,
      edges,
    };
  },
};

export const __test = {
  enclosingScope,
  extractDecls,
  extractRefs,
  inferEdges,
  sliceInitialiser,
};
