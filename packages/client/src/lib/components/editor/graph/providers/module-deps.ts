/**
 * ModuleDepsProvider — Phase 1.
 *
 * Builds a 1-hop module-dependency graph centered on the current file.
 * Parses `import … from '…'` statements out of the file text (works for
 * TS/TSX directly; Svelte/PUI by happenstance since their `<script>`
 * contents use the same import syntax).
 *
 * What's IN scope for v1:
 *   - Outgoing imports (this file → each imported module)
 *   - Specifier classification: relative paths = internal/file nodes;
 *     bare specifiers = external nodes (e.g. 'svelte', 'lodash')
 *
 * What's NOT in scope yet (tracked as follow-ups, see RelationProvider docs):
 *   - "Who imports me" — requires a server-side workspace index
 *   - Path resolution (./foo → ./foo.ts) — we display the literal specifier
 *
 * Hover targeting: returns a graph whenever the file extension matches.
 * The hover extension decides whether to show it (e.g. only over an
 * import specifier vs anywhere in the file).
 */
import type { RelationProvider, ProviderContext, RelationGraph } from '../types';

const SUPPORTED_EXT = /\.(ts|tsx|svelte|pui)$/;

/**
 * Loose extractor: matches static `import … from 'spec'` statements and
 * side-effect `import 'spec'`. The regex deliberately tolerates multi-line
 * specifier lists by using a non-greedy character class.
 *
 * Not a full parser — won't catch dynamic `import()` (handled below as a
 * separate pass) or imports inside template strings. For Phase 1 that's
 * fine; we surface the common case correctly and tracked the edge cases.
 */
// `[^'"]*?` between `import` and `from` allows newlines (multi-line specifier
// lists like `import {\n  a,\n  b,\n} from 'pkg'`). Excluding only quotes is
// enough to prevent the gap from devouring a subsequent string literal.
const STATIC_IMPORT = /(?:^|[\s;])import\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"\n]+)['"]/gm;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;

function extractImports(doc: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  STATIC_IMPORT.lastIndex = 0;
  while ((m = STATIC_IMPORT.exec(doc)) !== null) {
    found.add(m[1]);
  }
  DYNAMIC_IMPORT.lastIndex = 0;
  while ((m = DYNAMIC_IMPORT.exec(doc)) !== null) {
    found.add(m[1]);
  }
  return [...found];
}

function isExternal(spec: string): boolean {
  // Relative & absolute paths = internal. Anything else (npm packages,
  // workspace aliases like '$lib/…', '@e/shared') = external for v1
  // visualisation purposes — distinguishing workspace aliases from npm
  // packages is the dependents-lookup follow-up.
  return !spec.startsWith('.') && !spec.startsWith('/');
}

function basename(p: string): string {
  const slash = p.lastIndexOf('/');
  return slash >= 0 ? p.slice(slash + 1) : p;
}

export const moduleDepsProvider: RelationProvider = {
  kind: 'import',
  supports(ctx: ProviderContext): boolean {
    return SUPPORTED_EXT.test(ctx.filePath);
  },
  async build(ctx: ProviderContext): Promise<RelationGraph | null> {
    const imports = extractImports(ctx.doc);
    if (imports.length === 0) return null;

    const centerId = `file:${ctx.filePath}`;
    const centerLabel = basename(ctx.filePath) || ctx.filePath;

    const nodes = [
      {
        id: centerId,
        label: centerLabel,
        kind: 'file' as const,
        center: true,
        navigate: { filePath: ctx.filePath },
        title: ctx.filePath,
      },
      ...imports.map((spec) => ({
        id: `import:${spec}`,
        label: isExternal(spec) ? spec : basename(spec),
        kind: (isExternal(spec) ? 'external' : 'file') as 'external' | 'file',
        title: spec,
        // We only know the literal specifier; resolution to a filesystem
        // path is a follow-up. Leaving navigate undefined for now means
        // the node renders but isn't clickable — better than navigating
        // to a wrong path.
      })),
    ];

    const edges = imports.map((spec) => ({
      from: centerId,
      to: `import:${spec}`,
    }));

    const externalCount = imports.filter(isExternal).length;
    const internalCount = imports.length - externalCount;
    const title = `Module deps · ${internalCount} internal, ${externalCount} external`;

    return {
      kind: 'import',
      title,
      nodes,
      edges,
    };
  },
};

// Test-only surface; exported through the file barrel so __tests__ can drive
// extraction without hitting the provider's async path.
export const __test = { extractImports, isExternal, basename };
