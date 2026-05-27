import { describe, test, expect } from 'vitest';
import { componentTreeProvider, __test } from '../component-tree';
import type { ProviderContext } from '../../types';

const { parseBindings, extractImports, extractTagUsages, isPascalCase } = __test;

function makeCtx(filePath: string, doc: string): ProviderContext {
  return { filePath, workspacePath: '/workspace', pos: 0, doc, line: 0, column: 0 };
}

describe('componentTreeProvider — parseBindings', () => {
  test('default import head', () => {
    expect(parseBindings(' Foo ')).toEqual(['Foo']);
  });
  test('named-only block', () => {
    expect(parseBindings(' { A, B, C } ').sort()).toEqual(['A', 'B', 'C']);
  });
  test('renamed binding via `as`', () => {
    expect(parseBindings(' { A as Aliased, B } ').sort()).toEqual(['Aliased', 'B']);
  });
  test('namespace import', () => {
    expect(parseBindings(' * as ns ')).toContain('ns');
  });
  test('mixed default + named', () => {
    expect(parseBindings(' Foo, { Bar } ').sort()).toEqual(['Bar', 'Foo']);
  });
});

describe('componentTreeProvider — extractImports', () => {
  test('multiple imports from different sources', () => {
    const src = `
import Sibling from './Sibling.svelte';
import { Button, type IconName } from '$lib/ui';
import * as Lib from 'svelte';
`;
    const imps = extractImports(src);
    const map = new Map(imps.map((b) => [b.local, b.source]));
    expect(map.get('Sibling')).toBe('./Sibling.svelte');
    expect(map.get('Button')).toBe('$lib/ui');
    // `type IconName` is a type-only binding — not a runtime symbol; the
    // plain-identifier matcher correctly skips it so it never becomes a
    // candidate "component". Asserting absence guards that.
    expect(map.has('IconName')).toBe(false);
    expect(map.get('Lib')).toBe('svelte');
  });

  test('handles type-only imports', () => {
    const imps = extractImports(`import type { X } from '@e/shared';\n`);
    expect(imps.map((i) => i.local)).toEqual(['X']);
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

describe('componentTreeProvider — extractTagUsages', () => {
  test('opening, closing, self-closing, and attribute-bearing tags', () => {
    const src = `<Foo />
<Bar prop={x}>
  <Baz>hi</Baz>
</Bar>
`;
    const tags = extractTagUsages(src);
    expect(tags.has('Foo')).toBe(true);
    expect(tags.has('Bar')).toBe(true);
    expect(tags.has('Baz')).toBe(true);
  });

  test('does NOT match TypeScript generic `Array<Name>` inside script', () => {
    // Generics are typically preceded by a function/type identifier (not by
    // whitespace/`>`/`}`/SOL), so the leading-context anchor protects us.
    const src = `const arr: Array<MyType> = [];`;
    const tags = extractTagUsages(src);
    expect(tags.has('MyType')).toBe(false);
  });

  test('member-expression tags `Foo.Bar` use the root binding', () => {
    const tags = extractTagUsages('<Lib.Button />');
    expect(tags.has('Lib')).toBe(true);
    expect(tags.has('Lib.Button')).toBe(false);
  });
});

describe('componentTreeProvider — supports / build', () => {
  test('supports() restricted to .pui / .svelte', () => {
    expect(componentTreeProvider.supports(makeCtx('/x.svelte', ''))).toBe(true);
    expect(componentTreeProvider.supports(makeCtx('/x.pui', ''))).toBe(true);
    expect(componentTreeProvider.supports(makeCtx('/x.ts', ''))).toBe(false);
  });

  test('build() returns null when imports are present but no component tags are used', async () => {
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
    // lowercase imports are filtered out (not PascalCase)
    expect(g!.nodes.find((n) => n.label === 'lowercaseUtil')).toBeUndefined();
  });

  test('build() filters out PascalCase imports that are never used in markup', async () => {
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
