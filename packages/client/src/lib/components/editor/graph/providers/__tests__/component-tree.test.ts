import { describe, test, expect } from 'vitest';
import { componentTreeProvider, __test } from '../component-tree';
import { parseSvelte, scriptViewOf } from '../../ast';
import type { ProviderContext } from '../../types';

const { extractImports, extractTagUsages, isPascalCase } = __test;

function makeCtx(filePath: string, doc: string): ProviderContext {
  return { filePath, workspacePath: '/workspace', pos: 0, doc, line: 0, column: 0 };
}

describe('componentTreeProvider — extractImports (TS AST)', () => {
  test('default + named + namespace + renamed', () => {
    const src = scriptViewOf(
      `<script>
import Sibling from './Sibling.svelte';
import { Button, type IconName, Wrapper as W } from '$lib/ui';
import * as Lib from 'svelte';
</script>`,
      'svelte',
    ).source;
    const imps = extractImports(src);
    const map = new Map(imps.map((b) => [b.local, b.source]));
    expect(map.get('Sibling')).toBe('./Sibling.svelte');
    expect(map.get('Button')).toBe('$lib/ui');
    // `type IconName` is inline-type-only — correctly excluded as a
    // runtime binding (would never be a real component render).
    expect(map.has('IconName')).toBe(false);
    // `Wrapper as W` → local name is W (after `as`).
    expect(map.get('W')).toBe('$lib/ui');
    expect(map.has('Wrapper')).toBe(false);
    expect(map.get('Lib')).toBe('svelte');
  });

  test('whole-import `import type {…}` is skipped entirely', () => {
    const src = scriptViewOf(
      `<script>import type { X } from '@e/shared';</script>`,
      'svelte',
    ).source;
    expect(extractImports(src)).toEqual([]);
  });
});

describe('componentTreeProvider — isPascalCase', () => {
  test('Foo / FooBar / F yes', () => {
    expect(isPascalCase('Foo')).toBe(true);
    expect(isPascalCase('FooBar')).toBe(true);
    expect(isPascalCase('F')).toBe(true);
  });
  test('lowercase / camelCase / digit-start no', () => {
    expect(isPascalCase('foo')).toBe(false);
    expect(isPascalCase('fooBar')).toBe(false);
    expect(isPascalCase('1Foo')).toBe(false);
  });
});

describe('componentTreeProvider — extractTagUsages (svelte AST)', () => {
  test('opening, self-closing, and member-expression component tags', () => {
    const ast = parseSvelte(`<script>
import Foo from './Foo.svelte';
import Bar from './Bar.svelte';
import { Lib } from 'somewhere';
</script>
<Foo />
<Bar prop={x}>hi</Bar>
<Lib.Button />`).ast;
    const tags = extractTagUsages(ast?.fragment ?? null);
    expect(tags.has('Foo')).toBe(true);
    expect(tags.has('Bar')).toBe(true);
    // For Lib.Button the root binding is `Lib`.
    expect(tags.has('Lib')).toBe(true);
  });

  test('TypeScript generics inside scripts are NOT picked up as tags', () => {
    // `Array<MyType>` lives in a TS expression inside `<script>`, NOT in
    // the markup — the AST keeps these worlds separate, so the v1 false
    // positive is impossible by construction.
    const ast = parseSvelte(`<script>
const arr: Array<MyType> = [];
</script>`).ast;
    const tags = extractTagUsages(ast?.fragment ?? null);
    expect(tags.has('MyType')).toBe(false);
  });

  test('HTML elements (lowercase) are not collected', () => {
    const ast = parseSvelte(`<script></script>
<div><span><p>hi</p></span></div>`).ast;
    const tags = extractTagUsages(ast?.fragment ?? null);
    expect(tags.size).toBe(0);
  });

  test('dynamic `<svelte:component this={X}>` adds X', () => {
    const ast = parseSvelte(`<script>
import Foo from './Foo.svelte';
let CurrentTab = Foo;
</script>
<svelte:component this={CurrentTab} />`).ast;
    const tags = extractTagUsages(ast?.fragment ?? null);
    expect(tags.has('CurrentTab')).toBe(true);
  });
});

describe('componentTreeProvider — supports / build', () => {
  test('supports() restricted to .pui / .svelte', () => {
    expect(componentTreeProvider.supports(makeCtx('/x.svelte', ''))).toBe(true);
    expect(componentTreeProvider.supports(makeCtx('/x.pui', ''))).toBe(true);
    expect(componentTreeProvider.supports(makeCtx('/x.ts', ''))).toBe(false);
  });

  test('build() returns null when no component tags are used', async () => {
    const ctx = makeCtx(
      '/x.svelte',
      `<script>
import { thing } from 'lodash';
</script>
<p>hi</p>`,
    );
    expect(await componentTreeProvider.build(ctx)).toBeNull();
  });

  test('build() returns edges from this file to each rendered child component', async () => {
    const ctx = makeCtx(
      '/workspace/Foo.svelte',
      `<script>
import Sibling from './Sibling.svelte';
import { Button } from '$lib/ui';
import { lowercaseUtil } from './utils';
</script>
<Sibling />
<Button on:click={lowercaseUtil}>click</Button>`,
    );
    const g = await componentTreeProvider.build(ctx);
    expect(g).not.toBeNull();
    expect(g!.kind).toBe('component');
    expect(g!.title).toBe('Components rendered · 2');
    expect(g!.edges.map((e) => e.to).sort()).toEqual(['comp:Button', 'comp:Sibling']);
    expect(g!.nodes.find((n) => n.label === 'lowercaseUtil')).toBeUndefined();
  });

  test('build() filters out PascalCase imports that are never used as tags', async () => {
    const ctx = makeCtx(
      '/x.svelte',
      `<script>
import Unused from './Unused.svelte';
import Used from './Used.svelte';
</script>
<Used />`,
    );
    const g = await componentTreeProvider.build(ctx);
    expect(g).not.toBeNull();
    expect(g!.nodes.find((n) => n.label === 'Unused')).toBeUndefined();
    expect(g!.nodes.find((n) => n.label === 'Used')).toBeDefined();
  });
});
