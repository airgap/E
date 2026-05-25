import { describe, test, expect } from 'vitest';
import {
  isLibraryManifest,
  manifestToPaletteGroups,
  ensureImport,
  type LibraryManifest,
} from '../pui-manifest';
import { parsePuiMarkup } from '../pui-ast';

const MANIFEST: LibraryManifest = {
  version: 1,
  library: '@parascape-design/components',
  groups: [
    {
      name: 'Forms & inputs',
      components: [
        {
          name: 'Input',
          id: 'input',
          description: 'Single-line text field.',
          import: { module: '@parascape-design/components/input', name: 'Input', default: true },
          snippet: '<Input />',
          props: [],
        },
        {
          name: 'Container',
          id: 'container',
          import: {
            module: '@parascape-design/components/container',
            name: 'Container',
            default: true,
          },
          snippet: '<Container></Container>',
          props: [],
        },
      ],
    },
    { name: 'Empty', components: [] },
  ],
};

describe('isLibraryManifest', () => {
  test('accepts a well-formed manifest', () => {
    expect(isLibraryManifest(MANIFEST)).toBe(true);
  });
  test('rejects junk', () => {
    expect(isLibraryManifest(null)).toBe(false);
    expect(isLibraryManifest({})).toBe(false);
    expect(isLibraryManifest({ library: 'x' })).toBe(false);
    expect(isLibraryManifest({ library: 'x', groups: [{ name: 'g' }] })).toBe(false);
  });
});

describe('manifestToPaletteGroups', () => {
  const groups = manifestToPaletteGroups(MANIFEST);

  test('maps groups and drops empty ones', () => {
    expect(groups.map((g) => g.group)).toEqual(['Forms & inputs']);
  });

  test('each item carries label, snippet, import, description', () => {
    const input = groups[0].items[0];
    expect(input.label).toBe('Input');
    expect(input.snippet).toBe('<Input />');
    expect(input.import).toEqual({
      module: '@parascape-design/components/input',
      name: 'Input',
      default: true,
    });
    expect(input.description).toBe('Single-line text field.');
  });
});

describe('ensureImport', () => {
  const imp = { module: '@parascape-design/components/input', name: 'Input', default: true };

  test('prepends a <script> when the source has none', () => {
    const out = ensureImport('<Input />\n', imp);
    expect(out).toContain("import Input from '@parascape-design/components/input';");
    expect(out.startsWith('<script')).toBe(true);
    // Markup below the new script still parses.
    expect(parsePuiMarkup(out).error).toBeUndefined();
  });

  test('inserts into an existing <script lang="ts"> block', () => {
    const src = '<script lang="ts">\n  let x = 1;\n</script>\n\n<Input />\n';
    const out = ensureImport(src, imp);
    expect(out).toContain("import Input from '@parascape-design/components/input';");
    // Exactly one <script> — it inserted, did not add a second.
    expect(out.match(/<script\b/g)).toHaveLength(1);
    expect(parsePuiMarkup(out).error).toBeUndefined();
  });

  test('emits a named import when not a default export', () => {
    const out = ensureImport('<Button />\n', {
      module: '@lyku/si-bits',
      name: 'Button',
      default: false,
    });
    expect(out).toContain("import { Button } from '@lyku/si-bits';");
  });

  test('dedupes by module — no-op when already imported', () => {
    const src =
      '<script lang="ts">\n  import Input from \'@parascape-design/components/input\';\n</script>\n<Input />';
    expect(ensureImport(src, imp)).toBe(src);
  });
});
