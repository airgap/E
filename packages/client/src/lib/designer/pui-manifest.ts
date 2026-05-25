// Generic component-manifest consumer (LYK-969).
//
// A library describes its components in a versioned, tool-agnostic
// `component-manifest.json` (discovered via its package.json "componentManifest"
// field). This module is the CONSUMER side: it types that contract and converts
// a manifest into palette groups the designer can offer — so any library that
// ships a manifest (Parascape today, @lyku/si-bits or a Cloudscape port
// tomorrow) populates the palette with no E-side per-library code.
//
// Resolution (whether the inserted import renders in the preview) is orthogonal:
// the manifest only declares the import specifier; the bundle resolver handles
// the rest, and an unresolved component just shows the usual overlay.
import type { PaletteGroup, PaletteItem } from './pui-palette';

export interface ManifestImport {
  module: string;
  name: string;
  default: boolean;
}

export interface ManifestComponent {
  name: string;
  id: string;
  description?: string;
  import: ManifestImport;
  snippet: string;
  props?: unknown[];
}

export interface ManifestGroup {
  name: string;
  components: ManifestComponent[];
}

export interface LibraryManifest {
  version: number;
  library: string;
  generatedAt?: string;
  groups: ManifestGroup[];
}

/** Narrowing guard for an untrusted manifest payload (e.g. fetched JSON). */
export function isLibraryManifest(value: unknown): value is LibraryManifest {
  const m = value as LibraryManifest | null;
  return (
    !!m &&
    typeof m.library === 'string' &&
    Array.isArray(m.groups) &&
    m.groups.every((g) => g && typeof g.name === 'string' && Array.isArray(g.components))
  );
}

/**
 * Ensure a component's import is present in a `.pui` source's `<script>` block.
 * Deduped by module; inserts into the existing script, or prepends a new one.
 * The import goes at the top, so markup offsets/path-ids below are undisturbed.
 * (Lives here — a plain .ts module — so it can use literal script tags that a
 * `.svelte`/`.pui` source could not without ending its own block.)
 */
export function ensureImport(src: string, imp: ManifestImport): string {
  if (src.includes(`'${imp.module}'`) || src.includes(`"${imp.module}"`)) return src;
  const stmt = imp.default
    ? `import ${imp.name} from '${imp.module}';`
    : `import { ${imp.name} } from '${imp.module}';`;
  const open = /<script\b[^>]*>/.exec(src);
  if (open) {
    const at = open.index + open[0].length;
    return src.slice(0, at) + `\n  ${stmt}` + src.slice(at);
  }
  return `<script lang="ts">\n  ${stmt}\n</script>\n\n` + src;
}

/**
 * Convert a library manifest into palette groups. Group labels are prefixed with
 * the library so multiple libraries' groups don't collide; each component item
 * carries the import to weave into the <script> on insert.
 */
export function manifestToPaletteGroups(m: LibraryManifest): PaletteGroup[] {
  return m.groups
    .map((g) => ({
      group: g.name,
      items: g.components.map(
        (c): PaletteItem => ({
          label: c.name,
          snippet: c.snippet,
          import: c.import,
          description: c.description,
        }),
      ),
    }))
    .filter((g) => g.items.length > 0);
}
