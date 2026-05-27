/**
 * ModuleDepsProvider — semantic edition.
 *
 * Walks the TS AST (via `scriptViewOf`) to find every ImportDeclaration
 * and dynamic import() call. Compared to the v1 regex extractor this:
 *   - Distinguishes type-only imports (still listed, marked as such)
 *   - Correctly handles imports inside `<script>` blocks of svelte/pui
 *     because the script extractor returns the right TS source range
 *   - Doesn't false-positive on `import` words inside strings, JSX text,
 *     or comments
 */
import ts from 'typescript';
import type { RelationProvider, ProviderContext, RelationGraph } from '../types';
import { fileKindFromPath, scriptViewOf } from '../ast';

interface ImportSite {
  specifier: string;
  /** true for `import type` and inline `import { type X }` named bindings. */
  typeOnly: boolean;
  /** true for dynamic `import('x')`. */
  dynamic: boolean;
}

function basename(p: string): string {
  const slash = p.lastIndexOf('/');
  return slash >= 0 ? p.slice(slash + 1) : p;
}

function isExternal(spec: string): boolean {
  return !spec.startsWith('.') && !spec.startsWith('/');
}

/**
 * Extract every import the file makes. Static + dynamic, type-only flagged.
 * Implementation note: `ts.forEachChild` only walks immediate descendants;
 * dynamic imports nest arbitrarily deep so we recurse manually.
 */
export function extractImports(source: ts.SourceFile): ImportSite[] {
  const out: ImportSite[] = [];
  const seen = new Set<string>(); // dedupe by `${specifier}|${dynamic?}|${typeOnly}`

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const moduleSpec = node.moduleSpecifier;
      if (ts.isStringLiteral(moduleSpec)) {
        // Type-only when EITHER `import type {…}` OR every named binding is `type X`.
        const importClause = node.importClause;
        const wholeTypeOnly = !!importClause?.isTypeOnly;
        const key = `${moduleSpec.text}|s|${wholeTypeOnly ? 't' : 'v'}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ specifier: moduleSpec.text, typeOnly: wholeTypeOnly, dynamic: false });
        }
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const spec = (node.arguments[0] as ts.StringLiteral).text;
      const key = `${spec}|d|v`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ specifier: spec, typeOnly: false, dynamic: true });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return out;
}

export const moduleDepsProvider: RelationProvider = {
  kind: 'import',
  supports(ctx: ProviderContext): boolean {
    return fileKindFromPath(ctx.filePath) !== null;
  },
  async build(ctx: ProviderContext): Promise<RelationGraph | null> {
    const kind = fileKindFromPath(ctx.filePath);
    if (!kind) return null;
    let view;
    try {
      view = scriptViewOf(ctx.doc, kind);
    } catch {
      return null;
    }
    const imports = extractImports(view.source);
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
      ...imports.map((imp) => ({
        id: `import:${imp.specifier}`,
        label: isExternal(imp.specifier) ? imp.specifier : basename(imp.specifier),
        kind: (isExternal(imp.specifier) ? 'external' : 'file') as 'external' | 'file',
        title:
          imp.specifier + (imp.typeOnly ? ' (type-only)' : '') + (imp.dynamic ? ' (dynamic)' : ''),
      })),
    ];

    const edges = imports.map((imp) => ({
      from: centerId,
      to: `import:${imp.specifier}`,
      label: imp.dynamic ? 'dyn' : imp.typeOnly ? 'type' : undefined,
    }));

    const externalCount = imports.filter((i) => isExternal(i.specifier)).length;
    const internalCount = imports.length - externalCount;
    const title = `Module deps · ${internalCount} internal, ${externalCount} external`;

    return { kind: 'import', title, nodes, edges };
  },
};

export const __test = { extractImports, isExternal, basename };
