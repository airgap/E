/**
 * ComponentTreeProvider — semantic edition.
 *
 * Walks the svelte/compiler fragment AST to collect actually-used
 * component tags, then matches each against the script-block imports
 * (TS AST). Compared to the v1 regex extractor this:
 *   - Correctly distinguishes HTML elements from components (svelte AST
 *     tags them: Element vs Component / RegularElement vs SvelteComponent)
 *   - Handles dynamic-component nodes (`<svelte:component this={X}>`),
 *     adding the dynamic-binding identifier as a usage
 *   - Skips type-only imports cleanly (they don't have runtime bindings)
 *   - Handles renamed-on-import (`{ Foo as Bar }` → `Bar` is the local
 *     name to match against tag usage)
 */
import ts from 'typescript';
import type { RelationProvider, ProviderContext, RelationGraph } from '../types';
import { fileKindFromPath, parseSvelte, scriptViewOf } from '../ast';

interface ImportedBinding {
  /** Local name bound in this file (after `as` if renamed). */
  local: string;
  /** Module specifier the binding came from. */
  source: string;
}

function basename(p: string): string {
  const slash = p.lastIndexOf('/');
  return slash >= 0 ? p.slice(slash + 1) : p;
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9_$]*$/.test(name);
}

/**
 * Extract every runtime-bound name from the file's import declarations.
 * Type-only imports are skipped (they have no runtime presence and so
 * can't be component renders).
 */
export function extractImports(source: ts.SourceFile): ImportedBinding[] {
  const out: ImportedBinding[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const moduleSpec = node.moduleSpecifier;
      if (!ts.isStringLiteral(moduleSpec)) return;
      const importClause = node.importClause;
      // `import type {…}` blanket-skip — nothing here is runtime-bound.
      if (importClause?.isTypeOnly) return;
      const sourceText = moduleSpec.text;
      // Default import: `import Foo from '…'`
      if (importClause?.name) {
        out.push({ local: importClause.name.text, source: sourceText });
      }
      const named = importClause?.namedBindings;
      if (named) {
        if (ts.isNamespaceImport(named)) {
          // `import * as Foo from '…'`
          out.push({ local: named.name.text, source: sourceText });
        } else if (ts.isNamedImports(named)) {
          for (const el of named.elements) {
            if (el.isTypeOnly) continue; // inline `type Foo`
            // `import { Foo as Bar }` — Bar is the local binding.
            out.push({ local: el.name.text, source: sourceText });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return out;
}

/**
 * Walk the svelte template fragment, collecting component-tag names.
 * Svelte 5 AST shapes (in `modern: true` mode):
 *   - Component       (named local component, e.g. `<Foo />`)
 *   - RegularElement  (lowercase HTML element)
 *   - SvelteComponent (dynamic — `<svelte:component this={X} />`); the
 *     `this` attribute carries the runtime binding to resolve.
 *   - TitleElement / SvelteHead / SvelteWindow / SvelteBody → skip
 */
export function extractTagUsages(fragment: any): Set<string> {
  const used = new Set<string>();
  if (!fragment) return used;
  function visit(n: any) {
    if (!n || typeof n !== 'object') return;
    const type = n.type;
    if (type === 'Component') {
      // For namespaced tags like `<Lib.Foo />` svelte still uses the head
      // identifier as the runtime binding to look up; the AST stores the
      // whole dotted path as the name.
      const root = String(n.name ?? '').split('.')[0];
      if (root) used.add(root);
    } else if (type === 'SvelteComponent') {
      // svelte 5: `<svelte:component this={X} />` is a SvelteComponent
      // node with a direct `expression` field (not an `attributes` entry).
      // Pull the head identifier; handles both `this={Foo}` and member-
      // access forms like `this={obj.Sub}` (binding is `obj`).
      const ident = findIdentifierName(n.expression);
      if (ident) used.add(ident);
    }
    // Recurse into common AST shapes. We don't know every possible field
    // name, so traverse generically.
    for (const key of Object.keys(n)) {
      const val = (n as any)[key];
      if (Array.isArray(val)) {
        for (const item of val) visit(item);
      } else if (val && typeof val === 'object' && key !== 'parent') {
        visit(val);
      }
    }
  }
  visit(fragment);
  return used;
}

/**
 * Pull an Identifier name out of an Attribute subtree (used for
 * `<svelte:component this={Foo}>` resolution).
 */
function findIdentifierName(node: any): string | null {
  if (!node) return null;
  if (node.type === 'Identifier' && typeof node.name === 'string') return node.name;
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        const found = findIdentifierName(item);
        if (found) return found;
      }
    } else if (val && typeof val === 'object') {
      const found = findIdentifierName(val);
      if (found) return found;
    }
  }
  return null;
}

export const componentTreeProvider: RelationProvider = {
  kind: 'component',
  supports(ctx: ProviderContext): boolean {
    const k = fileKindFromPath(ctx.filePath);
    return k === 'svelte' || k === 'pui';
  },
  async build(ctx: ProviderContext): Promise<RelationGraph | null> {
    const kind = fileKindFromPath(ctx.filePath);
    if (kind !== 'svelte' && kind !== 'pui') return null;

    const svelteAst = parseSvelte(ctx.doc).ast;
    const view = scriptViewOf(ctx.doc, kind);

    const imports = extractImports(view.source);
    if (imports.length === 0) return null;

    const tagsUsed = extractTagUsages(svelteAst?.fragment ?? null);
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

export const __test = { extractImports, extractTagUsages, isPascalCase };
