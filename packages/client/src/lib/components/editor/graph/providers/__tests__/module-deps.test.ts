import { describe, test, expect } from 'vitest';
import { moduleDepsProvider, __test } from '../module-deps';
import type { ProviderContext } from '../../types';

const { extractImports, isExternal, basename } = __test;

function makeCtx(filePath: string, doc: string): ProviderContext {
  return {
    filePath,
    workspacePath: '/workspace',
    pos: 0,
    doc,
    line: 0,
    column: 0,
  };
}

describe('moduleDepsProvider — extractImports', () => {
  test('catches default + named + namespace imports', () => {
    const src = `
import Foo from 'foo';
import { a, b } from './local';
import * as ns from "deep/import";
`;
    expect(extractImports(src).sort()).toEqual(['./local', 'deep/import', 'foo'].sort());
  });

  test('catches side-effect and type-only imports', () => {
    const src = `
import './side-effect.css';
import type { X } from '@e/shared';
`;
    expect(extractImports(src).sort()).toEqual(['./side-effect.css', '@e/shared'].sort());
  });

  test('catches dynamic imports', () => {
    const src = `
async function load() {
  const m = await import('./lazy');
  const other = await import("react-heavy-thing");
}
`;
    expect(extractImports(src).sort()).toEqual(['./lazy', 'react-heavy-thing'].sort());
  });

  test('handles multi-line import specifier lists', () => {
    const src = `
import {
  alpha,
  beta,
  gamma,
} from '@scope/multi-line';
`;
    expect(extractImports(src)).toEqual(['@scope/multi-line']);
  });

  test('deduplicates repeated imports of the same module', () => {
    const src = `
import { a } from 'foo';
import { b } from 'foo';
const c = import('foo');
`;
    expect(extractImports(src)).toEqual(['foo']);
  });

  test('returns [] when there are no imports', () => {
    expect(extractImports('const x = 1;')).toEqual([]);
  });

  test('does not match import-like words inside string literals', () => {
    // Lines that contain `import` but not at start / after whitespace+import keyword
    // should be safe. This is a regression guard for the regex anchor.
    const src = `const greeting = "we import code here";\n`;
    expect(extractImports(src)).toEqual([]);
  });
});

describe('moduleDepsProvider — classification helpers', () => {
  test('isExternal classifies bare specifiers as external', () => {
    expect(isExternal('lodash')).toBe(true);
    expect(isExternal('@scope/pkg')).toBe(true);
    expect(isExternal('$lib/foo')).toBe(true); // workspace alias, still treated as external in v1
  });

  test('isExternal classifies relative and absolute paths as internal', () => {
    expect(isExternal('./foo')).toBe(false);
    expect(isExternal('../bar')).toBe(false);
    expect(isExternal('/abs/path')).toBe(false);
  });

  test('basename strips path prefixes', () => {
    expect(basename('foo/bar/baz')).toBe('baz');
    expect(basename('./relative')).toBe('relative');
    expect(basename('plain')).toBe('plain');
  });
});

describe('moduleDepsProvider — supports / build', () => {
  test('supports() only fires for the four configured extensions', () => {
    expect(moduleDepsProvider.supports(makeCtx('/x.ts', ''))).toBe(true);
    expect(moduleDepsProvider.supports(makeCtx('/x.tsx', ''))).toBe(true);
    expect(moduleDepsProvider.supports(makeCtx('/x.svelte', ''))).toBe(true);
    expect(moduleDepsProvider.supports(makeCtx('/x.pui', ''))).toBe(true);
    expect(moduleDepsProvider.supports(makeCtx('/x.js', ''))).toBe(false);
    expect(moduleDepsProvider.supports(makeCtx('/x.css', ''))).toBe(false);
  });

  test('build() returns null when the file has no imports', async () => {
    const ctx = makeCtx('/x.ts', 'export const k = 1;');
    expect(await moduleDepsProvider.build(ctx)).toBeNull();
  });

  test('build() centers on the current file and adds one edge per import', async () => {
    const ctx = makeCtx(
      '/workspace/foo/Bar.svelte',
      `<script>
        import { onMount } from 'svelte';
        import Sibling from './Sibling.svelte';
        import { api } from '$lib/api/client';
      </script>`,
    );
    const graph = await moduleDepsProvider.build(ctx);
    expect(graph).not.toBeNull();
    expect(graph!.kind).toBe('import');
    expect(graph!.nodes.find((n) => n.center)).toMatchObject({
      label: 'Bar.svelte',
      kind: 'file',
    });
    expect(graph!.edges.map((e) => e.to).sort()).toEqual(
      ['import:$lib/api/client', 'import:./Sibling.svelte', 'import:svelte'].sort(),
    );
    // External vs internal classification
    const sveltImport = graph!.nodes.find((n) => n.id === 'import:svelte');
    expect(sveltImport?.kind).toBe('external');
    const siblingImport = graph!.nodes.find((n) => n.id === 'import:./Sibling.svelte');
    expect(siblingImport?.kind).toBe('file');
  });

  test('build() title reflects internal/external split', async () => {
    const ctx = makeCtx('/x.ts', `import 'foo'; import './local'; import 'bar';`);
    const graph = await moduleDepsProvider.build(ctx);
    expect(graph!.title).toBe('Module deps · 1 internal, 2 external');
  });
});
