/**
 * ComponentTreeProvider — Phase 2.
 *
 * For a .svelte / .pui file: shows which child components this file
 * renders. We find all imported names that look like components
 * (PascalCase default/named imports) and then check the markup body
 * for tag usages (`<Name />` or `<Name>...</Name>`).
 *
 * Direction: this file → each rendered child component (1-hop). The
 * inverse (who renders me) needs a workspace index — same constraint
 * as ModuleDepsProvider's "who imports me", tracked separately.
 *
 * Regex-based, intentionally. Full Svelte AST parsing would be more
 * accurate (catches dynamic-component `<svelte:component this={X}>` too),
 * but the v1 markup-tag heuristic correctly handles the common case.
 */
import type { RelationProvider, ProviderContext, RelationGraph } from '../types';

const SUPPORTED_EXT = /\.(pui|svelte)$/;

/**
 * `import [type] X from '...'`  → captures default name + specifier
 * `import [type] { X, Y as Z }` → captures named/renamed bindings
 * `import [type] X, { Y } from`  → mixed default+named (rare but valid)
 *
 * We extract all bound local names regardless of form; later we filter
 * to PascalCase only.
 */
const IMPORT_STMT = /\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"\n]+)['"]/g;

interface ImportedBinding {
  /** Local name bound in this file (after `as` if renamed). */
  local: string;
  /** Module specifier the binding came from. */
  source: string;
}

function parseBindings(clauseSrc: string): string[] {
  const bindings: string[] = [];
  // Default-import head: `Foo` or `Foo,` before any `{` block
  const headMatch = clauseSrc.match(/^\s*([A-Za-z_$][\w$]*)\s*(?:,|$|\s*\{)/);
  if (headMatch) bindings.push(headMatch[1]);
  // Namespace: `* as Foo`
  const nsMatch = clauseSrc.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (nsMatch) bindings.push(nsMatch[1]);
  // Named block: `{ A, B as C, default as D }`
  const block = clauseSrc.match(/\{([\s\S]*?)\}/);
  if (block) {
    for (const part of block[1].split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const asMatch = trimmed.match(/(?:[A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)/);
      if (asMatch) {
        bindings.push(asMatch[1]);
      } else {
        const plain = trimmed.match(/^[A-Za-z_$][\w$]*$/);
        if (plain) bindings.push(trimmed);
      }
    }
  }
  return bindings;
}

function extractImports(doc: string): ImportedBinding[] {
  const out: ImportedBinding[] = [];
  let m: RegExpExecArray | null;
  IMPORT_STMT.lastIndex = 0;
  while ((m = IMPORT_STMT.exec(doc)) !== null) {
    const bindings = parseBindings(m[1]);
    for (const local of bindings) {
      out.push({ local, source: m[2] });
    }
  }
  return out;
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_$]*$/.test(name);
}

/**
 * Find markup tag usages. Matches `<Name`, `<Name>`, `<Name/>`, `<Name `,
 * also `</Name>` (closing tags imply usage). Returns the set of names
 * actually used in markup.
 *
 * To avoid matching JSX-inside-strings or TypeScript generics (`Array<Name>`),
 * we require the `<` to be preceded by whitespace, `>`, `}` or start-of-line
 * — typical of Svelte/PUI markup contexts.
 */
const TAG_USE = /(?:^|[\s>})])<\/?\s*([A-Z][A-Za-z0-9_$.]*)\b/g;

function extractTagUsages(doc: string): Set<string> {
  const used = new Set<string>();
  let m: RegExpExecArray | null;
  TAG_USE.lastIndex = 0;
  while ((m = TAG_USE.exec(doc)) !== null) {
    // Member-expression tags like `Foo.Bar` are valid; the root is what we
    // bind to via import, so split on `.` and use the head.
    const root = m[1].split('.')[0];
    used.add(root);
  }
  return used;
}

function basename(p: string): string {
  const slash = p.lastIndexOf('/');
  return slash >= 0 ? p.slice(slash + 1) : p;
}

export const componentTreeProvider: RelationProvider = {
  kind: 'component',
  supports(ctx: ProviderContext): boolean {
    return SUPPORTED_EXT.test(ctx.filePath);
  },
  async build(ctx: ProviderContext): Promise<RelationGraph | null> {
    const imports = extractImports(ctx.doc);
    if (imports.length === 0) return null;

    const tagsUsed = extractTagUsages(ctx.doc);
    const componentImports = imports.filter((b) => isPascalCase(b.local) && tagsUsed.has(b.local));
    if (componentImports.length === 0) return null;

    const centerId = `file:${ctx.filePath}`;
    const centerLabel = basename(ctx.filePath) || ctx.filePath;

    const nodes = [
      {
        id: centerId,
        label: centerLabel,
        kind: 'component' as const,
        center: true,
        navigate: { filePath: ctx.filePath },
        title: ctx.filePath,
      },
      ...componentImports.map((b) => ({
        id: `comp:${b.local}`,
        label: b.local,
        kind: 'component' as const,
        title: `${b.local} (from ${b.source})`,
      })),
    ];

    const edges = componentImports.map((b) => ({
      from: centerId,
      to: `comp:${b.local}`,
    }));

    return {
      kind: 'component',
      title: `Components rendered · ${componentImports.length}`,
      nodes,
      edges,
    };
  },
};

export const __test = { parseBindings, extractImports, extractTagUsages, isPascalCase };
