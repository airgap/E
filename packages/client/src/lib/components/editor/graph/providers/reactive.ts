/**
 * ReactiveProvider — semantic edition.
 *
 * Walks the script-block TS AST to find every reactive declaration:
 *
 *   - Para call-form:  `const X = signal(...)` / `derived(...)` / `derived.by(...)`
 *   - Para decl-form:  `signal X = expr` / `derived X = expr` — parsed by
 *     svelte/compiler as a CallExpression `signal(X = expr)` after Para
 *     lowering. Because we run BEFORE lowering, decl-form shows up as a
 *     LabeledStatement (`signal: X = expr`) when TS parses raw Para. We
 *     handle both shapes explicitly so the provider works on raw and
 *     lowered sources.
 *   - Svelte runes:    `let X = $state(...)` / `$derived(...)` / `$derived.by(...)`
 *   - Effects:         `$effect(() => ...)` / `effect(() => ...)` / Para's
 *     `effect { ... }` block — the third shows up as a LabeledStatement
 *     in raw Para; we treat both rune and call shapes.
 *
 * Edges: B → A means "B reads A". Walked via `collectIdentifierRefs` on
 * each declaration's body, then filtered to names that match another
 * declared reactive primitive. Signals never get incoming edges
 * (sources). This matches the v1 behaviour but is now precise about
 * shadowing — a `let foo` inside a derived's body won't false-edge to
 * a signal `foo` because the identifier walk respects binding scopes.
 */
import ts from 'typescript';
import type { RelationProvider, ProviderContext, RelationGraph, NodeKind } from '../types';
import { fileKindFromPath, scriptViewOf, collectIdentifierRefs } from '../ast';

type ReactiveKind = 'signal' | 'derived' | 'effect';

interface ReactiveDecl {
  id: string;
  name: string;
  kind: ReactiveKind;
  /** AST node whose body / initialiser we walk for dependencies. */
  body: ts.Node;
  /** Doc offset of the declaration's name token (for cursor centering). */
  nameStart: number;
}

const PARA_REACTIVES = new Set(['signal', 'derived']);
const SVELTE_RUNES = new Set(['$state', '$derived']);

/**
 * Check whether `call` looks like one of:
 *   signal(...)   derived(...)   derived.by(...)
 *   $state(...)   $derived(...)  $derived.by(...)
 *   effect(...)   $effect(...)
 * Returns the kind, or null when no match.
 */
function reactiveCallKind(call: ts.CallExpression): ReactiveKind | null {
  let head: ts.Node = call.expression;
  // Allow `.by` chained form.
  if (ts.isPropertyAccessExpression(head) && head.name.text === 'by') {
    head = head.expression;
  }
  if (!ts.isIdentifier(head)) return null;
  const name = head.text;
  if (name === 'signal' || name === '$state') return 'signal';
  if (name === 'derived' || name === '$derived') return 'derived';
  if (name === 'effect' || name === '$effect') return 'effect';
  return null;
}

export function extractDecls(view: { source: ts.SourceFile; start: number }): ReactiveDecl[] {
  const decls: ReactiveDecl[] = [];
  const seenNames = new Set<string>();
  let effectIdx = 0;

  function visit(node: ts.Node) {
    // `const|let|var NAME = reactiveCall(...)` (Para call-form + runes).
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!decl.initializer) continue;
        if (!ts.isCallExpression(decl.initializer)) continue;
        const kind = reactiveCallKind(decl.initializer);
        if (!kind) continue;
        if (kind === 'effect') {
          // `const e = $effect(...)` is unusual but valid; treat as effect.
          decls.push({
            id: `eff:${effectIdx}`,
            name: `effect #${effectIdx}`,
            kind: 'effect',
            body: decl.initializer,
            nameStart: view.start + decl.name.pos,
          });
          effectIdx++;
        } else if (ts.isIdentifier(decl.name)) {
          if (seenNames.has(decl.name.text)) continue;
          seenNames.add(decl.name.text);
          decls.push({
            id: `rx:${decl.name.text}`,
            name: decl.name.text,
            kind,
            body: decl.initializer,
            nameStart: view.start + decl.name.pos,
          });
        }
      }
      ts.forEachChild(node, visit);
      return;
    }

    // Standalone `$effect(...)` / `effect(() => ...)` (ExpressionStatement
    // wrapping a CallExpression).
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const kind = reactiveCallKind(node.expression);
      if (kind === 'effect') {
        decls.push({
          id: `eff:${effectIdx}`,
          name: `effect #${effectIdx}`,
          kind: 'effect',
          body: node.expression,
          nameStart: view.start + node.expression.pos,
        });
        effectIdx++;
        return;
      }
    }

    // Para decl-form: `signal X = expr` / `derived X = expr` parses (in
    // raw Para before lowering) as a LabeledStatement where the label is
    // `signal`/`derived` and the body is `X = expr` (an ExpressionStatement
    // with an Assignment).
    if (ts.isLabeledStatement(node) && PARA_REACTIVES.has(node.label.text)) {
      const kind = node.label.text as ReactiveKind;
      const body = node.statement;
      if (ts.isExpressionStatement(body) && ts.isBinaryExpression(body.expression)) {
        const lhs = body.expression.left;
        const rhs = body.expression.right;
        if (
          ts.isIdentifier(lhs) &&
          body.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
        ) {
          if (!seenNames.has(lhs.text)) {
            seenNames.add(lhs.text);
            decls.push({
              id: `rx:${lhs.text}`,
              name: lhs.text,
              kind,
              body: rhs,
              nameStart: view.start + lhs.pos,
            });
          }
          return;
        }
      }
    }

    // Para effect block: `effect { ... }` — parses as LabeledStatement
    // `effect:` wrapping a Block.
    if (ts.isLabeledStatement(node) && node.label.text === 'effect' && ts.isBlock(node.statement)) {
      decls.push({
        id: `eff:${effectIdx}`,
        name: `effect #${effectIdx}`,
        kind: 'effect',
        body: node.statement,
        nameStart: view.start + node.label.pos,
      });
      effectIdx++;
      return;
    }

    ts.forEachChild(node, visit);
  }
  visit(view.source);
  return decls;
}

export function inferEdges(decls: ReactiveDecl[]): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  const byName = new Map<string, ReactiveDecl>();
  for (const d of decls) byName.set(d.name, d);

  for (const dependent of decls) {
    if (dependent.kind === 'signal') continue; // sources never depend
    const refs = collectIdentifierRefs(dependent.body, { excludeTypes: true });
    const seenLocal = new Set<string>();
    for (const ref of refs) {
      if (ref.name === dependent.name) continue;
      if (seenLocal.has(ref.name)) continue;
      const src = byName.get(ref.name);
      if (src) {
        edges.push({ from: src.id, to: dependent.id });
        seenLocal.add(ref.name);
      }
    }
  }
  return edges;
}

function nodeKindForReactive(kind: ReactiveKind): NodeKind {
  return kind === 'effect' ? 'effect' : 'signal';
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

export const reactiveProvider: RelationProvider = {
  kind: 'reactive',
  supports(ctx: ProviderContext): boolean {
    const k = fileKindFromPath(ctx.filePath);
    return k === 'svelte' || k === 'pui';
  },
  async build(ctx: ProviderContext): Promise<RelationGraph | null> {
    const kind = fileKindFromPath(ctx.filePath);
    if (kind !== 'svelte' && kind !== 'pui') return null;
    const view = scriptViewOf(ctx.doc, kind);
    const decls = extractDecls(view);
    if (decls.length === 0) return null;

    const cursorWord = wordAtCursor(ctx.doc, ctx.pos);
    const centerId =
      cursorWord && decls.find((d) => d.name === cursorWord) ? `rx:${cursorWord}` : null;

    const nodes = decls.map((d) => ({
      id: d.id,
      label: d.name,
      kind: nodeKindForReactive(d.kind),
      center: d.id === centerId,
      title: `${d.kind} ${d.name}`,
    }));

    const edges = inferEdges(decls);

    const signals = decls.filter((d) => d.kind === 'signal').length;
    const deriveds = decls.filter((d) => d.kind === 'derived').length;
    const effects = decls.filter((d) => d.kind === 'effect').length;
    const title = `Reactive · ${signals} signal${signals === 1 ? '' : 's'}, ${deriveds} derived, ${effects} effect${effects === 1 ? '' : 's'}`;

    return { kind: 'reactive', title, nodes, edges };
  },
};

export const __test = { extractDecls, inferEdges, wordAtCursor };
