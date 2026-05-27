/**
 * CallGraphProvider — Phase 3.
 *
 * Intra-file function call graph for ts/tsx (and the script blocks of
 * svelte/pui by happenstance — they use the same syntax).
 *
 * Nodes: each declared function/method/arrow-bound-to-const.
 * Edges:  caller → callee whenever the caller's body lexically references
 *         another declared function's name in a call position.
 *
 * Like the reactive provider, this is intentionally lexical, not semantic.
 * A semantic call graph needs LSP `callHierarchy` (cross-file, accurate);
 * that's the natural next iteration. Lexical intra-file is useful enough
 * for "what does this function reach" reading at hover time.
 *
 * Center selection: if the cursor sits on a declared function name, that
 * node becomes the centered one. Otherwise no center — the renderer
 * shows the whole file's graph un-emphasised.
 */
import type { RelationProvider, ProviderContext, RelationGraph } from '../types';

const SUPPORTED_EXT = /\.(ts|tsx|svelte|pui)$/;

interface FnDecl {
  id: string;
  name: string;
  /** Source-position offset of the declaration's name token (for cursor centering). */
  nameStart: number;
  /** The function body source slice — used for callee lexical inference. */
  body: string;
}

// ── Declaration extractors ────────────────────────────────────────────

/**
 * Catches three common declaration shapes:
 *   1. `function foo(...)` (and `async function foo`, `export function foo`, etc.)
 *   2. `const foo = (...) => ...` or `const foo = function(...) {...}`
 *   3. Method shorthand inside class/object: `foo(...) { ... }` — too noisy
 *      to match reliably without a parser; deferred.
 *
 * We capture the name + a body slice via brace-counting from the opening
 * `{` (or up to a newline for arrow expression bodies).
 */
const FN_KEYWORD = /\b(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/g;
const FN_CONST =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g;
const FN_CONST_KEYWORD =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\*?\s*\(/g;

/**
 * Scan forward from `start` (index of an opening `{`) and return the
 * substring through the matching close brace. Naive — treats `{` / `}`
 * inside strings/regex/comments as real. Good enough for finding callees,
 * which only need to see identifier-shaped tokens; it's not used for
 * semantic analysis.
 */
function sliceBracedBody(doc: string, openBraceIdx: number): string {
  if (doc[openBraceIdx] !== '{') return '';
  let depth = 0;
  for (let i = openBraceIdx; i < doc.length; i++) {
    const ch = doc[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return doc.slice(openBraceIdx, i + 1);
    }
  }
  return doc.slice(openBraceIdx);
}

/**
 * For an arrow expression body (`const x = () => expr`), the body is
 * everything from the `=>` up to the line/statement end. Approximated.
 */
function sliceArrowBody(doc: string, arrowIdx: number): string {
  // arrowIdx points at `>` of `=>`. Body starts at arrowIdx+1.
  const start = arrowIdx + 1;
  // If the next non-whitespace is `{`, it's a block body — slice that.
  let j = start;
  while (j < doc.length && /\s/.test(doc[j])) j++;
  if (doc[j] === '{') return sliceBracedBody(doc, j);
  // Otherwise expression body up to the next `;` or newline at the same
  // paren/bracket depth — approximate by scanning to the next `\n` or `;`
  // at depth 0 of `(`/`{`/`[`.
  let paren = 0;
  for (let i = start; i < doc.length; i++) {
    const ch = doc[i];
    if (ch === '(' || ch === '[' || ch === '{') paren++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      paren--;
      if (paren < 0) return doc.slice(start, i);
    } else if (paren === 0 && (ch === '\n' || ch === ';')) {
      return doc.slice(start, i);
    }
  }
  return doc.slice(start);
}

function extractDecls(doc: string): FnDecl[] {
  const decls: FnDecl[] = [];
  let m: RegExpExecArray | null;

  // `function foo(...) { ... }`
  FN_KEYWORD.lastIndex = 0;
  while ((m = FN_KEYWORD.exec(doc)) !== null) {
    const name = m[1];
    const nameStart = m.index + m[0].indexOf(name);
    // Find the matching `{` after the parameter list.
    const parenEnd = findMatchingClose(doc, m.index + m[0].length - 1, '(', ')');
    if (parenEnd < 0) continue;
    const braceIdx = doc.indexOf('{', parenEnd);
    if (braceIdx < 0) continue;
    decls.push({ id: `fn:${name}`, name, nameStart, body: sliceBracedBody(doc, braceIdx) });
  }

  // `const foo = (...) => ...` or `const foo = x => ...`
  FN_CONST.lastIndex = 0;
  while ((m = FN_CONST.exec(doc)) !== null) {
    const name = m[1];
    const nameStart = m.index + m[0].indexOf(name);
    // Locate the `=>` we matched.
    const arrowIdx = doc.indexOf('=>', m.index + m[0].length - 2);
    if (arrowIdx < 0) continue;
    decls.push({
      id: `fn:${name}`,
      name,
      nameStart,
      body: sliceArrowBody(doc, arrowIdx + 1),
    });
  }

  // `const foo = function(...) { ... }`
  FN_CONST_KEYWORD.lastIndex = 0;
  while ((m = FN_CONST_KEYWORD.exec(doc)) !== null) {
    const name = m[1];
    const nameStart = m.index + m[0].indexOf(name);
    const parenEnd = findMatchingClose(doc, m.index + m[0].length - 1, '(', ')');
    if (parenEnd < 0) continue;
    const braceIdx = doc.indexOf('{', parenEnd);
    if (braceIdx < 0) continue;
    decls.push({ id: `fn:${name}`, name, nameStart, body: sliceBracedBody(doc, braceIdx) });
  }

  // De-dup by id; first wins.
  const seen = new Set<string>();
  return decls.filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
}

function findMatchingClose(doc: string, openIdx: number, openCh: string, closeCh: string): number {
  if (doc[openIdx] !== openCh) return -1;
  let depth = 0;
  for (let i = openIdx; i < doc.length; i++) {
    if (doc[i] === openCh) depth++;
    else if (doc[i] === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * For each declared function, scan its body for call-site identifiers
 * matching another declared name. Call site = identifier immediately
 * followed by `(`. Excludes calls to self (recursion noise — could be
 * surfaced as a self-loop later if useful).
 */
function inferEdges(decls: FnDecl[]): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  for (const caller of decls) {
    for (const callee of decls) {
      if (callee === caller) continue;
      const re = new RegExp(`\\b${escapeRegExp(callee.name)}\\s*\\(`);
      if (re.test(caller.body)) edges.push({ from: caller.id, to: callee.id });
    }
  }
  return edges;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

export const callGraphProvider: RelationProvider = {
  kind: 'call',
  supports(ctx: ProviderContext): boolean {
    return SUPPORTED_EXT.test(ctx.filePath);
  },
  async build(ctx: ProviderContext): Promise<RelationGraph | null> {
    const decls = extractDecls(ctx.doc);
    if (decls.length < 2) return null; // a single function has nothing to call locally

    const cursorWord = wordAtCursor(ctx.doc, ctx.pos);
    const centerId =
      cursorWord && decls.find((d) => d.name === cursorWord) ? `fn:${cursorWord}` : null;

    const nodes = decls.map((d) => ({
      id: d.id,
      label: d.name,
      kind: 'symbol' as const,
      center: d.id === centerId,
      title: `function ${d.name}`,
      navigate: { filePath: ctx.filePath, line: lineNumberOf(ctx.doc, d.nameStart) },
    }));

    const edges = inferEdges(decls);
    if (edges.length === 0) return null;

    return {
      kind: 'call',
      title: `Call graph · ${decls.length} fn${decls.length === 1 ? '' : 's'}, ${edges.length} edge${edges.length === 1 ? '' : 's'}`,
      nodes,
      edges,
    };
  },
};

function lineNumberOf(doc: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < doc.length; i++) {
    if (doc[i] === '\n') line++;
  }
  return line;
}

export const __test = {
  extractDecls,
  inferEdges,
  wordAtCursor,
  sliceBracedBody,
  sliceArrowBody,
};
