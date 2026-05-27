import { describe, test, expect } from 'vitest';
import { moduleDepsProvider, __test } from '../module-deps';
import { parseTs, scriptViewOf } from '../../ast';
import type { ProviderContext } from '../../types';

const { extractImports, isExternal, basename } = __test;

function makeCtx(filePath: string, doc: string): ProviderContext {
  return { filePath, workspacePath: '/workspace', pos: 0, doc, line: 0, column: 0 };
}

describe('moduleDepsProvider — extractImports (AST)', () => {
  test('default + named + namespace imports', () => {
    const src = parseTs(`
import Foo from 'foo';
import { a, b } from './local';
import * as ns from "deep/import";
`);
    const imps = extractImports(src);
    expect(imps.map((i) => i.specifier).sort()).toEqual(['./local', 'deep/import', 'foo']);
    expect(imps.every((i) => !i.dynamic)).toBe(true);
  });

  test('side-effect import is captured', () => {
    const src = parseTs(`import './side-effect.css';`);
    const imps = extractImports(src);
    expect(imps[0].specifier).toBe('./side-effect.css');
  });

  test('type-only imports get the typeOnly flag', () => {
    const src = parseTs(`import type { X } from '@e/shared';`);
    const imps = extractImports(src);
    expect(imps).toHaveLength(1);
    expect(imps[0]).toMatchObject({ specifier: '@e/shared', typeOnly: true });
  });

  test('dynamic imports are captured with the dynamic flag', () => {
    const src = parseTs(`
async function load() {
  const m = await import('./lazy');
  const other = await import("react-heavy-thing");
}
`);
    const imps = extractImports(src);
    expect(imps.map((i) => i.specifier).sort()).toEqual(['./lazy', 'react-heavy-thing']);
    expect(imps.every((i) => i.dynamic)).toBe(true);
  });

  test('multi-line specifier lists are parsed correctly', () => {
    const src = parseTs(`
import {
  alpha,
  beta,
  gamma,
} from '@scope/multi-line';
`);
    const imps = extractImports(src);
    expect(imps.map((i) => i.specifier)).toEqual(['@scope/multi-line']);
  });

  test('dedupes repeated imports of the same module', () => {
    const src = parseTs(`
import { a } from 'foo';
import { b } from 'foo';
const c = import('foo');
`);
    const imps = extractImports(src);
    // static `foo` and dynamic `foo` are separate entries (different semantics)
    const statics = imps.filter((i) => i.specifier === 'foo' && !i.dynamic);
    const dyns = imps.filter((i) => i.specifier === 'foo' && i.dynamic);
    expect(statics).toHaveLength(1);
    expect(dyns).toHaveLength(1);
  });

  test('does NOT match `import` words inside strings (regression vs v1)', () => {
    const src = parseTs(`const greeting = "we import code here";`);
    expect(extractImports(src)).toEqual([]);
  });

  test('does NOT match `import` words inside comments (regression vs v1)', () => {
    const src = parseTs(`// import { x } from 'evil';\nconst y = 1;`);
    expect(extractImports(src)).toEqual([]);
  });

  test('finds imports inside a .svelte <script> block', () => {
    const text = `<script lang="ts">
  import { onMount } from 'svelte';
  import Sibling from './Sibling.svelte';
</script>
<p>hi</p>`;
    const view = scriptViewOf(text, 'svelte');
    const imps = extractImports(view.source);
    expect(imps.map((i) => i.specifier).sort()).toEqual(['./Sibling.svelte', 'svelte']);
  });
});

describe('moduleDepsProvider — classification helpers', () => {
  test('isExternal classifies bare specifiers as external', () => {
    expect(isExternal('lodash')).toBe(true);
    expect(isExternal('@scope/pkg')).toBe(true);
    expect(isExternal('$lib/foo')).toBe(true);
  });
  test('isExternal classifies relative/absolute as internal', () => {
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
  test('supports() recognises ts/tsx/svelte/pui', () => {
    expect(moduleDepsProvider.supports(makeCtx('/x.ts', ''))).toBe(true);
    expect(moduleDepsProvider.supports(makeCtx('/x.tsx', ''))).toBe(true);
    expect(moduleDepsProvider.supports(makeCtx('/x.svelte', ''))).toBe(true);
    expect(moduleDepsProvider.supports(makeCtx('/x.pui', ''))).toBe(true);
    expect(moduleDepsProvider.supports(makeCtx('/x.js', ''))).toBe(false);
    expect(moduleDepsProvider.supports(makeCtx('/x.css', ''))).toBe(false);
  });

  test('build() returns null when the file has no imports', async () => {
    expect(await moduleDepsProvider.build(makeCtx('/x.ts', 'export const k = 1;'))).toBeNull();
  });

  test('build() centers on the current file and emits one edge per import', async () => {
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
