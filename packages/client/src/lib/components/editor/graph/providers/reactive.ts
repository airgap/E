/**
 * ReactiveProvider — Phase 2.
 *
 * Builds an intra-file reactive dataflow DAG for .pui and .svelte files.
 * Nodes: each declared reactive primitive (Para `signal`/`derived`/`effect`
 * + Svelte 5 runes `$state`/`$derived`/`$effect`). Edges: B → A means "B
 * reads A in its initialiser/body" (lexical inference).
 *
 * Lexical, not semantic — a body that *names* an identifier is treated as
 * depending on it. False positives are possible (e.g. a local `let foo`
 * shadowing a signal); for v1 the trade is intentional, since real
 * semantic analysis requires the Svelte AST or @lyku/para-preprocess output,
 * which costs another async pass per hover.
 *
 * `effect` declarations get synthesised IDs (`eff:0`, `eff:1`, …) since
 * they're often anonymous; users see `effect #0` style labels.
 *
 * Recognised forms (per [[project_pui_rune_policy]] both are accepted):
 *
 *   Para:
 *     signal X = expr
 *     derived X = expr
 *     effect { … } / effect(() => …)
 *     const X = signal(...)
 *     const X = derived(() => ...)
 *
 *   Svelte runes:
 *     let X = $state(...)
 *     let X = $derived(...)
 *     let X = $derived.by(() => ...)
 *     $effect(() => ...)
 */
import type { RelationProvider, ProviderContext, RelationGraph, NodeKind } from '../types';

const SUPPORTED_EXT = /\.(pui|svelte)$/;

type ReactiveKind = 'signal' | 'derived' | 'effect';

interface ReactiveDecl {
  id: string; // node id, also used for lexical matching
  name: string; // display label
  kind: ReactiveKind;
  /** The body/initialiser source used for lexical dependency inference. */
  body: string;
}

// ── Extractors ────────────────────────────────────────────────────────

/**
 * Para's first-class declaration form: `signal X = expr`. Also matches
 * `derived X = expr`. Captures the name + a body slice up to the line end
 * (good enough for lexical scanning of references).
 */
const PARA_DECL = /\b(signal|derived)\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n;]+)/g;

/**
 * Para's call-form initialiser inside a const/let/var binding:
 *   const X = signal(...)
 *   const X = derived(() => ...)
 *   let X = derived.by(() => ...)
 * Captures everything up to a matched-paren close — we approximate with
 * a non-greedy scan to the line end since proper paren matching needs a
 * parser. The lexical-reference inference doesn't need surgical accuracy.
 */
const CALL_DECL =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(signal|derived)\s*(?:\.by)?\s*\(([\s\S]*?)\)\s*[;\n]/g;

/**
 * Svelte 5 runes form: `let X = $state(...)`, `let X = $derived(...)`.
 */
const RUNE_DECL =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\$(state|derived)(?:\.by)?\s*\(([\s\S]*?)\)\s*[;\n]/g;

/**
 * Effects don't bind a name. We match both Para (`effect { … }` /
 * `effect(() => …)`) and rune form (`$effect(() => …)`), capturing the
 * body for lexical scan.
 */
const EFFECT_DECL =
  /\b(\$effect|effect)\s*\(\s*\(\s*\)\s*=>\s*([\s\S]*?)\)\s*[;\n]|(?:^|\s)effect\s*\{([\s\S]*?)\}/g;

function extractDecls(doc: string): ReactiveDecl[] {
  const decls: ReactiveDecl[] = [];
  let m: RegExpExecArray | null;

  PARA_DECL.lastIndex = 0;
  while ((m = PARA_DECL.exec(doc)) !== null) {
    const kindWord = m[1] as 'signal' | 'derived';
    decls.push({ id: `rx:${m[2]}`, name: m[2], kind: kindWord, body: m[3] });
  }

  CALL_DECL.lastIndex = 0;
  while ((m = CALL_DECL.exec(doc)) !== null) {
    const name = m[1];
    const kindWord = m[2] as 'signal' | 'derived';
    decls.push({ id: `rx:${name}`, name, kind: kindWord, body: m[3] });
  }

  RUNE_DECL.lastIndex = 0;
  while ((m = RUNE_DECL.exec(doc)) !== null) {
    const name = m[1];
    const runeKind = m[2] as 'state' | 'derived';
    const kindWord: ReactiveKind = runeKind === 'state' ? 'signal' : 'derived';
    decls.push({ id: `rx:${name}`, name, kind: kindWord, body: m[3] });
  }

  EFFECT_DECL.lastIndex = 0;
  let effectIdx = 0;
  while ((m = EFFECT_DECL.exec(doc)) !== null) {
    // group 2 = `$effect(...)` / `effect(() => ...)` body
    // group 3 = `effect { ... }` body
    const body = m[2] ?? m[3] ?? '';
    decls.push({
      id: `eff:${effectIdx}`,
      name: `effect #${effectIdx}`,
      kind: 'effect',
      body,
    });
    effectIdx++;
  }

  // De-dup by id — a name might be matched by both PARA_DECL and CALL_DECL if
  // the user writes both forms (unusual). Keep the first match.
  const seen = new Set<string>();
  return decls.filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
}

/**
 * For each derived/effect, find which declared identifiers its body
 * references. Identifier-boundary regex on each known name; cheap and
 * correct for the common case.
 */
function inferEdges(decls: ReactiveDecl[]): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  const byName = new Map<string, ReactiveDecl>();
  for (const d of decls) byName.set(d.name, d);

  for (const dependent of decls) {
    if (dependent.kind === 'signal') continue; // signals don't read other decls
    for (const candidate of decls) {
      if (candidate === dependent) continue;
      // Word-boundary match for the candidate name.
      const re = new RegExp(`\\b${escapeRegExp(candidate.name)}\\b`);
      if (re.test(dependent.body)) {
        edges.push({ from: candidate.id, to: dependent.id });
      }
    }
  }
  return edges;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Provider ──────────────────────────────────────────────────────────

function nodeKindForReactive(kind: ReactiveKind): NodeKind {
  return kind === 'effect' ? 'effect' : 'signal';
}

function symbolUnderCursor(ctx: ProviderContext): string | null {
  // Pull the word at the cursor. Used to pick a "center" node when the
  // hover happens exactly on a declared name.
  const lineStart = ctx.doc.lastIndexOf('\n', ctx.pos - 1) + 1;
  const lineEnd = ctx.doc.indexOf('\n', ctx.pos);
  const line = ctx.doc.slice(lineStart, lineEnd < 0 ? ctx.doc.length : lineEnd);
  const colInLine = ctx.pos - lineStart;
  const left = line.slice(0, colInLine).match(/[A-Za-z_$][\w$]*$/)?.[0] ?? '';
  const right = line.slice(colInLine).match(/^[\w$]*/)?.[0] ?? '';
  const word = left + right;
  return word || null;
}

export const reactiveProvider: RelationProvider = {
  kind: 'reactive',
  supports(ctx: ProviderContext): boolean {
    return SUPPORTED_EXT.test(ctx.filePath);
  },
  async build(ctx: ProviderContext): Promise<RelationGraph | null> {
    const decls = extractDecls(ctx.doc);
    if (decls.length === 0) return null;

    const cursorWord = symbolUnderCursor(ctx);
    const centerId =
      cursorWord && decls.find((d) => d.name === cursorWord) ? `rx:${cursorWord}` : null;

    const nodes = decls.map((d) => ({
      id: d.id,
      label: d.name,
      kind: nodeKindForReactive(d.kind),
      center: d.id === centerId,
      title: `${d.kind} ${d.name}`,
      // No navigate target — these are intra-file. A future enhancement
      // could resolve to the line number for click-to-jump.
    }));

    const edges = inferEdges(decls);

    const signals = decls.filter((d) => d.kind === 'signal').length;
    const deriveds = decls.filter((d) => d.kind === 'derived').length;
    const effects = decls.filter((d) => d.kind === 'effect').length;
    const title = `Reactive · ${signals} signal${signals === 1 ? '' : 's'}, ${deriveds} derived, ${effects} effect${effects === 1 ? '' : 's'}`;

    return {
      kind: 'reactive',
      title,
      nodes,
      edges,
    };
  },
};

export const __test = {
  extractDecls,
  inferEdges,
  symbolUnderCursor,
};
