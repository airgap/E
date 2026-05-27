/**
 * Shared AST surface for the graph providers. Replaces the regex-based
 * extractors with real semantic analysis (LYK-… "do it right").
 *
 *   - `parseTs(text, kind)` returns a ts.SourceFile parsed in TS mode
 *     (handles JSX/TSX, generics, type-only constructs, decorators).
 *   - `parseSvelte(text)` runs svelte/compiler.parse() and returns the
 *     full AST (`instance.content` is an estree-shaped script tree;
 *     `fragment` is the template tree with Element/Component nodes).
 *
 * .pui files share Svelte's parse path for v2 — they're a near-superset
 * of Svelte syntax; the bits that aren't (e.g. `signal X = expr`) are
 * recognised at a higher level in the reactive provider directly via
 * the TS AST of the script content.
 *
 * Providers should prefer the AST helpers in this file (`enclosingScope`,
 * `collectIdentifierRefs`, etc.) so all of them share the same scope and
 * shadowing semantics — that's the central correctness win of the rewrite.
 */
import ts from 'typescript';
import { parse as parseSvelteCompiler } from 'svelte/compiler';

export type FileKind = 'ts' | 'tsx' | 'svelte' | 'pui';

export function fileKindFromPath(filePath: string): FileKind | null {
  if (/\.tsx$/.test(filePath)) return 'tsx';
  if (/\.ts$/.test(filePath)) return 'ts';
  if (/\.svelte$/.test(filePath)) return 'svelte';
  if (/\.pui$/.test(filePath)) return 'pui';
  return null;
}

/**
 * Parse a TS / TSX source string. JSX is unconditionally enabled for tsx
 * mode and `Preserve`d so the resulting nodes look like `<Foo />` rather
 * than `React.createElement(...)`.
 */
export function parseTs(text: string, kind: 'ts' | 'tsx' = 'ts'): ts.SourceFile {
  return ts.createSourceFile(
    kind === 'tsx' ? 'in.tsx' : 'in.ts',
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    kind === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

export interface SvelteParseResult {
  /** The full AST. `.instance?.content` is the script estree; `.fragment` is markup. */
  ast: any;
  /** Script source text in TS (if any); null when the file has no `<script>` block. */
  scriptText: string | null;
  /** Byte offset of the script text within the original source — needed to translate
   *  TS-AST offsets back into editor positions for cursor centering / navigation. */
  scriptStart: number;
}

/**
 * Parse a `.svelte` or `.pui` source. The Svelte compiler is forgiving
 * of mild syntactic divergence (Para's `pure`, leading-dot lambdas inside
 * script blocks aren't part of Svelte's grammar, so we extract the
 * script text and re-parse it with TS — that's accurate enough for the
 * graph features and avoids depending on para-preprocess at hover time).
 */
/**
 * Cheap manual extraction of the FIRST `<script>` block contents. Used as
 * a fallback when svelte/compiler rejects the whole file (e.g. its
 * embedded acorn parser doesn't accept TS-specific syntax like inline
 * `type` keywords in imports). Returns null when there is no script.
 *
 * We use a tag-only regex so a `<script>` inside markup/strings won't
 * match — Svelte components reserve the literal `<script>` for the
 * top-level script block.
 */
function fallbackExtractScript(text: string): { scriptText: string; scriptStart: number } | null {
  // Match `<script ...>` (any attributes) and the matching `</script>`.
  const openMatch = text.match(/<script\b[^>]*>/);
  if (!openMatch || openMatch.index == null) return null;
  const innerStart = openMatch.index + openMatch[0].length;
  const closeIdx = text.indexOf('</script>', innerStart);
  if (closeIdx < 0) return null;
  return { scriptText: text.slice(innerStart, closeIdx), scriptStart: innerStart };
}

export function parseSvelte(text: string): SvelteParseResult {
  let ast: any = null;
  try {
    ast = parseSvelteCompiler(text, { modern: true } as any);
  } catch {
    // ast stays null; we still try to surface the script via the regex
    // fallback below so module-deps / call-graph / dataflow keep working
    // on files Svelte rejects.
  }

  // Preferred path: svelte 5 exposes `instance.content` (the inner estree
  // Program) with start/end pointing at the actual TS code WITHOUT the
  // wrapping `<script>` tags — exactly the range we want.
  const contentNode = ast?.instance?.content ?? null;
  if (contentNode && typeof contentNode.start === 'number' && typeof contentNode.end === 'number') {
    return {
      ast,
      scriptText: text.slice(contentNode.start, contentNode.end),
      scriptStart: contentNode.start,
    };
  }

  // Fallback when svelte/compiler bailed (e.g. inline `type` in imports
  // trips its acorn parser). The Svelte AST is null here so providers
  // that depend on the markup (component-tree) will degrade gracefully,
  // but TS-only providers (module-deps, call-graph, dataflow) still get
  // a correctly-scoped script slice.
  const fb = fallbackExtractScript(text);
  if (fb) {
    return { ast, scriptText: fb.scriptText, scriptStart: fb.scriptStart };
  }
  return { ast, scriptText: null, scriptStart: 0 };
}

/**
 * Get a TS AST view of the script content of any supported file. For
 * .ts/.tsx the whole file is the script; for .svelte/.pui we extract the
 * `<script>` block (returning an empty file when none exists).
 *
 * Returns the `scriptStart` offset so callers can map TS-AST positions
 * back into the original document.
 */
export interface ScriptView {
  source: ts.SourceFile;
  /** Offset (in the original document) where the script starts. */
  start: number;
  /** Original script text (already in `source.text`). */
  text: string;
}

export function scriptViewOf(text: string, kind: FileKind): ScriptView {
  if (kind === 'ts' || kind === 'tsx') {
    return { source: parseTs(text, kind), start: 0, text };
  }
  const { scriptText, scriptStart } = parseSvelte(text);
  if (scriptText == null) {
    return { source: parseTs('', 'ts'), start: 0, text: '' };
  }
  return { source: parseTs(scriptText, 'tsx'), start: scriptStart, text: scriptText };
}

// ── Scope helpers ─────────────────────────────────────────────────────

/**
 * Find the innermost function-like declaration containing `pos` (a TS
 * source offset). Returns null when `pos` is at module top level.
 */
export function enclosingFunction(
  source: ts.SourceFile,
  pos: number,
): ts.FunctionLikeDeclaration | null {
  let result: ts.FunctionLikeDeclaration | null = null;
  function visit(node: ts.Node) {
    if (node.pos > pos || node.end < pos) return;
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      result = node as ts.FunctionLikeDeclaration;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return result;
}

/**
 * Collect every identifier reference name inside `node`, with positional
 * metadata. Skips:
 *   - the declared name of a function/variable (we want USES, not defs)
 *   - property-access names (`foo.bar` → only `foo` is collected)
 *   - JSX attribute names (`<Foo bar={…}>` → `bar` excluded)
 *   - type positions (when `excludeTypes` is true) — set for dataflow/
 *     callgraph where types aren't runtime references
 */
export function collectIdentifierRefs(
  node: ts.Node,
  opts: { excludeTypes?: boolean } = {},
): Array<{ name: string; pos: number; end: number }> {
  const refs: Array<{ name: string; pos: number; end: number }> = [];
  function visit(n: ts.Node) {
    // Skip identifiers in type-only contexts when requested.
    if (opts.excludeTypes && (ts.isTypeNode(n) || ts.isTypeReferenceNode(n))) return;
    // Skip the BINDING name of a function/variable (it's a definition,
    // not a reference).
    if (
      (ts.isFunctionDeclaration(n) ||
        ts.isFunctionExpression(n) ||
        ts.isMethodDeclaration(n) ||
        ts.isClassDeclaration(n)) &&
      n.name
    ) {
      // Visit everything EXCEPT the name node.
      ts.forEachChild(n, (c) => {
        if (c !== n.name) visit(c);
      });
      return;
    }
    if (ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) {
      // Skip the binding pattern (left side); visit the initialiser
      // and type explicitly so references in the RHS still count.
      if (n.initializer) visit(n.initializer);
      return;
    }
    // PropertyAccessExpression: only the head identifier counts.
    if (ts.isPropertyAccessExpression(n)) {
      visit(n.expression);
      // skip n.name
      return;
    }
    // ElementAccessExpression: visit expression + argument (argument can be a reference).
    if (ts.isElementAccessExpression(n)) {
      visit(n.expression);
      visit(n.argumentExpression);
      return;
    }
    if (ts.isQualifiedName(n)) {
      visit(n.left);
      return;
    }
    // JSX attribute name: skip the name, visit the initializer.
    if (ts.isJsxAttribute(n)) {
      if (n.initializer) visit(n.initializer);
      return;
    }
    // ShorthandPropertyAssignment: name IS a reference (e.g. `{ x }`
    // means `{ x: x }`).
    if (ts.isShorthandPropertyAssignment(n)) {
      refs.push({ name: n.name.text, pos: n.name.pos, end: n.name.end });
      return;
    }
    if (ts.isPropertyAssignment(n)) {
      // skip property name, visit value
      visit(n.initializer);
      return;
    }
    if (ts.isIdentifier(n)) {
      refs.push({ name: n.text, pos: n.pos, end: n.end });
      return;
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return refs;
}

/**
 * Translate a script-offset back into a doc-offset. For ts/tsx files
 * scriptStart is 0 so this is a no-op; for svelte/pui the script lives
 * inside a `<script>` block and offsets need shifting.
 */
export function toDocOffset(view: ScriptView, scriptOffset: number): number {
  return view.start + scriptOffset;
}

/** Compute 0-indexed line number of a doc offset. */
export function lineOfOffset(doc: string, offset: number): number {
  let line = 0;
  const lim = Math.min(offset, doc.length);
  for (let i = 0; i < lim; i++) {
    if (doc[i] === '\n') line++;
  }
  return line;
}
